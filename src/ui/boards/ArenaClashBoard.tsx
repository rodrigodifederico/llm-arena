import { useState, useEffect, useRef } from "react";
import type { GameState } from "../../engine/GameEngine";
import { ARCHETYPES, type ArenaState, type ArenaUnit } from "../../engine/arenaClash";
import { playSound } from "../../utils/audio";
import { useSpritePoses, type SpritePose } from "./useSpritePoses";

// Effect-sprite assets (public/sprites/fx/*.svg)
const FX = {
  slash: "/sprites/fx/slash.svg",
  impact: "/sprites/fx/impact.svg",
  heal: "/sprites/fx/heal.svg",
  cast: "/sprites/fx/cast-circle.svg",
  shield: "/sprites/fx/shield.svg",
  poison: "/sprites/fx/poison.svg",
  skull: "/sprites/fx/skull.svg",
  arrow: "/sprites/fx/arrow.svg",
} as const;

export interface FloatNum {
  unit: string;
  text: string;
  cls: string;
  delay: number;
}

export interface FxIcon {
  unit: string;
  src: string;
  cls: string;
  delay: number;
}

// What the board's animation controller exposes to each tile for one event.
interface AnimView {
  seq: number;
  actorId: string;
  actorPose: SpritePose | null;
  moveClass: string;
  targetPoses: Record<string, SpritePose>;
  fxIcons: FxIcon[];
  floats: FloatNum[];
  dying: string[];
}

const STATUS_ICON: Record<string, string> = {
  atkDown: "⬇️",
  defendUp: "🛡️",
  taunt: "📢",
  counter: "↩️",
  poison: "☠️",
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 w-full rounded bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function getUnitCoords(id: string): { x: number; y: number } {
  // A1 -> x=0, y=0; A2 -> x=0, y=1; A3 -> x=0, y=2
  // B1 -> x=2, y=0; B2 -> x=2, y=1; B3 -> x=2, y=2
  const match = /([AB])([1-3])/.exec(id);
  if (!match) return { x: 1, y: 1 };
  const side = match[1];
  const idx = parseInt(match[2], 10) - 1;
  return {
    x: side === "A" ? 0 : 2,
    y: idx,
  };
}

// Client-side Chromakey transparency filter for solid white backgrounds
function useChromakeySprite(src: string, keyColorHex: string = "#ffffff", tolerance: number = 45) {
  const [processedSrc, setProcessedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setProcessedSrc(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setProcessedSrc(src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Parse key color
      const keyR = parseInt(keyColorHex.slice(1, 3), 16);
      const keyG = parseInt(keyColorHex.slice(3, 5), 16);
      const keyB = parseInt(keyColorHex.slice(5, 7), 16);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Calculate Euclidean distance in RGB space
        const distance = Math.sqrt(
          Math.pow(r - keyR, 2) +
          Math.pow(g - keyG, 2) +
          Math.pow(b - keyB, 2)
        );

        if (distance < tolerance) {
          data[i + 3] = 0; // Set alpha to 0
        }
      }

      ctx.putImageData(imgData, 0, 0);
      setProcessedSrc(canvas.toDataURL());
    };
    img.onerror = () => {
      setProcessedSrc(src);
    };
    img.src = src;
  }, [src, keyColorHex, tolerance]);

  return processedSrc;
}

function getBubbleText(actionText: string | null): string {
  if (!actionText) return "";
  
  let text = actionText;
  
  // Strip starting actor ID and class name (e.g. "B2 Berserker used " or "B2 Berserker -> ")
  text = text.replace(/^[AB][1-3]\s+\w+\s*(?:->|used|cast)?\s*/i, "");
  
  // Shorten other unit references like "A1 Paladin" to just "A1"
  text = text.replace(/\b(A[1-3]|B[1-3])\s+\w+\b/g, "$1");
  
  // Clean up action phrasing to be concise
  text = text.replace(/\bdealt magic damage to\b/gi, "->");
  text = text.replace(/\bfor\s+(\d+)\s+damage\b/gi, "($1 dmg)");
  text = text.replace(/\bfor\s+(\d+)\s+HP\b/gi, "(+$1 HP)");
  text = text.replace(/\bhealed\b/gi, "healed");
  
  text = text.trim();
  if (text.length > 40) {
    text = text.slice(0, 37) + "...";
  }
  return text;
}

