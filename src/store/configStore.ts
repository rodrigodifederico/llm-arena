// Setup-screen state (§10). Persisted to localStorage — API keys are only
// persisted when "Remember on this device" is checked for that side.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlayerId } from "../engine/GameEngine";
import type { EndpointConfig } from "../llm/LLMClient";

export interface PlayerSetup {
  label: string;
  baseUrl: string;
  apiKey: string;
  rememberKey: boolean;
  model: string;
  useProxy: boolean;
  costInPerM: number;
  costOutPerM: number;
  maxTokens: number; // output budget; raise for reasoning models
}

export interface ConfigState {
  players: Record<PlayerId, PlayerSetup>;
  gameId: string;
  seed: string;
  temperature: number;
  allowThinking: boolean;
  maxRetries: number;
  decisionTimeoutSec: number;
  setPlayer: (p: PlayerId, patch: Partial<PlayerSetup>) => void;
  setGlobal: (
    patch: Partial<
      Pick<ConfigState, "gameId" | "seed" | "temperature" | "allowThinking" | "maxRetries" | "decisionTimeoutSec">
    >,
  ) => void;
  copyAToB: () => void;
  randomizeSeed: () => void;
}

function emptyPlayer(label: string): PlayerSetup {
  return {
    label,
    baseUrl: "",
    apiKey: "",
    rememberKey: false,
    model: "",
    useProxy: false,
    costInPerM: 0,
    costOutPerM: 0,
    maxTokens: 4096,
  };
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      players: { A: emptyPlayer("Player A"), B: emptyPlayer("Player B") },
      gameId: "arena_clash",
      seed: randomSeed(),
      temperature: 0.2,
      allowThinking: true,
      maxRetries: 2,
      decisionTimeoutSec: 30,
      setPlayer: (p, patch) =>
        set((s) => ({ players: { ...s.players, [p]: { ...s.players[p], ...patch } } })),
      setGlobal: (patch) => set(patch),
      copyAToB: () =>
        set((s) => ({
          players: { ...s.players, B: { ...s.players.A, label: s.players.A.label + " (copy)" } },
        })),
      randomizeSeed: () => set({ seed: randomSeed() }),
    }),
    {
      name: "llm-arena-config",
      partialize: (s) => ({
        players: {
          A: { ...s.players.A, apiKey: s.players.A.rememberKey ? s.players.A.apiKey : "" },
          B: { ...s.players.B, apiKey: s.players.B.rememberKey ? s.players.B.apiKey : "" },
        },
        gameId: s.gameId,
        seed: s.seed,
        temperature: s.temperature,
        allowThinking: s.allowThinking,
        maxRetries: s.maxRetries,
        decisionTimeoutSec: s.decisionTimeoutSec,
      }),
    },
  ),
);

export function toEndpointConfig(p: PlayerSetup): EndpointConfig {
  return {
    label: p.label,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: p.model,
    useProxy: p.useProxy,
    costInPerM: p.costInPerM,
    costOutPerM: p.costOutPerM,
    maxTokens: p.maxTokens,
  };
}

export function playerReady(p: PlayerSetup): boolean {
  return /^https?:\/\/.+/.test(p.baseUrl.trim()) && p.apiKey.trim().length > 0 && p.model.trim().length > 0;
}
