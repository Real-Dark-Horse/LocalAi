import { create } from "zustand";
import type { HardwareInfo, InferenceTimings, PerfStats } from "../types";
import { MOCK_HARDWARE, MOCK_STATS_HISTORY } from "../lib/mockData";
import { isTauri } from "../lib/tauri";

interface StatsState {
  hardware: HardwareInfo;
  history: PerfStats[];
  latest: PerfStats;
  timings: InferenceTimings | null;
  liveTokPerSec: number | null;
  contextUsed: number;
  contextLimit: number;
  popoverOpen: boolean;

  setHardware: (hw: HardwareInfo) => void;
  pushSample: (sample: PerfStats) => void;
  setTimings: (timings: InferenceTimings, contextUsed: number, contextLimit: number) => void;
  setLiveTokPerSec: (val: number | null) => void;
  setContextUsed: (contextUsed: number) => void;
  setContextLimit: (contextLimit: number) => void;
  setPopoverOpen: (open: boolean) => void;
}

const EMPTY_STATS: PerfStats = {
  ts: Date.now(),
  cpu_percent: 0,
  ram_used_mb: 0,
  ram_total_mb: 0,
  gpu_percent: null,
  vram_used_mb: null,
  vram_total_mb: null,
  server_proc: null,
};

export const useStatsStore = create<StatsState>((set) => ({
  hardware: isTauri()
    ? {
        cpu_name: "Detecting CPU…",
        physical_cores: 1,
        logical_cores: 1,
        total_ram_mb: 0,
        available_ram_mb: 0,
        gpus: [],
        recommended_backend: "cpu",
      }
    : MOCK_HARDWARE,
  history: isTauri() ? [] : MOCK_STATS_HISTORY,
  latest: isTauri() ? EMPTY_STATS : MOCK_STATS_HISTORY[MOCK_STATS_HISTORY.length - 1],
  timings: null,
  liveTokPerSec: null,
  contextUsed: 0,
  contextLimit: 8192,
  popoverOpen: false,

  setHardware: (hardware) => set({ hardware }),

  pushSample: (sample) =>
    set((s) => {
      const next = [...s.history, sample];
      if (next.length > 60) {
        next.splice(0, next.length - 60);
      }
      return { latest: sample, history: next };
    }),

  setTimings: (timings, contextUsed, contextLimit) =>
    set({
      timings,
      liveTokPerSec: timings.predicted_per_second,
      contextUsed,
      contextLimit,
    }),

  setLiveTokPerSec: (liveTokPerSec) => set({ liveTokPerSec }),

  setContextUsed: (contextUsed) => set({ contextUsed }),

  setContextLimit: (contextLimit) => set({ contextLimit }),

  setPopoverOpen: (popoverOpen) => set({ popoverOpen }),
}));
