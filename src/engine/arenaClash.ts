// Game 1 — Arena Clash: 3v3 turn-based tactical RPG (§5).
// Pure, deterministic. All randomness (team draw, tie-breaks) flows from the seed.

import type {
  Action,
  GameEngine,
  GameState,
  PlayerId,
  TurnRequest,
  ValidationResult,
} from "./GameEngine";
import { deepClone, hashString, makeRng } from "./GameEngine";

export interface ArchetypeDef {
  key: string;
  name: string;
  emoji: string;
  hp: number;
  atk: number;
  mag: number;
  def: number;
  res: number;
  spd: number;
  mana: number;
  specialName: string;
  specialCost: number;
  specialDesc: string;
  specialTarget: "enemy" | "self" | "all-enemies" | "all-allies";
  canHeal: boolean;
}

export const ARCHETYPES: ArchetypeDef[] = [
  { key: "soldier", name: "Soldier", emoji: "🗡️", hp: 100, atk: 22, mag: 0, def: 14, res: 8, spd: 10, mana: 20, specialName: "Shield Bash", specialCost: 10, specialDesc: "Physical damage + target's ATK -30% for 1 round.", specialTarget: "enemy", canHeal: false },
  { key: "knight", name: "Knight", emoji: "🛡️", hp: 160, atk: 16, mag: 0, def: 24, res: 14, spd: 6, mana: 20, specialName: "Taunt/Guard", specialCost: 10, specialDesc: "Forces enemies to target it for 1 round and gains +50% DEF for 1 round.", specialTarget: "self", canHeal: false },
  { key: "berserker", name: "Berserker", emoji: "🪓", hp: 120, atk: 30, mag: 0, def: 8, res: 4, spd: 12, mana: 20, specialName: "Reckless Strike", specialCost: 15, specialDesc: "1.8x physical damage; self takes 20% of damage dealt as recoil.", specialTarget: "enemy", canHeal: false },
  { key: "archer", name: "Archer", emoji: "🏹", hp: 85, atk: 24, mag: 0, def: 8, res: 8, spd: 16, mana: 25, specialName: "Piercing Shot", specialCost: 12, specialDesc: "Physical damage ignoring 60% of target DEF.", specialTarget: "enemy", canHeal: false },
  { key: "mage", name: "Mage", emoji: "🔮", hp: 70, atk: 6, mag: 30, def: 6, res: 12, spd: 11, mana: 40, specialName: "Fireball", specialCost: 20, specialDesc: "AoE magic damage to ALL enemies.", specialTarget: "all-enemies", canHeal: false },
  { key: "priest", name: "Priest", emoji: "✨", hp: 80, atk: 8, mag: 20, def: 8, res: 16, spd: 12, mana: 45, specialName: "Mass Heal", specialCost: 30, specialDesc: "Restores HP (0.9x MAG) to ALL allies. Also has single-target 'heal' action (cost 15, restores 1.5x MAG).", specialTarget: "all-allies", canHeal: true },
  { key: "rogue", name: "Rogue", emoji: "🗡", hp: 75, atk: 28, mag: 0, def: 6, res: 6, spd: 20, mana: 25, specialName: "Backstab", specialCost: 12, specialDesc: "Physical damage; 1.8x multiplier vs targets below 40% HP (1.0x otherwise).", specialTarget: "enemy", canHeal: false },
  { key: "paladin", name: "Paladin", emoji: "⚔️", hp: 130, atk: 20, mag: 12, def: 18, res: 16, spd: 8, mana: 35, specialName: "Smite", specialCost: 18, specialDesc: "1.5x magic damage; heals self for 40% of damage dealt. Also has single-target 'heal' action (cost 15, restores 1.5x MAG).", specialTarget: "enemy", canHeal: true },
  { key: "necromancer", name: "Necromancer", emoji: "💀", hp: 75, atk: 10, mag: 26, def: 6, res: 12, spd: 10, mana: 40, specialName: "Curse", specialCost: 16, specialDesc: "Poison DoT (magic) at end of each round for 3 rounds.", specialTarget: "enemy", canHeal: false },
  { key: "monk", name: "Monk", emoji: "🥋", hp: 105, atk: 22, mag: 0, def: 12, res: 14, spd: 14, mana: 30, specialName: "Counter Stance", specialCost: 12, specialDesc: "Reflects 50% of the next direct hit taken back at the attacker (lasts up to 2 rounds).", specialTarget: "self", canHeal: false },
];

