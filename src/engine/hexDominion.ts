// Game 2 — Hex Dominion: 7x7 grid conquest / light turn-based RTS (§6).
// Alternating turns (A first). Each turn the player submits an ordered command
// list constrained by an energy budget. Fully deterministic.

import type {
  Action,
  GameEngine,
  GameState,
  PlayerId,
  TurnRequest,
  ValidationResult,
} from "./GameEngine";
import { deepClone, makeRng } from "./GameEngine";

export type Pos = [number, number]; // [row, col], 0-indexed

export interface HexUnit {
  id: string;
  owner: PlayerId;
  pos: Pos;
  hp: number;
  atk: number;
  move: number;
}

export interface Mine {
  pos: Pos;
  owner: PlayerId | null;
}

export interface HexState {
  seed: string;
  turnNumber: number; // 1-based, counts player-turns; cap 30 total
  current: PlayerId;
  hqs: Record<PlayerId, { pos: Pos; hp: number }>;
  mines: Mine[];
  units: HexUnit[];
  energy: Record<PlayerId, number>;
  nextUnitNum: Record<PlayerId, number>;
  lastSummary: string | null;
  log: string[];
  [key: string]: unknown;
}

const SIZE = 7;
const TURN_CAP = 30;
const HQ_HP = 30;
const ENERGY_CAP = 6;
const SPAWN_COST = 3;
const MOVE_COST = 1;
const MAX_COMMANDS = 12;
const UNIT_STATS = { hp: 10, atk: 4, move: 2 };

const HQ_POS: Record<PlayerId, Pos> = { A: [6, 0], B: [0, 6] };

function inBounds(p: Pos): boolean {
  return p[0] >= 0 && p[0] < SIZE && p[1] >= 0 && p[1] < SIZE;
}
function samePos(a: Pos, b: Pos): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}
function adjacent(a: Pos, b: Pos): boolean {
  return manhattan(a, b) === 1;
}

function unitAt(s: HexState, p: Pos): HexUnit | undefined {
  return s.units.find((u) => samePos(u.pos, p));
}
function occupied(s: HexState, p: Pos): boolean {
  return !!unitAt(s, p) || samePos(s.hqs.A.pos, p) || samePos(s.hqs.B.pos, p);
}
function minesOwned(s: HexState, player: PlayerId): number {
  return s.mines.filter((m) => m.owner === player).length;
}
function income(s: HexState, player: PlayerId): number {
  return 1 + minesOwned(s, player);
}

function captureMines(s: HexState): void {
  for (const m of s.mines) {
    const u = unitAt(s, m.pos);
    if (u) m.owner = u.owner;
  }
}

function grantIncome(s: HexState, player: PlayerId): void {
  s.energy[player] = Math.min(ENERGY_CAP, s.energy[player] + income(s, player));
}

function init(seed: string): HexState {
  const rng = makeRng(seed + "|mines");
  // Two base positions in A's half, jittered, mirrored through the center for symmetry.
  const bases: Pos[] = [
    [4, 1],
    [5, 3],
  ];
  const mines: Mine[] = [];
  const taken = new Set<string>(["6,0", "0,6", "5,0", "6,1", "1,6", "0,5"]);
  for (const base of bases) {
    let p: Pos = base;
    for (let tries = 0; tries < 20; tries++) {
      const jr = rng.int(3) - 1;
      const jc = rng.int(3) - 1;
      const cand: Pos = [base[0] + jr, base[1] + jc];
      const mirror: Pos = [SIZE - 1 - cand[0], SIZE - 1 - cand[1]];
      if (
        inBounds(cand) &&
        !taken.has(cand.join(",")) &&
        !taken.has(mirror.join(",")) &&
        !samePos(cand, mirror)
      ) {
        p = cand;
        break;
      }
    }
    const mirror: Pos = [SIZE - 1 - p[0], SIZE - 1 - p[1]];
    taken.add(p.join(","));
    taken.add(mirror.join(","));
    mines.push({ pos: p, owner: null }, { pos: mirror, owner: null });
  }

  const s: HexState = {
    seed,
    turnNumber: 1,
    current: "A",
    hqs: {
      A: { pos: HQ_POS.A, hp: HQ_HP },
      B: { pos: HQ_POS.B, hp: HQ_HP },
    },
    mines,
    units: [
      { id: "A1", owner: "A", pos: [5, 0], ...UNIT_STATS },
      { id: "A2", owner: "A", pos: [6, 1], ...UNIT_STATS },
      { id: "B1", owner: "B", pos: [1, 6], ...UNIT_STATS },
      { id: "B2", owner: "B", pos: [0, 5], ...UNIT_STATS },
    ],
    energy: { A: 0, B: 0 },
    nextUnitNum: { A: 3, B: 3 },
    lastSummary: null,
    log: [],
  };
  grantIncome(s, "A"); // A's first-turn income
  return s;
}

