import { useState, useRef } from "react";
import { ENGINES } from "../engine";
import type { PlayerId } from "../engine/GameEngine";
import { fetchModels, testConnection } from "../llm/LLMClient";
import { playerReady, toEndpointConfig, useConfigStore } from "../store/configStore";
import { useMatchStore } from "../store/matchStore";
import { useUiStore } from "../store/uiStore";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-zinc-600">{hint}</span>}
    </label>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500";

const API_PRESETS = [
  { name: "OpenAI", url: "https://api.openai.com/v1" },
  { name: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { name: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "Groq", url: "https://api.groq.com/openai/v1" },
  { name: "Mistral", url: "https://api.mistral.ai/v1" },
  { name: "Together", url: "https://api.together.xyz/v1" },
  { name: "Ollama", url: "http://localhost:11434/v1" },
  { name: "LM Studio", url: "http://localhost:1234/v1" },
];

const GAME_DETAILS = [
  {
    id: "arena_clash",
    name: "Arena Clash",
    image: "/screenshot/arena-clash.png",
    tagline: "3v3 tactical RPG and combat simulation",
    description: "Assemble a squad of 3 heroes drafted from 10 distinct archetypes (Soldier, Priest, Mage, Rogue, etc.). Engage in a turn-based battle where character speed determines turn order. Manage physical/magical attacks, custom spells, cooldowns, mana, and visual status effects. Features floating combat text, animations, and sound effects.",
    competencies: "Combat tactics, target priority, mana management, status interaction."
  },
  {
    id: "hex_dominion",
    name: "Hex Dominion",
    image: "/screenshot/hex-dominium.png",
    tagline: "7x7 Hexagonal grid conquest and resource war",
    description: "Command forces on a 7x7 hex battlefield with symmetric energy mines. Earn energy every turn based on controlled territory and mines. Spend energy to spawn new units, move, or attack. Defend your Headquarters (30 HP) and conquer the hex grid before the 30-turn limit is reached.",
    competencies: "Spatial planning, pathfinding, economic budgeting, long-horizon positioning."
  },
  {
    id: "salvo",
    name: "Salvo",
    image: "/screenshot/salvo.png",
    tagline: "Asymmetric information hidden-grid battleship duel",
    description: "Secretly position a fleet of 5 ships of varying lengths on an 8x8 grid. Take turns launching salvos at the enemy. Since boards are hidden, you must deduce the enemy's ship locations using asymmetric feedback (hits, misses, or ship sinkings) and a systematic search algorithm.",
    competencies: "Probabilistic inference, memory retention, deduction under uncertainty."
  },
  {
    id: "standoff",
    name: "Standoff",
    image: "/screenshot/standoff.png",
    tagline: "Simultaneous-reveal game theory gunfight",
    description: "Start with 3 lives and an empty gun. Every round, both players submit actions simultaneously. Choose to Reload, Shield, Shoot (costs 1 bullet), or cast an unblockable Mega shot (costs 2 bullets). Outsmart the opponent's strategy, bluff, and manage your resources in real-time.",
    competencies: "Opponent modeling, game-theory Nash equilibrium, bluffing, risk mitigation."
  }
];

function PlayerCard({ player }: { player: PlayerId }) {
  const setup = useConfigStore((s) => s.players[player]);
  const setPlayer = useConfigStore((s) => s.setPlayer);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);

  const accent = player === "A" ? "border-cyan-500/40" : "border-fuchsia-500/40";
  const title = player === "A" ? "text-cyan-400" : "text-fuchsia-400";
  const set = (patch: Partial<typeof setup>) => setPlayer(player, patch);

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await testConnection(toEndpointConfig(setup));
    setTestResult(r.ok ? `✓ OK — ${r.latencyMs}ms` : `✗ ${r.error}`);
    setTesting(false);
  };

  const doFetchModels = async () => {
    try {
      const list = await fetchModels(toEndpointConfig(setup));
      setModels(list);
      setTestResult(`✓ ${list.length} models found`);
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className={`flex-1 space-y-3 rounded-xl border bg-zinc-900/60 p-4 ${accent}`}>
      <h2 className={`text-sm font-bold ${title}`}>Player {player}</h2>
      <Field label="Label (display name)">
        <input className={inputCls} value={setup.label} onChange={(e) => set({ label: e.target.value })} placeholder={`e.g. "DeepSeek V4 Flash"`} />
      </Field>
      <Field label="Base URL" hint="OpenAI-compatible endpoints. Click a preset below to auto-fill:">
        <input className={inputCls} value={setup.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…/v1" />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {API_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
              onClick={() => {
                set({
                  baseUrl: preset.url,
                  label: !setup.label || setup.label.startsWith("Player") ? `${preset.name} Fighter` : setup.label
                });
                setTimeout(() => {
                  if (apiKeyInputRef.current) {
                    apiKeyInputRef.current.focus();
                    apiKeyInputRef.current.select();
                  }
                }, 50);
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="API Key" hint="Kept in memory only; sent only to this endpoint (or your local proxy). Never exported.">
        <div className="mt-1 flex gap-1">
          <input
            ref={apiKeyInputRef}
            className={inputCls + " mt-0 flex-1"}
            type={showKey ? "text" : "password"}
            value={setup.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder="sk-…"
            autoComplete="off"
          />
          <button className="rounded-md border border-zinc-700 px-2 text-xs text-zinc-400 hover:bg-zinc-800" onClick={() => setShowKey(!showKey)}>
            {showKey ? "🙈" : "👁"}
          </button>
        </div>
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <input type="checkbox" checked={setup.rememberKey} onChange={(e) => set({ rememberKey: e.target.checked })} />
          Remember on this device (localStorage)
        </label>
      </Field>
      <Field label="Model">
        <div className="mt-1 flex gap-1">
          <input className={inputCls + " mt-0 flex-1"} value={setup.model} onChange={(e) => set({ model: e.target.value })} placeholder="model id" list={`models-${player}`} />
          <button className="whitespace-nowrap rounded-md border border-zinc-700 px-2 text-xs text-zinc-400 hover:bg-zinc-800" onClick={doFetchModels}>
            Fetch models
          </button>
        </div>
        <datalist id={`models-${player}`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <label className="flex items-center gap-1.5 text-xs text-zinc-400">
        <input type="checkbox" checked={setup.useProxy} onChange={(e) => set({ useProxy: e.target.checked })} />
        Route through local proxy
        <span className="text-[10px] text-zinc-600">(npm run proxy — for endpoints that block browser CORS)</span>
      </label>
      <div className="flex gap-2">
        <Field label="Cost in (USD/1M tok)">
          <input className={inputCls} type="number" min={0} step={0.01} value={setup.costInPerM} onChange={(e) => set({ costInPerM: Number(e.target.value) })} />
        </Field>
        <Field label="Cost out (USD/1M tok)">
          <input className={inputCls} type="number" min={0} step={0.01} value={setup.costOutPerM} onChange={(e) => set({ costOutPerM: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Max output tokens" hint="Reasoning models need headroom (4096+) or they truncate before the JSON action.">
        <input className={inputCls} type="number" min={256} max={32000} step={256} value={setup.maxTokens ?? 4096} onChange={(e) => set({ maxTokens: Number(e.target.value) })} />
      </Field>
      <div className="flex items-center gap-2">
        <button
          className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          disabled={!playerReady(setup) || testing}
          onClick={doTest}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {testResult && (
          <span className={`min-w-0 flex-1 truncate text-[11px] ${testResult.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`} title={testResult}>
            {testResult}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SetupScreen() {
  const cfg = useConfigStore();
  const start = useMatchStore((s) => s.start);
  const go = useUiStore((s) => s.go);

  const activeIndex = GAME_DETAILS.findIndex((g) => g.id === cfg.gameId);
  const currentIdx = activeIndex === -1 ? 0 : activeIndex;

  const setIndex = (idx: number) => {
    const nextIdx = (idx + GAME_DETAILS.length) % GAME_DETAILS.length;
    cfg.setGlobal({ gameId: GAME_DETAILS[nextIdx].id });
  };

  const ready = playerReady(cfg.players.A) && playerReady(cfg.players.B) && cfg.seed.trim() !== "";

  const startMatch = () => {
    const activeSeed = cfg.seed;
    cfg.randomizeSeed(); // Randomize seed for the next run
    start({
      engineId: cfg.gameId,
      players: { A: toEndpointConfig(cfg.players.A), B: toEndpointConfig(cfg.players.B) },
      settings: {
        temperature: cfg.temperature,
        allowThinking: cfg.allowThinking,
        maxRetries: cfg.maxRetries,
        decisionTimeoutMs: cfg.decisionTimeoutSec * 1000,
        forfeitLimit: 3,
      },
      seed: activeSeed,
    });
    go("arena");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            <span className="text-cyan-400">LLM</span> <span className="text-fuchsia-400">ARENA</span>
          </h1>
          <p className="text-xs text-zinc-500">Two models. Four games. Every decision logged.</p>
        </div>
        <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={() => go("replays")}>
          📼 Replays
        </button>
      </header>

      <div className="flex flex-col gap-4 md:flex-row">
        <PlayerCard player="A" />
        <div className="flex items-center justify-center">
          <button
            className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
            title="Copy A's configuration to B (baseline/control runs)"
            onClick={cfg.copyAToB}
          >
            Same model both sides →
          </button>
        </div>
        <PlayerCard player="B" />
      </div>

      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-bold text-zinc-300 font-mono tracking-wider uppercase">Select Battleground</h2>
        
        {/* Large Game Slider */}
        <div className="relative flex flex-col overflow-hidden rounded-2xl border border-zinc-850 bg-zinc-950/70 shadow-2xl md:flex-row min-h-[340px]">
          {/* Previous Button */}
          <button
            type="button"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-955/90 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-amber-400 active:scale-90 shadow-xl hover:border-amber-500/35 cursor-pointer"
            onClick={() => setIndex(currentIdx - 1)}
            title="Previous Game"
          >
            ◀
          </button>
          
          {/* Next Button */}
          <button
            type="button"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-955/90 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-amber-400 active:scale-90 shadow-xl hover:border-amber-500/35 cursor-pointer"
            onClick={() => setIndex(currentIdx + 1)}
            title="Next Game"
          >
            ▶
          </button>

          {/* Game Image Panel */}
          <div className="relative h-[220px] w-full overflow-hidden bg-zinc-900 md:h-auto md:w-[48%] flex items-center justify-center border-b border-zinc-800 md:border-b-0 md:border-r border-zinc-850">
            <img
              src={GAME_DETAILS[currentIdx].image}
              alt={GAME_DETAILS[currentIdx].name}
              className="h-full w-full object-cover transition-all duration-700 hover:scale-[1.03] select-none"
            />
            {/* Active Indicator Overlay */}
            <div className="absolute top-4 left-4 rounded-full bg-amber-500/90 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-950 shadow-lg border border-amber-400/20">
              Selected
            </div>
          </div>

          {/* Game Info Panel */}
          <div className="flex flex-1 flex-col justify-between p-6 md:p-8">
            <div className="space-y-3">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 font-mono">
                System Objective
              </div>
              <h3 className="text-2xl font-black tracking-tight text-zinc-100 uppercase">
                {GAME_DETAILS[currentIdx].name}
              </h3>
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-500/90 font-mono">
                {GAME_DETAILS[currentIdx].tagline}
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed pt-1">
                {GAME_DETAILS[currentIdx].description}
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="border-t border-zinc-900 pt-3">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider font-mono block mb-1">
                  Evaluated Competencies
                </span>
                <span className="text-xs font-semibold text-emerald-400 font-sans">
                  {GAME_DETAILS[currentIdx].competencies}
                </span>
              </div>

              {/* Slider Dots */}
              <div className="flex items-center justify-center gap-2 pt-2 border-t border-zinc-900/60">
                {GAME_DETAILS.map((game, idx) => (
                  <button
                    key={game.id}
                    type="button"
                    className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                      idx === currentIdx ? "w-6 bg-amber-500" : "w-2 bg-zinc-700 hover:bg-zinc-600"
                    }`}
                    onClick={() => setIndex(idx)}
                    title={`Switch to ${game.name}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Seed" hint="same seed = same board/characters">
            <div className="mt-1 flex gap-1">
              <input className={inputCls + " mt-0 flex-1"} value={cfg.seed} onChange={(e) => cfg.setGlobal({ seed: e.target.value })} />
              <button className="rounded-md border border-zinc-700 px-2 hover:bg-zinc-800" title="Randomize" onClick={cfg.randomizeSeed}>
                🎲
              </button>
            </div>
          </Field>
          <Field label={`Temperature: ${cfg.temperature}`} hint="0 = max reproducibility">
            <input className="mt-2 w-full" type="range" min={0} max={1.5} step={0.1} value={cfg.temperature} onChange={(e) => cfg.setGlobal({ temperature: Number(e.target.value) })} />
          </Field>
          <Field label="Max retries">
            <input className={inputCls} type="number" min={0} max={5} value={cfg.maxRetries} onChange={(e) => cfg.setGlobal({ maxRetries: Number(e.target.value) })} />
          </Field>
          <Field label="Decision timeout (s)">
            <input className={inputCls} type="number" min={5} max={300} value={cfg.decisionTimeoutSec} onChange={(e) => cfg.setGlobal({ decisionTimeoutSec: Number(e.target.value) })} />
          </Field>
          <label className="flex items-start gap-1.5 pt-4 text-xs text-zinc-400">
            <input type="checkbox" checked={cfg.allowThinking} onChange={(e) => cfg.setGlobal({ allowThinking: e.target.checked })} />
            <span>
              Allow thinking
              <span className="block text-[10px] text-zinc-600">reasoning included in output — inflates measured output tokens</span>
            </span>
          </label>
        </div>
      </div>

      <button
        className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-fuchsia-600 py-3 text-lg font-black tracking-widest text-white shadow-lg transition hover:brightness-110 disabled:opacity-30 disabled:hover:brightness-100"
        disabled={!ready}
        onClick={startMatch}
      >
        ⚔️ START MATCH
      </button>
      {!ready && (
        <p className="text-center text-[11px] text-zinc-600">
          Fill Base URL (http/https), API key and model for both players to enable.
        </p>
      )}
    </div>
  );
}