export type StatusKind = "atkDown" | "defendUp" | "taunt" | "counter" | "poison";

export interface Status {
  kind: StatusKind;
  roundsLeft: number;
  value?: number; // poison: caster MAG at cast time
}

export interface ArenaUnit {
  id: string; // "A1".."A3", "B1".."B3"
  side: PlayerId;
  archetype: string;
  name: string;
  emoji: string;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  atk: number;
  mag: number;
  def: number;
  res: number;
  spd: number;
  statuses: Status[];
}

// Structured description of what just happened — the UI reads this to drive
// sprite poses, effect overlays and floating combat numbers (no text parsing).
// JSON-safe: it is captured in replay snapshots, so replays animate too.
export type EffectType = "damage" | "heal" | "poisoned" | "poison" | "status" | "death" | "mana";

export interface ArenaEffect {
  unit: string;
  type: EffectType;
  amount?: number;
  label?: string; // e.g. "recoil", "counter!", "ATK -30%", "Taunt/Guard"
}

// How the actor physically performs the action (drives the sprite pose).
export type ActionMotion = "melee" | "ranged" | "cast" | "support" | "none";

export interface ArenaEvent {
  seq: number; // increments on every applied action — keys UI animations
  actor: string;
  kind: "attack" | "special" | "heal" | "defend" | "pass";
  ability: string; // "Attack", "Fireball", "Heal", …
  motion: ActionMotion;
  targets: string[]; // units visually affected (excludes the actor unless self-target)
  effects: ArenaEffect[]; // ordered: action effects first, then end-of-round ticks
}

export interface ArenaState {
  seed: string;
  round: number; // 1-based; hard cap 20
  units: ArenaUnit[];
  queue: string[]; // unit ids still to act this round (head = active unit)
  lastAction: string | null;
  lastEvent: ArenaEvent | null;
  eventSeq: number;
  log: string[];
  [key: string]: unknown;
}

const ROUND_CAP = 20;
const MANA_REGEN_PER_ROUND = 5;
const PASS_MANA = 8;

function arch(key: string): ArchetypeDef {
  const a = ARCHETYPES.find((x) => x.key === key);
  if (!a) throw new Error(`unknown archetype ${key}`);
  return a;
}

function getUnit(s: ArenaState, id: string): ArenaUnit | undefined {
  return s.units.find((u) => u.id === id);
}

function alive(u: ArenaUnit): boolean {
  return u.hp > 0;
}

function aliveUnits(s: ArenaState, side?: PlayerId): ArenaUnit[] {
  return s.units.filter((u) => alive(u) && (side === undefined || u.side === side));
}

function hasStatus(u: ArenaUnit, kind: StatusKind): boolean {
  return u.statuses.some((st) => st.kind === kind);
}

function effDef(u: ArenaUnit): number {
  return hasStatus(u, "defendUp") ? u.def * 1.5 : u.def;
}
function effRes(u: ArenaUnit): number {
  return hasStatus(u, "defendUp") ? u.res * 1.5 : u.res;
}
function effAtk(u: ArenaUnit): number {
  return hasStatus(u, "atkDown") ? u.atk * 0.7 : u.atk;
}

function physDamage(attacker: ArenaUnit, target: ArenaUnit, mult: number, defPierce = 0): number {
  const d = effDef(target) * (1 - defPierce);
  return Math.max(1, Math.round(effAtk(attacker) * mult - d / 2));
}
function magDamage(attacker: ArenaUnit, target: ArenaUnit, mult: number): number {
  return Math.max(1, Math.round(attacker.mag * mult - effRes(target) / 2));
}

