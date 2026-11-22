import React from "react";
import { ChevronDown } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useStatsStore } from "../../store/statsStore";
import { formatContextSize } from "../../lib/format";
import { pickFolder } from "../../lib/tauri";
import { Menu } from "../ui/Menu";
import { LoadingAnimation } from "../ui/LoadingAnimation";

function pieColor(pct: number): string {
  if (pct >= 90) return "#EF4444";
  if (pct >= 70) return "#F59E0B";
  return "#3B82F6";
}

const ContextPie: React.FC<{ used: number; limit: number }> = ({ used, limit }) => {
  const safeLimit = limit > 0 ? limit : 8192;
  const pct = Math.max(0, Math.min(100, (used / safeLimit) * 100));
  const color = pieColor(pct);
  const r = 5;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className="group/pie relative inline-flex items-center">
      <svg width={14} height={14} viewBox="0 0 14 14" className="-rotate-90">
        <circle
          cx={7}
          cy={7}
          r={r}
          fill="none"
          stroke="#3E3E44"
          strokeWidth={3}
        />
        <circle
          cx={7}
          cy={7}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="butt"
        />
      </svg>
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-[#141416] px-2 py-1 font-mono text-[11px] text-ink shadow-md group-hover/pie:block">
        ctx {formatContextSize(used)}/{formatContextSize(safeLimit)} ({Math.round(pct)}%)
      </div>
    </div>
  );
};

export const ModelSelect: React.FC = () => {
  const models = useAppStore((s) => s.models);
  const selectedFilename = useAppStore((s) => s.selectedModelFilename);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setModelsDir = useAppStore((s) => s.setModelsDir);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const serverStatus = useAppStore((s) => s.serverStatus);
  const overrides = useAppStore((s) => s.config.model_overrides);
  const contextUsed = useStatsStore((s) => s.contextUsed);
  const contextLimitStore = useStatsStore((s) => s.contextLimit);

  const active =
    models.find((m) => m.filename === selectedFilename) ?? models[0] ?? null;

  const ctx = active
    ? overrides[active.filename]?.context ?? active.auto_settings.context
    : contextLimitStore;

  const dotColor =
    serverStatus.state === "ready"
      ? "bg-success"
      : serverStatus.state === "loading"
        ? "bg-warning animate-pulse"
        : serverStatus.state === "error"
          ? "bg-danger"
          : "bg-muted";

  const handleChangeFolder = async () => {
    const folder = await pickFolder("Choose Models Folder");
    if (folder) {
      await setModelsDir(folder);
    }
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      {active && <ContextPie used={contextUsed} limit={ctx} />}
      <Menu
        align="right"
        direction="up"
        trigger={
          <button
            type="button"
            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-ink/90 hover:bg-hover transition-colors"
            title={active ? `${active.filename} (${serverStatus.state})` : "No model selected"}
          >
            {serverStatus.state === "loading" ? (
              <LoadingAnimation size={14} className="text-warning" />
            ) : (
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
            )}
            <span className="truncate font-medium">
              {active ? active.name : "Select model"}
            </span>
            {active && (
              <span className="shrink-0 text-[11.5px] text-muted">
                · {formatContextSize(ctx)}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
          </button>
        }
        items={[
          ...models.map((m) => ({
            label: `${m.name}${m.quantization ? ` (${m.quantization})` : ""}`,
            description: "Chat / Code",
            active: active?.filename === m.filename,
            onClick: () => setSelectedModel(m.filename),
          })),
          {
            label: "Model settings…",
            dividerBefore: models.length > 0,
            onClick: () => setShowSettings(true),
          },
          {
            label: "Change models folder…",
            onClick: handleChangeFolder,
          },
        ]}
      />
    </div>
  );
};
