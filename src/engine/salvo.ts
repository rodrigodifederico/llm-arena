// Game 3 — Salvo: hidden-grid deduction duel, Battleship-style (§7).
// Sequential: placement (A then B, each hidden), then alternating fire (A first).
// Each model only ever sees its own board + its shot history.

import type {
  Action,
  GameEngine,
  GameState,
  PlayerId,
  TurnRequest,
  ValidationResult,
} from "./GameEngine";
import { deepClone, makeRng } from "./GameEngine";

export type Pos = [number, number];

export const FLEET: { name: string; size: number }[] = [
  { name: "carrier", size: 5 },
  { name: "battleship", size: 4 },
  { name: "cruiser", size: 3 },
  { name: "submarine", size: 3 },
  { name: "destroyer", size: 2 },
];

export interface Ship {
  name: string;
  size: number;
  cells: Pos[];
  hits: string[]; // "r,c" keys of cells hit
}

export interface Shot {
  pos: Pos;
  result: "miss" | "hit" | "sunk";
  ship?: string; // set when result === "sunk"
}

export interface SalvoState {
  seed: string;
  phase: "placement" | "battle" | "done";
  fleets: { A: Ship[] | null; B: Ship[] | null };
  shots: { A: Shot[]; B: Shot[] }; // shots FIRED BY that player
  current: PlayerId;
  lastSummary: string | null;
  [key: string]: unknown;
}

const SIZE = 8;

function key(p: Pos): string {
  return `${p[0]},${p[1]}`;
}
function inBounds(p: Pos): boolean {
  return Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < SIZE && p[1] >= 0 && p[1] < SIZE;
}

function init(seed: string): SalvoState {
  return {
    seed,
    phase: "placement",
    fleets: { A: null, B: null },
    shots: { A: [], B: [] },
    current: "A",
    lastSummary: null,
  };
}

function allSunk(fleet: Ship[]): boolean {
  return fleet.every((sh) => sh.hits.length === sh.size);
}

function isTerminal(state: GameState): boolean {
  return (state as SalvoState).phase === "done";
}

function result(state: GameState) {
  const s = state as SalvoState;
  const aSunk = s.fleets.A ? allSunk(s.fleets.A) : false;
  const bSunk = s.fleets.B ? allSunk(s.fleets.B) : false;
  const shotsA = s.shots.A.length;
  const shotsB = s.shots.B.length;
  if (bSunk) {
    return { winner: "A" as const, reason: `All enemy ships sunk in ${shotsA} shots`, score: { A: shotsA, B: shotsB } };
  }
  if (aSunk) {
    return { winner: "B" as const, reason: `All enemy ships sunk in ${shotsB} shots`, score: { A: shotsA, B: shotsB } };
  }
  return { winner: "draw" as const, reason: "Match ended before either fleet was sunk", score: { A: shotsA, B: shotsB } };
}

function pendingDecisions(state: GameState): PlayerId[] {
  const s = state as SalvoState;
  if (s.phase === "done") return [];
  if (s.phase === "placement") return [s.fleets.A === null ? "A" : "B"];
  return [s.current];
}

function isStraightContiguous(cells: Pos[]): boolean {
  if (cells.length === 1) return true;
  const rows = cells.map((c) => c[0]);
  const cols = cells.map((c) => c[1]);
  const sameRow = rows.every((r) => r === rows[0]);
  const sameCol = cols.every((c) => c === cols[0]);
  if (!sameRow && !sameCol) return false;
  const vary = (sameRow ? cols : rows).slice().sort((a, b) => a - b);
  for (let i = 1; i < vary.length; i++) if (vary[i] !== vary[i - 1] + 1) return false;
  return true;
}

function validatePlacements(raw: unknown): { ok: true; fleet: Ship[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `"placements" must be an array of 5 ships.` };
  const fleet: Ship[] = [];
  const used = new Set<string>();
  const remaining = FLEET.map((f) => ({ ...f }));
  for (const p of raw as { ship?: string; cells?: Pos[] }[]) {
    const name = String(p?.ship ?? "");
    const idx = remaining.findIndex((f) => f.name === name);
    if (idx < 0) {
      return { ok: false, error: `Unknown or duplicate ship "${name}". Required exactly: ${FLEET.map((f) => `${f.name}(${f.size})`).join(", ")}.` };
    }
    const spec = remaining.splice(idx, 1)[0];
    const cells = p.cells;
    if (!Array.isArray(cells) || cells.length !== spec.size) {
      return { ok: false, error: `${name} must occupy exactly ${spec.size} cells.` };
    }
    for (const c of cells) {
      if (!Array.isArray(c) || c.length !== 2 || !inBounds(c as Pos)) {
        return { ok: false, error: `${name}: cell ${JSON.stringify(c)} is out of the 8x8 board (rows/cols 0-7).` };
      }
      if (used.has(key(c as Pos))) return { ok: false, error: `${name}: cell [${c}] overlaps another ship.` };
      used.add(key(c as Pos));
    }
    if (!isStraightContiguous(cells as Pos[])) {
      return { ok: false, error: `${name}: cells must form one straight contiguous line (horizontal or vertical).` };
    }
    fleet.push({ name: spec.name, size: spec.size, cells: cells as Pos[], hits: [] });
  }
  if (remaining.length > 0) {
    return { ok: false, error: `Missing ships: ${remaining.map((f) => `${f.name}(${f.size})`).join(", ")}.` };
  }
  return { ok: true, fleet };
}

