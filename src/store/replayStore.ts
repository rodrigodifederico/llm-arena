// Replay persistence (§2.1/§9): a small metadata index in localStorage plus
// full replay blobs in IndexedDB (via idb). Export/import as a single .json.

import { openDB, type IDBPDatabase } from "idb";
import { create } from "zustand";
import type { Replay } from "../match/replay";
import { parseReplay } from "../match/replay";

export interface ReplayMeta {
  matchId: string;
  createdAt: string;
  game: string;
  labelA: string;
  labelB: string;
  winner: string; // "A" | "B" | "draw" | "aborted"
  turnCount: number;
}

const INDEX_KEY = "llm-arena-replay-index";
const DB_NAME = "llm-arena";
const STORE = "replays";

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

function loadIndex(): ReplayMeta[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as ReplayMeta[];
  } catch {
    return [];
  }
}

function saveIndex(index: ReplayMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function metaOf(r: Replay): ReplayMeta {
  return {
    matchId: r.matchId,
    createdAt: r.createdAt,
    game: r.game,
    labelA: r.players.A.label,
    labelB: r.players.B.label,
    winner: r.aborted ? "aborted" : (r.result?.winner ?? "draw"),
    turnCount: r.turns.length,
  };
}

interface ReplayStoreState {
  index: ReplayMeta[];
  save: (r: Replay) => Promise<void>;
  load: (matchId: string) => Promise<Replay | null>;
  remove: (matchId: string) => Promise<void>;
  importJson: (json: string) => Promise<Replay>;
}

export const useReplayStore = create<ReplayStoreState>()((set, get) => ({
  index: loadIndex(),
  save: async (r) => {
    await (await db()).put(STORE, JSON.parse(JSON.stringify(r)), r.matchId);
    const index = [metaOf(r), ...get().index.filter((m) => m.matchId !== r.matchId)];
    saveIndex(index);
    set({ index });
  },
  load: async (matchId) => {
    const raw = await (await db()).get(STORE, matchId);
    return (raw as Replay) ?? null;
  },
  remove: async (matchId) => {
    await (await db()).delete(STORE, matchId);
    const index = get().index.filter((m) => m.matchId !== matchId);
    saveIndex(index);
    set({ index });
  },
  importJson: async (json) => {
    const replay = parseReplay(json);
    await get().save(replay);
    return replay;
  },
}));