function UnitToken({
  unit,
  active,
  pose,
  moveClass,
  dying,
  animSeq,
  bubbleText,
  floats,
  fxIcons,
}: {
  unit: ArenaUnit;
  active: boolean;
  pose: SpritePose | null;
  moveClass: string;
  dying: boolean;
  animSeq: number;
  bubbleText: string | null;
  floats: FloatNum[];
  fxIcons: FxIcon[];
}) {
  const dead = unit.hp <= 0;
  const isPoisoned = unit.statuses.some((st) => st.kind === "poison");

  const archetype = unit.archetype.toLowerCase();
  // While the death animation plays, keep the character art in its "fall"
  // pose; only after it ends does the ghost sprite take over.
  const showGhost = dead && !dying;
  const rawSpriteSrc = showGhost ? `/sprites/ghost.png` : `/sprites/${archetype}.png`;

  // Baked action-pose frames (chromakeyed + transformed + tinted)
  const poses = useSpritePoses(rawSpriteSrc);
  const activePose: SpritePose = dying ? "fall" : showGhost ? "idle" : (pose ?? "idle");
  const transparentSrc = poses ? poses[activePose] : null;
  const maskSrc = poses ? poses.idle : null;

  const sideColor = unit.side === "A" ? "text-cyan-400" : "text-fuchsia-400";
  const borderHighlight = active
    ? (unit.side === "A" ? "filter drop-shadow(0 0 10px rgba(6,182,212,0.9))" : "filter drop-shadow(0 0 10px rgba(217,70,239,0.9))")
    : "filter drop-shadow(0 4px 6px rgba(0,0,0,0.5))";

  // Combine animation classes
  let classes = "isometric-billboard select-none transition-all duration-300 ";
  if (showGhost) {
    classes += "anim-dead";
  } else if (dying) {
    classes += "anim-dying";
  } else if (moveClass) {
    classes += moveClass;
  } else if (isPoisoned) {
    classes += "anim-poison";
  } else {
    classes += "anim-idle";
  }

  const hpPct = Math.max(0, Math.min(100, (unit.hp / unit.maxHp) * 100));

  return (
    <div className={classes}>
      {/* 3D Floor Shadow */}
      {!dead && <div className="character-floor-shadow" />}

      {/* Decision Speech Bubble */}
      <div className={`speech-bubble ${bubbleText ? "bubble-visible" : ""}`}>
        {bubbleText}
      </div>

      {/* Floating HUD Indicator above character head */}
      <div className="w-full flex flex-col items-center mb-1.5 z-10 select-none pointer-events-none">
        {active && (
          <div className="text-[14px] text-amber-400 animate-bounce leading-none mb-0.5">▼</div>
        )}
        
        {!dead && (
          <div className="w-16 bg-zinc-950 border border-zinc-800 rounded-[2px] p-[1px] flex flex-col gap-[1px]">
            <div className="h-1 w-full bg-zinc-900 rounded-[1px] overflow-hidden">
              <div 
                className="h-full bg-emerald-500 rounded-[1px] transition-all duration-300"
                style={{ width: `${hpPct}%` }}
              />
            </div>
            {unit.maxMana > 0 && (
              <div className="h-[2px] w-full bg-zinc-900 rounded-[1px] overflow-hidden">
                <div 
                  className="h-full bg-sky-500 rounded-[1px] transition-all duration-300"
                  style={{ width: `${(unit.mana / unit.maxMana) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        <span className={`text-[10px] font-black font-mono px-1.5 py-0.3 rounded bg-zinc-950/80 border border-zinc-900 mt-0.5 ${sideColor}`}>
          {unit.id}
        </span>
      </div>

      {/* The Character Sprite (Borderless standing model, action-pose frame) */}
      <div className={`character-sprite-container transition-all duration-300 ${borderHighlight}`}>
        {transparentSrc ? (
          <img
            src={transparentSrc}
            alt={unit.name}
            className={`max-h-full max-w-full object-contain pixelated transition-all duration-150 ${
              showGhost ? "opacity-35 grayscale" : ""
            }`}
          />
        ) : (
          <span className="text-4xl filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] select-none">
            {dead ? "💀" : unit.emoji}
          </span>
        )}

        {/* Poison Overlay conforming to the transparent sprite boundary */}
        {isPoisoned && !dead && maskSrc && (
          <div
            className="absolute inset-0 bg-green-500/20 mix-blend-color animate-pulse pointer-events-none rounded-lg"
            style={{
              maskImage: `url(${maskSrc})`,
              WebkitMaskImage: `url(${maskSrc})`,
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
              maskPosition: 'center',
              WebkitMaskPosition: 'center'
            }}
          />
        )}

        {/* Effect sprites (slash / impact / heal / poison / skull / cast circle …) */}
        {fxIcons.map((f, i) => (
          <img
            key={`fx-${animSeq}-${i}`}
            src={f.src}
            alt=""
            className={`fx-overlay ${f.cls}`}
            style={{ animationDelay: `${f.delay}ms` }}
          />
        ))}
      </div>

      {/* Floating combat numbers */}
      {floats.map((f, i) => (
        <div
          key={`fl-${animSeq}-${i}`}
          className={`float-num ${f.cls}`}
          style={{ animationDelay: `${f.delay}ms`, left: `calc(50% + ${((i % 3) - 1) * 26}px)` }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}

function DetailedUnitCard({ unit, active }: { unit: ArenaUnit; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const dead = unit.hp <= 0;
  const accent = unit.side === "A" ? "border-cyan-500/40 bg-cyan-950/5" : "border-fuchsia-500/40 bg-fuchsia-950/5";
  const glow = active ? "ring-1 ring-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)] bg-zinc-900" : "";
  const sideColor = unit.side === "A" ? "text-cyan-400" : "text-fuchsia-400";

  // Find archetype definition for stats and special skill
  const archDef = ARCHETYPES.find((a) => a.key === unit.archetype.toLowerCase());

  // Load avatar sprite with chromakey transparency
  const archetype = unit.archetype.toLowerCase();
  const rawSpriteSrc = dead ? `/sprites/ghost.png` : `/sprites/${archetype}.png`;
  const transparentSrc = useChromakeySprite(rawSpriteSrc, "#ffffff", 45);
  
  return (
    <div
      className={`w-full rounded-xl border bg-zinc-900/60 p-2.5 flex flex-col gap-1.5 transition-all duration-300 ${accent} ${glow} ${
        dead ? "opacity-30 grayscale" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Avatar Circle */}
        <div className="w-10 h-10 rounded-full bg-zinc-950/90 border border-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0 relative">
          {transparentSrc ? (
            <img 
              src={transparentSrc} 
              alt={unit.name} 
              className="w-8 h-8 object-contain pixelated" 
            />
          ) : (
            <span className="text-xl">{dead ? "💀" : unit.emoji}</span>
          )}
        </div>

        {/* Name and ID */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold truncate block">
              <span className={sideColor}>{unit.id}</span> {unit.name}
            </span>
          </div>
          <span className="text-[9px] text-zinc-500 capitalize block leading-none mt-0.5">{unit.archetype}</span>
        </div>
      </div>
      
      <div className="space-y-1">
        <div>
          <div className="flex justify-between text-[9px] text-zinc-400 mb-0.5">
            <span>HP</span>
            <span>{Math.max(0, unit.hp)}/{unit.maxHp}</span>
          </div>
          <Bar value={Math.max(0, unit.hp)} max={unit.maxHp} color="bg-emerald-500" />
        </div>
        <div>
          <div className="flex justify-between text-[9px] text-zinc-400 mb-0.5">
            <span>MP</span>
            <span>{unit.mana}/{unit.maxMana}</span>
          </div>
          <Bar value={unit.mana} max={unit.maxMana} color="bg-sky-500" />
        </div>
      </div>

      {/* Statuses list */}
      <div className="flex flex-wrap gap-1 min-h-[14px]">
        {unit.statuses.map((st, i) => (
          <span
            key={i}
            className="text-[10px] bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 flex items-center gap-0.5 font-mono text-zinc-300"
            title={`${st.kind} (${st.roundsLeft} rounds remaining)`}
          >
            <span>{STATUS_ICON[st.kind] ?? "•"}</span>
            <span className="text-[8px] text-zinc-500">{st.roundsLeft}</span>
          </span>
        ))}
      </div>

      {/* Expand/Collapse Toggle Button */}
      <button 
        onClick={() => setExpanded(!expanded)} 
        className="w-full text-center text-[9px] font-bold text-zinc-500 hover:text-zinc-300 py-1 bg-zinc-950/40 hover:bg-zinc-950/70 border border-zinc-800/60 rounded transition-all duration-200 mt-1 uppercase tracking-wider font-mono"
      >
        {expanded ? "▲ Hide Details" : "▼ Show Details"}
      </button>

      {/* Expandable Stats and Skill Area */}
      {expanded && archDef && (
        <div className="mt-1 pt-1.5 border-t border-zinc-800/80 flex flex-col gap-2 text-[10px] text-zinc-400 font-sans animate-flash-in">
          {/* Base Stats Grid */}
          <div className="grid grid-cols-5 gap-1 text-center bg-zinc-950/40 p-1 rounded border border-zinc-900">
            <div>
              <div className="text-[8px] text-zinc-600 font-bold uppercase">ATK</div>
              <div className="font-mono text-zinc-300">{archDef.atk}</div>
            </div>
            <div>
              <div className="text-[8px] text-zinc-600 font-bold uppercase">DEF</div>
              <div className="font-mono text-zinc-300">{archDef.def}</div>
            </div>
            <div>
              <div className="text-[8px] text-zinc-600 font-bold uppercase">MAG</div>
              <div className="font-mono text-zinc-300">{archDef.mag}</div>
            </div>
            <div>
              <div className="text-[8px] text-zinc-600 font-bold uppercase">RES</div>
              <div className="font-mono text-zinc-300">{archDef.res}</div>
            </div>
            <div>
              <div className="text-[8px] text-zinc-600 font-bold uppercase">SPD</div>
              <div className="font-mono text-zinc-300">{archDef.spd}</div>
            </div>
          </div>

          {/* Special Skill Info */}
          <div className="bg-zinc-950/30 p-1.5 rounded border border-zinc-900/50 space-y-0.5">
            <div className="flex justify-between items-center text-[9px] font-bold text-amber-500/90">
              <span>🌟 {archDef.specialName}</span>
              <span className="font-mono text-[8px] bg-sky-950/40 border border-sky-900 px-1 rounded text-sky-400">{archDef.specialCost} MP</span>
            </div>
            <p className="text-[9px] text-zinc-500 leading-normal italic">
              {archDef.specialDesc}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


export default function ArenaClashBoard({ state }: { state: GameState }) {
  const s = state as ArenaState;

  // Local state queue using refs to avoid React batching / skipping races
  const queueRef = useRef<ArenaState[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visualState, setVisualState] = useState<ArenaState>(s);
  const [isAnimating, setIsAnimating] = useState(false);

  const processNextState = () => {
    if (queueRef.current.length === 0) return;
    
    const nextState = queueRef.current.shift()!;
    setVisualState(nextState);

    // If it's a combat turn, lock the queue for 2.3 seconds
    if (nextState.lastAction) {
      setIsAnimating(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setIsAnimating(false);
      }, 2300);
    }
  };

  // Queue up new states arriving from the match controller
  useEffect(() => {
    queueRef.current.push(s);
    if (!isAnimating) {
      processNextState();
    }
  }, [s]);

  // When animation lock is released, process the next state in queue
  useEffect(() => {
    if (!isAnimating) {
      processNextState();
    }
  }, [isAnimating]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const teamA = visualState.units.filter((u) => u.side === "A");
  const teamB = visualState.units.filter((u) => u.side === "B");

  // Animation controller — driven by the engine's structured lastEvent
  // (actor, motion, per-unit effects) instead of parsing log text.
  const [anim, setAnim] = useState<AnimView | null>(null);

  // While an action is animating, keep the "active" highlight on the acting
  // unit. The engine already advanced the queue inside stateAfter, so reading
  // visualState.queue[0] directly would select the NEXT unit before its
  // predecessor's animation has even played. Only fall through to the queue
  // once the animation has cleared.
  const activeId = anim ? anim.actorId : visualState.queue[0];
  const animTimersRef = useRef<number[]>([]);

  useEffect(() => {
    const ev = visualState.lastEvent;
    if (!ev) return;

    animTimersRef.current.forEach((t) => clearTimeout(t));
    animTimersRef.current = [];

    const isA = ev.actor.startsWith("A");
    const windupPose: SpritePose | null =
      ev.motion === "melee" || ev.motion === "ranged"
        ? "windup"
        : ev.motion === "cast"
          ? "cast"
          : ev.motion === "support"
            ? "guard"
            : null;
    const moveClass = ev.motion === "melee" ? (isA ? "anim-attack-a" : "anim-attack-b") : "";

    // Phase 1 — actor winds up / starts casting / raises guard
    const baseFx: FxIcon[] = [];
    if (ev.motion === "cast") baseFx.push({ unit: ev.actor, src: FX.cast, cls: "fx-cast", delay: 0 });
    if (ev.motion === "support") baseFx.push({ unit: ev.actor, src: FX.shield, cls: "fx-pop", delay: 0 });

    setAnim({
      seq: ev.seq,
      actorId: ev.actor,
      actorPose: windupPose,
      moveClass,
      targetPoses: {},
      fxIcons: baseFx,
      floats: [],
      dying: [],
    });

    // Phase 2 — impact: target poses, effect sprites, floating numbers, sound
    const tImpact = window.setTimeout(() => {
      const targetPoses: Record<string, SpritePose> = {};
      const floats: FloatNum[] = [];
      const icons: FxIcon[] = [...baseFx];
      const dying: string[] = [];
      let delay = 0;
      for (const ef of ev.effects) {
        switch (ef.type) {
          case "damage":
            targetPoses[ef.unit] = "hit";
            floats.push({ unit: ef.unit, text: `-${ef.amount}${ef.label ? ` ${ef.label}` : ""}`, cls: "float-dmg", delay });
            icons.push({
              unit: ef.unit,
              src: ev.motion === "ranged" ? FX.arrow : ev.motion === "cast" ? FX.impact : FX.slash,
              cls: "fx-pop",
              delay,
            });
            break;
          case "heal":
            if (!targetPoses[ef.unit]) targetPoses[ef.unit] = "heal";
            floats.push({ unit: ef.unit, text: `+${ef.amount}`, cls: "float-heal", delay });
            icons.push({ unit: ef.unit, src: FX.heal, cls: "fx-rise", delay });
            break;
          case "poisoned":
            floats.push({ unit: ef.unit, text: ef.label ?? "poisoned", cls: "float-poison", delay });
            icons.push({ unit: ef.unit, src: FX.poison, cls: "fx-rise", delay });
            break;
          case "poison":
            if (!targetPoses[ef.unit]) targetPoses[ef.unit] = "hit";
            floats.push({ unit: ef.unit, text: `-${ef.amount}`, cls: "float-poison", delay });
            icons.push({ unit: ef.unit, src: FX.poison, cls: "fx-rise", delay });
            break;
          case "status":
            floats.push({ unit: ef.unit, text: ef.label ?? "status", cls: "float-status", delay });
            break;
          case "mana":
            floats.push({ unit: ef.unit, text: `+${ef.amount} MP`, cls: "float-mana", delay });
            break;
          case "death":
            dying.push(ef.unit);
            icons.push({ unit: ef.unit, src: FX.skull, cls: "fx-rise-slow", delay: delay + 250 });
            break;
        }
        delay += 120;
      }

      const strikePose: SpritePose | null =
        ev.motion === "melee" ? "strike" : ev.motion === "ranged" ? "shoot" : windupPose;
      setAnim((prev) => (prev && prev.seq === ev.seq ? { ...prev, actorPose: strikePose, targetPoses, fxIcons: icons, floats, dying } : prev));

      // 8-bit sound: priority death > damage > heal > poison > support
      const has = (t: string) => ev.effects.some((e) => e.type === t);
      if (has("death")) playSound("death");
      else if (has("damage")) playSound("attack");
      else if (has("heal")) playSound("heal");
      else if (has("poisoned") || has("poison")) playSound("poison");
      else if (ev.motion === "support") playSound("shield");
    }, 380);

    // Clear 400ms before the state-queue lock releases
    const tClear = window.setTimeout(() => setAnim(null), 1900);
    animTimersRef.current = [tImpact, tClear];
    return () => animTimersRef.current.forEach((t) => clearTimeout(t));
  }, [visualState.lastEvent?.seq]);

  // Construct 3x3 tiles list
  const tiles: { x: number; y: number; unit?: ArenaUnit }[] = [];
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      const unit = visualState.units.find((u) => {
        const coords = getUnitCoords(u.id);
        return coords.x === x && coords.y === y;
      });
      tiles.push({ x, y, unit });
    }
  }

  return (
    <div className="w-full relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 min-h-[720px] flex flex-col items-center justify-between p-4">
      {/* FOREST SCENERY BACKDROP */}
      <div className="forest-scenery" />

      {/* Last Action Notification Box HUD */}
      <div className="min-h-[50px] w-full max-w-xl flex items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-950/85 px-4 py-2 text-center text-xs text-amber-300 font-medium shadow-md flash-in z-20" key={visualState.lastAction ?? "start"}>
        {visualState.lastAction ?? `Round ${visualState.round} — awaiting first action`}
      </div>

      {/* In-Game Gameplay Row Layout */}
      <div className="w-full flex flex-col md:flex-row items-stretch justify-between gap-6 z-10 flex-1 mt-4 mb-4 min-h-0">
        
        {/* Team A HUD Overlay Panel (Left) */}
        <div className="w-[220px] flex flex-col gap-3 min-w-[170px] bg-zinc-950/65 backdrop-blur-xs p-3 rounded-lg border border-zinc-800/50 shadow-2xl">
          <h3 className="text-xs font-black uppercase tracking-wider text-cyan-400 border-b border-cyan-950 pb-1.5">Team A</h3>
          {teamA.map((unit) => (
            <DetailedUnitCard key={unit.id} unit={unit} active={unit.id === activeId} />
          ))}
        </div>

        {/* 3D Isometric Battlefield (Center) */}
        <div className="flex-1 flex items-center justify-center min-w-[480px]">
          <div className="isometric-container pt-12 pb-4">
            <div className="isometric-grid">
              {tiles.map(({ x, y, unit }) => {
                const isActiveTile = unit?.id === activeId;
                const isActor = unit && anim ? unit.id === anim.actorId : false;
                const pose: SpritePose | null = unit && anim
                  ? isActor
                    ? anim.actorPose
                    : anim.targetPoses[unit.id] ?? null
                  : null;

                return (
                  <div
                    key={`${x}-${y}`}
                    className={`isometric-tile ${isActiveTile ? "tile-active" : ""}`}
                    style={{ gridRow: y + 1, gridColumn: x + 1 }}
                  >
                    {/* Ground visual grass layer */}
                    <div className="tile-ground-visual" />

                    {/* Coordinate tag */}
                    <span className="absolute top-1 left-1.5 text-[8px] text-zinc-700 select-none font-mono z-10">
                      {x},{y}
                    </span>

                    {unit && (
                      <UnitToken
                        unit={unit}
                        active={isActiveTile}
                        pose={pose}
                        moveClass={isActor && anim ? anim.moveClass : ""}
                        dying={anim ? anim.dying.includes(unit.id) : false}
                        animSeq={anim?.seq ?? 0}
                        bubbleText={isActor ? getBubbleText(visualState.lastAction) : null}
                        floats={anim ? anim.floats.filter((f) => f.unit === unit.id) : []}
                        fxIcons={anim ? anim.fxIcons.filter((f) => f.unit === unit.id) : []}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Team B HUD Overlay Panel (Right) */}
        <div className="w-[220px] flex flex-col gap-3 min-w-[170px] bg-zinc-950/65 backdrop-blur-xs p-3 rounded-lg border border-zinc-800/50 shadow-2xl text-right">
          <h3 className="text-xs font-black uppercase tracking-wider text-fuchsia-400 border-b border-fuchsia-950 pb-1.5 text-right">Team B</h3>
          {teamB.map((u) => (
            <DetailedUnitCard key={u.id} unit={u} active={u.id === activeId} />
          ))}
        </div>
      </div>

      {/* Round Counter HUD */}
      <div className="text-xs text-zinc-300 font-mono bg-zinc-950/90 px-3.5 py-1 rounded-full border border-zinc-800 shadow z-20">
        Round {Math.min(visualState.round, 20)} / 20 · {anim ? "Acting" : "Next to act"}: <span className="text-amber-400 font-bold">{activeId ?? "—"}</span>
      </div>
    </div>
  );
}

