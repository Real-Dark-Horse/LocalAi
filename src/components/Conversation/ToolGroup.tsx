import React from "react";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import type { ToolRowItem } from "../../types";
import { useChatStore } from "../../store/chatStore";
import { ToolRow } from "./ToolRow";

interface ToolGroupProps {
  blockId: string;
  rows: ToolRowItem[];
  collapsed?: boolean;
}

export const ToolGroup: React.FC<ToolGroupProps> = React.memo(
  ({ blockId, rows, collapsed = false }) => {
  const toggleToolGroupCollapse = useChatStore((s) => s.toggleToolGroupCollapse);
  const approveToolRow = useChatStore((s) => s.approveToolRow);
  const rejectToolRow = useChatStore((s) => s.rejectToolRow);

  const hasApproval = rows.some((r) => r.status === "needs_approval");
  const hasRunning = rows.some((r) => r.status === "running");
  const hasError = rows.some(
    (r) => r.status === "error" || r.status === "rejected" || r.status === "stopped"
  );

  const dotClass = hasApproval
    ? "bg-warning"
    : hasRunning
      ? "bg-accent animate-pulse"
      : hasError
        ? "bg-danger"
        : "bg-success";

  const statusText = hasApproval
    ? "needs approval"
    : hasRunning
      ? "running"
      : hasError
        ? "finished with issues"
        : "done";

  const label = `${rows.length} ${rows.length === 1 ? "tool call" : "tool calls"}`;

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      <button
        type="button"
        onClick={() => toggleToolGroupCollapse(blockId)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-hover/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-[13px]">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <ListChecks className="h-3.5 w-3.5 text-muted" />
          <span className="font-medium text-ink">{label}</span>
          <span className="text-muted">· {statusText}</span>
        </div>
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-border">
          {rows.map((row) => (
            <ToolRow
              key={row.id}
              blockId={blockId}
              row={row}
              onApprove={approveToolRow}
              onReject={rejectToolRow}
            />
          ))}
        </div>
      )}
    </div>
  );
});

ToolGroup.displayName = "ToolGroup";