function isTerminal(state: GameState): boolean {
  const s = state as HexState;
  return s.hqs.A.hp <= 0 || s.hqs.B.hp <= 0 || s.turnNumber > TURN_CAP;
}

function totalUnitHp(s: HexState, p: PlayerId): number {
  return s.units.filter((u) => u.owner === p).reduce((t, u) => t + u.hp, 0);
}

function result(state: GameState) {
  const s = state as HexState;
  if (s.hqs.A.hp <= 0 && s.hqs.B.hp <= 0) {
    return { winner: "draw" as const, reason: "Both HQs destroyed simultaneously", score: { A: 0, B: 0 } };
  }
  if (s.hqs.B.hp <= 0) {
    return { winner: "A" as const, reason: "Enemy HQ destroyed", score: { A: s.hqs.A.hp, B: 0 } };
  }
  if (s.hqs.A.hp <= 0) {
    return { winner: "B" as const, reason: "Enemy HQ destroyed", score: { A: 0, B: s.hqs.B.hp } };
  }
  // turn cap: mine control, tie-break total unit HP
  const ma = minesOwned(s, "A");
  const mb = minesOwned(s, "B");
  if (ma !== mb) {
    const w: PlayerId = ma > mb ? "A" : "B";
    return { winner: w, reason: `Turn cap (${TURN_CAP}) reached — more mines controlled (${ma} vs ${mb})`, score: { A: ma, B: mb } };
  }
  const ha = totalUnitHp(s, "A");
  const hb = totalUnitHp(s, "B");
  if (ha !== hb) {
    const w: PlayerId = ha > hb ? "A" : "B";
    return { winner: w, reason: `Turn cap reached — equal mines (${ma}); more total unit HP (${ha} vs ${hb})`, score: { A: ma, B: mb } };
  }
  return { winner: "draw" as const, reason: `Turn cap reached — equal mines and equal unit HP`, score: { A: ma, B: mb } };
}

function pendingDecisions(state: GameState): PlayerId[] {
  const s = state as HexState;
  return isTerminal(s) ? [] : [s.current];
}

interface Command {
  type: string;
  unit?: string;
  to?: Pos;
  target?: Pos;
  at?: Pos;
}

