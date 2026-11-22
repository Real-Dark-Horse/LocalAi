import React, { useRef } from "react";
import { Activity } from "lucide-react";
import { useStatsStore } from "../../store/statsStore";
import { formatMbAsGb } from "../../lib/format";
import { PerfPopover } from "../Overlays/PerfPopover";

function levelColor(pct: number | null): string {
  if (pct === null) return "text-muted";
  if (pct < 60) return "text-success";
  if (pct <= 85) return "text-warning";
  return "text-danger";
}

export const PerfPill: React.FC = React.memo(() => {
  const latest = useStatsStore((s) => s.latest);
  const timings = useStatsStore((s) => s.timings);
  const liveTokPerSec = useStatsStore((s) => s.liveTokPerSec);
  const popoverOpen = useStatsStore((s) => s.popoverOpen);
  const setPopoverOpen = useStatsStore((s) => s.setPopoverOpen);
  const pillRef = useRef<HTMLDivElement>(null);

  const tokPerSec = liveTokPerSec ?? timings?.predicted_per_second ?? null;

  const ramPct =
    latest.ram_total_mb > 0
      ? (latest.ram_used_mb / latest.ram_total_mb) * 100
      : 0;

  return (
    <div ref={pillRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setPopoverOpen(!popoverOpen)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-[#171717] px-2 py-1 text-[11.5px] font-mono hover:bg-hover transition-colors"
        title="System & Inference Monitor"
      >
        <Activity className="h-3 w-3 text-muted" />
        <span className="text-muted">
          CPU{" "}
          <span className={levelColor(latest.cpu_percent)}>
            {Math.round(latest.cpu_percent)}%
          </span>
        </span>
        <span className="text-muted">
          RAM{" "}
          <span className={levelColor(ramPct)}>
            {formatMbAsGb(latest.ram_used_mb)}
          </span>
        </span>
        <span className="text-muted">
          GPU{" "}
          <span className={levelColor(latest.gpu_percent)}>
            {latest.gpu_percent !== null
              ? `${Math.round(latest.gpu_percent)}%`
              : "n/a"}
          </span>
        </span>
        {tokPerSec !== null && tokPerSec > 0 && (
          <span className="text-ink/90 border-l border-border pl-2">
            {tokPerSec.toFixed(1)} <span className="text-muted">tok/s</span>
          </span>
        )}
      </button>

      {popoverOpen && <PerfPopover onClose={() => setPopoverOpen(false)} />}
    </div>
  );
});

PerfPill.displayName = "PerfPill";
