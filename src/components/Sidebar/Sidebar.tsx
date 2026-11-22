import React from "react";
import { PanelLeft, Plus } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { GENERAL_CHAT_WORKSPACE_ID, useWorkspaceStore } from "../../store/workspaceStore";
import { isTauri, pickFolder } from "../../lib/tauri";
import { BrandLogo } from "../ui/BrandLogo";
import { SidebarNav } from "./SidebarNav";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { ConversationItem } from "./ConversationItem";
import { SidebarFooter } from "./SidebarFooter";

export const Sidebar: React.FC = () => {
  const collapsed = useAppStore((s) => s.config.sidebar_collapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setMode = useAppStore((s) => s.setMode);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const conversationsByWs = useWorkspaceStore((s) => s.conversationsByWorkspace);
  const totalByWs = useWorkspaceStore((s) => s.totalByWorkspace);
  const visibleLimit = useWorkspaceStore(
    (s) => s.visibleCountByWorkspace[GENERAL_CHAT_WORKSPACE_ID] ?? 5
  );
  const loadMoreConversations = useWorkspaceStore((s) => s.loadMoreConversations);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const createConversation = useWorkspaceStore((s) => s.createConversation);

  const generalChats = conversationsByWs[GENERAL_CHAT_WORKSPACE_ID] ?? [];
  const generalTotal = totalByWs[GENERAL_CHAT_WORKSPACE_ID] ?? generalChats.length;
  const visibleGeneralChats = isTauri()
    ? generalChats
    : generalChats.slice(0, visibleLimit);
  const generalRemaining = isTauri()
    ? Math.max(0, generalTotal - generalChats.length)
    : Math.max(0, generalChats.length - visibleGeneralChats.length);

  const handleNewGeneralChat = async () => {
    setMode("chat");
    await createConversation(GENERAL_CHAT_WORKSPACE_ID);
  };

  const handleAddWorkspace = async () => {
    const path = await pickFolder("Add Project Workspace");
    if (path) {
      const ws = await addWorkspace(path);
      if (ws) {
        await createConversation(ws.id);
      }
    }
  };

  return (
    <aside
      aria-hidden={collapsed}
      className={`h-full shrink-0 overflow-hidden bg-sidebar select-none transition-[width,opacity] duration-200 ease-out ${
        collapsed
          ? "w-0 opacity-0 border-r-0 pointer-events-none"
          : "w-[240px] opacity-100 border-r border-border"
      }`}
    >
      <div className="flex h-full w-[240px] flex-col">
        {/* Top logo + collapse */}
        <div className="flex h-[44px] items-center justify-between px-3">
          <BrandLogo size="sm" />
          <button
            type="button"
            onClick={toggleSidebar}
            title="Collapse sidebar (Ctrl+B)"
            className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Primary actions */}
        <SidebarNav />

        {/* Chats & Workspaces list */}
        <div className="mt-3 flex-1 space-y-4 overflow-y-auto px-2 pb-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold tracking-wider text-muted">
                CHATS
              </span>
              <button
                type="button"
                onClick={() => void handleNewGeneralChat()}
                title="New general chat (no workspace)"
                className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {visibleGeneralChats.length > 0 ? (
              <div className="space-y-0.5">
                {visibleGeneralChats.map((conv) => (
                  <ConversationItem key={conv.id} summary={conv} />
                ))}
                {generalRemaining > 0 && (
                  <button
                    type="button"
                    onClick={() => void loadMoreConversations(GENERAL_CHAT_WORKSPACE_ID)}
                    className="w-full rounded-sidebar px-2 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-ink transition-colors"
                  >
                    Load {Math.min(5, generalRemaining)} more chats
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleNewGeneralChat()}
                className="w-full rounded-sidebar px-2 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-ink transition-colors"
              >
                Start a general chat…
              </button>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold tracking-wider text-muted">
                WORKSPACES
              </span>
              <button
                type="button"
                onClick={handleAddWorkspace}
                title="Add project folder"
                className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              {workspaces.map((ws) => (
                <WorkspaceGroup key={ws.id} workspace={ws} />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <SidebarFooter />
      </div>
    </aside>
  );
};
