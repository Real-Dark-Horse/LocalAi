import React, { useEffect, useState } from "react";
import { Download, ExternalLink, FolderOpen, RefreshCw, RotateCcw, X } from "lucide-react";
import type { AgentMode, ModelOverride } from "../../types";
import { useAppStore } from "../../store/appStore";
import { useStatsStore } from "../../store/statsStore";
import { formatMbDetailed } from "../../lib/format";
import { openExternalUrl, pickFolder } from "../../lib/tauri";
import { BrandLogo } from "../ui/BrandLogo";
import { Button } from "../ui/Button";

type SettingsTab =
  | "general"
  | "appearance"
  | "models"
  | "performance"
  | "shortcuts"
  | "about";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "models", label: "Models" },
  { id: "performance", label: "Performance" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
];

export const SettingsDialog: React.FC = () => {
  const open = useAppStore((s) => s.showSettings);
  const setOpen = useAppStore((s) => s.setShowSettings);
  const config = useAppStore((s) => s.config);
  const paths = useAppStore((s) => s.paths);
  const models = useAppStore((s) => s.models);
  const selectedFilename = useAppStore((s) => s.selectedModelFilename);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setModelsDir = useAppStore((s) => s.setModelsDir);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const saveModelOverride = useAppStore((s) => s.saveModelOverride);
  const restartActiveModel = useAppStore((s) => s.restartActiveModel);
  const setEnableThinking = useAppStore((s) => s.setEnableThinking);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const checkingUpdate = useAppStore((s) => s.checkingUpdate);
  const checkForUpdates = useAppStore((s) => s.checkForUpdates);
  const hardware = useStatsStore((s) => s.hardware);

  const [tab, setTab] = useState<SettingsTab>("general");
  const [editingModelFile, setEditingModelFile] = useState<string | null>(null);

  const activeModel =
    models.find((m) => m.filename === (editingModelFile ?? selectedFilename)) ??
    models[0] ??
    null;

  const [draft, setDraft] = useState<ModelOverride>({
    backend: "auto",
    context: 8192,
    gpu_layers: 0,
    threads: 4,
    temperature: 0.2,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!activeModel) return;
    const existing = config.model_overrides[activeModel.filename];
    setDraft({
      backend: existing?.backend ?? "auto",
      context: existing?.context ?? activeModel.auto_settings.context,
      gpu_layers: existing?.gpu_layers ?? activeModel.auto_settings.gpu_layers,
      threads: existing?.threads ?? activeModel.auto_settings.threads,
      temperature: existing?.temperature ?? activeModel.auto_settings.temperature,
    });
  }, [activeModel, config.model_overrides, open]);

  if (!open) return null;

  const handleBrowseModels = async () => {
    const dir = await pickFolder("Select GGUF Models Folder");
    if (dir) {
      await setModelsDir(dir);
    }
  };

  const handleResetAuto = async () => {
    if (!activeModel) return;
    const nextOverrides = { ...config.model_overrides };
    delete nextOverrides[activeModel.filename];
    await updateConfig({ model_overrides: nextOverrides });
    setDraft({
      backend: "auto",
      context: activeModel.auto_settings.context,
      gpu_layers: activeModel.auto_settings.gpu_layers,
      threads: activeModel.auto_settings.threads,
      temperature: activeModel.auto_settings.temperature,
    });
  };

  const handleSaveAndApply = async () => {
    if (!activeModel) return;
    await saveModelOverride(activeModel.filename, draft);
    if (activeModel.filename === selectedFilename) {
      await restartActiveModel();
    } else {
      await setSelectedModel(activeModel.filename);
    }
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative flex h-[540px] w-full max-w-[740px] overflow-hidden rounded-[14px] border border-border bg-[#0F0F11] text-ink">
        {/* Left Navigation */}
        <aside className="flex w-[185px] shrink-0 flex-col border-r border-border bg-[#141416] p-3 select-none">
          <div className="px-2.5 pb-2 pt-1 text-[11.5px] font-medium text-muted">
            Settings
          </div>
          <nav className="flex-1 space-y-0.5">
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex w-full items-center rounded-[8px] px-2.5 py-1.5 text-left text-[13.5px] transition-colors ${
                    active
                      ? "bg-[#242428] font-medium text-ink"
                      : "text-muted hover:bg-hover hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-border px-2 pt-3">
            <BrandLogo size="sm" />
          </div>
        </aside>

        {/* Right Content */}
        <div className="relative flex-1 overflow-y-auto px-8 py-6">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>

          {tab === "general" && (
            <div className="space-y-5">
              <h2 className="text-[18px] font-semibold text-ink">General</h2>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Models Folder</div>
                <div className="flex items-center justify-between gap-3 rounded-[12px] border border-border bg-[#161618] px-4 py-3">
                  <span className="truncate font-mono text-[12.5px] text-ink">
                    {config.models_dir || "Not selected"}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleBrowseModels()}
                    className="shrink-0"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Defaults</div>
                <div className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618]">
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13.5px] font-medium text-ink">Default Mode</span>
                    <select
                      value={config.default_mode}
                      onChange={(e) =>
                        void updateConfig({ default_mode: e.target.value as AgentMode })
                      }
                      className="rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-[12.5px] text-ink focus:outline-none"
                    >
                      <option value="ask">Ask</option>
                      <option value="auto">Auto</option>
                      <option value="chat">Chat</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13.5px] font-medium text-ink">Reasoning</span>
                    <div className="inline-flex rounded-full border border-border bg-[#1E1E22] p-0.5 text-[12px]">
                      <button
                        type="button"
                        onClick={() => {
                          setEnableThinking(false);
                          void updateConfig({ default_thinking: false });
                        }}
                        className={`rounded-full px-3 py-1 transition-colors ${
                          !config.default_thinking
                            ? "bg-[#2C2C32] font-medium text-ink"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        Fast
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEnableThinking(true);
                          void updateConfig({ default_thinking: true });
                        }}
                        className={`rounded-full px-3 py-1 transition-colors ${
                          config.default_thinking
                            ? "bg-[#2C2C32] font-medium text-ink"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        Think
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {paths && (
                <div>
                  <div className="mb-2 text-[12.5px] font-medium text-muted">Data Path</div>
                  <div className="rounded-[12px] border border-border bg-[#161618] px-4 py-3 font-mono text-[12px] text-ink/90">
                    {paths.data_dir}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "appearance" && (
            <div className="space-y-5">
              <h2 className="text-[18px] font-semibold text-ink">Appearance</h2>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Chat</div>
                <div className="flex items-center justify-between gap-4 rounded-[12px] border border-border bg-[#161618] px-4 py-3">
                  <span className="text-[13.5px] font-medium text-ink">
                    Conversation Steps
                  </span>
                  <div className="inline-flex rounded-full border border-border bg-[#1E1E22] p-0.5 text-[12px]">
                    <button
                      type="button"
                      onClick={() => void updateConfig({ verbose_steps: false })}
                      className={`rounded-full px-3 py-1 transition-colors ${
                        !config.verbose_steps
                          ? "bg-[#2C2C32] font-medium text-ink"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateConfig({ verbose_steps: true })}
                      className={`rounded-full px-3 py-1 transition-colors ${
                        config.verbose_steps
                          ? "bg-[#2C2C32] font-medium text-ink"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      Verbose
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Interface</div>
                <div className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618]">
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13.5px] font-medium text-ink">Font Size</span>
                    <select
                      value={config.font_size || 14}
                      onChange={(e) =>
                        void updateConfig({ font_size: Number(e.target.value) || 14 })
                      }
                      className="rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-[12.5px] text-ink focus:outline-none"
                    >
                      <option value={13}>13px</option>
                      <option value={14}>14px</option>
                      <option value={15}>15px</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13.5px] font-medium text-ink">Sidebar</span>
                    <div className="inline-flex rounded-full border border-border bg-[#1E1E22] p-0.5 text-[12px]">
                      <button
                        type="button"
                        onClick={() => void updateConfig({ sidebar_collapsed: false })}
                        className={`rounded-full px-3 py-1 transition-colors ${
                          !config.sidebar_collapsed
                            ? "bg-[#2C2C32] font-medium text-ink"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        Shown
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateConfig({ sidebar_collapsed: true })}
                        className={`rounded-full px-3 py-1 transition-colors ${
                          config.sidebar_collapsed
                            ? "bg-[#2C2C32] font-medium text-ink"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        Hidden
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "models" && (
            <div className="space-y-5">
              <h2 className="text-[18px] font-semibold text-ink">Models</h2>

              {!activeModel ? (
                <div className="rounded-[12px] border border-border bg-[#161618] p-4 text-[13px] text-muted">
                  No models detected.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-[12px] border border-border bg-[#161618] px-4 py-3">
                    <span className="text-[13.5px] font-medium text-ink">Model</span>
                    <select
                      value={activeModel.filename}
                      onChange={(e) => setEditingModelFile(e.target.value)}
                      className="max-w-[240px] rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-[12.5px] text-ink focus:outline-none"
                    >
                      {models.map((m) => (
                        <option key={m.filename} value={m.filename}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618]">
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[13.5px] font-medium text-ink">Backend</span>
                      <select
                        value={draft.backend ?? "auto"}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            backend: e.target.value as "auto" | "vulkan" | "cpu",
                            gpu_layers:
                              e.target.value === "cpu"
                                ? 0
                                : d.gpu_layers === 0
                                  ? activeModel.auto_settings.gpu_layers
                                  : d.gpu_layers,
                          }))
                        }
                        className="rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-[12.5px] text-ink focus:outline-none"
                      >
                        <option value="auto">Auto (GPU)</option>
                        <option value="vulkan">GPU Offload</option>
                        <option value="cpu">CPU only</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[13.5px] font-medium text-ink">Context</span>
                      <select
                        value={draft.context}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, context: Number(e.target.value) }))
                        }
                        className="rounded-full border border-border bg-[#1E1E22] px-3 py-1 font-mono text-[12.5px] text-ink focus:outline-none"
                      >
                        <option value={4096}>4,096</option>
                        <option value={8192}>8,192</option>
                        <option value={16384}>16,384</option>
                        <option value={32768}>32,768</option>
                        <option value={65536}>65,536</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[13.5px] font-medium text-ink">GPU Layers</span>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={draft.gpu_layers}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            gpu_layers: Math.max(0, Math.min(99, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-20 rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-center font-mono text-[12.5px] text-ink focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[13.5px] font-medium text-ink">Threads</span>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={draft.threads}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            threads: Math.max(1, Math.min(32, Number(e.target.value) || 1)),
                          }))
                        }
                        className="w-20 rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-center font-mono text-[12.5px] text-ink focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[13.5px] font-medium text-ink">Temperature</span>
                      <input
                        type="number"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={draft.temperature}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            temperature: Math.max(0, Math.min(1.5, Number(e.target.value) || 0.2)),
                          }))
                        }
                        className="w-20 rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-center font-mono text-[12.5px] text-ink focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={() => void handleResetAuto()}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Auto
                    </Button>
                    <Button variant="primary" onClick={() => void handleSaveAndApply()}>
                      Save &amp; Restart
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "performance" && (
            <div className="space-y-5">
              <h2 className="text-[18px] font-semibold text-ink">Performance</h2>

              <div className="flex items-center justify-between gap-4 rounded-[12px] border border-border bg-[#161618] px-4 py-3">
                <span className="text-[13.5px] font-medium text-ink">
                  Monitor Interval (ms)
                </span>
                <input
                  type="number"
                  min={500}
                  max={10000}
                  step={250}
                  value={config.monitor_interval_ms}
                  onChange={(e) =>
                    void updateConfig({
                      monitor_interval_ms: Math.max(500, Number(e.target.value) || 1000),
                    })
                  }
                  className="w-24 rounded-full border border-border bg-[#1E1E22] px-3 py-1 text-center font-mono text-[12.5px] text-ink focus:outline-none"
                />
              </div>

              <div className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618] text-[12.5px]">
                <div className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-muted">CPU</span>
                  <span className="text-right font-mono text-ink">
                    {hardware.cpu_name} ({hardware.physical_cores}C/{hardware.logical_cores}T)
                  </span>
                </div>
                <div className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-muted">RAM</span>
                  <span className="font-mono text-ink">
                    {formatMbDetailed(hardware.available_ram_mb)} /{" "}
                    {formatMbDetailed(hardware.total_ram_mb)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-muted">GPU</span>
                  <span className="text-right font-mono text-ink">
                    {hardware.gpus[0]
                      ? `${hardware.gpus[0].name} (${formatMbDetailed(
                          hardware.gpus[0].vram_total_mb
                        )})`
                      : "None"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === "shortcuts" && (
            <div className="space-y-5">
              <h2 className="text-[18px] font-semibold text-ink">Shortcuts</h2>

              <div className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618]">
                {[
                  { action: "Search Conversations", keys: "Ctrl + K" },
                  { action: "Toggle Sidebar", keys: "Ctrl + B" },
                  { action: "Send / Approve", keys: "Enter" },
                  { action: "New Line", keys: "Shift + Enter" },
                  { action: "Stop / Reject", keys: "Esc" },
                ].map((sc) => (
                  <div
                    key={sc.action}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <span className="text-[13.5px] font-medium text-ink">{sc.action}</span>
                    <kbd className="rounded-md border border-border bg-[#1E1E22] px-2.5 py-0.5 font-mono text-[11.5px] text-ink">
                      {sc.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "about" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <BrandLogo size="md" />
                <span className="rounded-full border border-border bg-[#1E1E22] px-2.5 py-0.5 font-mono text-[11.5px] text-muted">
                  v{updateInfo?.current_version ?? "0.2.0"}
                </span>
              </div>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Updates</div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-[#161618] px-4 py-3 text-[13px]">
                  <div className="min-w-0">
                    {updateInfo?.update_available ? (
                      <div className="font-medium text-accent">
                        Update available: v{updateInfo.latest_version}
                      </div>
                    ) : updateInfo?.checked ? (
                      <div className="text-ink">
                        You&apos;re up to date (v{updateInfo.current_version})
                      </div>
                    ) : (
                      <div className="text-muted">
                        Check GitHub Releases for a newer version of LocalAI.exe
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={checkingUpdate}
                      onClick={() => void checkForUpdates(true)}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${checkingUpdate ? "animate-spin" : ""}`}
                      />
                      {checkingUpdate ? "Checking…" : "Check for Updates"}
                    </Button>
                    {updateInfo?.update_available && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void openExternalUrl(updateInfo.download_url)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Features</div>
                <ul className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618] text-[13px] text-ink">
                  <li className="px-4 py-2.5">100% offline GGUF coding agent (CPU &amp; GPU)</li>
                  <li className="px-4 py-2.5">Multi-workspace &amp; independent concurrent sessions</li>
                  <li className="px-4 py-2.5">Sandboxed diffs, Ask/Auto/Chat modes &amp; shell tools</li>
                  <li className="px-4 py-2.5">Live CPU, RAM, GPU, tok/s &amp; context monitor</li>
                </ul>
              </div>

              <div>
                <div className="mb-2 text-[12.5px] font-medium text-muted">Developer</div>
                <div className="divide-y divide-border/70 rounded-[12px] border border-border bg-[#161618] text-[13px]">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted">Developed by</span>
                    <span className="font-medium text-ink">Anees Sarwar</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted">LinkedIn</span>
                    <button
                      type="button"
                      onClick={() =>
                        void openExternalUrl("https://www.linkedin.com/in/anees-sarwar/")
                      }
                      className="inline-flex items-center gap-1.5 font-medium text-[#60A5FA] hover:underline"
                    >
                      <span>Anees Sarwar | Linkedin</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
