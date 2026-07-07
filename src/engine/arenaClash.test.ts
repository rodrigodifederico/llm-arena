import { describe, expect, it } from "vitest";
import { arenaClash } from "./arenaClash";
import type { ArenaState } from "./arenaClash";
import { deepClone } from "./GameEngine";

const init = (seed: string) => arenaClash.init(seed) as ArenaState;

describe("arenaClash", () => {
  it("init is deterministic for the same seed", () => {
    expect(init("alpha")).toEqual(init("alpha"));
    expect(JSON.stringify(init("alpha"))).not.toEqual(JSON.stringify(init("beta")));
  });

  it("draws 3 distinct archetypes per side", () => {
    const s = init("seed-1");
    for (const side of ["A", "B"] as const) {
      const team = s.units.filter((u) => u.side === side);
      expect(team).toHaveLength(3);
      expect(new Set(team.map((u) => u.archetype)).size).toBe(3);
    }
  });

  it("queue is ordered by descending SPD", () => {
    const s = init("seed-2");
    const spds = s.queue.map((id) => s.units.find((u) => u.id === id)!.spd);
    for (let i = 1; i < spds.length; i++) expect(spds[i]).toBeLessThanOrEqual(spds[i - 1]);
  });

  it("rejects acting with a non-active unit and unknown types", () => {
    const s = init("seed-3");
    const active = s.queue[0];
    const player = active[0] as "A" | "B";
    const wrongUnit = player === "A" ? "A9" : "B9";
    expect(arenaClash.validateAction(s, player, { unit: wrongUnit, type: "pass" }).ok).toBe(false);
    expect(arenaClash.validateAction(s, player, { unit: active, type: "dance" }).ok).toBe(false);
  });

  it("rejects special without enough mana", () => {
    const s = init("seed-4");
    const active = s.units.find((u) => u.id === s.queue[0])!;
    active.mana = 0;
    const enemy = s.units.find((u) => u.side !== active.side)!;
    const v = arenaClash.validateAction(s, active.side, { unit: active.id, type: "special", target: enemy.id });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/mana/i);
  });

  it("enforces taunt targeting", () => {
    const s = init("seed-5");
    const active = s.units.find((u) => u.id === s.queue[0])!;
    const enemies = s.units.filter((u) => u.side !== active.side);
    enemies[0].statuses.push({ kind: "taunt", roundsLeft: 1 });
    const bad = arenaClash.validateAction(s, active.side, { unit: active.id, type: "attack", target: enemies[1].id });
    expect(bad.ok).toBe(false);
    const good = arenaClash.validateAction(s, active.side, { unit: active.id, type: "attack", target: enemies[0].id });
    expect(good.ok).toBe(true);
  });

  it("attack applies the deterministic physical formula", () => {
    const s = init("seed-6");
    const attacker = s.units.find((u) => u.id === s.queue[0])!;
    const target = s.units.find((u) => u.side !== attacker.side)!;
    const expected = Math.max(1, Math.round(attacker.atk * 1.0 - target.def / 2));
    const next = arenaClash.applyActions(s, {
      [attacker.side]: { unit: attacker.id, type: "attack", target: target.id },
    }) as ArenaState;
    const after = next.units.find((u) => u.id === target.id)!;
    expect(after.hp).toBe(target.hp - expected);
  });

  it("a scripted match (all defaults) is fully deterministic and terminates", () => {
    const run = () => {
      let state = arenaClash.init("script-seed");
      const seen: string[] = [];
      let guard = 0;
      while (!arenaClash.isTerminal(state) && guard++ < 500) {
        const [p] = arenaClash.pendingDecisions(state);
        const a = arenaClash.defaultAction(state, p);
        const v = arenaClash.validateAction(state, p, a);
        expect(v.ok).toBe(true);
        state = arenaClash.applyActions(state, { [p]: a });
        seen.push(JSON.stringify(state));
      }
      expect(arenaClash.isTerminal(state)).toBe(true);
      return { final: state, trace: seen.join("|") };
    };
    const r1 = run();
    const r2 = run();
    expect(r1.trace).toEqual(r2.trace);
    // all passes => equal HP% => draw at round cap
    expect(arenaClash.result(r1.final).winner).toBe("draw");
  });

  it("emits a structured lastEvent with effects for the animation layer", () => {
    const s = init("seed-8");
    const attacker = s.units.find((u) => u.id === s.queue[0])!;
    const target = s.units.find((u) => u.side !== attacker.side)!;
    const next = arenaClash.applyActions(s, {
      [attacker.side]: { unit: attacker.id, type: "attack", target: target.id },
    }) as ArenaState;
    const ev = next.lastEvent!;
    expect(ev.seq).toBe(1);
    expect(ev.actor).toBe(attacker.id);
    expect(ev.kind).toBe("attack");
    expect(ev.motion).toBe("melee");
    expect(ev.targets).toContain(target.id);
    const dmg = ev.effects.find((e) => e.type === "damage" && e.unit === target.id);
    expect(dmg?.amount).toBeGreaterThan(0);

    // pass emits a mana effect and no targets
    const s2 = init("seed-8");
    const u2 = s2.units.find((u) => u.id === s2.queue[0])!;
    const next2 = arenaClash.applyActions(s2, { [u2.side]: { unit: u2.id, type: "pass" } }) as ArenaState;
    expect(next2.lastEvent!.motion).toBe("none");
    expect(next2.lastEvent!.effects[0]).toMatchObject({ unit: u2.id, type: "mana" });
    expect(next2.lastEvent!.targets).toEqual([]);
  });

  it("applyActions does not mutate the input state", () => {
    const s = init("seed-7");
    const snapshot = deepClone(s);
    const [p] = arenaClash.pendingDecisions(s);
    arenaClash.applyActions(s, { [p]: arenaClash.defaultAction(s, p) });
    expect(s).toEqual(snapshot);
  });
});
