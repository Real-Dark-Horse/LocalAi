import React, { useEffect, useRef } from "react";
import { useStatsStore } from "../../store/statsStore";
import { formatContextSize, formatMbDetailed } from "../../lib/format";
import { Sparkline } from "../ui/Sparkline";

interface PerfPopoverProps {
  onClose: () => void;
}

export const PerfPopover: React.FC<PerfPopoverProps> = ({ onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const hardware = useStatsStore((s) => s.hardware);
  const history = useStatsStore((s) => s.history);
  const latest = useStatsStore((s) => s.latest);
  const timings = useStatsStore((s) => s.timings);
  const contextUsed = useStatsStore((s) => s.contextUsed);
  const contextLimit = useStatsStore((s) => s.contextLimit);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const cpuSeries = history.map((s) => s.cpu_percent);
  const ramSeries = history.map((s) =>
    s.ram_total_mb > 0 ? (s.ram_used_mb / s.ram_total_mb) * 100 : 0
  );
  const gpuSeries = history.map((s) => s.gpu_percent ?? 0);
  const vramSeries = history.map((s) =>
    s.vram_total_mb && s.vram_used_mb
      ? (s.vram_used_mb / s.vram_total_mb) * 100
      : 0
  );

  const gpu = hardware.gpus[0];

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-40 mb-2 w-[340px] rounded-[12px] border border-border bg-card p-3.5 text-[12px]"
    >
      <div className="mb-2.5 flex items-center justify-between border-b border-border pb-2">
        <span className="font-semibold text-ink">System & Inference Monitor</span>
        <span className="text-[11px] text-muted">1s live</span>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-ink">
              CPU <span className="font-mono">{Math.round(latest.cpu_percent)}%</span>
            </div>
            <div className="truncate text-[11px] text-muted">
              {hardware.cpu_name} · {hardware.physical_cores}C/{hardware.logical_cores}T
            </div>
          </div>
          <Sparkline values={cpuSeries} color="#3B82F6" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-ink">
              RAM{" "}
              <span className="font-mono">
                {(latest.ram_used_mb / 1024).toFixed(1)} /{" "}
                {(latest.ram_total_mb / 1024).toFixed(0)} GB
              </span>
            </div>
          </div>
          <Sparkline values={ramSeries} color="#22C55E" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-ink">
              GPU{" "}
              <span className="font-mono">
                {latest.gpu_percent !== null ? `${Math.round(latest.gpu_percent)}%` : "n/a"}
              </span>
            </div>
            <div className="truncate text-[11px] text-muted">
              {gpu ? gpu.name : "No dedicated GPU"}
            </div>
          </div>
          <Sparkline values={gpuSeries} color="#F59E0B" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-ink">
              VRAM{" "}
              <span className="font-mono">
                {latest.vram_used_mb !== null && latest.vram_total_mb !== null
                  ? `${(latest.vram_used_mb / 1024).toFixed(1)} / ${(
                      latest.vram_total_mb / 1024
                    ).toFixed(0)} GB`
                  : "n/a"}
              </span>
            </div>
          </div>
          <Sparkline values={vramSeries} color="#A855F7" />
        </div>
      </div>

      <div className="mt-3 space-y-1 border-t border-border pt-2.5 text-[11.5px]">
        <div className="flex justify-between text-ink">
          <span className="text-muted">AI</span>
          <span className="font-mono">
            {timings
              ? `${timings.predicted_per_second.toFixed(1)} tok/s · ${Math.round(
                  timings.prompt_per_second
                )} prompt · ctx ${formatContextSize(contextUsed)}/${formatContextSize(
                  contextLimit
                )}`
              : "idle"}
          </span>
        </div>
        <div className="flex justify-between text-ink">
          <span className="text-muted">Server</span>
          <span className="font-mono">
            {latest.server_proc
              ? `CPU ${Math.round(latest.server_proc.cpu_percent)}% · RAM ${formatMbDetailed(
                  latest.server_proc.ram_mb
                )}`
              : "stopped"}
          </span>
        </div>
      </div>
    </div>
  );
};