const PLACEMENT_RULES = `You are playing SALVO, a Battleship-style hidden-grid duel on an 8x8 board (coordinates [row,col], 0-indexed, rows and cols 0-7) against a rival AI.

PHASE 1 — PLACEMENT. Place your fleet of 5 ships: ${FLEET.map((f) => `${f.name} (${f.size})`).join(", ")}.
- Each ship occupies a straight contiguous horizontal or vertical line of cells.
- Ships may not overlap; all cells must be on the board. Ships may touch.
- Your opponent will NEVER see your placement (only hit/miss feedback on its shots). Place to be hard to find.

Respond with: {"action":{"placements":[{"ship":"carrier","cells":[[r,c],...]}, ...all 5 ships...]}}`;

const BATTLE_RULES = `You are playing SALVO, a Battleship-style hidden-grid duel on an 8x8 board (coordinates [row,col], 0-indexed, rows and cols 0-7) against a rival AI.

PHASE 2 — FIRING. Players alternate firing one shot per turn at the opponent's hidden board.
- After each shot you are told: miss, hit, or hit+sunk (with the ship name).
- Enemy fleet: ${FLEET.map((f) => `${f.name} (${f.size})`).join(", ")} — all placed in straight lines, no overlaps.
- You may not repeat a coordinate you already fired at.
- WIN: sink all 5 enemy ships first. Efficiency matters: your score is the number of shots you needed (lower is better).

Use your shot history to reason probabilistically: after a hit, adjacent cells are prime targets; track which ships are already sunk. You may keep deductions in "notes" — they are echoed back to you next turn.

Respond with: {"action":{"fire":[row,col]}}`;

function renderOwnBoard(s: SalvoState, player: PlayerId): string {
  const fleet = s.fleets[player];
  const enemyShots = s.shots[player === "A" ? "B" : "A"];
  const grid: string[][] = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill(" ."));
  if (fleet) {
    for (const sh of fleet) {
      for (const c of sh.cells) grid[c[0]][c[1]] = ` ${sh.name[0].toUpperCase()}`;
    }
  }
  for (const shot of enemyShots) {
    const [r, c] = shot.pos;
    grid[r][c] = shot.result === "miss" ? " o" : " X";
  }
  return "   " + Array.from({ length: SIZE }, (_, i) => ` ${i}`).join("") + "\n" +
    grid.map((row, r) => `r${r} ${row.join("")}`).join("\n") +
    "\n(letters = your ships, X = enemy hit on you, o = enemy miss)";
}

function renderShotBoard(s: SalvoState, player: PlayerId): string {
  const grid: string[][] = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill(" ."));
  for (const shot of s.shots[player]) {
    const [r, c] = shot.pos;
    grid[r][c] = shot.result === "miss" ? " o" : shot.result === "sunk" ? " S" : " X";
  }
  return "   " + Array.from({ length: SIZE }, (_, i) => ` ${i}`).join("") + "\n" +
    grid.map((row, r) => `r${r} ${row.join("")}`).join("\n") +
    "\n(. = not fired, o = miss, X = hit, S = hit that sank a ship)";
}

function buildTurnRequest(state: GameState, player: PlayerId): TurnRequest {
  const s = state as SalvoState;
  if (s.phase === "placement") {
    return {
      player,
      systemPrompt: PLACEMENT_RULES,
      userPrompt: `You are player ${player}. Place your 5 ships on your empty 8x8 board now.`,
      responseSchemaName: "salvo_placement",
    };
  }
  const enemy: PlayerId = player === "A" ? "B" : "A";
  const enemyFleet = s.fleets[enemy]!;
  const sunkList = enemyFleet.filter((sh) => sh.hits.length === sh.size).map((sh) => `${sh.name}(${sh.size})`);
  const myShots = s.shots[player];
  const last = myShots[myShots.length - 1];
  const userPrompt = `You are player ${player}. It is your turn to FIRE (your shot #${myShots.length + 1}).

YOUR OWN BOARD (what the enemy has done to you):
${renderOwnBoard(s, player)}

YOUR SHOTS at the enemy board so far:
${renderShotBoard(s, player)}

SHOT HISTORY (yours, in order): ${myShots.map((sh) => `[${sh.pos}]:${sh.result}${sh.ship ? `(${sh.ship})` : ""}`).join(" ") || "none yet"}
ENEMY SHIPS SUNK SO FAR: ${sunkList.length ? sunkList.join(", ") : "none"} (remaining: ${enemyFleet.filter((sh) => sh.hits.length < sh.size).map((sh) => `${sh.name}(${sh.size})`).join(", ")})
${last ? `YOUR LAST SHOT: [${last.pos}] → ${last.result}${last.ship ? ` (${last.ship})` : ""}` : ""}

Fire at one new coordinate.`;
  return { player, systemPrompt: BATTLE_RULES, userPrompt, responseSchemaName: "salvo_fire" };
}

