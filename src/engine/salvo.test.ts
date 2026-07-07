import { describe, expect, it } from "vitest";
import { autoPlacement, salvo } from "./salvo";
import type { SalvoState } from "./salvo";

const init = (seed: string) => salvo.init(seed) as SalvoState;

function placeBoth(seed: string): SalvoState {
  let s = salvo.init(seed);
  s = salvo.applyActions(s, { A: autoPlacement(seed, "A") as never });
  s = salvo.applyActions(s, { B: autoPlacement(seed, "B") as never });
  return s as SalvoState;
}

describe("salvo", () => {
  it("autoPlacement is deterministic and passes validation", () => {
    expect(autoPlacement("x", "A")).toEqual(autoPlacement("x", "A"));
    const s = init("x");
    const v = salvo.validateAction(s, "A", autoPlacement("x", "A") as never);
    expect(v.ok).toBe(true);
  });

  it("placement order is A then B, then battle starts with A", () => {
    let s = init("p");
    expect(salvo.pendingDecisions(s)).toEqual(["A"]);
    s = salvo.applyActions(s, { A: autoPlacement("p", "A") as never }) as SalvoState;
    expect(salvo.pendingDecisions(s)).toEqual(["B"]);
    s = salvo.applyActions(s, { B: autoPlacement("p", "B") as never }) as SalvoState;
    expect((s as SalvoState).phase).toBe("battle");
    expect(salvo.pendingDecisions(s)).toEqual(["A"]);
  });

  it("rejects bad placements: overlap, wrong size, diagonal, missing ship", () => {
    const s = init("bad");
    const base = autoPlacement("bad", "A").placements;
    const overlap = base.map((p, i) => (i === 1 ? { ...p, cells: base[0].cells.slice(0, 4) } : p));
    expect(salvo.validateAction(s, "A", { placements: overlap }).ok).toBe(false);
    const short = base.map((p, i) => (i === 0 ? { ...p, cells: p.cells.slice(0, 4) } : p));
    expect(salvo.validateAction(s, "A", { placements: short }).ok).toBe(false);
    const diagonal = base.map((p, i) =>
      i === 4 ? { ...p, cells: [ [0, 0], [1, 1] ] as [number, number][] } : p,
    );
    expect(salvo.validateAction(s, "A", { placements: diagonal }).ok).toBe(false);
    expect(salvo.validateAction(s, "A", { placements: base.slice(0, 4) }).ok).toBe(false);
  });

  it("firing at a ship cell hits; repeats are illegal; sinking all ships wins", () => {
    let s = placeBoth("battle");
    const bFleet = s.fleets.B!;
    const target = bFleet[0].cells[0];
    expect(salvo.validateAction(s, "A", { fire: target }).ok).toBe(true);
    s = salvo.applyActions(s, { A: { fire: target } }) as SalvoState;
    expect(s.shots.A[0].result).toBe("hit");
    expect(s.current).toBe("B");
    // B fires a miss somewhere (find a water cell)
    const aCells = new Set(s.fleets.A!.flatMap((sh) => sh.cells.map((c) => c.join(","))));
    let water: [number, number] = [0, 0];
    outer: for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!aCells.has(`${r},${c}`)) { water = [r, c]; break outer; }
    s = salvo.applyActions(s, { B: { fire: water } }) as SalvoState;
    expect(s.shots.B[0].result).toBe("miss");
    // repeat shot by A is illegal
    expect(salvo.validateAction(s, "A", { fire: target }).ok).toBe(false);
    // A sinks everything (alternating with B misses)
    for (const ship of s.fleets.B!) {
      for (const cell of ship.cells) {
        if (s.shots.A.some((sh) => sh.pos.join() === cell.join())) continue;
        s = salvo.applyActions(s, { A: { fire: cell } }) as SalvoState;
        if (s.phase === "done") break;
        // B fires its deterministic default
        const bAction = salvo.defaultAction(s, "B");
        s = salvo.applyActions(s, { B: bAction }) as SalvoState;
        if (s.phase === "done") break;
      }
    }
    expect(salvo.isTerminal(s)).toBe(true);
    const r = salvo.result(s);
    expect(r.winner === "A" || r.winner === "B").toBe(true);
    expect(r.score.A).toBe(s.shots.A.length);
  });

  it("sunk is reported on the finishing shot", () => {
    let s = placeBoth("sunk-test");
    const destroyer = s.fleets.B!.find((sh) => sh.name === "destroyer")!;
    s = salvo.applyActions(s, { A: { fire: destroyer.cells[0] } }) as SalvoState;
    s = salvo.applyActions(s, { B: salvo.defaultAction(s, "B") }) as SalvoState;
    s = salvo.applyActions(s, { A: { fire: destroyer.cells[1] } }) as SalvoState;
    const last = s.shots.A[s.shots.A.length - 1];
    expect(last.result).toBe("sunk");
    expect(last.ship).toBe("destroyer");
  });
});
