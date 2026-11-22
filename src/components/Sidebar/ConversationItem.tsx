import React, { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ConversationSummary } from "../../types";
import { formatRelativeTime } from "../../lib/format";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useChatStore } from "../../store/chatStore";
import { Menu } from "../ui/Menu";
import { LoadingAnimation } from "../ui/LoadingAnimation";

interface ConversationItemProps {
  summary: ConversationSummary;
}

export const ConversationItem: React.FC<ConversationItemProps> = ({ summary }) => {
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(summary.title);

  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const runningIds = useWorkspaceStore((s) => s.runningConversationIds);
  const setActiveConversation = useWorkspaceStore((s) => s.setActiveConversation);
  const renameConversation = useWorkspaceStore((s) => s.renameConversation);
  const deleteConversation = useWorkspaceStore((s) => s.deleteConversation);
  const isConvRunning = useChatStore(
    (s) => Boolean(s.runsByConversation[summary.id]?.isRunning)
  );

  const isSelected = activeConversationId === summary.id;
  const isRunning = Boolean(runningIds[summary.id]) || isConvRunning;

  const commitRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== summary.title) {
      void renameConversation(summary.workspace_id, summary.id, trimmed);
    } else {
      setDraftTitle(summary.title);
    }
    setRenaming(false);
  };

  return (
    <div
      onClick={() => void setActiveConversation(summary.workspace_id, summary.id)}
      className={`group flex cursor-pointer items-center justify-between gap-2 rounded-sidebar px-2 py-1.5 text-[13px] transition-colors ${
        isSelected ? "bg-selected text-ink" : "text-ink/85 hover:bg-hover"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {isRunning && <LoadingAnimation size={15} className="text-accent" />}
        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraftTitle(summary.title);
                setRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded bg-card px-1.5 py-0.5 text-[12.5px] text-ink outline-none ring-1 ring-accent"
          />
        ) : (
          <span className="truncate">{summary.title}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <span className="text-[11px] text-muted group-hover:hidden">
          {formatRelativeTime(summary.updated_at)}
        </span>
        <div className="hidden group-hover:inline-flex">
          <Menu
            trigger={
              <button
                type="button"
                title="Conversation options"
                className="rounded p-0.5 text-muted hover:bg-card hover:text-ink"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
            items={[
              {
                label: "Rename",
                onClick: () => {
                  setDraftTitle(summary.title);
                  setRenaming(true);
                },
              },
              {
                label: "Delete",
                danger: true,
                dividerBefore: true,
                onClick: () =>
                  void deleteConversation(summary.workspace_id, summary.id),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
};
