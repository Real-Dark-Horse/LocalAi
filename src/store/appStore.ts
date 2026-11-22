import { create } from "zustand";
import type {
  AgentMode,
  AppConfig,
  AppPaths,
  ModelInfo,
  ModelOverride,
  ServerStatus,
  ToastItem,
  UpdateInfo,
} from "../types";
import {
  checkForUpdate,
  detectHardware,
  getConfig,
  getPaths,
  isTauri,
  listenEvents,
  saveConfig,
  scanModels,
  startServer,
  stopServer,
} from "../lib/tauri";
import { MOCK_MODELS } from "../lib/mockData";
import { resetPortCapabilities } from "../lib/llm";
import { useStatsStore } from "./statsStore";
import { useWorkspaceStore } from "./workspaceStore";

interface AppState {
  initialized: boolean;
  paths: AppPaths | null;
  config: AppConfig;
  mode: AgentMode;
  enableThinking: boolean;
  models: ModelInfo[];
  selectedModelFilename: string | null;
  serverStatus: ServerStatus;
  showSetupWizard: boolean;
  showSettings: boolean;
  showSearch: boolean;
  dismissedWarnings: Record<string, boolean>;
  toasts: ToastItem[];
  updateInfo: UpdateInfo | null;
  updateDismissed: boolean;
  checkingUpdate: boolean;

  init: () => Promise<() => void>;
  setMode: (mode: AgentMode) => void;
  setEnableThinking: (enabled: boolean) => void;
  toggleSidebar: () => void;
  setSelectedModel: (filename: string) => Promise<void>;
  refreshModels: (dir?: string) => Promise<ModelInfo[]>;
  setModelsDir: (dir: string) => Promise<void>;
  saveModelOverride: (filename: string, override: ModelOverride) => Promise<void>;
  restartActiveModel: () => Promise<void>;
  updateConfig: (partial: Partial<AppConfig>) => Promise<void>;
  setShowSetupWizard: (open: boolean) => void;
  setShowSettings: (open: boolean) => void;
  setShowSearch: (open: boolean) => void;
  dismissWarning: (key: string) => void;
  pushToast: (level: ToastItem["level"], message: string) => void;
  removeToast: (id: string) => void;
  checkForUpdates: (manual?: boolean) => Promise<UpdateInfo | null>;
  dismissUpdate: () => void;
}

const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  models_dir: "",
  last_model: null,
  last_workspace_id: null,
  last_conversation_id: null,
  default_mode: "ask",
  sidebar_collapsed: false,
  model_overrides: {},
  monitor_interval_ms: 1500,
  font_size: 14,
  verbose_steps: false,
  default_thinking: false,
};

