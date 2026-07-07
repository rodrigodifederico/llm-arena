import { useState, useEffect, useRef } from "react";
import { getEngine } from "../engine";
import { downloadReplay } from "../match/replay";
import { useConfigStore } from "../store/configStore";
import { useMatchStore } from "../store/matchStore";
import { useUiStore } from "../store/uiStore";
import { getBoard } from "./boards";
import CompetitorHeader, { getProviderInfo } from "./hud/CompetitorHeader";
import TurnLog from "./hud/TurnLog";

export default function ArenaScreen() {
  const m = useMatchStore();
  const go = useUiStore((s) => s.go);
  const players = useConfigStore((s) => s.players);
  const showCost = players.A.costInPerM > 0 || players.A.costOutPerM > 0 || players.B.costInPerM > 0 || players.B.costOutPerM > 0;
  const [showLogs, setShowLogs] = useState(false);

  const [countdown, setCountdown] = useState<number | "Fight!" | "Readying..." | null>(null);
  const countdownFinishedRef = useRef(false);

  // 1. Separate Effect to handle the countdown sequence (runs once on mount)
  useEffect(() => {
    if (m.turns.length === 0 && !countdownFinishedRef.current) {
      setCountdown("Readying...");

      // Give 1.2s for chromakey assets to load & process before counting down
      const prepTimer = setTimeout(() => {
        setCountdown(3);
      }, 1200);

      const timer3 = setTimeout(() => setCountdown(2), 2200);
      const timer2 = setTimeout(() => setCountdown(1), 3200);
      const timer1 = setTimeout(() => setCountdown("Fight!"), 4200);
      const timerEnd = setTimeout(() => {
        countdownFinishedRef.current = true;
        setCountdown(null);
        m.resume(); // Resume the match to start LLM calls
      }, 5200);

      return () => {
        clearTimeout(prepTimer);
        clearTimeout(timer3);
        clearTimeout(timer2);
        clearTimeout(timer1);
        clearTimeout(timerEnd);
      };
    }
  }, []);

  // 2. Reset the ref on setup reset
  useEffect(() => {
    if (m.status === "idle") {
      countdownFinishedRef.current = false;
      setCountdown(null);
    }
  }, [m.status]);

  if (!m.engineId) {
    return (
      <div className="p-10 text-center text-zinc-500">
        No match running. <button className="text-cyan-400 underline" onClick={() => go("setup")}>Back to setup</button>
      </div>
    );
  }

  const engine = getEngine(m.engineId);
  const Board = getBoard(m.engineId);
  const running = m.status === "running";
  const paused = m.status === "paused";
  const over = m.status === "finished" || m.status === "aborted";

  const winnerId = m.result?.winner;
  let winnerLabel = "";
  if (winnerId && winnerId !== "draw") {
    const modelName = m.playerModels[winnerId];
    const rawLabel = m.playerLabels[winnerId];
    const provider = getProviderInfo(modelName, rawLabel);
    winnerLabel = `${provider.company} (${modelName || rawLabel})`;
  }

  return (
    <div className="w-full flex h-screen max-w-none flex-col gap-3 p-4 px-6">
      <div className="flex items-stretch gap-3">
        <CompetitorHeader player="A" label={m.playerLabels.A} model={m.playerModels.A} totals={m.totals.A} thinking={m.thinking.A} showCost={showCost} />
        <div className="flex flex-col items-center justify-center px-1 text-center">
          <div className="text-lg font-black text-zinc-600">VS</div>
          <div className="text-[10px] text-zinc-500">{engine.displayName}</div>
          <div className="text-[10px] text-zinc-600">turn {m.turns.length}</div>
          <button 
            className="mt-1.5 rounded bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 text-[11px] font-bold text-zinc-300 border border-zinc-700 shadow flex items-center gap-1.5 transition-all select-none shrink-0"
            onClick={() => setShowLogs(true)}
          >
            📜 Logs
          </button>
        </div>
        <CompetitorHeader player="B" label={m.playerLabels.B} model={m.playerModels.B} totals={m.totals.B} thinking={m.thinking.B} showCost={showCost} />
      </div>

      {over && (
        <div className={`rounded-xl border p-3 text-center flash-in ${m.aborted ? "border-zinc-700 bg-zinc-900" : "border-amber-500/50 bg-amber-950/30"}`}>
          {m.aborted ? (
            <div className="text-sm text-zinc-400">Match aborted — partial replay saved.</div>
          ) : m.result ? (
            <div>
              <div className="text-lg font-black text-amber-300">
                {m.result.winner === "draw" ? "🤝 DRAW" : `🏆 ${winnerLabel} WINS`}
              </div>
              <div className="text-xs text-zinc-400">
                {m.result.reason} · score A {m.result.score.A} — B {m.result.score.B}
              </div>
            </div>
          ) : null}
          <div className="mt-2 flex justify-center gap-2">
            {m.replay && (
              <>
                <button className="rounded-md border border-zinc-600 px-3 py-1 text-xs hover:bg-zinc-800" onClick={() => downloadReplay(m.replay!)}>
                  ⬇ Export replay
                </button>
                <button className="rounded-md border border-zinc-600 px-3 py-1 text-xs hover:bg-zinc-800" onClick={() => go("replay", m.replay!.matchId)}>
                  ▶ Watch replay
                </button>
              </>
            )}
            <button className="rounded-md border border-zinc-600 px-3 py-1 text-xs hover:bg-zinc-800" onClick={() => { m.reset(); go("setup"); }}>
              ✨ New match
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 overflow-auto p-1">
          {m.gameState ? (
            <div className="m-auto w-full">
              <Board state={m.gameState} />
            </div>
          ) : (
            <div className="m-auto text-zinc-600">initializing…</div>
          )}
        </div>
      </div>

      {!over && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
          {running && (
            <button className="rounded-md border border-zinc-600 px-4 py-1.5 text-sm hover:bg-zinc-800" onClick={m.pause}>
              ⏸ Pause
            </button>
          )}
          {paused && (
            <>
              <button className="rounded-md border border-zinc-600 px-4 py-1.5 text-sm hover:bg-zinc-800" onClick={m.resume}>
                ▶ Resume
              </button>
              <button className="rounded-md border border-zinc-600 px-4 py-1.5 text-sm hover:bg-zinc-800" onClick={m.step}>
                ⏭ Step one turn
              </button>
            </>
          )}
          <button className="rounded-md border border-red-900 px-4 py-1.5 text-sm text-red-400 hover:bg-red-950" onClick={m.abort}>
            ⏹ Abort (saves partial replay)
          </button>
          <span className="text-[10px] text-zinc-600">{m.status}</span>
        </div>
      )}

      {/* Decision Logs Modal */}
      {showLogs && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-6">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-900 bg-zinc-900/40">
              <h2 className="text-lg font-extrabold text-zinc-100 flex items-center gap-2">
                📜 Decision Log <span className="text-xs font-normal text-zinc-500">({m.turns.length} turns)</span>
              </h2>
              <button 
                className="rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800 font-bold"
                onClick={() => setShowLogs(false)}
              >
                ✕ Close
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 modal-logs-large">
              {m.turns.length === 0 ? (
                <div className="text-zinc-500 text-center py-20">No turns have been logged yet.</div>
              ) : (
                <TurnLog turns={m.turns} playerModels={m.playerModels} />
              )}
            </div>
          </div>
        </div>
      )}
      {/* Countdown Overlay */}
      {countdown !== null && (
        <div className="countdown-overlay">
          {countdown === "Readying..." ? (
            <div className="flex flex-col items-center gap-4 text-center animate-pulse">
              <span className="text-4xl text-amber-500 animate-spin">🛡️</span>
              <span className="text-xs font-black font-mono tracking-widest text-zinc-400 uppercase">
                Preparing Battleground...
              </span>
            </div>
          ) : (
            <span
              key={countdown}
              className={`countdown-text ${
                countdown === "Fight!"
                  ? "text-rose-500 text-[10rem] md:text-[13rem]"
                  : "text-amber-400 text-[12rem] md:text-[15rem]"
              }`}
            >
              {countdown}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
