import { create } from "zustand";
import type { Conversation, ConversationSummary, Workspace } from "../types";
import { MOCK_SUMMARIES, MOCK_WORKSPACES } from "../lib/mockData";
import {
  addWorkspace as tauriAddWorkspace,
  deleteConversation as tauriDeleteConversation,
  isTauri,
  listConversations,
  listWorkspaces,
  removeWorkspace as tauriRemoveWorkspace,
  renameConversation as tauriRenameConversation,
  saveConversation as tauriSaveConversation,
  updateWorkspace as tauriUpdateWorkspace,
} from "../lib/tauri";
import { useChatStore } from "./chatStore";
import { useAppStore } from "./appStore";

export const GENERAL_CHAT_WORKSPACE_ID = "__chat__";

interface WorkspaceState {
  workspaces: Workspace[];
  conversationsByWorkspace: Record<string, ConversationSummary[]>;
  totalByWorkspace: Record<string, number>;
  visibleCountByWorkspace: Record<string, number>;
  activeWorkspaceId: string | null;
  activeConversationId: string | null;
  runningConversationIds: Record<string, boolean>;

  loadFromBackend: (
    lastWorkspaceId: string | null,
    lastConversationId: string | null
  ) => Promise<void>;
  toggleWorkspaceCollapse: (workspaceId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  setActiveConversation: (workspaceId: string, conversationId: string) => Promise<void>;
  loadMoreConversations: (workspaceId: string) => Promise<void>;
  createConversation: (workspaceId: string) => Promise<string>;
  renameConversation: (workspaceId: string, conversationId: string, title: string) => Promise<void>;
  deleteConversation: (workspaceId: string, conversationId: string) => Promise<void>;
  upsertSummary: (summary: ConversationSummary) => void;
  setConversationRunning: (conversationId: string, running: boolean) => void;
  addWorkspace: (path: string) => Promise<Workspace | null>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: isTauri() ? [] : MOCK_WORKSPACES,
  conversationsByWorkspace: isTauri() ? {} : MOCK_SUMMARIES,
  totalByWorkspace: {},
  visibleCountByWorkspace: {},
  activeWorkspaceId: isTauri() ? null : "ws-my-site",
  activeConversationId: isTauri() ? null : "conv-navbar",
  runningConversationIds: {},

  loadFromBackend: async (lastWsId, lastConvId) => {
    if (!isTauri()) return;
    const list = await listWorkspaces();
    const convMap: Record<string, ConversationSummary[]> = {};
    const totalMap: Record<string, number> = {};

    await Promise.all([
      ...list.map(async (ws) => {
        const page = await listConversations(ws.id, 5, 0);
        convMap[ws.id] = page.items;
        totalMap[ws.id] = page.total;
      }),
      (async () => {
        const page = await listConversations(GENERAL_CHAT_WORKSPACE_ID, 5, 0);
        convMap[GENERAL_CHAT_WORKSPACE_ID] = page.items;
        totalMap[GENERAL_CHAT_WORKSPACE_ID] = page.total;
      })(),
    ]);

    const generalConvs = convMap[GENERAL_CHAT_WORKSPACE_ID] ?? [];
    const activeWs =
      lastWsId === GENERAL_CHAT_WORKSPACE_ID
        ? GENERAL_CHAT_WORKSPACE_ID
        : list.find((w) => w.id === lastWsId)?.id ??
          list[0]?.id ??
          (generalConvs.length > 0 ? GENERAL_CHAT_WORKSPACE_ID : null);
    let activeConv: string | null = null;
    if (activeWs) {
      const wsConvs = convMap[activeWs] ?? [];
      activeConv =
        wsConvs.find((c) => c.id === lastConvId)?.id ?? wsConvs[0]?.id ?? null;
    }

    set({
      workspaces: list,
      conversationsByWorkspace: convMap,
      totalByWorkspace: totalMap,
      activeWorkspaceId: activeWs,
      activeConversationId: activeConv,
    });

    if (activeConv) {
      await useChatStore.getState().selectConversation(activeConv, activeWs);
    }
  },

  toggleWorkspaceCollapse: (workspaceId) => {
    const updated = get().workspaces.map((ws) =>
      ws.id === workspaceId ? { ...ws, collapsed: !ws.collapsed } : ws
    );
    set({ workspaces: updated });
    const target = updated.find((w) => w.id === workspaceId);
    if (target && isTauri()) {
      void tauriUpdateWorkspace(target);
    }
  },

  setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),

  setActiveConversation: async (workspaceId, conversationId) => {
    if (workspaceId === GENERAL_CHAT_WORKSPACE_ID) {
      useAppStore.getState().setMode("chat");
    }
    set({
      activeWorkspaceId: workspaceId,
      activeConversationId: conversationId,
    });
    await useChatStore.getState().selectConversation(conversationId, workspaceId);
    void useAppStore.getState().updateConfig({
      last_workspace_id: workspaceId,
      last_conversation_id: conversationId,
    });
  },

  loadMoreConversations: async (workspaceId) => {
    const currentList = get().conversationsByWorkspace[workspaceId] ?? [];
    if (isTauri()) {
      const page = await listConversations(workspaceId, 5, currentList.length);
      set((s) => ({
        conversationsByWorkspace: {
          ...s.conversationsByWorkspace,
          [workspaceId]: [...currentList, ...page.items],
        },
        totalByWorkspace: {
          ...s.totalByWorkspace,
          [workspaceId]: page.total,
        },
      }));
    } else {
      set((s) => ({
        visibleCountByWorkspace: {
          ...s.visibleCountByWorkspace,
          [workspaceId]: (s.visibleCountByWorkspace[workspaceId] ?? 5) + 5,
        },
      }));
    }
  },

