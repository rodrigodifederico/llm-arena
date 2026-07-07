import type { GameState } from "../../engine/GameEngine";
import type { HexState } from "../../engine/hexDominion";

export default function HexBoard({ state }: { state: GameState }) {
  const s = state as HexState;
  const cells = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isHqA = s.hqs.A.pos[0] === r && s.hqs.A.pos[1] === c;
      const isHqB = s.hqs.B.pos[0] === r && s.hqs.B.pos[1] === c;
      const mine = s.mines.find((m) => m.pos[0] === r && m.pos[1] === c);
      const unit = s.units.find((u) => u.pos[0] === r && u.pos[1] === c);
      let content: React.ReactNode = null;
      let bg = "bg-zinc-900";
      if (isHqA || isHqB) {
        const hq = isHqA ? s.hqs.A : s.hqs.B;
        bg = isHqA ? "bg-cyan-950" : "bg-fuchsia-950";
        content = (
          <div className="text-center">
            <div className="text-lg leading-none">🏰</div>
            <div className={`text-[10px] font-bold ${isHqA ? "text-cyan-300" : "text-fuchsia-300"}`}>{hq.hp}</div>
          </div>
        );
      } else if (unit) {
        bg = unit.owner === "A" ? "bg-cyan-900/60" : "bg-fuchsia-900/60";
        content = (
          <div className="text-center">
            <div className={`text-xs font-bold ${unit.owner === "A" ? "text-cyan-300" : "text-fuchsia-300"}`}>
              {unit.id}
            </div>
            <div className="flex justify-center gap-px">
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className={`h-1 w-1.5 rounded-sm ${i < Math.ceil(unit.hp / 2) ? "bg-emerald-400" : "bg-zinc-700"}`}
                />
              ))}
            </div>
            {mine && <div className="text-[9px]">⛏️</div>}
          </div>
        );
      } else if (mine) {
        bg = mine.owner === "A" ? "bg-cyan-950/70" : mine.owner === "B" ? "bg-fuchsia-950/70" : "bg-amber-950/50";
        content = (
          <div className="text-center">
            <div className="text-sm">⛏️</div>
            <div className="text-[9px] text-zinc-400">{mine.owner ?? "—"}</div>
          </div>
        );
      }
      cells.push(
        <div
          key={`${r},${c}`}
          className={`flex h-12 w-12 items-center justify-center rounded border border-zinc-800 ${bg}`}
          title={`[${r},${c}]`}
        >
          {content}
        </div>,
      );
    }
  }
  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="flex w-full max-w-lg justify-between text-sm">
        <div className="text-cyan-400">
          ⚡ A: {s.energy.A} energy · {s.mines.filter((m) => m.owner === "A").length} mines
        </div>
        <div className="text-zinc-400">turn {Math.min(s.turnNumber, 30)}/30 · {s.current} to move</div>
        <div className="text-fuchsia-400">
          ⚡ B: {s.energy.B} energy · {s.mines.filter((m) => m.owner === "B").length} mines
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">{cells}</div>
      {s.lastSummary && (
        <div className="max-w-lg text-center text-xs text-amber-300 flash-in" key={s.lastSummary}>
          {s.lastSummary}
        </div>
      )}
    </div>
  );
}
