import type { GameState, PlayerId } from "../../engine/GameEngine";
import type { SalvoState } from "../../engine/salvo";

function Grid({ s, owner }: { s: SalvoState; owner: PlayerId }) {
  const fleet = s.fleets[owner];
  const enemyShots = s.shots[owner === "A" ? "B" : "A"];
  const shipCells = new Map<string, string>();
  const sunkCells = new Set<string>();
  if (fleet) {
    for (const sh of fleet) {
      const sunk = sh.hits.length === sh.size;
      for (const c of sh.cells) {
        shipCells.set(c.join(","), sh.name);
        if (sunk) sunkCells.add(c.join(","));
      }
    }
  }
  const shotAt = new Map<string, string>();
  for (const sh of enemyShots) shotAt.set(sh.pos.join(","), sh.result);

  const accent = owner === "A" ? "text-cyan-400" : "text-fuchsia-400";
  const shipBg = owner === "A" ? "bg-cyan-800/70" : "bg-fuchsia-800/70";

  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const k = `${r},${c}`;
      const ship = shipCells.get(k);
      const shot = shotAt.get(k);
      let cls = "bg-zinc-900";
      let mark: React.ReactNode = null;
      if (ship) cls = sunkCells.has(k) ? "bg-zinc-700" : shipBg;
      if (shot === "miss") mark = <span className="text-zinc-500 text-[10px]">•</span>;
      if (shot === "hit" || shot === "sunk") mark = <span className="text-red-400 text-xs font-bold">✕</span>;
      cells.push(
        <div key={k} title={`[${r},${c}]${ship ? ` ${ship}` : ""}`} className={`flex h-6 w-6 items-center justify-center rounded-sm border border-zinc-800 ${cls}`}>
          {mark}
        </div>,
      );
    }
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`text-sm font-semibold ${accent}`}>
        {owner}'s fleet {fleet ? "" : "(placing…)"}
      </div>
      <div className="grid grid-cols-8 gap-0.5">{cells}</div>
      <div className="text-[10px] text-zinc-500">
        {fleet ? `${fleet.filter((sh) => sh.hits.length === sh.size).length}/5 ships lost` : "fleet not placed yet"} ·{" "}
        {enemyShots.length} enemy shots
      </div>
    </div>
  );
}

export default function SalvoBoard({ state }: { state: GameState }) {
  const s = state as SalvoState;
  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="flex flex-wrap justify-center gap-8">
        <Grid s={s} owner="A" />
        <Grid s={s} owner="B" />
      </div>
      {s.lastSummary && (
        <div className="text-xs text-amber-300 flash-in" key={s.lastSummary}>
          {s.lastSummary}
        </div>
      )}
      <div className="max-w-md text-center text-[10px] text-zinc-600">
        Spectator view — each model only sees its own board and its shot results, never the opponent's grid.
      </div>
    </div>
  );
}