function validateAction(state: GameState, player: PlayerId, action: Action): ValidationResult {
  const s = state as SalvoState;
  if (s.phase === "placement") {
    const expected = s.fleets.A === null ? "A" : "B";
    if (player !== expected) return { ok: false, error: "not your placement turn" };
    const v = validatePlacements(action?.placements);
    if (!v.ok) return v;
    return { ok: true, action: { placements: (action.placements as unknown[]).slice() as never } };
  }
  if (s.phase !== "battle" || s.current !== player) return { ok: false, error: "not your turn" };
  const fire = action?.fire as Pos;
  if (!Array.isArray(fire) || fire.length !== 2 || !inBounds(fire)) {
    return { ok: false, error: `"fire" must be [row,col] with row and col between 0 and 7.` };
  }
  if (s.shots[player].some((sh) => key(sh.pos) === key(fire))) {
    return { ok: false, error: `You already fired at [${fire}]. Choose a coordinate you have not fired at.` };
  }
  return { ok: true, action: { fire: [fire[0], fire[1]] } };
}

function applyActions(state: GameState, actions: Partial<Record<PlayerId, Action>>): GameState {
  const s = deepClone(state as SalvoState);
  if (s.phase === "placement") {
    const player: PlayerId = s.fleets.A === null ? "A" : "B";
    const action = actions[player];
    if (!action) throw new Error(`missing placement for ${player}`);
    const v = validatePlacements(action.placements);
    if (!v.ok) throw new Error(v.error);
    s.fleets[player] = v.fleet;
    s.lastSummary = `${player} placed its fleet (hidden)`;
    if (s.fleets.A && s.fleets.B) {
      s.phase = "battle";
      s.current = "A";
    }
    return s;
  }
  const player = s.current;
  const enemy: PlayerId = player === "A" ? "B" : "A";
  const action = actions[player];
  if (!action) throw new Error(`missing action for ${player}`);
  const fire = action.fire as Pos;
  const fleet = s.fleets[enemy]!;
  let result: Shot = { pos: fire, result: "miss" };
  for (const sh of fleet) {
    if (sh.cells.some((c) => key(c) === key(fire))) {
      if (!sh.hits.includes(key(fire))) sh.hits.push(key(fire));
      result = sh.hits.length === sh.size ? { pos: fire, result: "sunk", ship: sh.name } : { pos: fire, result: "hit" };
      break;
    }
  }
  s.shots[player].push(result);
  s.lastSummary = `${player} fires at [${fire}] → ${result.result}${result.ship ? ` (${result.ship})` : ""}`;
  if (allSunk(fleet)) {
    s.phase = "done";
  } else {
    s.current = enemy;
  }
  return s;
}

// Deterministic seeded legal placement (also used as placement defaultAction).
export function autoPlacement(seed: string, player: PlayerId): { placements: { ship: string; cells: Pos[] }[] } {
  const rng = makeRng(`${seed}|autoplace|${player}`);
  const used = new Set<string>();
  const placements: { ship: string; cells: Pos[] }[] = [];
  for (const f of FLEET) {
    for (let tries = 0; ; tries++) {
      const horiz = rng.next() < 0.5;
      const r = rng.int(horiz ? SIZE : SIZE - f.size + 1);
      const c = rng.int(horiz ? SIZE - f.size + 1 : SIZE);
      const cells: Pos[] = Array.from({ length: f.size }, (_, i) => (horiz ? [r, c + i] : [r + i, c]) as Pos);
      if (cells.every((p) => !used.has(key(p)))) {
        cells.forEach((p) => used.add(key(p)));
        placements.push({ ship: f.name, cells });
        break;
      }
      if (tries > 500) throw new Error("autoPlacement failed"); // practically unreachable
    }
  }
  return { placements };
}

function defaultAction(state: GameState, player: PlayerId): Action {
  const s = state as SalvoState;
  if (s.phase === "placement") return autoPlacement(s.seed, player) as unknown as Action;
  // first unfired cell, row-major — always legal, deterministic
  const fired = new Set(s.shots[player].map((sh) => key(sh.pos)));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!fired.has(`${r},${c}`)) return { fire: [r, c] };
    }
  }
  return { fire: [0, 0] }; // unreachable: board exhausts only after all ships sunk
}

function summarizeAction(state: GameState, player: PlayerId, action: Action): string {
  const s = state as SalvoState;
  if (s.phase === "placement") return `${player} places fleet (hidden)`;
  return `${player} fires at [${(action.fire as Pos)?.join(",")}]`;
}

export const salvo: GameEngine = {
  id: "salvo",
  displayName: "Salvo",
  description: "Hidden-grid Battleship duel — inference, memory, systematic search.",
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