// Simulates a full command list. Returns the mutated clone + log, or an error
// naming the offending command. Used by BOTH validateAction (dry-run) and
// applyActions, so they can never disagree.
function runCommands(
  base: HexState,
  player: PlayerId,
  commands: Command[],
): { ok: true; state: HexState; lines: string[] } | { ok: false; error: string } {
  const s = deepClone(base);
  const lines: string[] = [];
  const moved = new Set<string>();
  const attacked = new Set<string>();

  if (!Array.isArray(commands)) return { ok: false, error: `"commands" must be an array (may be empty to pass).` };
  if (commands.length > MAX_COMMANDS) return { ok: false, error: `Too many commands (max ${MAX_COMMANDS}).` };

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const label = `command #${i + 1} (${JSON.stringify(c)})`;
    if (!c || typeof c !== "object") return { ok: false, error: `${label}: not an object.` };

    if (c.type === "move") {
      const u = s.units.find((x) => x.id === c.unit);
      if (!u) return { ok: false, error: `${label}: unit "${c.unit}" does not exist.` };
      if (u.owner !== player) return { ok: false, error: `${label}: ${u.id} is not your unit.` };
      if (moved.has(u.id)) return { ok: false, error: `${label}: ${u.id} already moved this turn.` };
      if (s.energy[player] < MOVE_COST) return { ok: false, error: `${label}: not enough energy (move costs ${MOVE_COST}, you have ${s.energy[player]}).` };
      const to = c.to as Pos;
      if (!Array.isArray(to) || to.length !== 2 || !inBounds(to)) return { ok: false, error: `${label}: "to" must be [row,col] within the 7x7 board.` };
      if (manhattan(u.pos, to) > u.move) return { ok: false, error: `${label}: ${u.id} at [${u.pos}] can move at most ${u.move} cells (Manhattan distance); [${to}] is ${manhattan(u.pos, to)} away.` };
      if (manhattan(u.pos, to) === 0) return { ok: false, error: `${label}: destination equals current position.` };
      if (occupied(s, to)) return { ok: false, error: `${label}: cell [${to}] is occupied.` };
      s.energy[player] -= MOVE_COST;
      u.pos = to;
      moved.add(u.id);
      captureMines(s);
      lines.push(`${u.id} moves to [${to}]`);
    } else if (c.type === "attack") {
      const u = s.units.find((x) => x.id === c.unit);
      if (!u) return { ok: false, error: `${label}: unit "${c.unit}" does not exist.` };
      if (u.owner !== player) return { ok: false, error: `${label}: ${u.id} is not your unit.` };
      if (attacked.has(u.id)) return { ok: false, error: `${label}: ${u.id} already attacked this turn.` };
      const t = c.target as Pos;
      if (!Array.isArray(t) || t.length !== 2 || !inBounds(t)) return { ok: false, error: `${label}: "target" must be [row,col] within the board.` };
      if (!adjacent(u.pos, t)) return { ok: false, error: `${label}: target [${t}] is not orthogonally adjacent to ${u.id} at [${u.pos}].` };
      const enemy: PlayerId = player === "A" ? "B" : "A";
      const tu = unitAt(s, t);
      if (tu && tu.owner === enemy) {
        tu.hp -= u.atk;
        if (tu.hp <= 0) {
          s.units = s.units.filter((x) => x.id !== tu.id);
          lines.push(`${u.id} attacks ${tu.id}: ${u.atk} dmg — ${tu.id} destroyed`);
        } else {
          // retaliation
          u.hp -= tu.atk;
          lines.push(`${u.id} attacks ${tu.id}: ${u.atk} dmg (${tu.hp} HP left); ${tu.id} retaliates: ${tu.atk} dmg${u.hp <= 0 ? ` — ${u.id} destroyed` : ""}`);
          if (u.hp <= 0) s.units = s.units.filter((x) => x.id !== u.id);
        }
        captureMines(s);
      } else if (samePos(s.hqs[enemy].pos, t)) {
        s.hqs[enemy].hp = Math.max(0, s.hqs[enemy].hp - u.atk);
        lines.push(`${u.id} attacks enemy HQ: ${u.atk} dmg (HQ at ${s.hqs[enemy].hp} HP)`);
        if (s.hqs[enemy].hp <= 0) {
          lines.push(`Enemy HQ destroyed!`);
          attacked.add(u.id);
          // stop processing further commands — game over
          return { ok: true, state: s, lines };
        }
      } else {
        return { ok: false, error: `${label}: no enemy unit or enemy HQ at [${t}].` };
      }
      attacked.add(u.id);
    } else if (c.type === "spawn") {
      if (s.energy[player] < SPAWN_COST) return { ok: false, error: `${label}: spawn costs ${SPAWN_COST} energy, you have ${s.energy[player]}.` };
      const at = c.at as Pos;
      if (!Array.isArray(at) || at.length !== 2 || !inBounds(at)) return { ok: false, error: `${label}: "at" must be [row,col] within the board.` };
      if (!adjacent(at, s.hqs[player].pos)) return { ok: false, error: `${label}: spawn cell [${at}] must be orthogonally adjacent to your HQ at [${s.hqs[player].pos}].` };
      if (occupied(s, at)) return { ok: false, error: `${label}: cell [${at}] is occupied.` };
      s.energy[player] -= SPAWN_COST;
      const id = `${player}${s.nextUnitNum[player]}`;
      s.nextUnitNum[player] += 1;
      s.units.push({ id, owner: player, pos: at, ...UNIT_STATS });
      captureMines(s);
      lines.push(`${id} spawned at [${at}]`);
    } else {
      return { ok: false, error: `${label}: unknown type "${c.type}" (use move | attack | spawn).` };
    }
  }
  return { ok: true, state: s, lines };
}

function renderGrid(s: HexState, forPlayer?: PlayerId): string {
  const rows: string[] = ["    " + Array.from({ length: SIZE }, (_, c) => ` c${c} `).join("")];
  for (let r = 0; r < SIZE; r++) {
    const cells: string[] = [];
    for (let c = 0; c < SIZE; c++) {
      const p: Pos = [r, c];
      let cell = " . ";
      if (samePos(s.hqs.A.pos, p)) cell = "HQa";
      else if (samePos(s.hqs.B.pos, p)) cell = "HQb";
      else {
        const m = s.mines.find((x) => samePos(x.pos, p));
        const u = unitAt(s, p);
        if (u) cell = u.id.padEnd(3, " ");
        else if (m) cell = m.owner ? `m${m.owner.toLowerCase()} ` : "m? ";
      }
      cells.push(` ${cell}`);
    }
    rows.push(`r${r}  ${cells.join("")}`);
  }
  void forPlayer; // full information game — both sides see everything
  return rows.join("\n");
}

