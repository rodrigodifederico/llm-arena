// Live match state: the MatchController writes here through its listener;
// the arena screen renders from here.

import { create } from "zustand";
import type { GameResult, GameState, PlayerId } from "../engine/GameEngine";
import { getEngine } from "../engine";
import type { EndpointConfig } from "../llm/LLMClient";
import { MatchController, type MatchSettings, type MatchStatus } from "../match/MatchController";
import type { PlayerTotals, Replay, TurnRecord } from "../match/replay";
import { emptyTotals } from "../match/replay";
import { useReplayStore } from "./replayStore";

interface MatchStoreState {
  status: MatchStatus;
  engineId: string | null;
  gameState: GameState | null;
  turns: TurnRecord[];
  totals: Record<PlayerId, PlayerTotals>;
  thinking: Record<PlayerId, boolean>;
  result: GameResult | null;
  aborted: boolean;
  replay: Replay | null;
  playerLabels: Record<PlayerId, string>;
  playerModels: Record<PlayerId, string>;
  controller: MatchController | null;

  start: (opts: {
    engineId: string;
    players: Record<PlayerId, EndpointConfig>;
    settings: MatchSettings;
    seed: string;
  }) => void;
  pause: () => void;
  resume: () => void;
  step: () => void;
  abort: () => void;
  reset: () => void;
}

export const useMatchStore = create<MatchStoreState>()((set, get) => ({
  status: "idle",
  engineId: null,
  gameState: null,
  turns: [],
  totals: { A: emptyTotals(), B: emptyTotals() },
  thinking: { A: false, B: false },
  result: null,
  aborted: false,
  replay: null,
  playerLabels: { A: "Player A", B: "Player B" },
  playerModels: { A: "", B: "" },
  controller: null,

  start: ({ engineId, players, settings, seed }) => {
    const engine = getEngine(engineId);
    set({
      status: "running",
      engineId,
      gameState: null,
      turns: [],
      totals: { A: emptyTotals(), B: emptyTotals() },
      thinking: { A: false, B: false },
      result: null,
      aborted: false,
      replay: null,
      playerLabels: { A: players.A.label || "Player A", B: players.B.label || "Player B" },
      playerModels: { A: players.A.model, B: players.B.model },
    });
    const controller = new MatchController({
      engine,
      players,
      settings,
      seed,
      listener: {
        onStatus: (status) => set({ status }),
        onStateChange: (gameState) => set({ gameState }),
        onThinking: (player, is) => set((s) => ({ thinking: { ...s.thinking, [player]: is } })),
        onTurn: (turn) => set((s) => ({ turns: [...s.turns, turn] })),
        onTotals: (totals) => set({ totals }),
        onFinish: (replay) => {
          set({ replay, result: replay.result, aborted: replay.aborted });
          // Aborted matches still persist the partial replay (§13).
          void useReplayStore.getState().save(replay);
        },
      },
    });
    set({ controller });
    controller.pause(); // Pause immediately for the countdown overlay
    void controller.run();
  },

  pause: () => get().controller?.pause(),
  resume: () => get().controller?.resume(),
  step: () => get().controller?.step(),
  abort: () => get().controller?.abort(),
  reset: () =>
    set({
      status: "idle",
      engineId: null,
      gameState: null,
      turns: [],
      totals: { A: emptyTotals(), B: emptyTotals() },
      thinking: { A: false, B: false },
      result: null,
      aborted: false,
      replay: null,
      controller: null,
    }),
}));
