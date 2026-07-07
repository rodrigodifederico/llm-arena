// Game 4 — Standoff: simultaneous-reveal duel (§8).
// Both players decide each round in parallel; applyActions resolves both at once.

import type {
  Action,
  GameEngine,
  GameState,
  PlayerId,
  TurnRequest,
  ValidationResult,
} from "./GameEngine";
import { deepClone } from "./GameEngine";

export type Move = "reload" | "shield" | "shoot" | "mega";

export interface RoundRecord {
  round: number;
  moves: Record<PlayerId, Move>;
  events: string[];
  lives: Record<PlayerId, number>; // lives AFTER this round resolved
}

export interface StandoffState {
  round: number; // 1-based; cap 40 (+5 sudden death)
  lives: Record<PlayerId, number>;
  ammo: Record<PlayerId, number>;
  history: RoundRecord[];
  lastSummary: string | null;
  [key: string]: unknown;
}

const ROUND_CAP = 40;
const SUDDEN_DEATH_CAP = 45;
const MOVES: Move[] = ["reload", "shield", "shoot", "mega"];

function init(_seed: string): StandoffState {
  return {
    round: 1,
    lives: { A: 3, B: 3 },
    ammo: { A: 0, B: 0 },
    history: [],
    lastSummary: null,
  };
}

function isTerminal(state: GameState): boolean {
  const s = state as StandoffState;
  if (s.lives.A <= 0 || s.lives.B <= 0) return true;
  if (s.round > ROUND_CAP && s.lives.A !== s.lives.B) return true; // regulation over, someone ahead
  if (s.round > SUDDEN_DEATH_CAP) return true; // sudden death exhausted
  return false;
}

function result(state: GameState) {
  const s = state as StandoffState;
  const { A, B } = s.lives;
  if (A <= 0 && B <= 0) {
    return { winner: "draw" as const, reason: "Both duelists fell in the same round", score: { A: 0, B: 0 } };
  }
  if (B <= 0) return { winner: "A" as const, reason: `Opponent eliminated in round ${s.round - 1}`, score: { A, B: 0 } };
  if (A <= 0) return { winner: "B" as const, reason: `Opponent eliminated in round ${s.round - 1}`, score: { A: 0, B } };
  if (A !== B) {
    const w: PlayerId = A > B ? "A" : "B";
    const inSD = s.round > ROUND_CAP + 1;
    return {
      winner: w,
      reason: `${inSD ? "Sudden death" : `Round cap (${ROUND_CAP})`} — more lives remaining (${A} vs ${B})`,
      score: { A: w === "A" ? A : 0, B: w === "B" ? B : 0 },
    };
  }
  return { winner: "draw" as const, reason: "Still tied after sudden death", score: { A, B } };
}

function pendingDecisions(state: GameState): PlayerId[] {
  return isTerminal(state) ? [] : ["A", "B"];
}

const RULES = `You are playing STANDOFF, a simultaneous-reveal duel against a rival AI. Both players pick a move at the same time each round; the engine resolves them together.

STATE: you and your opponent each start with 3 lives and 0 ammo. Everything is public: both ammo counts, both lives, and the full move history.

MOVES (each round, choose one):
- "reload": gain 1 ammo. Vulnerable: you lose 1 life if the opponent shoots or megas.
- "shield": blocks one incoming "shoot". Does NOT block "mega". Free.
- "shoot": needs >=1 ammo, spends 1. Opponent loses 1 life unless they shield or mega.
- "mega": needs >=3 ammo, spends 3. Pierces shield. Beats "shoot" (mega is faster: the shooter dies, you don't). If both mega, both lose 1 life.

RESOLUTION (you vs opponent): reload/reload or reload/shield or shield/shield: nothing. reload vs shoot|mega: reloader -1. shield vs shoot: blocked. shield vs mega: shielder -1. shoot vs shoot: both -1. shoot vs mega: shooter -1 only. mega vs mega: both -1.

ILLEGAL: "shoot" with 0 ammo, "mega" with <3 ammo.

WIN: reduce the opponent to 0 lives. After ${ROUND_CAP} rounds, most lives wins; if tied, 5 rounds of sudden death; still tied = draw.

This is a psychology game: model your opponent's pattern, break your own, and manage risk. You may keep private observations in "notes" — they are echoed back to you next round and never shown to the opponent.

Respond with: {"action":{"move":"reload|shield|shoot|mega"}}`;