// Deterministic tie-break for SPD ties: seeded hash of round + unit id, then side A first.
function buildQueue(s: ArenaState): string[] {
  const us = aliveUnits(s);
  return us
    .slice()
    .sort((a, b) => {
      if (b.spd !== a.spd) return b.spd - a.spd;
      const ha = hashString(`${s.seed}|r${s.round}|${a.id}`);
      const hb = hashString(`${s.seed}|r${s.round}|${b.id}`);
      if (ha !== hb) return ha - hb;
      return a.side === b.side ? a.id.localeCompare(b.id) : a.side === "A" ? -1 : 1;
    })
    .map((u) => u.id);
}

function makeUnit(side: PlayerId, idx: number, key: string): ArenaUnit {
  const a = arch(key);
  return {
    id: `${side}${idx + 1}`,
    side,
    archetype: a.key,
    name: a.name,
    emoji: a.emoji,
    hp: a.hp,
    maxHp: a.hp,
    mana: a.mana,
    maxMana: a.mana,
    atk: a.atk,
    mag: a.mag,
    def: a.def,
    res: a.res,
    spd: a.spd,
    statuses: [],
  };
}

function init(seed: string): ArenaState {
  const rng = makeRng(seed);
  const keys = ARCHETYPES.map((a) => a.key);
  const shuffled = rng.shuffle(keys);
  const teamA = shuffled.slice(0, 3);
  const teamB = shuffled.slice(3, 6);
  const state: ArenaState = {
    seed,
    round: 1,
    units: [
      ...teamA.map((k, i) => makeUnit("A", i, k)),
      ...teamB.map((k, i) => makeUnit("B", i, k)),
    ],
    queue: [],
    lastAction: null,
    lastEvent: null,
    eventSeq: 0,
    log: [],
  };
  state.queue = buildQueue(state);
  return state;
}

function sideHpPct(s: ArenaState, side: PlayerId): number {
  const us = s.units.filter((u) => u.side === side);
  const cur = us.reduce((t, u) => t + Math.max(0, u.hp), 0);
  const max = us.reduce((t, u) => t + u.maxHp, 0);
  return Math.round((cur / max) * 100);
}

function isTerminal(state: GameState): boolean {
  const s = state as ArenaState;
  return aliveUnits(s, "A").length === 0 || aliveUnits(s, "B").length === 0 || s.round > ROUND_CAP;
}

function result(state: GameState) {
  const s = state as ArenaState;
  const aAlive = aliveUnits(s, "A").length > 0;
  const bAlive = aliveUnits(s, "B").length > 0;
  if (!aAlive && !bAlive) {
    return { winner: "draw" as const, reason: "Both teams were wiped out simultaneously", score: { A: 0, B: 0 } };
  }
  if (!bAlive) {
    return { winner: "A" as const, reason: "All enemy units defeated", score: { A: sideHpPct(s, "A"), B: 0 } };
  }
  if (!aAlive) {
    return { winner: "B" as const, reason: "All enemy units defeated", score: { A: 0, B: sideHpPct(s, "B") } };
  }
  // round cap
  const a = sideHpPct(s, "A");
  const b = sideHpPct(s, "B");
  if (a === b) {
    return { winner: "draw" as const, reason: `Round cap (${ROUND_CAP}) reached with equal remaining HP%`, score: { A: a, B: b } };
  }
  const winner: PlayerId = a > b ? "A" : "B";
  return {
    winner,
    reason: `Round cap (${ROUND_CAP}) reached — higher total remaining HP% wins (${a}% vs ${b}%)`,
    score: { A: winner === "A" ? a : 0, B: winner === "B" ? b : 0 },
  };
}

