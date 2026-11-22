import React from "react";
import { PlusCircle, Search } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { GENERAL_CHAT_WORKSPACE_ID, useWorkspaceStore } from "../../store/workspaceStore";

export const SidebarNav: React.FC = () => {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createConversation = useWorkspaceStore((s) => s.createConversation);
  const setShowSearch = useAppStore((s) => s.setShowSearch);

  const handleNewChat = async () => {
    if (
      mode === "chat" ||
      activeWorkspaceId === GENERAL_CHAT_WORKSPACE_ID ||
      (!activeWorkspaceId && workspaces.length === 0)
    ) {
      if (mode !== "chat") {
        setMode("chat");
      }
      await createConversation(GENERAL_CHAT_WORKSPACE_ID);
      return;
    }

    const targetWsId = activeWorkspaceId ?? workspaces[0]?.id ?? null;
    if (targetWsId) {
      await createConversation(targetWsId);
    }
  };

  return (
    <div className="space-y-0.5 px-2 pt-1">
      <button
        type="button"
        onClick={handleNewChat}
        className="flex w-full items-center gap-2.5 rounded-sidebar px-2.5 py-1.5 text-[13.5px] text-ink hover:bg-hover transition-colors"
      >
        <PlusCircle className="h-4 w-4 text-muted" />
        <span>New Chat</span>
      </button>
      <button
        type="button"
        onClick={() => setShowSearch(true)}
        className="flex w-full items-center justify-between rounded-sidebar px-2.5 py-1.5 text-[13.5px] text-ink hover:bg-hover transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <Search className="h-4 w-4 text-muted" />
          <span>Search</span>
        </span>
        <kbd className="rounded bg-card px-1.5 py-0.5 text-[11px] text-muted border border-border">
          Ctrl K
        </kbd>
      </button>
    </div>
  );
};
