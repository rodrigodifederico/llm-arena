import { useRef } from "react";
import { downloadReplay } from "../match/replay";
import { useReplayStore } from "../store/replayStore";
import { useUiStore } from "../store/uiStore";

export default function ReplaysScreen() {
  const { index, load, remove, importJson } = useReplayStore();
  const go = useUiStore((s) => s.go);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async (matchId: string) => {
    const r = await load(matchId);
    if (r) downloadReplay(r);
  };

  const doImport = async (file: File) => {
    try {
      const replay = await importJson(await file.text());
      go("replay", replay.matchId);
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-black">📼 Replays</h1>
        <div className="flex gap-2">
          <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800" onClick={() => fileRef.current?.click()}>
            ⬆ Import .json
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = "";
            }}
          />
          <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800" onClick={() => go("setup")}>
            ← Setup
          </button>
        </div>
      </header>
      {index.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-600">No saved matches yet. Finish (or abort) a match and it will appear here.</p>
      ) : (
        <div className="space-y-2">
          {index.map((meta) => (
            <div key={meta.matchId} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="text-cyan-400">{meta.labelA}</span>
                  <span className="text-zinc-600"> vs </span>
                  <span className="text-fuchsia-400">{meta.labelB}</span>
                  <span className="ml-2 text-xs text-zinc-500">{meta.game}</span>
                </div>
                <div className="text-[11px] text-zinc-600">
                  {new Date(meta.createdAt).toLocaleString()} · {meta.turnCount} turns ·{" "}
                  {meta.winner === "aborted" ? "⏹ aborted" : meta.winner === "draw" ? "🤝 draw" : `🏆 ${meta.winner} won`}
                </div>
              </div>
              <button className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800" onClick={() => go("replay", meta.matchId)}>
                ▶ Watch
              </button>
              <button className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800" onClick={() => void doExport(meta.matchId)}>
                ⬇ Export
              </button>
              <button className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950" onClick={() => void remove(meta.matchId)}>
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
