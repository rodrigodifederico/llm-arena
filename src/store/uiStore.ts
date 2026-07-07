import { create } from "zustand";

export type View = "setup" | "arena" | "replays" | "replay";

interface UiState {
  view: View;
  replayId: string | null;
  go: (view: View, replayId?: string | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  view: "setup",
  replayId: null,
  go: (view, replayId = null) => set({ view, replayId }),
}));
