// Action-pose sprite generator: takes each character's base PNG (white
// background) and bakes per-action frames on a canvas — chromakey to
// transparent, then per-pose transforms (lean, lunge, fall) and tints
// (hit flash, heal glow, cast aura). Results are cached per src so every
// UnitToken re-render is free.

import { useEffect, useState } from "react";

export type SpritePose =
  | "idle"
  | "windup" // pulling back before a melee strike
  | "strike" // melee lunge frame
  | "shoot" // ranged release frame
  | "cast" // spellcasting: raised, arcane aura
  | "hit" // taking damage: recoil + red flash
  | "heal" // being healed: green-gold glow
  | "guard" // defend/support stance: blue shimmer
  | "fall"; // dying: toppled over, desaturated

export type PoseMap = Record<SpritePose, string>;

interface PoseSpec {
  rotate: number; // degrees
  dx: number; // fraction of width
  dy: number; // fraction of height
  scaleX: number;
  scaleY: number;
  tint?: string; // rgba overlay applied to the sprite silhouette
  glow?: string; // outer glow color
  desaturate?: boolean;
  alpha?: number;
}

const POSES: Record<SpritePose, PoseSpec> = {
  idle: { rotate: 0, dx: 0, dy: 0, scaleX: 1, scaleY: 1 },
  windup: { rotate: -8, dx: -0.04, dy: 0.02, scaleX: 0.96, scaleY: 0.94 },
  strike: { rotate: 12, dx: 0.08, dy: -0.03, scaleX: 1.08, scaleY: 0.98 },
  shoot: { rotate: -4, dx: -0.02, dy: -0.02, scaleX: 1.02, scaleY: 1.02, glow: "rgba(251,191,36,0.55)" },
  cast: { rotate: -3, dx: 0, dy: -0.05, scaleX: 1, scaleY: 1.05, glow: "rgba(167,139,250,0.8)", tint: "rgba(139,92,246,0.12)" },
  hit: { rotate: -11, dx: -0.06, dy: 0.03, scaleX: 0.95, scaleY: 0.97, tint: "rgba(239,68,68,0.42)" },
  heal: { rotate: 0, dx: 0, dy: -0.03, scaleX: 1.02, scaleY: 1.03, glow: "rgba(52,211,153,0.85)", tint: "rgba(52,211,153,0.16)" },
  guard: { rotate: 0, dx: 0, dy: 0.02, scaleX: 1.04, scaleY: 0.96, glow: "rgba(96,165,250,0.75)", tint: "rgba(59,130,246,0.12)" },
  fall: { rotate: 78, dx: 0.12, dy: 0.18, scaleX: 1, scaleY: 1, desaturate: true, alpha: 0.85 },
};

const cache = new Map<string, Promise<PoseMap | null>>();

function chromakey(img: HTMLImageElement, tolerance = 45): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  try {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const dist = Math.sqrt((data[i] - 255) ** 2 + (data[i + 1] - 255) ** 2 + (data[i + 2] - 255) ** 2);
      if (dist < tolerance) data[i + 3] = 0;
    }
    ctx.putImageData(imgData, 0, 0);
  } catch {
    return null; // tainted canvas etc. — caller falls back to the raw src
  }
  return canvas;
}

function bakePose(base: HTMLCanvasElement, spec: PoseSpec): string {
  const w = base.width;
  const h = base.height;
  // padded canvas so rotation/lunge never clips
  const pad = Math.ceil(Math.max(w, h) * 0.35);
  const canvas = document.createElement("canvas");
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const ctx = canvas.getContext("2d")!;

  ctx.save();
  if (spec.glow) {
    ctx.shadowColor = spec.glow;
    ctx.shadowBlur = Math.round(w * 0.08);
  }
  if (spec.desaturate) ctx.filter = "grayscale(0.85) brightness(0.75)";
  if (spec.alpha !== undefined) ctx.globalAlpha = spec.alpha;

  // pivot at the sprite's feet (bottom center) so leans/falls look grounded
  const px = pad + w / 2 + spec.dx * w;
  const py = pad + h + spec.dy * h;
  ctx.translate(px, py);
  ctx.rotate((spec.rotate * Math.PI) / 180);
  ctx.scale(spec.scaleX, spec.scaleY);
  ctx.drawImage(base, -w / 2, -h);
  ctx.restore();

  if (spec.tint) {
    // tint only the sprite silhouette
    const tintLayer = document.createElement("canvas");
    tintLayer.width = canvas.width;
    tintLayer.height = canvas.height;
    const tctx = tintLayer.getContext("2d")!;
    tctx.drawImage(canvas, 0, 0);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = spec.tint;
    tctx.fillRect(0, 0, tintLayer.width, tintLayer.height);
    ctx.drawImage(tintLayer, 0, 0);
  }

  return canvas.toDataURL();
}

function buildPoses(src: string): Promise<PoseMap | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const base = chromakey(img);
      if (!base) return resolve(null);
      const out = {} as PoseMap;
      for (const pose of Object.keys(POSES) as SpritePose[]) {
        out[pose] = bakePose(base, POSES[pose]);
      }
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Returns the baked pose frames for a sprite src, or null while loading /
// on failure (caller falls back to the raw image or emoji).
export function useSpritePoses(src: string): PoseMap | null {
  const [poses, setPoses] = useState<PoseMap | null>(null);
  useEffect(() => {
    if (!src) {
      setPoses(null);
      return;
    }
    let alive = true;
    if (!cache.has(src)) cache.set(src, buildPoses(src));
    void cache.get(src)!.then((p) => {
      if (alive) setPoses(p);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  return poses;
}