function activeUnit(s: ArenaState): ArenaUnit {
  const u = getUnit(s, s.queue[0]);
  if (!u) throw new Error("no active unit");
  return u;
}

function pendingDecisions(state: GameState): PlayerId[] {
  const s = state as ArenaState;
  if (isTerminal(s)) return [];
  return [activeUnit(s).side];
}

function legalActionsFor(s: ArenaState, u: ArenaUnit): { types: string[]; notes: string[] } {
  const a = arch(u.archetype);
  const types = ["attack", "defend", "pass"];
  const notes: string[] = [];
  if (u.mana >= a.specialCost) types.push("special");
  else notes.push(`special (${a.specialName}) needs ${a.specialCost} mana — you have ${u.mana}`);
  if (a.canHeal) {
    if (u.mana >= 15) types.push("heal");
    else notes.push(`heal needs 15 mana — you have ${u.mana}`);
  }
  return { types, notes };
}

function tauntTargets(s: ArenaState, attackerSide: PlayerId): ArenaUnit[] {
  return aliveUnits(s, attackerSide === "A" ? "B" : "A").filter((u) => hasStatus(u, "taunt"));
}

function describeUnit(u: ArenaUnit): Record<string, unknown> {
  return {
    id: u.id,
    archetype: u.name,
    hp: `${Math.max(0, u.hp)}/${u.maxHp}`,
    mana: `${u.mana}/${u.maxMana}`,
    stats: { ATK: u.atk, MAG: u.mag, DEF: u.def, RES: u.res, SPD: u.spd },
    statuses: u.statuses.map((st) => `${st.kind}(${st.roundsLeft} rounds left)`),
    alive: alive(u),
  };
}

const RULES = `You are playing ARENA CLASH, a 3v3 turn-based tactical RPG. You control one team; a rival AI controls the other. The game rules are enforced by a deterministic engine — you only choose actions.

RULES:
- Each round, all living units act once, in descending SPD order.
- On your unit's turn you choose ONE action for that unit:
  - {"unit":"<id>","type":"attack","target":"<enemy id>"} — physical damage: max(1, ATK - DEF_eff/2).
  - {"unit":"<id>","type":"special","target":"<id if required>"} — the unit's signature ability (costs mana; see ability list).
  - {"unit":"<id>","type":"heal","target":"<ally id>"} — Priest/Paladin only, costs 15 mana, restores 1.5x MAG HP.
  - {"unit":"<id>","type":"defend"} — +50% DEF and RES until end of round.
  - {"unit":"<id>","type":"pass"} — do nothing, recover ${PASS_MANA} mana.
- Damage formulas (deterministic, no dice): physical = max(1, ATK*mult - DEF_eff/2); magic = max(1, MAG*mult - RES_eff/2).
- Statuses: atkDown = -30% ATK; defendUp = +50% DEF/RES; taunt = enemies MUST target the taunting unit with attacks and single-target offensive specials; counter = reflects 50% of next direct hit; poison = magic DoT at end of each round.
- All units regain ${MANA_REGEN_PER_ROUND} mana at the end of each round.
- WIN: defeat all 3 enemy units. After ${ROUND_CAP} rounds the team with higher total remaining HP% wins.

ABILITIES (special, with mana cost):
${ARCHETYPES.map((a) => `- ${a.name}: ${a.specialName} (${a.specialCost}): ${a.specialDesc}`).join("\n")}

Choose legal actions only. If a special/heal lacks mana it is illegal. If an enemy has taunt you must target it with attacks/single-target specials.`;

