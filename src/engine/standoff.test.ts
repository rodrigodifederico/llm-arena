import { describe, expect, it } from "vitest";
import { losesLife, standoff } from "./standoff";
import type { Move, StandoffState } from "./standoff";

const init = () => standoff.init("any") as StandoffState;

describe("standoff", () => {
  it("resolution table matches the spec exactly", () => {
    // expected[you][opp] = you lose a life?
    const expected: Record<Move, Record<Move, boolean>> = {
      reload: { reload: false, shield: false, shoot: true, mega: true },
      shield: { reload: false, shield: false, shoot: false, mega: true },
      shoot: { reload: false, shield: false, shoot: true, mega: true },
      mega: { reload: false, shield: false, shoot: false, mega: true },
    };
    for (const you of Object.keys(expected) as Move[]) {
      for (const opp of Object.keys(expected[you]) as Move[]) {
        expect(losesLife(you, opp), `${you} vs ${opp}`).toBe(expected[you][opp]);
      }
    }
  });

  it("is simultaneous: both players pending", () => {
    expect(standoff.pendingDecisions(init())).toEqual(["A", "B"]);
  });

  it("rejects shoot with 0 ammo and mega with <3", () => {
    const s = init();
    expect(standoff.validateAction(s, "A", { move: "shoot" }).ok).toBe(false);
    expect(standoff.validateAction(s, "A", { move: "mega" }).ok).toBe(false);
    expect(standoff.validateAction(s, "A", { move: "reload" }).ok).toBe(true);
  });

  it("applies ammo and life changes correctly", () => {
    let s = standoff.applyActions(init(), { A: { move: "reload" }, B: { move: "reload" } }) as StandoffState;
    expect(s.ammo).toEqual({ A: 1, B: 1 });
    s = standoff.applyActions(s, { A: { move: "shoot" }, B: { move: "reload" } }) as StandoffState;
    expect(s.lives).toEqual({ A: 3, B: 2 });
    expect(s.ammo).toEqual({ A: 0, B: 2 });
    s = standoff.applyActions(s, { A: { move: "shield" }, B: { move: "shoot" } }) as StandoffState;
    expect(s.lives).toEqual({ A: 3, B: 2 }); // blocked
    expect(s.history).toHaveLength(3);
  });

  it("mega pierces shield and beats shoot", () => {
    const s = init();
    s.ammo = { A: 3, B: 1 };
    const afterShield = standoff.applyActions(s, { A: { move: "mega" }, B: { move: "shield" } }) as StandoffState;
    expect(afterShield.lives.B).toBe(2);
    const s2 = init();
    s2.ammo = { A: 3, B: 1 };
    const afterShoot = standoff.applyActions(s2, { A: { move: "mega" }, B: { move: "shoot" } }) as StandoffState;
    expect(afterShoot.lives).toEqual({ A: 3, B: 2 }); // mega is faster
  });

  it("terminal conditions: elimination, round cap, sudden death", () => {
    const dead = init();
    dead.lives.B = 0;
    expect(standoff.isTerminal(dead)).toBe(true);
    expect(standoff.result(dead).winner).toBe("A");

    const capped = init();
    capped.round = 41;
    capped.lives = { A: 3, B: 2 };
    expect(standoff.isTerminal(capped)).toBe(true);
    expect(standoff.result(capped).winner).toBe("A");

    const tiedAtCap = init();
    tiedAtCap.round = 41;
    expect(standoff.isTerminal(tiedAtCap)).toBe(false); // sudden death continues

    const exhausted = init();
    exhausted.round = 46;
    expect(standoff.isTerminal(exhausted)).toBe(true);
    expect(standoff.result(exhausted).winner).toBe("draw");
  });
});
