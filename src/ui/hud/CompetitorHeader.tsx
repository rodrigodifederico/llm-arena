import type { PlayerId } from "../../engine/GameEngine";
import type { PlayerTotals } from "../../match/replay";

interface LLMProviderInfo {
  company: string;
  logo: string;
  logoColor: string;
}

export function getProviderInfo(model: string, label: string): LLMProviderInfo {
  const m = (model || "").toLowerCase();
  const l = (label || "").toLowerCase();
  
  if (m.includes("gemini") || l.includes("gemini") || m.includes("google") || l.includes("google")) {
    return {
      company: "Google Gemini",
      logo: "✦",
      logoColor: "text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]",
    };
  }
  if (m.includes("gpt") || m.includes("o1") || m.startsWith("o3") || l.includes("openai") || m.includes("openai")) {
    return {
      company: "OpenAI",
      logo: "🌀",
      logoColor: "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]",
    };
  }
  if (m.includes("claude") || m.includes("anthropic") || l.includes("anthropic")) {
    return {
      company: "Anthropic",
      logo: "🏺",
      logoColor: "text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]",
    };
  }
  if (m.includes("deepseek") || l.includes("deepseek")) {
    return {
      company: "DeepSeek",
      logo: "🐳",
      logoColor: "text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]",
    };
  }
  if (m.includes("llama") || m.includes("meta") || l.includes("meta") || l.includes("llama")) {
    return {
      company: "Meta LLaMA",
      logo: "🦙",
      logoColor: "text-indigo-400 drop-shadow-[0_0_8px_rgba(129,140,248,0.6)]",
    };
  }
  if (m.includes("ollama") || m.includes("local") || l.includes("local")) {
    return {
      company: "Ollama / Local",
      logo: "🐙",
      logoColor: "text-zinc-400 drop-shadow-[0_0_8px_rgba(161,161,170,0.6)]",
    };
  }
  
  return {
    company: label || "Unknown LLM",
    logo: "🤖",
    logoColor: "text-zinc-500",
  };
}

export default function CompetitorHeader({
  player,
  label,
  model,
  totals,
  thinking,
  showCost,
}: {
  player: PlayerId;
  label: string;
  model: string;
  totals: PlayerTotals;
  thinking: boolean;
  showCost: boolean;
}) {
  const accent = player === "A" ? "border-cyan-500/30" : "border-fuchsia-500/30";
  const sideColor = player === "A" ? "text-cyan-400" : "text-fuchsia-400";
  const est = totals.anyEstimated ? "~" : "";

  const provider = getProviderInfo(model, label);

  return (
    <div className={`flex-1 rounded-xl border bg-zinc-900/60 p-3 flex flex-col justify-between transition-all duration-300 ${accent} ${
      thinking ? "ring-1 ring-amber-500/50 bg-zinc-900/80" : ""
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Company/LLM Logo Icon */}
          <div className={`w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-xl font-bold flex-shrink-0 ${provider.logoColor}`}>
            {provider.logo}
          </div>
          
          <div className="min-w-0 leading-tight">
            <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{provider.company}</div>
            <div className={`truncate text-sm font-black tracking-wide ${sideColor}`}>{model || label}</div>
          </div>
        </div>

        {thinking && (
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-amber-400 font-mono font-bold animate-pulse">
            <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-amber-400" />
            THINKING...
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
        <div>
          <div className="font-mono text-zinc-200">{est}{totals.tokensIn.toLocaleString()}</div>
          <div className="text-zinc-600">tok in</div>
        </div>
        <div>
          <div className="font-mono text-zinc-200">{est}{totals.tokensOut.toLocaleString()}</div>
          <div className="text-zinc-600">tok out</div>
        </div>
        <div>
          <div className="font-mono text-zinc-200">{totals.avgLatencyMs.toLocaleString()}ms</div>
          <div className="text-zinc-600">avg lat</div>
        </div>
        {showCost ? (
          <div>
            <div className="font-mono text-zinc-200">${totals.cost.toFixed(4)}</div>
            <div className="text-zinc-600">cost</div>
          </div>
        ) : (
          <div>
            <div className="font-mono text-zinc-200">{totals.decisions}</div>
            <div className="text-zinc-600">moves</div>
          </div>
        )}
      </div>
      {totals.forfeits > 0 && (
        <div className="mt-1 text-center text-[10px] text-red-400">⚠ {totals.forfeits} defaulted decision(s)</div>
      )}
      {totals.anyEstimated && (
        <div className="mt-1 text-center text-[10px] text-zinc-600">~ token counts estimated (provider sent no usage)</div>
      )}
    </div>
  );
}
