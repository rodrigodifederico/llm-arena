// MatchController (§4.2): game-agnostic loop. Knows nothing about any specific
// game — it only talks to the GameEngine interface. Handles retries, timeouts,
// default actions, forfeit-by-repeated-failure, pause/step/abort, and builds
// the replay artifact incrementally.

import type { Action, GameEngine, GameResult, GameState, PlayerId } from "../engine/GameEngine";
import { deepClone } from "../engine/GameEngine";
import type { EndpointConfig, LLMCallResult } from "../llm/LLMClient";
import { callChat, costOf } from "../llm/LLMClient";
import type { AttemptRecord, DecisionRecord, PlayerTotals, Replay, TurnRecord } from "./replay";
import { emptyTotals } from "./replay";

export interface MatchSettings {
  temperature: number;
  allowThinking: boolean;
  maxRetries: number; // extra attempts after the first (2 => 3 tries total)
  decisionTimeoutMs: number;
  forfeitLimit: number; // consecutive forfeited decisions => lose the match
}

export type MatchStatus = "idle" | "running" | "paused" | "finished" | "aborted";

export interface MatchListener {
  onStatus(status: MatchStatus): void;
  onStateChange(state: GameState): void;
  onThinking(player: PlayerId, thinking: boolean): void;
  onTurn(turn: TurnRecord): void;
  onTotals(totals: Record<PlayerId, PlayerTotals>): void;
  onFinish(replay: Replay): void;
}

function envelopeInstructions(allowThinking: boolean): string {
  const common =
    `\n\nRESPONSE FORMAT — respond with ONLY one JSON object and no other text:\n`;
  if (allowThinking) {
    return (
      common +
      `{"reasoning": "one short paragraph explaining your decision (optional)", "action": { ... }, "notes": "private scratchpad; echoed back to you on your next turn, never shown to the opponent (optional)"}\n` +
      `"action" is REQUIRED and must follow this game's action schema exactly.`
    );
  }
  return (
    common +
    `{"action": { ... }, "notes": "private scratchpad echoed back to you next turn (optional)"}\n` +
    `"action" is REQUIRED and must follow this game's action schema exactly. Do NOT include reasoning, explanations or any prose.`
  );
}

const MAX_TOTAL_TURNS = 2000; // hard safety cap, far above any game's natural length

export class MatchController {
  readonly matchId: string;
  private readonly engine: GameEngine;
  private readonly players: Record<PlayerId, EndpointConfig>;
  private readonly settings: MatchSettings;
  private readonly seed: string;
  private readonly listener: MatchListener;

  private turns: TurnRecord[] = [];
  private totals: Record<PlayerId, PlayerTotals> = { A: emptyTotals(), B: emptyTotals() };
  private latencySums: Record<PlayerId, number> = { A: 0, B: 0 };
  private latencyCounts: Record<PlayerId, number> = { A: 0, B: 0 };
  private notes: Partial<Record<PlayerId, string>> = {};

  private status: MatchStatus = "idle";
  private aborted = false;
  private paused = false;
  private pauseAfterTurn = false;
  private waiters: (() => void)[] = [];
  private abortCtrl = new AbortController();

  constructor(opts: {
    engine: GameEngine;
    players: Record<PlayerId, EndpointConfig>;
    settings: MatchSettings;
    seed: string;
    listener: MatchListener;
  }) {
    this.engine = opts.engine;
    this.players = opts.players;
    this.settings = opts.settings;
    this.seed = opts.seed;
    this.listener = opts.listener;
    this.matchId = crypto.randomUUID();
  }

  pause(): void {
    if (this.status === "idle") {
      this.paused = true;
      return;
    }
    if (this.status !== "running") return;
    this.paused = true;
    this.setStatus("paused");
  }

  resume(): void {
    this.pauseAfterTurn = false;
    this.releaseGate();
  }

  // From pause: play exactly one turn, then pause again.
  step(): void {
    this.pauseAfterTurn = true;
    this.releaseGate();
  }