function buildTurnRequest(state: GameState, player: PlayerId): TurnRequest {
  const s = state as ArenaState;
  const u = activeUnit(s);
  const legal = legalActionsFor(s, u);
  const enemySide: PlayerId = player === "A" ? "B" : "A";
  const taunters = tauntTargets(s, player);
  const enemies = aliveUnits(s, enemySide);
  const validEnemyTargets = (taunters.length > 0 ? taunters : enemies).map((e) => e.id);

  const userPrompt = `You are player ${player}. It is ROUND ${s.round}. Your unit ${u.id} (${u.name}) is the ACTIVE unit and must act now.

YOUR TEAM:
${JSON.stringify(s.units.filter((x) => x.side === player).map(describeUnit), null, 1)}

ENEMY TEAM:
${JSON.stringify(s.units.filter((x) => x.side === enemySide).map(describeUnit), null, 1)}

TURN ORDER REMAINING THIS ROUND: ${s.queue.join(", ")}
LAST ACTION: ${s.lastAction ?? "none (first action of the match)"}

LEGAL ACTION TYPES for ${u.id}: ${legal.types.join(", ")}${legal.notes.length ? `\n(unavailable: ${legal.notes.join("; ")})` : ""}
VALID enemy targets (attack / offensive special): ${validEnemyTargets.join(", ")}${taunters.length > 0 ? " (TAUNT is forcing your targeting!)" : ""}
VALID ally targets (heal): ${aliveUnits(s, player).map((x) => x.id).join(", ")}

Return your action for unit ${u.id}.`;

  return { player, systemPrompt: RULES, userPrompt, responseSchemaName: "arena_clash_action" };
}

function validateAction(state: GameState, player: PlayerId, action: Action): ValidationResult {
  const s = state as ArenaState;
  const u = activeUnit(s);
  if (u.side !== player) return { ok: false, error: "It is not your unit's turn." };
  if (typeof action !== "object" || action === null) return { ok: false, error: "action must be an object" };
  const unitId = String(action.unit ?? "");
  if (unitId !== u.id) {
    return { ok: false, error: `The active unit is ${u.id}; you sent "${unitId}". You must act with ${u.id}.` };
  }
  const type = String(action.type ?? "");
  const a = arch(u.archetype);
  const enemySide: PlayerId = player === "A" ? "B" : "A";
  const taunters = tauntTargets(s, player);

  const checkEnemyTarget = (): ValidationResult | ArenaUnit => {
    const t = getUnit(s, String(action.target ?? ""));
    if (!t || t.side !== enemySide || !alive(t)) {
      return { ok: false, error: `"target" must be a living enemy unit id (one of: ${aliveUnits(s, enemySide).map((x) => x.id).join(", ")}).` };
    }
    if (taunters.length > 0 && !hasStatus(t, "taunt")) {
      return { ok: false, error: `An enemy has TAUNT active — you must target ${taunters.map((x) => x.id).join(" or ")}.` };
    }
    return t;
  };

  switch (type) {
    case "attack": {
      const r = checkEnemyTarget();
      if ("ok" in (r as object) && (r as { ok: boolean }).ok === false) return r as ValidationResult;
      return { ok: true, action: { unit: u.id, type: "attack", target: (r as ArenaUnit).id } };
    }
    case "special": {
      if (u.mana < a.specialCost) {
        return { ok: false, error: `${a.specialName} costs ${a.specialCost} mana; ${u.id} only has ${u.mana}.` };
      }
      if (a.specialTarget === "enemy") {
        const r = checkEnemyTarget();
        if ("ok" in (r as object) && (r as { ok: boolean }).ok === false) return r as ValidationResult;
        return { ok: true, action: { unit: u.id, type: "special", target: (r as ArenaUnit).id } };
      }
      return { ok: true, action: { unit: u.id, type: "special" } };
    }
    case "heal": {
      if (!a.canHeal) return { ok: false, error: `${u.name} cannot use "heal" (Priest/Paladin only).` };
      if (u.mana < 15) return { ok: false, error: `heal costs 15 mana; ${u.id} only has ${u.mana}.` };
      const t = getUnit(s, String(action.target ?? ""));
      if (!t || t.side !== player || !alive(t)) {
        return { ok: false, error: `"target" must be a living ally id (one of: ${aliveUnits(s, player).map((x) => x.id).join(", ")}).` };
      }
      return { ok: true, action: { unit: u.id, type: "heal", target: t.id } };
    }
    case "defend":
      return { ok: true, action: { unit: u.id, type: "defend" } };
    case "pass":
      return { ok: true, action: { unit: u.id, type: "pass" } };
    default:
      return { ok: false, error: `Unknown action type "${type}". Legal types: attack, special, heal (Priest/Paladin), defend, pass.` };
  }
}

