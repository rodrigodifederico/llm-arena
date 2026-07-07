// Replay player (§9): steps through stored stateAfter snapshots — no API calls.

import { useEffect, useRef, useState } from "react";
import type { PlayerId } from "../engine/GameEngine";
import { downloadReplay, type Replay } from "../match/replay";
import { useReplayStore } from "../store/replayStore";
import { useUiStore } from "../store/uiStore";
import { getBoard } from "./boards";
import { getProviderInfo } from "./hud/CompetitorHeader";
import TurnLog from "./hud/TurnLog";

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export default function ReplayScreen() {
  const replayId = useUiStore((s) => s.replayId);
  const go = useUiStore((s) => s.go);
  const load = useReplayStore((s) => s.load);

  const [replay, setReplay] = useState<Replay | null>(null);
  const [missing, setMissing] = useState(false);
  // cursor: -1 = initial state; i >= 0 = after turns[i]
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2);
  const timer = useRef<number | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    setReplay(null);
    setMissing(false);
    setCursor(-1);
    setPlaying(false);
    if (!replayId) return;
    void load(replayId).then((r) => {
      if (r) setReplay(r);
      else setMissing(true);
    });
  }, [replayId, load]);

  useEffect(() => {
    if (!playing || !replay) return;
    const interval = 1200 / SPEEDS[speedIdx];
    timer.current = window.setInterval(() => {
      setCursor((c) => {
        if (c >= replay.turns.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, interval);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, speedIdx, replay]);

  if (missing) {
    return (
      <div className="p-10 text-center text-zinc-500">
        Replay not found. <button className="text-cyan-400 underline" onClick={() => go("replays")}>Back to replays</button>
      </div>
    );
  }
  if (!replay) return <div className="p-10 text-center text-zinc-600">loading replay…</div>;

  const Board = getBoard(replay.game);
  const state = cursor < 0 ? replay.initialState : replay.turns[cursor].stateAfter;
  const provA = getProviderInfo(replay.players.A.model, replay.players.A.label);
  const provB = getProviderInfo(replay.players.B.model, replay.players.B.label);
  const currentTurn = cursor >= 0 ? replay.turns[cursor] : null;
  const btn = "rounded-md border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-30";

  return (
    <div className="w-full flex h-screen max-w-none flex-col gap-3 p-4 px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold flex items-center gap-1.5">
            📼 
            <span className="inline-block">{provA.logo}</span>
            <span className="text-cyan-400 font-extrabold">{replay.players.A.model || replay.players.A.label}</span>
            <span className="text-zinc-600 font-normal"> vs </span>
            <span className="inline-block">{provB.logo}</span>
            <span className="text-fuchsia-400 font-extrabold">{replay.players.B.model || replay.players.B.label}</span>
            <span className="ml-2 text-xs text-zinc-500 font-normal">
              {replay.game} · seed {replay.seed} · temp {replay.settings.temperature}
            </span>
          </h1>
          <div className="text-[11px] text-zinc-600">
            {replay.aborted
              ? "⏹ aborted match (partial)"
              : replay.result
                ? `${replay.result.winner === "draw" ? "🤝 draw" : `🏆 ${replay.result.winner} won`} — ${replay.result.reason} · A ${replay.result.score.A} / B ${replay.result.score.B}`
                : ""}
            {" · totals: A "}
            {replay.totals.A.tokensIn + replay.totals.A.tokensOut} tok / {replay.totals.A.avgLatencyMs}ms avg, B{" "}
            {replay.totals.B.tokensIn + replay.totals.B.tokensOut} tok / {replay.totals.B.avgLatencyMs}ms avg
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            className="rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 font-bold flex items-center gap-1.5 shadow"
            onClick={() => setShowLogs(true)}
          >
            📜 Logs
          </button>
          <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800" onClick={() => downloadReplay(replay)}>
            ⬇ Export
          </button>
          <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800" onClick={() => go("replays")}>
            ← Replays
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 overflow-auto p-1">
          <div className="m-auto w-full">
            <Board state={state} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
        <button className={btn} onClick={() => { setPlaying(false); setCursor(-1); }} disabled={cursor < 0}>⏮</button>
        <button className={btn} onClick={() => { setPlaying(false); setCursor((c) => Math.max(-1, c - 1)); }} disabled={cursor < 0}>◀</button>
        <button className={btn} onClick={() => setPlaying(!playing)}>{playing ? "▮▮" : "▶"}</button>
        <button className={btn} onClick={() => { setPlaying(false); setCursor((c) => Math.min(replay.turns.length - 1, c + 1)); }} disabled={cursor >= replay.turns.length - 1}>▶▶</button>
        <input
          className="min-w-0 flex-1"
          type="range"
          min={-1}
          max={replay.turns.length - 1}
          value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
        />
        <span className="w-20 text-right text-xs text-zinc-500">
          {cursor + 1} / {replay.turns.length}
        </span>
        <button className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
          {SPEEDS[speedIdx]}×
        </button>
      </div>

      {/* Decision Logs Modal */}
      {showLogs && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-6">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-900 bg-zinc-900/40">
              <h2 className="text-lg font-extrabold text-zinc-100 flex items-center gap-2">
                📜 Replay Decision Log <span className="text-xs font-normal text-zinc-500">({cursor + 1} / {replay.turns.length} turns)</span>
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
              {cursor < 0 ? (
                <div className="text-zinc-500 text-center py-20 font-medium">Board as generated by init(seed). Press play or scrub the timeline to show turns.</div>
              ) : (
                <TurnLog 
                  turns={replay.turns.slice(0, cursor + 1)} 
                  playerModels={{
                    A: replay.players.A.model || replay.players.A.label,
                    B: replay.players.B.model || replay.players.B.label,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
