import { useEffect, useRef } from "react";
import type { GameState, PlayerId } from "../../engine/GameEngine";
import type { StandoffState } from "../../engine/standoff";
import { playSound } from "../../utils/audio";

const MOVE_ICON: Record<string, string> = {
  reload: "🔄",
  shield: "🛡️",
  shoot: "🔫",
  mega: "💥",
};

function Duelist({ s, player }: { s: StandoffState; player: PlayerId }) {
  const accent =
    player === "A"
      ? "text-cyan-400 border-cyan-500/50 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
      : "text-fuchsia-400 border-fuchsia-500/50 shadow-[0_0_15px_rgba(232,121,249,0.15)]";
  const last = s.history[s.history.length - 1];
  const duelistImg = player === "A" ? "/gunslinger_a.png" : "/gunslinger_b.png";

  return (
    <div className={`flex w-48 flex-col items-center gap-3 rounded-xl border bg-zinc-900/60 p-4 shadow-xl backdrop-blur-xs transition-all ${accent}`}>
      <div className="relative w-28 h-28 flex items-center justify-center border border-zinc-800 bg-zinc-950/40 rounded-lg p-1.5 overflow-hidden">
        <img
          src={duelistImg}
          alt={`Duelist ${player}`}
          className={`w-full h-full object-contain pixelated ${s.lives[player] <= 0 ? "filter grayscale brightness-50 opacity-40" : ""}`}
        />
        {s.lives[player] <= 0 && (
          <span className="absolute text-4xl drop-shadow-lg">💀</span>
        )}
      </div>
      <div className="text-xs font-black uppercase tracking-wider">{player === "A" ? "Player A" : "Player B"}</div>
      <div className="text-lg tracking-wider flex gap-0.5">
        {"❤️".repeat(Math.max(0, s.lives[player]))}
        {"🖤".repeat(Math.max(0, 3 - s.lives[player]))}
      </div>
      <div className="text-xs text-zinc-400 mt-1 flex flex-col items-center gap-1 w-full">
        <span className="font-semibold text-zinc-300">ammo: {s.ammo[player]}</span>
        {s.ammo[player] > 0 ? (
          <div className="flex flex-wrap justify-center gap-0.5 max-w-full px-1">
            {Array.from({ length: s.ammo[player] }).map((_, i) => (
              <span key={i} className="text-xs select-none">🔸</span>
            ))}
          </div>
        ) : (
          <span className="text-zinc-600 text-xs">—</span>
        )}
      </div>
      {last && (
        <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-xs font-bold uppercase tracking-wide flash-in" key={last.round}>
          {MOVE_ICON[last.moves[player]]} {last.moves[player]}
        </div>
      )}
    </div>
  );
}

export default function StandoffBoard({ state }: { state: GameState }) {
  const s = state as StandoffState;
  const last = s.history[s.history.length - 1];

  const lastRoundRef = useRef(s.round);

  useEffect(() => {
    if (s.round !== lastRoundRef.current) {
      lastRoundRef.current = s.round;

      if (last) {
        // 1. Check if anyone died this round
        // lives snapshots may be absent in replays recorded before the field existed
        const aJustDied = s.lives.A <= 0 && s.history.length >= 2 && (s.history[s.history.length - 2].lives?.A ?? 1) > 0;
        const bJustDied = s.lives.B <= 0 && s.history.length >= 2 && (s.history[s.history.length - 2].lives?.B ?? 1) > 0;
        
        if (aJustDied || bJustDied) {
          playSound("death");
          return;
        }

        // 2. Play sound effects for the moves
        const moves = [last.moves.A, last.moves.B];
        if (moves.includes("mega")) {
          playSound("attack"); // 8-bit explosion sound
        }
        if (moves.includes("shoot")) {
          playSound("shoot");
        }
        if (moves.includes("shield")) {
          setTimeout(() => playSound("shield"), 80);
        }
        if (moves.includes("reload")) {
          setTimeout(() => playSound("reload"), 150);
        }
      }
    }
  }, [s.round, last]);

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <div className="text-xs text-zinc-500">
        round {Math.min(s.round, 45)} {s.round > 40 ? "· SUDDEN DEATH" : "/ 40"}
      </div>
      <div className="flex items-center gap-8">
        <Duelist s={s} player="A" />
        <div className="text-3xl text-zinc-600">⚡</div>
        <Duelist s={s} player="B" />
      </div>
      {last && (
        <div className="text-sm text-amber-300 flash-in" key={`ev-${last.round}`}>
          {last.events.length ? last.events.join(" · ") : "no damage this round"}
        </div>
      )}
      <div className="flex max-w-xl flex-wrap justify-center gap-1">
        {s.history.slice(-12).map((h) => (
          <div key={h.round} className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400" title={h.events.join("; ")}>
            R{h.round}: {MOVE_ICON[h.moves.A]}v{MOVE_ICON[h.moves.B]}
          </div>
        ))}
      </div>
    </div>
  );
}
