import React, { useEffect } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "../ui/Button";

interface ApprovalBarProps {
  dangerous?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export const ApprovalBar: React.FC<ApprovalBarProps> = ({
  dangerous,
  onApprove,
  onReject,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onApprove();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onReject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onApprove, onReject]);

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <div className="flex items-center gap-2 text-[12.5px]">
        {dangerous ? (
          <span className="inline-flex items-center gap-1 rounded bg-danger/20 px-2 py-0.5 font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" />
            Dangerous command
          </span>
        ) : (
          <span className="text-warning font-medium">Waiting for approval</span>
        )}
        <span className="text-[11.5px] text-muted">Enter to approve · Esc to reject</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onReject}>
          <X className="h-3.5 w-3.5" />
          Reject
        </Button>
        <Button variant="primary" size="sm" onClick={onApprove}>
          <Check className="h-3.5 w-3.5" />
          Approve
        </Button>
      </div>
    </div>
  );
};
