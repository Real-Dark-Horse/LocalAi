import React, { useState } from "react";
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Plus } from "lucide-react";
import type { Workspace } from "../../types";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useAppStore } from "../../store/appStore";
import { isTauri, openInExplorer } from "../../lib/tauri";
import { Menu } from "../ui/Menu";
import { ConversationItem } from "./ConversationItem";

interface WorkspaceGroupProps {
  workspace: Workspace;
}

export const WorkspaceGroup: React.FC<WorkspaceGroupProps> = ({ workspace }) => {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);

  const toggleWorkspaceCollapse = useWorkspaceStore((s) => s.toggleWorkspaceCollapse);
  const conversations = useWorkspaceStore(
    (s) => s.conversationsByWorkspace[workspace.id] ?? []
  );
  const totalCount = useWorkspaceStore(
    (s) => s.totalByWorkspace[workspace.id] ?? conversations.length
  );
  const visibleLimit = useWorkspaceStore(
    (s) => s.visibleCountByWorkspace[workspace.id] ?? 5
  );
  const loadMoreConversations = useWorkspaceStore((s) => s.loadMoreConversations);
  const createConversation = useWorkspaceStore((s) => s.createConversation);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const pushToast = useAppStore((s) => s.pushToast);

  const visibleConversations = isTauri()
    ? conversations
    : conversations.slice(0, visibleLimit);
  const remaining = isTauri()
    ? Math.max(0, totalCount - conversations.length)
    : Math.max(0, conversations.length - visibleConversations.length);

  const handleNewInWorkspace = (e: React.MouseEvent) => {
    e.stopPropagation();
    void createConversation(workspace.id);
  };

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== workspace.name) {
      void renameWorkspace(workspace.id, trimmed);
    } else {
      setDraftName(workspace.name);
    }
    setRenaming(false);
  };

  return (
    <div>
      <div
        onClick={() => toggleWorkspaceCollapse(workspace.id)}
        className={`group flex cursor-pointer items-center justify-between rounded-sidebar px-2 py-1.5 hover:bg-hover transition-colors ${
          workspace.missing ? "opacity-55" : ""
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted" />
          {renaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraftName(workspace.name);
                  setRenaming(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded bg-card px-1.5 py-0.5 text-[13px] text-ink outline-none ring-1 ring-accent"
            />
          ) : (
            <span className="truncate text-[13px] font-medium text-ink">
              {workspace.name}
            </span>
          )}
          {workspace.missing && (
            <span className="shrink-0 rounded bg-warning/15 px-1 py-0.5 text-[10px] text-warning">
              Folder missing
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={handleNewInWorkspace}
            title="New conversation"
            className="hidden rounded p-0.5 text-muted hover:bg-selected hover:text-ink group-hover:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div className="hidden group-hover:inline-flex">
            <Menu
              trigger={
                <button
                  type="button"
                  title="Workspace options"
                  className="rounded p-0.5 text-muted hover:bg-selected hover:text-ink"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              }
              items={[
                {
                  label: "Open in Explorer",
                  onClick: () => {
                    openInExplorer(workspace.path).catch((err) =>
                      pushToast("error", String(err))
                    );
                  },
                },
                {
                  label: "Rename",
                  onClick: () => {
                    setDraftName(workspace.name);
                    setRenaming(true);
                  },
                },
                {
                  label: "Remove from list",
                  danger: true,
                  dividerBefore: true,
                  onClick: () => void removeWorkspace(workspace.id),
                },
              ]}
            />
          </div>
          {workspace.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted" />
          )}
        </div>
      </div>

      {!workspace.collapsed && (
        <div className="mt-0.5 space-y-0.5 pl-4">
          {visibleConversations.length === 0 ? (
            <div className="px-2 py-1 text-[12px] text-muted">
              No conversations yet
            </div>
          ) : (
            <>
              {visibleConversations.map((conv) => (
                <ConversationItem key={conv.id} summary={conv} />
              ))}
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={() => void loadMoreConversations(workspace.id)}
                  className="w-full rounded-sidebar px-2 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-ink transition-colors"
                >
                  Load {Math.min(5, remaining)} more conversations
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