  createConversation: async (workspaceId) => {
    const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const appState = useAppStore.getState();
    const conv: Conversation = {
      id,
      workspace_id: workspaceId,
      title: "New chat",
      created_at: now,
      updated_at: now,
      model: appState.selectedModelFilename,
      mode: appState.mode,
      messages: [],
      ui_events: [],
    };
    const summary: ConversationSummary = {
      id,
      workspace_id: workspaceId,
      title: conv.title,
      created_at: now,
      updated_at: now,
      model: conv.model,
      mode: conv.mode,
    };

    if (isTauri()) {
      await tauriSaveConversation(conv);
    }

    set((s) => ({
      activeWorkspaceId: workspaceId,
      activeConversationId: id,
      conversationsByWorkspace: {
        ...s.conversationsByWorkspace,
        [workspaceId]: [summary, ...(s.conversationsByWorkspace[workspaceId] ?? [])],
      },
      totalByWorkspace: {
        ...s.totalByWorkspace,
        [workspaceId]: (s.totalByWorkspace[workspaceId] ?? 0) + 1,
      },
    }));

    useChatStore.getState().cacheAndActivate(conv);
    void useAppStore.getState().updateConfig({
      last_workspace_id: workspaceId,
      last_conversation_id: id,
    });
    return id;
  },

  renameConversation: async (workspaceId, conversationId, title) => {
    if (isTauri()) {
      await tauriRenameConversation(conversationId, title);
    }
    set((s) => ({
      conversationsByWorkspace: {
        ...s.conversationsByWorkspace,
        [workspaceId]: (s.conversationsByWorkspace[workspaceId] ?? []).map((c) =>
          c.id === conversationId ? { ...c, title } : c
        ),
      },
    }));
    useChatStore.getState().updateTitleLocal(conversationId, title);
  },

  deleteConversation: async (workspaceId, conversationId) => {
    if (isTauri()) {
      await tauriDeleteConversation(conversationId);
    }
    const state = get();
    const nextList = (state.conversationsByWorkspace[workspaceId] ?? []).filter(
      (c) => c.id !== conversationId
    );
    const nextActive =
      state.activeConversationId === conversationId
        ? nextList[0]?.id ?? null
        : state.activeConversationId;
    set({
      activeConversationId: nextActive,
      conversationsByWorkspace: {
        ...state.conversationsByWorkspace,
        [workspaceId]: nextList,
      },
      totalByWorkspace: {
        ...state.totalByWorkspace,
        [workspaceId]: Math.max(0, (state.totalByWorkspace[workspaceId] ?? 1) - 1),
      },
    });
    if (nextActive) {
      await useChatStore.getState().selectConversation(nextActive, workspaceId);
    } else {
      useChatStore.getState().clearActive();
    }
  },

  upsertSummary: (summary) =>
    set((s) => {
      const existing = s.conversationsByWorkspace[summary.workspace_id] ?? [];
      const filtered = existing.filter((c) => c.id !== summary.id);
      return {
        conversationsByWorkspace: {
          ...s.conversationsByWorkspace,
          [summary.workspace_id]: [summary, ...filtered],
        },
      };
    }),

  setConversationRunning: (conversationId, running) =>
    set((s) => ({
      runningConversationIds: {
        ...s.runningConversationIds,
        [conversationId]: running,
      },
    })),

  addWorkspace: async (path) => {
    if (isTauri()) {
      const ws = await tauriAddWorkspace(path);
      const exists = get().workspaces.some((w) => w.id === ws.id);
      set((s) => ({
        workspaces: exists ? s.workspaces : [ws, ...s.workspaces],
        conversationsByWorkspace: exists
          ? s.conversationsByWorkspace
          : { ...s.conversationsByWorkspace, [ws.id]: [] },
        activeWorkspaceId: ws.id,
      }));
      return ws;
    }

    const clean = path.replace(/[\\/]+$/, "");
    const name = clean.split(/[\\/]/).pop() || clean;
    const id = `ws-${Date.now()}`;
    const ws: Workspace = {
      id,
      name,
      path: clean,
      added_at: new Date().toISOString(),
      collapsed: false,
    };
    set((s) => ({
      workspaces: [ws, ...s.workspaces],
      conversationsByWorkspace: { ...s.conversationsByWorkspace, [id]: [] },
      activeWorkspaceId: id,
    }));
    return ws;
  },

  renameWorkspace: async (workspaceId, name) => {
    const updated = get().workspaces.map((ws) =>
      ws.id === workspaceId ? { ...ws, name } : ws
    );
    set({ workspaces: updated });
    const target = updated.find((w) => w.id === workspaceId);
    if (target && isTauri()) {
      await tauriUpdateWorkspace(target);
    }
  },

  removeWorkspace: async (workspaceId) => {
    if (isTauri()) {
      await tauriRemoveWorkspace(workspaceId);
    }
    set((s) => {
      const remaining = s.workspaces.filter((ws) => ws.id !== workspaceId);
      const nextWs =
        s.activeWorkspaceId === workspaceId ? remaining[0]?.id ?? null : s.activeWorkspaceId;
      return {
        workspaces: remaining,
        activeWorkspaceId: nextWs,
        activeConversationId:
          s.activeWorkspaceId === workspaceId ? null : s.activeConversationId,
      };
    });
  },
}));
