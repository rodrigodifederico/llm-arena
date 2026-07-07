import { describe, expect, it } from "vitest";
import { hexDominion } from "./hexDominion";
import type { HexState } from "./hexDominion";
import { deepClone } from "./GameEngine";

const init = (seed: string) => hexDominion.init(seed) as HexState;

describe("hexDominion", () => {
  it("init is deterministic and mines are centrally symmetric", () => {
    expect(init("s")).toEqual(init("s"));
    const s = init("mines-seed");
    expect(s.mines).toHaveLength(4);
    const keys = new Set(s.mines.map((m) => m.pos.join(",")));
    for (const m of s.mines) {
      expect(keys.has(`${6 - m.pos[0]},${6 - m.pos[1]}`)).toBe(true);
    }
  });

  it("A starts with income 1 (no mines) and spawn is unaffordable", () => {
    const s = init("s2");
    expect(s.energy.A).toBe(1);
    const v = hexDominion.validateAction(s, "A", { commands: [{ type: "spawn", at: [5, 1] }] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/energy/i);
  });

  it("rejects out-of-range moves and occupied destinations", () => {
    const s = init("s3");
    expect(hexDominion.validateAction(s, "A", { commands: [{ type: "move", unit: "A1", to: [1, 0] }] }).ok).toBe(false); // dist 4 > 2
    expect(hexDominion.validateAction(s, "A", { commands: [{ type: "move", unit: "A1", to: [6, 1] }] }).ok).toBe(false); // A2 there
    expect(hexDominion.validateAction(s, "A", { commands: [{ type: "move", unit: "B1", to: [2, 6] }] }).ok).toBe(false); // not yours
  });

  it("legal move applies, spends energy, switches turn, grants income", () => {
    const s = init("s4");
    const cmd = { commands: [{ type: "move", unit: "A1", to: [4, 0] }] };
    expect(hexDominion.validateAction(s, "A", cmd).ok).toBe(true);
    const next = hexDominion.applyActions(s, { A: cmd }) as HexState;
    expect(next.units.find((u) => u.id === "A1")!.pos).toEqual([4, 0]);
    expect(next.energy.A).toBe(0);
    expect(next.current).toBe("B");
    expect(next.energy.B).toBe(1);
    expect(next.turnNumber).toBe(2);
  });

  it("attack deals damage with retaliation; kills remove the unit", () => {
    const s = init("s5");
    // craft adjacency
    s.units.find((u) => u.id === "A1")!.pos = [1, 5];
    const v = hexDominion.validateAction(s, "A", { commands: [{ type: "attack", unit: "A1", target: [1, 6] }] });
    expect(v.ok).toBe(true);
    const next = hexDominion.applyActions(s, { A: { commands: [{ type: "attack", unit: "A1", target: [1, 6] }] } }) as HexState;
    expect(next.units.find((u) => u.id === "B1")!.hp).toBe(6);
    expect(next.units.find((u) => u.id === "A1")!.hp).toBe(6); // retaliation
  });

  it("destroying the HQ ends the game", () => {
    const s = init("s6");
    s.units.find((u) => u.id === "A1")!.pos = [1, 6];
    s.units = s.units.filter((u) => u.id !== "B1"); // free the cell next to HQ
    s.hqs.B.hp = 4;
    const next = hexDominion.applyActions(s, { A: { commands: [{ type: "attack", unit: "A1", target: [0, 6] }] } });
    expect(hexDominion.isTerminal(next)).toBe(true);
    expect(hexDominion.result(next).winner).toBe("A");
  });

  it("moving onto a mine captures it and raises income", () => {
    const s = init("s7");
    const mine = s.mines[0];
    s.units.find((u) => u.id === "A1")!.pos = [mine.pos[0] + 1, mine.pos[1]];
    const cmd = { commands: [{ type: "move", unit: "A1", to: mine.pos }] };
    const v = hexDominion.validateAction(s, "A", cmd);
    expect(v.ok).toBe(true);
    const next = hexDominion.applyActions(s, { A: cmd }) as HexState;
    expect(next.mines.find((m) => m.pos.join() === mine.pos.join())!.owner).toBe("A");
  });

  it("turn cap result compares mines then unit HP", () => {
    const s = init("s8");
    s.turnNumber = 31;
    s.mines[0].owner = "B";
    expect(hexDominion.isTerminal(s)).toBe(true);
    expect(hexDominion.result(s).winner).toBe("B");
  });

  it("applyActions does not mutate input", () => {
    const s = init("s9");
    const snap = deepClone(s);
    hexDominion.applyActions(s, { A: { commands: [] } });
    expect(s).toEqual(snap);
  });
});
