// Replay artifact (§9): one JSON object per match. API keys are NEVER stored.

import type { Action, GameResult, GameState, PlayerId } from "../engine/GameEngine";
import type { ParsedEnvelope } from "../llm/LLMClient";

export interface AttemptRecord {
  raw: string;
  parsed: ParsedEnvelope | null;
  valid: boolean;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  estimatedTokens: boolean;
}

export interface DecisionRecord {
  player: PlayerId;
  systemPrompt: string;
  userPrompt: string;
  attempts: AttemptRecord[];
  acceptedAction: Action;
  forfeitedDecision: boolean;
  summary: string;
}

// One turn = one applyActions step. Sequential games have one decision;
// simultaneous games (Standoff) hold both players' decisions + one stateAfter.
export interface TurnRecord {
  index: number;
  decisions: Partial<Record<PlayerId, DecisionRecord>>;
  stateAfter: GameState;
}

export interface PlayerTotals {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  avgLatencyMs: number;
  decisions: number;
  forfeits: number;
  anyEstimated: boolean;
}

export interface ReplayPlayerInfo {
  label: string;
  model: string;
  endpoint: string;
}

export interface Replay {
  matchId: string;
  createdAt: string;
  game: string;
  seed: string;
  settings: {
    temperature: number;
    allowThinking: boolean;
    maxRetries: number;
    decisionTimeoutMs: number;
  };
  players: Record<PlayerId, ReplayPlayerInfo>;
  initialState: GameState;
  turns: TurnRecord[];
  result: GameResult | null; // null only for aborted matches
  aborted: boolean;
  totals: Record<PlayerId, PlayerTotals>;
}

export function emptyTotals(): PlayerTotals {
  return { tokensIn: 0, tokensOut: 0, cost: 0, avgLatencyMs: 0, decisions: 0, forfeits: 0, anyEstimated: false };
}

export function serializeReplay(r: Replay): string {
  return JSON.stringify(r, null, 1);
}

export function parseReplay(json: string): Replay {
  const r = JSON.parse(json) as Replay;
  if (!r || typeof r !== "object") throw new Error("Not a replay file");
  for (const field of ["matchId", "game", "seed", "initialState", "turns", "players"] as const) {
    if (!(field in r)) throw new Error(`Invalid replay: missing "${field}"`);
  }
  if (!Array.isArray(r.turns)) throw new Error("Invalid replay: turns must be an array");
  // Defensive: strip anything that looks like a key if a foreign file smuggles one in.
  for (const p of ["A", "B"] as const) {
    const info = r.players[p] as unknown as Record<string, unknown>;
    if (info) delete info.apiKey;
  }
  return r;
}

export function downloadReplay(r: Replay): void {
  const blob = new Blob([serializeReplay(r)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `llm-arena_${r.game}_${r.matchId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