// Deal a direct (single-target) hit, handling counter reflection. Returns log lines
// and appends structured effects to `fx` for the animation layer.
function dealDirectDamage(
  s: ArenaState,
  attacker: ArenaUnit,
  target: ArenaUnit,
  dmg: number,
  label: string,
  fx: ArenaEffect[],
): string[] {
  const lines: string[] = [];
  target.hp = Math.max(0, target.hp - dmg);
  lines.push(`${attacker.id} ${attacker.name} → ${label} → ${target.id} ${target.name}: ${dmg} dmg${target.hp === 0 ? " — DEFEATED" : ""}`);
  fx.push({ unit: target.id, type: "damage", amount: dmg });
  if (target.hp === 0) fx.push({ unit: target.id, type: "death" });
  const counterIdx = target.statuses.findIndex((st) => st.kind === "counter");
  if (counterIdx >= 0 && target.hp > 0) {
    target.statuses.splice(counterIdx, 1);
    const refl = Math.max(1, Math.round(dmg * 0.5));
    attacker.hp = Math.max(0, attacker.hp - refl);
    lines.push(`${target.id} ${target.name} counters! ${refl} dmg reflected to ${attacker.id}${attacker.hp === 0 ? " — DEFEATED" : ""}`);
    fx.push({ unit: attacker.id, type: "damage", amount: refl, label: "counter!" });
    if (attacker.hp === 0) fx.push({ unit: attacker.id, type: "death" });
  }
  return lines;
}

function endOfRound(s: ArenaState, fx: ArenaEffect[]): string[] {
  const lines: string[] = [];
  // poison ticks (deterministic order: unit id)
  for (const u of s.units.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    if (!alive(u)) continue;
    for (const st of u.statuses) {
      if (st.kind === "poison") {
        const dmg = Math.max(1, Math.round((st.value ?? 20) * 0.5 - effRes(u) / 2));
        u.hp = Math.max(0, u.hp - dmg);
        lines.push(`${u.id} ${u.name} suffers ${dmg} poison dmg${u.hp === 0 ? " — DEFEATED" : ""}`);
        fx.push({ unit: u.id, type: "poison", amount: dmg });
        if (u.hp === 0) fx.push({ unit: u.id, type: "death" });
      }
    }
  }
  // status durations + mana regen
  for (const u of s.units) {
    if (!alive(u)) {
      u.statuses = [];
      continue;
    }
    u.statuses = u.statuses
      .map((st) => ({ ...st, roundsLeft: st.roundsLeft - 1 }))
      .filter((st) => st.roundsLeft > 0);
    u.mana = Math.min(u.maxMana, u.mana + MANA_REGEN_PER_ROUND);
  }
  return lines;
}

// Motion each special uses (drives the actor's sprite pose in the UI).
const SPECIAL_MOTION: Record<string, ActionMotion> = {
  soldier: "melee",
  knight: "support",
  berserker: "melee",
  archer: "ranged",
  mage: "cast",
  priest: "support",
  rogue: "melee",
  paladin: "cast",
  necromancer: "cast",
  monk: "support",
};