function buildTurnRequest(state: GameState, player: PlayerId): TurnRequest {
  const s = state as StandoffState;
  const opp: PlayerId = player === "A" ? "B" : "A";
  const historyText =
    s.history
      .slice(-15)
      .map((h) => `R${h.round}: you=${h.moves[player]} opp=${h.moves[opp]}${h.events.length ? ` (${h.events.join("; ")})` : ""}`)
      .join("\n") || "none yet";
  const inSuddenDeath = s.round > ROUND_CAP;
  const userPrompt = `You are player ${player}. ROUND ${s.round}${inSuddenDeath ? " (SUDDEN DEATH)" : ` of ${ROUND_CAP}`}.

YOU:      ${s.lives[player]} lives, ${s.ammo[player]} ammo
OPPONENT: ${s.lives[opp]} lives, ${s.ammo[opp]} ammo

MOVE HISTORY (latest 15 rounds):
${historyText}

LEGAL MOVES for you now: ${MOVES.filter((m) => (m === "shoot" ? s.ammo[player] >= 1 : m === "mega" ? s.ammo[player] >= 3 : true)).join(", ")}

Choose your move for this round.`;
  return { player, systemPrompt: RULES, userPrompt, responseSchemaName: "standoff_move" };
}

function validateAction(state: GameState, player: PlayerId, action: Action): ValidationResult {
  const s = state as StandoffState;
  const move = String(action?.move ?? "") as Move;
  if (!MOVES.includes(move)) {
    return { ok: false, error: `"move" must be one of: ${MOVES.join(", ")}.` };
  }
  if (move === "shoot" && s.ammo[player] < 1) {
    return { ok: false, error: `"shoot" needs at least 1 ammo; you have ${s.ammo[player]}. Legal: reload, shield.` };
  }
  if (move === "mega" && s.ammo[player] < 3) {
    return { ok: false, error: `"mega" needs 3 ammo; you have ${s.ammo[player]}.` };
  }
  return { ok: true, action: { move } };
}

// Does `you` lose a life given both moves? (Spec §8.3 table.)
export function losesLife(you: Move, opp: Move): boolean {
  if (opp === "mega") return true; // mega pierces shield, beats shoot, trades with mega
  if (opp === "shoot") return you === "reload" || you === "shoot";
  return false;
}

function applyActions(state: GameState, actions: Partial<Record<PlayerId, Action>>): GameState {
  const s = deepClone(state as StandoffState);
  const mA = String(actions.A?.move) as Move;
  const mB = String(actions.B?.move) as Move;
  if (!MOVES.includes(mA) || !MOVES.includes(mB)) throw new Error("missing/invalid simultaneous moves");

  // ammo effects
  const ammoDelta: Record<Move, number> = { reload: 1, shield: 0, shoot: -1, mega: -3 };
  s.ammo.A = Math.max(0, s.ammo.A + ammoDelta[mA]);
  s.ammo.B = Math.max(0, s.ammo.B + ammoDelta[mB]);

  const events: string[] = [];
  if (losesLife(mA, mB)) {
    s.lives.A -= 1;
    events.push(`A loses a life (${mA} vs ${mB})`);
  }
  if (losesLife(mB, mA)) {
    s.lives.B -= 1;
    events.push(`B loses a life (${mB} vs ${mA})`);
  }
  if (mA === "shield" && mB === "shoot") events.push("A blocks B's shot");
  if (mB === "shield" && mA === "shoot") events.push("B blocks A's shot");

  s.history.push({ round: s.round, moves: { A: mA, B: mB }, events, lives: { A: s.lives.A, B: s.lives.B } });
  s.lastSummary = `R${s.round}: A=${mA} B=${mB}${events.length ? ` — ${events.join("; ")}` : ""}`;
  s.round += 1;
  return s;
}

function defaultAction(state: GameState, player: PlayerId): Action {
  const s = state as StandoffState;
  void s.ammo[player];
  return { move: "reload" };
}

function summarizeAction(_state: GameState, player: PlayerId, action: Action): string {
  return `${player} → ${action.move}`;
}

export const standoff: GameEngine = {
  id: "standoff",
  displayName: "Standoff",
  description: "Simultaneous-reveal duel — opponent modeling, bluffing, risk.",
  init,
  isTerminal,
  result,
  pendingDecisions,
  buildTurnRequest,
  validateAction,
  applyActions,
  defaultAction,
  summarizeAction,
};
