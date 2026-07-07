import { useState } from "react";
import type { PlayerId } from "../../engine/GameEngine";
import type { DecisionRecord, TurnRecord } from "../../match/replay";

function DecisionEntry({
  turnIndex,
  d,
  modelName,
}: {
  turnIndex: number;
  d: DecisionRecord;
  modelName: string;
}) {
  const [open, setOpen] = useState(false);
  const accent =
    d.player === "A"
      ? "text-cyan-400 border-cyan-950 bg-cyan-950/25"
      : "text-fuchsia-400 border-fuchsia-950 bg-fuchsia-950/25";
  const lastAttempt = d.attempts[d.attempts.length - 1];
  const tokens = d.attempts.reduce((t, a) => t + a.tokensIn + a.tokensOut, 0);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 text-xs">
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-800/50" onClick={() => setOpen(!open)}>
        <span className="text-zinc-600">#{"00" + turnIndex}</span>
        <span className={`px-2 py-0.5 rounded border text-[9px] font-mono font-black uppercase tracking-wider shrink-0 ${accent}`}>
          {modelName}
        </span>
        <span className="min-w-0 flex-1 truncate text-zinc-300 font-medium">{d.summary}</span>
        {d.forfeitedDecision && <span className="rounded bg-red-900 px-1 text-[10px] text-red-300">FORFEIT</span>}
        {d.attempts.length > 1 && !d.forfeitedDecision && (
          <span className="rounded bg-amber-900 px-1 text-[10px] text-amber-300">{d.attempts.length} tries</span>
        )}
        <span className="shrink-0 text-zinc-600 font-mono">{tokens}t · {lastAttempt?.latencyMs ?? 0}ms</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800 p-2">
          {d.attempts.map((a, i) => (
            <div key={i} className="rounded bg-zinc-950 p-2">
              <div className="mb-1 flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>
                  attempt {i + 1} — {a.valid ? "✓ valid" : `✗ ${a.error}`}
                </span>
                <span>
                  {a.estimatedTokens ? "~" : ""}{a.tokensIn}/{a.tokensOut}t · {a.latencyMs}ms
                </span>
              </div>
              {a.parsed?.reasoning ? (
                <div className="mb-1 text-zinc-400 italic">💭 {String(a.parsed.reasoning)}</div>
              ) : null}
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-zinc-500 font-mono">
                {a.raw || "(no response)"}
              </pre>
            </div>
          ))}
          <div className="text-[10px] text-zinc-500 font-mono">
            accepted action: <code className="text-emerald-400">{JSON.stringify(d.acceptedAction)}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TurnLog({
  turns,
  playerModels,
}: {
  turns: TurnRecord[];
  playerModels?: Record<PlayerId, string>;
}) {
  return (
    <div className="flex flex-col-reverse gap-1 overflow-y-auto">
      {turns.map((t) =>
        (Object.keys(t.decisions) as PlayerId[]).map((p) => {
          const modelName = playerModels?.[p] || p;
          return (
            <DecisionEntry
              key={`${t.index}-${p}`}
              turnIndex={t.index}
              d={t.decisions[p]!}
              modelName={modelName}
            />
          );
        }),
      )}
    </div>
  );
}
