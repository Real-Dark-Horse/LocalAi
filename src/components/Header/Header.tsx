import React from "react";
import { MoreHorizontal, PanelLeft } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { GENERAL_CHAT_WORKSPACE_ID, useWorkspaceStore } from "../../store/workspaceStore";
import { useChatStore } from "../../store/chatStore";
import { openInExplorer } from "../../lib/tauri";
import { Menu } from "../ui/Menu";

export const Header: React.FC = () => {
  const sidebarCollapsed = useAppStore((s) => s.config.sidebar_collapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const pushToast = useAppStore((s) => s.pushToast);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const conversationsByWs = useWorkspaceStore((s) => s.conversationsByWorkspace);
  const renameConversation = useWorkspaceStore((s) => s.renameConversation);
  const deleteConversation = useWorkspaceStore((s) => s.deleteConversation);
  const activeConv = useChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId] ?? null : null
  );

  const mode = useAppStore((s) => s.mode);
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const summaryWsId = activeWs?.id ?? activeWorkspaceId ?? GENERAL_CHAT_WORKSPACE_ID;
  const activeSummaryResolved = activeConversationId
    ? (conversationsByWs[summaryWsId] ?? []).find((c) => c.id === activeConversationId) ?? null
    : null;
  const effectiveWsId = activeWs?.id ?? activeSummaryResolved?.workspace_id ?? activeWorkspaceId;

  const handleRename = () => {
    const targetWsId = effectiveWsId ?? GENERAL_CHAT_WORKSPACE_ID;
    if (!activeSummaryResolved) return;
    const next = window.prompt("Rename conversation", activeSummaryResolved.title);
    if (next && next.trim()) {
      void renameConversation(targetWsId, activeSummaryResolved.id, next.trim());
    }
  };

  const handleExportMarkdown = () => {
    if (!activeConv) return;
    const parts: string[] = [`# ${activeConv.title}\n`];
    for (const blk of activeConv.ui_events) {
      if (blk.type === "user") {
        parts.push(`## User\n\n${blk.content}\n`);
      } else if (blk.type === "thinking") {
        parts.push(`> *${blk.content}*\n`);
      } else if (blk.type === "assistant") {
        parts.push(`## Assistant\n\n${blk.content}\n`);
      } else if (blk.type === "tool_group") {
        const lines = blk.rows.map((r) => `- **${r.verb}** \`${r.target}\` (${r.status})`);
        parts.push(`### Tool calls\n\n${lines.join("\n")}\n`);
      }
    }
    const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeConv.title.replace(/[^a-z0-9-_]+/gi, "_") || "conversation"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="flex h-[44px] shrink-0 items-center justify-between border-b border-border bg-app px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            title="Expand sidebar (Ctrl+B)"
            className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
          <span className="shrink-0 font-medium text-muted">
            {activeWs
              ? activeWs.name
              : activeWorkspaceId === GENERAL_CHAT_WORKSPACE_ID || mode === "chat"
                ? "General Chat"
                : "No workspace"}
          </span>
          {activeSummaryResolved && (
            <>
              <span className="text-muted/60">/</span>
              <span className="truncate font-medium text-ink">
                {activeSummaryResolved.title}
              </span>
            </>
          )}
        </div>
      </div>

      {(activeWs || activeSummaryResolved) && (
        <Menu
          trigger={
            <button
              type="button"
              title="Conversation actions"
              className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
          items={[
            ...(activeSummaryResolved
              ? [
                  {
                    label: "Rename",
                    onClick: handleRename,
                  },
                  {
                    label: "Export as Markdown",
                    onClick: handleExportMarkdown,
                  },
                ]
              : []),
            ...(activeWs
              ? [
                  {
                    label: "Open project folder",
                    onClick: () => {
                      openInExplorer(activeWs.path).catch((err) =>
                        pushToast("error", String(err))
                      );
                    },
                  },
                ]
              : []),
            ...(activeSummaryResolved
              ? [
                  {
                    label: "Delete",
                    danger: true,
                    dividerBefore: true,
                    onClick: () =>
                      void deleteConversation(
                        effectiveWsId ?? GENERAL_CHAT_WORKSPACE_ID,
                        activeSummaryResolved.id
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </header>
  );
};