const RULES = `You are playing HEX DOMINION, a deterministic turn-based conquest game on a 7x7 grid (coordinates [row,col], 0-indexed). You battle a rival AI. Rules are enforced by the engine — you only submit commands.

RULES:
- Each turn you receive energy income = 1 + (1 per mine you control). Unspent energy carries over, capped at ${ENERGY_CAP}.
- On your turn submit an ORDERED list of commands (executed in order, max ${MAX_COMMANDS}); an empty list passes:
  - {"type":"move","unit":"<id>","to":[r,c]} — costs ${MOVE_COST} energy; up to the unit's move range (${UNIT_STATS.move}, Manhattan distance); destination must be free. Each unit may move once per turn.
  - {"type":"attack","unit":"<id>","target":[r,c]} — free; target must be orthogonally adjacent; deals the unit's ATK (${UNIT_STATS.atk}). If the target unit survives it retaliates for its ATK. Each unit may attack once per turn.
  - {"type":"spawn","at":[r,c]} — costs ${SPAWN_COST} energy; new unit (HP ${UNIT_STATS.hp} / ATK ${UNIT_STATS.atk} / MOVE ${UNIT_STATS.move}) on a free cell orthogonally adjacent to YOUR HQ.
- A mine is controlled by whoever last had a unit standing on it. Mines are the economy — control them.
- If ANY command in your list is illegal the whole list is rejected and you must resubmit.
- WIN: reduce the enemy HQ (${HQ_HP} HP) to 0, or control more mines when the turn cap (${TURN_CAP} player-turns) is reached (tie-break: total unit HP).

Both HQs are stationary and cannot attack. Plan economy (mines, spawns) versus tempo (rushing the HQ).`;

function buildTurnRequest(state: GameState, player: PlayerId): TurnRequest {
  const s = state as HexState;
  const enemy: PlayerId = player === "A" ? "B" : "A";
  const userPrompt = `You are player ${player}. Turn ${s.turnNumber} of ${TURN_CAP}. Your energy: ${s.energy[player]} (income next turn: ${income(s, player)}).

BOARD (r = row, c = col; HQa/HQb = HQs, m? = neutral mine, ma/mb = owned mine, ids = units):
${renderGrid(s)}

YOUR HQ: [${s.hqs[player].pos}] with ${s.hqs[player].hp} HP. ENEMY HQ: [${s.hqs[enemy].pos}] with ${s.hqs[enemy].hp} HP.
YOUR UNITS: ${JSON.stringify(s.units.filter((u) => u.owner === player))}
ENEMY UNITS: ${JSON.stringify(s.units.filter((u) => u.owner === enemy))}
MINES: ${JSON.stringify(s.mines)}
ENERGY: you ${s.energy[player]}, enemy ${s.energy[enemy]}.
LAST ENEMY TURN: ${s.lastSummary ?? "none"}

Return {"action":{"commands":[...]}} with your ordered command list (empty array = pass).`;
  return { player, systemPrompt: RULES, userPrompt, responseSchemaName: "hex_dominion_commands" };
}

function validateAction(state: GameState, player: PlayerId, action: Action): ValidationResult {
  const s = state as HexState;
  if (s.current !== player) return { ok: false, error: "not your turn" };
  const commands = (action?.commands ?? action) as Command[];
  const r = runCommands(s, player, Array.isArray(commands) ? commands : (null as never));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, action: { commands: Array.isArray(commands) ? commands : [] } };
}

function applyActions(state: GameState, actions: Partial<Record<PlayerId, Action>>): GameState {
  const s = state as HexState;
  const player = s.current;
  const action = actions[player];
  if (!action) throw new Error(`missing action for ${player}`);
  const commands = (action.commands ?? []) as Command[];
  const r = runCommands(s, player, commands);
  if (!r.ok) throw new Error(`applyActions on invalid commands: ${r.error}`);
  const next = r.state;
  captureMines(next);
  const summary = r.lines.length ? `${player}: ${r.lines.join("; ")}` : `${player} passes`;
  next.lastSummary = summary;
  next.log = [...next.log, summary].slice(-60);
  next.turnNumber += 1;
  next.current = player === "A" ? "B" : "A";
  if (!isTerminal(next)) grantIncome(next, next.current);
  return next;
}

function defaultAction(): Action {
  return { commands: [] };
}

function summarizeAction(_state: GameState, player: PlayerId, action: Action): string {
  const cmds = (action.commands ?? []) as Command[];
  if (!cmds.length) return `${player} passes`;
  return cmds
    .map((c) =>
      c.type === "move"
        ? `move ${c.unit}→[${c.to}]`
        : c.type === "attack"
          ? `attack ${c.unit}→[${c.target}]`
          : `spawn@[${c.at}]`,
    )
    .join(", ");
}

export const hexDominion: GameEngine = {
  id: "hex_dominion",
  displayName: "Hex Dominion",
  description: "7x7 grid conquest — spatial planning, economy, long-horizon strategy.",
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
