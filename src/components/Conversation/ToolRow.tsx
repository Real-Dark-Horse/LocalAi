import React, { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  FilePlus2,
  FileText,
  FolderTree,
  Pencil,
  Search,
  Terminal,
  X,
} from "lucide-react";
import type { ToolRowItem } from "../../types";
import { DiffView } from "./DiffView";
import { ApprovalBar } from "./ApprovalBar";

interface ToolRowProps {
  blockId: string;
  row: ToolRowItem;
  onApprove: (blockId: string, rowId: string) => void;
  onReject: (blockId: string, rowId: string) => void;
}

export const ToolRow: React.FC<ToolRowProps> = React.memo(
  ({ blockId, row, onApprove, onReject }) => {
  const [expanded, setExpanded] = useState(row.status === "needs_approval");

  useEffect(() => {
    if (row.status === "needs_approval") {
      setExpanded(true);
    }
  }, [row.status]);

  const iconMap = {
    run: <Terminal className="h-3.5 w-3.5 text-muted" />,
    read: <FileText className="h-3.5 w-3.5 text-muted" />,
    search: <Search className="h-3.5 w-3.5 text-muted" />,
    edit: <Pencil className="h-3.5 w-3.5 text-muted" />,
    create: <FilePlus2 className="h-3.5 w-3.5 text-muted" />,
    list: <FolderTree className="h-3.5 w-3.5 text-muted" />,
  };

  const statusBadge = () => {
    switch (row.status) {
      case "running":
        return <Circle className="h-2.5 w-2.5 fill-accent text-accent animate-pulse" />;
      case "done":
        return <Check className="h-3.5 w-3.5 text-success" />;
      case "error":
      case "rejected":
      case "stopped":
        return <X className="h-3.5 w-3.5 text-danger" />;
      case "needs_approval":
        return <Circle className="h-2.5 w-2.5 fill-warning text-warning" />;
    }
  };

  const hasDetails = Boolean(row.diff || row.output || row.status === "needs_approval");

  return (
    <div className="border-t border-border/70 first:border-t-0">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-hover/70 transition-colors"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {iconMap[row.kind]}
          <span className="shrink-0 text-[13px] font-semibold text-ink">
            {row.verb}
          </span>
          <span className="truncate font-mono text-[12.5px] text-muted">
            {row.target}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {row.diff && (
            <span className="font-mono text-[12px]">
              <span className="text-success">+{row.diff.added}</span>
              {row.diff.removed > 0 && (
                <span className="ml-1.5 text-danger">-{row.diff.removed}</span>
              )}
            </span>
          )}
          {statusBadge()}
          {hasDetails && (
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
          )}
        </div>
      </button>

      {expanded && hasDetails && (
        <div className="px-3 pb-3 pt-1">
          {row.diff && (
            <DiffView oldText={row.diff.oldText} newText={row.diff.newText} />
          )}
          {row.output && !row.diff && (
            <pre className="max-h-[240px] overflow-auto rounded-md border border-border bg-[#141414] p-2.5 font-mono text-[12px] text-ink/90 whitespace-pre-wrap break-words">
              {row.output}
            </pre>
          )}
          {row.status === "needs_approval" && (
            <ApprovalBar
              dangerous={row.dangerous}
              onApprove={() => onApprove(blockId, row.id)}
              onReject={() => onReject(blockId, row.id)}
            />
          )}
        </div>
      )}
    </div>
  );
});

ToolRow.displayName = "ToolRow";
