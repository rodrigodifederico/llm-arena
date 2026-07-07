// Core contract (§3 of the spec) + shared deterministic helpers.
// Every game is a pure module implementing GameEngine; the orchestrator
// only ever talks to this interface.

export type GameState = Record<string, unknown>;
export type Action = Record<string, unknown>;
export type PlayerId = "A" | "B";

export interface TurnRequest {
  player: PlayerId;
  systemPrompt: string;
  userPrompt: string;
  responseSchemaName: string;
}

export interface GameResult {
  winner: PlayerId | "draw";
  reason: string;
  score: { A: number; B: number };
}

export type ValidationResult =
  | { ok: true; action: Action }
  | { ok: false; error: string };

export interface GameEngine {
  id: string;
  displayName: string;
  description: string;

  init(seed: string): GameState;
  isTerminal(state: GameState): boolean;
  result(state: GameState): GameResult;

  // Sequential games return 1 player; simultaneous games return both.
  pendingDecisions(state: GameState): PlayerId[];

  buildTurnRequest(state: GameState, player: PlayerId): TurnRequest;

  validateAction(state: GameState, player: PlayerId, action: Action): ValidationResult;

  // For simultaneous games, receives both players' actions at once.
  applyActions(state: GameState, actions: Partial<Record<PlayerId, Action>>): GameState;

  // Least-harmful legal move used after all retries fail.
  defaultAction(state: GameState, player: PlayerId): Action;

  // One-line human-readable summary of an accepted action (for the turn log / HUD).
  summarizeAction(state: GameState, player: PlayerId, action: Action): string;
}

// ---------------------------------------------------------------------------
// Seeded PRNG: xmur3 string hash feeding mulberry32. Same seed => same stream.
// ---------------------------------------------------------------------------

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number; // [0, 1)
  int(maxExclusive: number): number;
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[]; // returns a new shuffled copy
}

export function makeRng(seed: string): Rng {
  const next = mulberry32(hashString(seed));
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