let activeInitPromise: Promise<() => void> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  paths: null,
  config: DEFAULT_CONFIG,
  mode: "ask",
  enableThinking: false,
  models: isTauri() ? [] : MOCK_MODELS,
  selectedModelFilename: isTauri() ? null : MOCK_MODELS[0].filename,
  serverStatus: isTauri() ? { state: "stopped" } : { state: "ready", port: 39281 },
  showSetupWizard: false,
  showSettings: false,
  showSearch: false,
  dismissedWarnings: {},
  toasts: [],
  updateInfo: null,
  updateDismissed: false,
  checkingUpdate: false,

  init: async () => {
    if (activeInitPromise) {
      return activeInitPromise;
    }
    const run = async (): Promise<() => void> => {
      if (!isTauri()) {
        set({ initialized: true });
        return () => {};
      }

      const unlisten = await listenEvents({
        onStats: (stats) => {
          useStatsStore.getState().pushSample(stats);
        },
        onServerStatus: (status) => {
          set({ serverStatus: status });
        },
        onServerToast: (toast) => {
          get().pushToast(toast.level, toast.message);
        },
      });

      try {
        void detectHardware().then((hw) => {
          if (hw) {
            useStatsStore.getState().setHardware(hw);
          }
        });

        const [paths, cfg] = await Promise.all([getPaths(), getConfig()]);

        const nextConfig = { ...DEFAULT_CONFIG, ...(cfg ?? {}) };
        set({
          paths,
          config: nextConfig,
          mode: nextConfig.default_mode || "ask",
          enableThinking: nextConfig.default_thinking ?? false,
          selectedModelFilename: nextConfig.last_model,
        });

        if (paths?.fallback_warning) {
          get().pushToast("warning", paths.fallback_warning);
        }

        const [, scanned] = await Promise.all([
          useWorkspaceStore
            .getState()
            .loadFromBackend(
              nextConfig.last_workspace_id,
              nextConfig.last_conversation_id
            ),
          nextConfig.models_dir
            ? get().refreshModels(nextConfig.models_dir)
            : Promise.resolve([]),
        ]);

        set({ initialized: true });

        if (nextConfig.models_dir) {
          if (scanned.length === 0) {
            set({ showSetupWizard: true });
          } else {
            const target =
              scanned.find((m) => m.filename === nextConfig.last_model) ?? scanned[0];
            if (target) {
              void get().setSelectedModel(target.filename);
            }
          }
        } else {
          set({ showSetupWizard: true });
        }

        // Check for newer GitHub releases quietly in the background
        setTimeout(() => {
          void get().checkForUpdates(false);
        }, 1800);
      } catch (err) {
        set({ initialized: true });
        get().pushToast("error", `Startup error: ${String(err)}`);
      }

      return unlisten;
    };

    activeInitPromise = run();
    return activeInitPromise;
  },

  setMode: (mode) => set({ mode }),
  setEnableThinking: (enableThinking) => set({ enableThinking }),

  toggleSidebar: () => {
    const next = !get().config.sidebar_collapsed;
    void get().updateConfig({ sidebar_collapsed: next });
  },

  refreshModels: async (dir) => {
    const targetDir = dir ?? get().config.models_dir;
    if (!targetDir) {
      set({ models: [] });
      return [];
    }
    try {
      const list = await scanModels(targetDir);
      set({ models: list });
      return list;
    } catch (err) {
      get().pushToast("error", `Model scan failed: ${String(err)}`);
      set({ models: [] });
      return [];
    }
  },

  setSelectedModel: async (filename) => {
    set({ selectedModelFilename: filename });
    await get().updateConfig({ last_model: filename });

    if (!isTauri()) return;
    const model = get().models.find((m) => m.filename === filename);
    if (!model) return;

    const override = get().config.model_overrides[filename];
    const hw = useStatsStore.getState().hardware;
    const chosenBackend =
      override?.backend && override.backend !== "auto"
        ? override.backend
        : override && override.gpu_layers === 0
          ? "cpu"
          : hw.recommended_backend === "vulkan" && model.auto_settings.backend === "vulkan"
            ? "vulkan"
            : model.auto_settings.backend;
    const settings = {
      backend: chosenBackend,
      context: override?.context ?? model.auto_settings.context,
      gpu_layers:
        chosenBackend === "cpu"
          ? 0
          : override?.gpu_layers ?? model.auto_settings.gpu_layers,
      threads: override?.threads ?? model.auto_settings.threads,
      auto_gpu_layers: chosenBackend === "vulkan" && !override,
    };

    try {
      resetPortCapabilities();
      set({ serverStatus: { state: "loading" } });
      const port = await startServer(model.path, settings);
      if (get().selectedModelFilename !== filename) return;
      set({ serverStatus: { state: "ready", port } });
      useStatsStore.getState().setContextLimit(settings.context);
    } catch (err) {
      if (get().selectedModelFilename !== filename) return;
      const msg = String(err);
      if (msg.toLowerCase().includes("superseded")) {
        return;
      }
      set({ serverStatus: { state: "error", message: msg } });
      get().pushToast("error", msg);
    }
  },

  restartActiveModel: async () => {
    const current = get().selectedModelFilename;
    if (!current) return;
    if (isTauri()) {
      await stopServer();
    }
    await get().setSelectedModel(current);
  },

  saveModelOverride: async (filename, override) => {
    const nextOverrides = {
      ...get().config.model_overrides,
      [filename]: override,
    };
    await get().updateConfig({ model_overrides: nextOverrides });
  },

  setModelsDir: async (dir) => {
    await get().updateConfig({ models_dir: dir });
    const list = await get().refreshModels(dir);
    if (list.length > 0) {
      await get().setSelectedModel(list[0].filename);
    } else {
      get().pushToast("warning", "No .gguf models found in that folder.");
    }
  },

  updateConfig: async (partial) => {
    const nextConfig: AppConfig = { ...get().config, ...partial };
    set({ config: nextConfig });
    try {
      await saveConfig(nextConfig);
    } catch (err) {
      get().pushToast("error", `Could not save config: ${String(err)}`);
    }
  },

  setShowSetupWizard: (open) => set({ showSetupWizard: open }),
  setShowSettings: (open) => set({ showSettings: open }),
  setShowSearch: (open) => set({ showSearch: open }),

  dismissWarning: (key) =>
    set((s) => ({
      dismissedWarnings: { ...s.dismissedWarnings, [key]: true },
    })),

  pushToast: (level, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts, { id, level, message }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 5000);
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  checkForUpdates: async (manual = false) => {
    if (get().checkingUpdate) return get().updateInfo;
    set({ checkingUpdate: true });
    try {
      const info = await checkForUpdate();
      set({
        updateInfo: info,
        updateDismissed: manual && info.update_available ? false : get().updateDismissed,
      });
      if (manual) {
        if (info.error) {
          get().pushToast("warning", info.error);
        } else if (info.update_available && info.latest_version) {
          get().pushToast(
            "info",
            `Update available: LocalAI v${info.latest_version}`
          );
        } else if (info.checked) {
          get().pushToast("success", `You are on the latest version (v${info.current_version}).`);
        }
      }
      return info;
    } catch (err) {
      if (manual) {
        get().pushToast("warning", `Update check failed: ${String(err)}`);
      }
      return null;
    } finally {
      set({ checkingUpdate: false });
    }
  },

  dismissUpdate: () => set({ updateDismissed: true }),
}));
