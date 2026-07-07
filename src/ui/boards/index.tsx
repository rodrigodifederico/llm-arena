import type { ComponentType } from "react";
import type { GameState } from "../../engine/GameEngine";
import ArenaClashBoard from "./ArenaClashBoard";
import HexBoard from "./HexBoard";
import SalvoBoard from "./SalvoBoard";
import StandoffBoard from "./StandoffBoard";

// Per-game board component keyed by engine.id (§11). Each is a pure function
// of GameState, so the replay screen reuses them verbatim.
const BOARDS: Record<string, ComponentType<{ state: GameState }>> = {
  arena_clash: ArenaClashBoard,
  hex_dominion: HexBoard,
  salvo: SalvoBoard,
  standoff: StandoffBoard,
};

export function getBoard(engineId: string): ComponentType<{ state: GameState }> {
  const b = BOARDS[engineId];
  if (!b) throw new Error(`no board for engine ${engineId}`);
  return b;
}
