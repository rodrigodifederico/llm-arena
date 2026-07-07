import type { GameEngine } from "./GameEngine";
import { arenaClash } from "./arenaClash";
import { hexDominion } from "./hexDominion";
import { salvo } from "./salvo";
import { standoff } from "./standoff";

export const ENGINES: GameEngine[] = [arenaClash, hexDominion, salvo, standoff];

export function getEngine(id: string): GameEngine {
  const e = ENGINES.find((x) => x.id === id);
  if (!e) throw new Error(`unknown game engine: ${id}`);
  return e;
}