function applyActions(state: GameState, actions: Partial<Record<PlayerId, Action>>): GameState {
  const s = deepClone(state as ArenaState);
  const u = activeUnit(s);
  const action = actions[u.side];
  if (!action) throw new Error(`missing action for player ${u.side}`);
  const a = arch(u.archetype);
  const type = String(action.type);
  const lines: string[] = [];
  const fx: ArenaEffect[] = [];
  let ability = type;
  let motion: ActionMotion = "none";

  const target = action.target ? getUnit(s, String(action.target)) : undefined;

  switch (type) {
    case "attack": {
      if (!target) throw new Error("attack requires target");
      ability = "Attack";
      motion = "melee";
      lines.push(...dealDirectDamage(s, u, target, physDamage(u, target, 1.0), "Attack", fx));
      break;
    }
    case "special": {
      u.mana -= a.specialCost;
      ability = a.specialName;
      motion = SPECIAL_MOTION[a.key] ?? "melee";
      switch (a.key) {
        case "soldier": {
          if (!target) throw new Error("target required");
          lines.push(...dealDirectDamage(s, u, target, physDamage(u, target, 1.0), "Shield Bash", fx));
          if (alive(target)) {
            target.statuses.push({ kind: "atkDown", roundsLeft: 1 });
            lines.push(`${target.id} suffers ATK -30% for 1 round`);
            fx.push({ unit: target.id, type: "status", label: "ATK -30%" });
          }
          break;
        }
        case "knight": {
          u.statuses.push({ kind: "taunt", roundsLeft: 1 });
          u.statuses.push({ kind: "defendUp", roundsLeft: 1 });
          lines.push(`${u.id} ${u.name} → Taunt/Guard: enemies must target it; +50% DEF/RES for 1 round`);
          fx.push({ unit: u.id, type: "status", label: "Taunt/Guard" });
          break;
        }
        case "berserker": {
          if (!target) throw new Error("target required");
          const dmg = physDamage(u, target, 1.8);
          lines.push(...dealDirectDamage(s, u, target, dmg, "Reckless Strike", fx));
          const recoil = Math.max(1, Math.round(dmg * 0.2));
          u.hp = Math.max(0, u.hp - recoil);
          lines.push(`${u.id} takes ${recoil} recoil dmg${u.hp === 0 ? " — DEFEATED" : ""}`);
          fx.push({ unit: u.id, type: "damage", amount: recoil, label: "recoil" });
          if (u.hp === 0) fx.push({ unit: u.id, type: "death" });
          break;
        }
        case "archer": {
          if (!target) throw new Error("target required");
          lines.push(...dealDirectDamage(s, u, target, physDamage(u, target, 1.0, 0.6), "Piercing Shot", fx));
          break;
        }
        case "mage": {
          for (const e of aliveUnits(s, u.side === "A" ? "B" : "A")) {
            const dmg = magDamage(u, e, 1.0);
            e.hp = Math.max(0, e.hp - dmg);
            lines.push(`${u.id} ${u.name} → Fireball → ${e.id} ${e.name}: ${dmg} dmg${e.hp === 0 ? " — DEFEATED" : ""}`);
            fx.push({ unit: e.id, type: "damage", amount: dmg });
            if (e.hp === 0) fx.push({ unit: e.id, type: "death" });
          }
          break;
        }
        case "priest": {
          for (const ally of aliveUnits(s, u.side)) {
            const amt = Math.round(u.mag * 0.9);
            ally.hp = Math.min(ally.maxHp, ally.hp + amt);
            lines.push(`${u.id} ${u.name} → Mass Heal → ${ally.id}: +${amt} HP`);
            fx.push({ unit: ally.id, type: "heal", amount: amt });
          }
          break;
        }
        case "rogue": {
          if (!target) throw new Error("target required");
          const mult = target.hp / target.maxHp < 0.4 ? 1.8 : 1.0;
          lines.push(...dealDirectDamage(s, u, target, physDamage(u, target, mult), mult > 1 ? "Backstab (execute!)" : "Backstab", fx));
          break;
        }
        case "paladin": {
          if (!target) throw new Error("target required");
          const dmg = magDamage(u, target, 1.5);
          lines.push(...dealDirectDamage(s, u, target, dmg, "Smite", fx));
          if (alive(u)) {
            const heal = Math.round(dmg * 0.4);
            u.hp = Math.min(u.maxHp, u.hp + heal);
            lines.push(`${u.id} self-heals ${heal} HP`);
            fx.push({ unit: u.id, type: "heal", amount: heal });
          }
          break;
        }
        case "necromancer": {
          if (!target) throw new Error("target required");
          target.statuses.push({ kind: "poison", roundsLeft: 3, value: u.mag });
          lines.push(`${u.id} ${u.name} → Curse → ${target.id} ${target.name}: poisoned for 3 rounds`);
          fx.push({ unit: target.id, type: "poisoned", label: "Cursed" });
          break;
        }
        case "monk": {
          u.statuses.push({ kind: "counter", roundsLeft: 2 });
          lines.push(`${u.id} ${u.name} → Counter Stance: will reflect 50% of the next hit`);
          fx.push({ unit: u.id, type: "status", label: "Counter Stance" });
          break;
        }
      }
      break;
    }
    case "heal": {
      if (!target) throw new Error("heal requires target");
      u.mana -= 15;
      ability = "Heal";
      motion = "support";
      const amt = Math.round(u.mag * 1.5);
      target.hp = Math.min(target.maxHp, target.hp + amt);
      lines.push(`${u.id} ${u.name} → Heal → ${target.id} ${target.name}: +${amt} HP`);
      fx.push({ unit: target.id, type: "heal", amount: amt });
      break;
    }
    case "defend": {
      u.statuses.push({ kind: "defendUp", roundsLeft: 1 });
      ability = "Defend";
      motion = "support";
      lines.push(`${u.id} ${u.name} defends (+50% DEF/RES this round)`);
      fx.push({ unit: u.id, type: "status", label: "Defend" });
      break;
    }
    case "pass": {
      u.mana = Math.min(u.maxMana, u.mana + PASS_MANA);
      ability = "Pass";
      motion = "none";
      lines.push(`${u.id} ${u.name} passes (+${PASS_MANA} mana)`);
      fx.push({ unit: u.id, type: "mana", amount: PASS_MANA });
      break;
    }
    default:
      throw new Error(`unknown action type ${type}`);
  }

  // advance queue: drop acting unit, then drop any units that died mid-round
  s.queue.shift();
  s.queue = s.queue.filter((id) => {
    const q = getUnit(s, id);
    return q && alive(q);
  });

  // end of round?
  if (s.queue.length === 0 && aliveUnits(s, "A").length > 0 && aliveUnits(s, "B").length > 0) {
    lines.push(...endOfRound(s, fx));
    s.round += 1;
    if (s.round <= ROUND_CAP) s.queue = buildQueue(s);
  }

  s.lastAction = lines[0] ?? null;
  s.eventSeq += 1;
  s.lastEvent = {
    seq: s.eventSeq,
    actor: u.id,
    kind: type as ArenaEvent["kind"],
    ability,
    motion,
    targets: [...new Set(fx.filter((e) => e.unit !== u.id).map((e) => e.unit))],
    effects: fx,
  };
  s.log = [...s.log, ...lines].slice(-60);
  return s;
}

function defaultAction(state: GameState, player: PlayerId): Action {
  const s = state as ArenaState;
  const u = activeUnit(s);
  if (u.side !== player) return { unit: s.queue[0], type: "pass" };
  return { unit: u.id, type: "pass" };
}

function summarizeAction(state: GameState, _player: PlayerId, action: Action): string {
  const s = state as ArenaState;
  const u = getUnit(s, String(action.unit));
  const a = u ? arch(u.archetype) : undefined;
  const type = String(action.type);
  const label = type === "special" && a ? a.specialName : type;
  return `${action.unit} ${u?.name ?? ""} → ${label}${action.target ? ` → ${action.target}` : ""}`;
}

export const arenaClash: GameEngine = {
  id: "arena_clash",
  displayName: "Arena Clash",
  description: "3v3 tactical RPG — combat tactics, target priority, mana management.",
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