  abort(): void {
    this.aborted = true;
    this.abortCtrl.abort();
    this.releaseGate();
  }

  private releaseGate(): void {
    this.paused = false;
    if (this.status === "paused") this.setStatus("running");
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach((w) => w());
  }

  private async gate(): Promise<void> {
    while (this.paused && !this.aborted) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  private setStatus(s: MatchStatus): void {
    this.status = s;
    this.listener.onStatus(s);
  }

  private bumpTotals(player: PlayerId, a: AttemptRecord): void {
    const t = this.totals[player];
    t.tokensIn += a.tokensIn;
    t.tokensOut += a.tokensOut;
    t.cost = costOf(this.players[player], t.tokensIn, t.tokensOut);
    if (a.latencyMs > 0) {
      this.latencySums[player] += a.latencyMs;
      this.latencyCounts[player] += 1;
      t.avgLatencyMs = Math.round(this.latencySums[player] / this.latencyCounts[player]);
    }
    if (a.estimatedTokens) t.anyEstimated = true;
    this.listener.onTotals(deepClone(this.totals));
  }

  private async decide(
    state: GameState,
    player: PlayerId,
  ): Promise<{ record: DecisionRecord; action: Action; forfeited: boolean }> {
    const req = this.engine.buildTurnRequest(state, player);
    let userPrompt = req.userPrompt;
    const myNotes = this.notes[player];
    if (myNotes) {
      userPrompt += `\n\nYOUR PRIVATE NOTES (kept by you on a previous turn, invisible to the opponent):\n${myNotes}`;
    }
    const systemPrompt = req.systemPrompt + envelopeInstructions(this.settings.allowThinking);

    const attempts: AttemptRecord[] = [];
    let accepted: Action | null = null;
    let prevError: string | null = null;

    this.listener.onThinking(player, true);
    try {
      for (let attempt = 0; attempt <= this.settings.maxRetries && !this.aborted; attempt++) {
        const content = prevError
          ? `${userPrompt}\n\nYOUR PREVIOUS RESPONSE WAS REJECTED — reason: ${prevError}\nRespond again with a single valid JSON object containing a LEGAL action.`
          : userPrompt;

        let resp: LLMCallResult;
        try {
          resp = await callChat(
            this.players[player],
            [
              { role: "system", content: systemPrompt },
              { role: "user", content },
            ],
            {
              temperature: this.settings.temperature,
              timeoutMs: this.settings.decisionTimeoutMs,
              signal: this.abortCtrl.signal,
            },
          );
        } catch (e) {
          if (this.aborted) break;
          const msg = e instanceof Error ? e.message : String(e);
          const rec: AttemptRecord = {
            raw: "",
            parsed: null,
            valid: false,
            error: msg,
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: 0,
            estimatedTokens: false,
          };
          attempts.push(rec);
          this.bumpTotals(player, rec);
          prevError = null; // transport error: retry with the same prompt
          continue;
        }

        if (!resp.parsed || resp.parseError || typeof resp.parsed.action !== "object" || resp.parsed.action === null) {
          const err =
            resp.parseError ??
            `The "action" field is missing or is not a JSON object. Return {"action": { ... }}.`;
          const rec: AttemptRecord = { ...toAttempt(resp), valid: false, error: err };
          attempts.push(rec);
          this.bumpTotals(player, rec);
          prevError = err;
          continue;
        }

        const v = this.engine.validateAction(state, player, resp.parsed.action as Action);
        const rec: AttemptRecord = {
          ...toAttempt(resp),
          valid: v.ok,
          error: v.ok ? null : v.error,
        };
        attempts.push(rec);
        this.bumpTotals(player, rec);

        if (v.ok) {
          accepted = v.action;
          const n = resp.parsed.notes;
          if (typeof n === "string" && n.trim()) this.notes[player] = n.slice(0, 2000);
          break;
        }
        prevError = v.error;
      }
    } finally {
      this.listener.onThinking(player, false);
    }

    const forfeited = accepted === null;
    const action = accepted ?? this.engine.defaultAction(state, player);
    const t = this.totals[player];
    t.decisions += 1;
    if (forfeited) t.forfeits += 1;
    this.listener.onTotals(deepClone(this.totals));

    return {
      record: {
        player,
        systemPrompt,
        userPrompt,
        attempts,
        acceptedAction: action,
        forfeitedDecision: forfeited,
        summary:
          this.engine.summarizeAction(state, player, action) + (forfeited ? " (defaulted)" : ""),
      },
      action,
      forfeited,
    };
  }

  async run(): Promise<Replay> {
    this.setStatus("running");
    let state = this.engine.init(this.seed);
    const initialState = deepClone(state);
    this.listener.onStateChange(deepClone(state));

    const consecutiveForfeits: Record<PlayerId, number> = { A: 0, B: 0 };
    let forfeitLoser: PlayerId | null = null;
    let turnIndex = 0;

    while (!this.engine.isTerminal(state) && !this.aborted && turnIndex < MAX_TOTAL_TURNS) {
      await this.gate();
      if (this.aborted) break;

      const pending = this.engine.pendingDecisions(state);
      // sequential: 1 player; simultaneous: both, decided in parallel
      const results = await Promise.all(pending.map((p) => this.decide(state, p)));
      if (this.aborted) break;

      const actions: Partial<Record<PlayerId, Action>> = {};
      const decisions: Partial<Record<PlayerId, DecisionRecord>> = {};
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        actions[p] = results[i].action;
        decisions[p] = results[i].record;
        if (results[i].forfeited) {
          consecutiveForfeits[p] += 1;
          if (consecutiveForfeits[p] >= this.settings.forfeitLimit) forfeitLoser = p;
        } else {
          consecutiveForfeits[p] = 0;
        }
      }

      state = this.engine.applyActions(state, actions);
      const turn: TurnRecord = { index: turnIndex++, decisions, stateAfter: deepClone(state) };
      this.turns.push(turn);
      this.listener.onTurn(turn);
      this.listener.onStateChange(deepClone(state));

      if (forfeitLoser) break;

      if (this.pauseAfterTurn) {
        this.pauseAfterTurn = false;
        this.paused = true;
        this.setStatus("paused");
      }
    }

    let result: GameResult | null;
    if (this.aborted) {
      result = null;
    } else if (forfeitLoser) {
      const winner: PlayerId = forfeitLoser === "A" ? "B" : "A";
      result = {
        winner,
        reason: `${this.players[forfeitLoser].label || forfeitLoser} forfeited: ${this.settings.forfeitLimit} consecutive failed decisions`,
        score: { A: 0, B: 0 },
      };
    } else {
      result = this.engine.result(state);
    }

    const replay: Replay = {
      matchId: this.matchId,
      createdAt: new Date().toISOString(),
      game: this.engine.id,
      seed: this.seed,
      settings: {
        temperature: this.settings.temperature,
        allowThinking: this.settings.allowThinking,
        maxRetries: this.settings.maxRetries,
        decisionTimeoutMs: this.settings.decisionTimeoutMs,
      },
      // endpoint + model + label only — API keys are never written to replays
      players: {
        A: { label: this.players.A.label, model: this.players.A.model, endpoint: this.players.A.baseUrl },
        B: { label: this.players.B.label, model: this.players.B.model, endpoint: this.players.B.baseUrl },
      },
      initialState,
      turns: this.turns,
      result,
      aborted: this.aborted,
      totals: deepClone(this.totals),
    };

    this.setStatus(this.aborted ? "aborted" : "finished");
    this.listener.onFinish(replay);
    return replay;
  }
}

function toAttempt(resp: LLMCallResult): Omit<AttemptRecord, "valid" | "error"> {
  return {
    raw: resp.raw,
    parsed: resp.parsed,
    tokensIn: resp.promptTokens,
    tokensOut: resp.completionTokens,
    latencyMs: resp.latencyMs,
    estimatedTokens: resp.estimatedTokens,
  };
}
