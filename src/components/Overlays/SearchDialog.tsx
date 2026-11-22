import React, { useEffect, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { GENERAL_CHAT_WORKSPACE_ID, useWorkspaceStore } from "../../store/workspaceStore";
import { formatRelativeTime } from "../../lib/format";
import { isTauri, searchConversations } from "../../lib/tauri";
import { Dialog } from "../ui/Dialog";

interface SearchResultItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  updatedAt: string;
  snippet?: string | null;
}

export const SearchDialog: React.FC = () => {
  const open = useAppStore((s) => s.showSearch);
  const setOpen = useAppStore((s) => s.setShowSearch);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const conversationsByWs = useWorkspaceStore((s) => s.conversationsByWorkspace);
  const setActiveConversation = useWorkspaceStore((s) => s.setActiveConversation);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const run = async () => {
      const wsMap = new Map(workspaces.map((w) => [w.id, w.name]));
      wsMap.set(GENERAL_CHAT_WORKSPACE_ID, "General Chat");
      if (isTauri()) {
        try {
          const hits = await searchConversations(query);
          if (!cancelled) {
            setResults(
              hits.map((h) => ({
                id: h.id,
                workspaceId: h.workspace_id,
                workspaceName: wsMap.get(h.workspace_id) ?? "General Chat",
                title: h.title,
                updatedAt: h.updated_at,
                snippet: h.snippet,
              }))
            );
          }
          return;
        } catch {
          // Fallback to in-memory filter
        }
      }

      const q = query.trim().toLowerCase();
      const all: SearchResultItem[] = [];
      for (const conv of conversationsByWs[GENERAL_CHAT_WORKSPACE_ID] ?? []) {
        if (!q || conv.title.toLowerCase().includes(q) || "general chat".includes(q)) {
          all.push({
            id: conv.id,
            workspaceId: GENERAL_CHAT_WORKSPACE_ID,
            workspaceName: "General Chat",
            title: conv.title,
            updatedAt: conv.updated_at,
          });
        }
      }
      for (const ws of workspaces) {
        for (const conv of conversationsByWs[ws.id] ?? []) {
          if (
            !q ||
            conv.title.toLowerCase().includes(q) ||
            ws.name.toLowerCase().includes(q)
          ) {
            all.push({
              id: conv.id,
              workspaceId: ws.id,
              workspaceName: ws.name,
              title: conv.title,
              updatedAt: conv.updated_at,
            });
          }
        }
      }
      if (!cancelled) setResults(all.slice(0, 50));
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, query, workspaces, conversationsByWs]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidthClass="max-w-lg">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Search className="h-4 w-4 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations…"
          className="w-full bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
        />
      </div>
      <div className="max-h-[340px] overflow-y-auto p-2">
        {results.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-muted">
            No matching conversations
          </div>
        ) : (
          results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                void setActiveConversation(item.workspaceId, item.id);
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-hover transition-colors"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <MessageSquare className="h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium text-ink">
                    {item.title}
                  </div>
                  <div className="truncate text-[11.5px] text-muted">
                    {item.workspaceName}
                    {item.snippet ? ` · ${item.snippet}` : ""}
                  </div>
                </div>
              </div>
              <span className="shrink-0 text-[11.5px] text-muted">
                {formatRelativeTime(item.updatedAt)}
              </span>
            </button>
          ))
        )}
      </div>
    </Dialog>
  );
};
