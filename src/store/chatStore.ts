import { create } from "zustand";
import type { Conversation, ConversationBlock, ToolRowItem } from "../types";
import { MOCK_CONVERSATION } from "../lib/mockData";
import { truncateTitle } from "../lib/format";
import {
  isTauri,
  loadConversation,
  saveConversation,
} from "../lib/tauri";
import { runAgentTurn } from "../lib/agent";
import { useAppStore } from "./appStore";
import { GENERAL_CHAT_WORKSPACE_ID, useWorkspaceStore } from "./workspaceStore";
import { useStatsStore } from "./statsStore";

export interface ConversationRunState {
  isRunning: boolean;
  runPhase: string | null;
  queuedMessages: string[];
}

const IDLE_RUN: ConversationRunState = {
  isRunning: false,
  runPhase: null,
  queuedMessages: [],
};

interface ChatState {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;
  runsByConversation: Record<string, ConversationRunState>;
  attachedFiles: string[];

  getRunState: (conversationId: string | null) => ConversationRunState;
  selectConversation: (id: string, workspaceId?: string | null) => Promise<void>;
  cacheAndActivate: (conv: Conversation) => void;
  clearActive: () => void;
  sendMessage: (text: string, targetConversationId?: string) => Promise<boolean>;
  retryResponse: (blockId: string) => Promise<void>;
  stopRun: (targetConversationId?: string) => void;
  clearQueuedMessages: (targetConversationId?: string) => void;
  toggleToolGroupCollapse: (blockId: string) => void;
  approveToolRow: (blockId: string, rowId: string) => void;
  rejectToolRow: (blockId: string, rowId: string) => void;
  attachFile: (relPath: string) => void;
  removeAttachment: (relPath: string) => void;
  updateTitleLocal: (id: string, title: string) => void;
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const abortControllers = new Map<string, AbortController>();
const pendingApprovals = new Map<string, Map<string, (approved: boolean) => void>>();

function scheduleSave(conv: Conversation) {
  if (!isTauri()) return;
  const existing = saveTimers.get(conv.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    saveTimers.delete(conv.id);
    void saveConversation(conv);
  }, 600);
  saveTimers.set(conv.id, timer);
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: isTauri() ? {} : { [MOCK_CONVERSATION.id]: MOCK_CONVERSATION },
  activeConversationId: isTauri() ? null : MOCK_CONVERSATION.id,
  runsByConversation: {},
  attachedFiles: [],

  getRunState: (conversationId) => {
    if (!conversationId) return IDLE_RUN;
    return get().runsByConversation[conversationId] ?? IDLE_RUN;
  },

  selectConversation: async (id, workspaceId) => {
    const cached = get().conversations[id];
    if (cached) {
      set({ activeConversationId: id });
      const est = cached.messages.reduce(
        (sum, m) => sum + Math.ceil((m.content?.length ?? 0) / 3.5) + 12,
        0
      );
      useStatsStore.getState().setContextUsed(est);
      return;
    }
    if (isTauri()) {
      try {
        const loaded = await loadConversation(id);
        set((s) => ({
          activeConversationId: id,
          conversations: { ...s.conversations, [id]: loaded },
        }));
        const est = loaded.messages.reduce(
          (sum, m) => sum + Math.ceil((m.content?.length ?? 0) / 3.5) + 12,
          0
        );
        useStatsStore.getState().setContextUsed(est);
        return;
      } catch {
        // Create fallback if missing
      }
    }
    if (workspaceId) {
      const now = new Date().toISOString();
      const blank: Conversation = {
        id,
        workspace_id: workspaceId,
        title: "New chat",
        created_at: now,
        updated_at: now,
        model: null,
        mode: useAppStore.getState().mode,
        messages: [],
        ui_events: [],
      };
      set((s) => ({
        activeConversationId: id,
        conversations: { ...s.conversations, [id]: blank },
      }));
      useStatsStore.getState().setContextUsed(0);
    }
  },

  cacheAndActivate: (conv) =>
    set((s) => ({
      activeConversationId: conv.id,
      conversations: { ...s.conversations, [conv.id]: conv },
    })),

  clearActive: () => set({ activeConversationId: null }),

  sendMessage: async (text, targetConversationId) => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const appState = useAppStore.getState();
    if (isTauri() && appState.serverStatus.state !== "ready") {
      appState.pushToast(
        "warning",
        appState.serverStatus.state === "loading"
          ? "Model is still loading — please wait a moment."
          : appState.serverStatus.state === "error"
            ? `Model server error: ${appState.serverStatus.message}`
            : "No model server is running. Select a model first."
      );
      return false;
    }

    const wsStore = useWorkspaceStore.getState();
    let wsId = wsStore.activeWorkspaceId;
    if (!wsId && appState.mode !== "chat" && wsStore.workspaces.length > 0) {
      wsId = wsStore.workspaces[0].id;
      wsStore.setActiveWorkspace(wsId);
    }
    if (!wsId) {
      if (appState.mode === "chat") {
        wsId = GENERAL_CHAT_WORKSPACE_ID;
        wsStore.setActiveWorkspace(wsId);
      } else {
        appState.pushToast(
          "warning",
          "Add a workspace folder for Ask/Auto mode, or switch to Chat mode."
        );
        return false;
      }
    }

    let convId = targetConversationId ?? get().activeConversationId;
    if (!convId || !get().conversations[convId]) {
      convId = await wsStore.createConversation(wsId);
    }

    const currentRun = get().runsByConversation[convId] ?? IDLE_RUN;
    if (currentRun.isRunning) {
      set((s) => {
        const prev = s.runsByConversation[convId!] ?? IDLE_RUN;
        return {
          runsByConversation: {
            ...s.runsByConversation,
            [convId!]: {
              ...prev,
              queuedMessages: [...prev.queuedMessages, trimmed],
            },
          },
        };
      });
      return true;
    }

    const conv = get().conversations[convId];
    if (!conv) return false;

    const attachments = [...get().attachedFiles];
    const now = new Date().toISOString();
    const userBlock: ConversationBlock = {
      id: `u-${Date.now()}`,
      type: "user",
      content: trimmed,
      attachments: attachments.length ? attachments : undefined,
      timestamp: now,
    };

    const nextTitle =
      conv.ui_events.length === 0 ? truncateTitle(trimmed, 60) : conv.title;
    const updatedConv: Conversation = {
      ...conv,
      title: nextTitle,
      updated_at: now,
      model: appState.selectedModelFilename,
      mode: appState.mode,
      messages: [...conv.messages, { role: "user", content: trimmed }],
      ui_events: [...conv.ui_events, userBlock],
    };

    set((s) => ({
      attachedFiles: [],
      conversations: { ...s.conversations, [convId!]: updatedConv },
    }));
    wsStore.upsertSummary({
      id: updatedConv.id,
      workspace_id: updatedConv.workspace_id,
      title: updatedConv.title,
      created_at: updatedConv.created_at,
      updated_at: updatedConv.updated_at,
      model: updatedConv.model,
      mode: updatedConv.mode,
    });
    scheduleSave(updatedConv);

    const activeModel = appState.models.find(
      (m) => m.filename === appState.selectedModelFilename
    );
    if (!isTauri()) return true;
    if (appState.serverStatus.state !== "ready") {
      return true;
    }

    const isGeneralChat = updatedConv.workspace_id === GENERAL_CHAT_WORKSPACE_ID;
    const workspace = isGeneralChat
      ? null
      : wsStore.workspaces.find((w) => w.id === updatedConv.workspace_id) ?? null;
    if (!isGeneralChat && !workspace) return false;
    const override = activeModel
      ? appState.config.model_overrides[activeModel.filename]
      : undefined;
    const contextLimit =
      override?.context ?? activeModel?.auto_settings.context ?? 8192;
    const temperature =
      override?.temperature ?? activeModel?.auto_settings.temperature ?? 0.2;

    const controller = new AbortController();
    abortControllers.set(convId, controller);
    const rowApprovals = new Map<string, (approved: boolean) => void>();
    pendingApprovals.set(convId, rowApprovals);

    set((s) => ({
      runsByConversation: {
        ...s.runsByConversation,
        [convId!]: {
          ...(s.runsByConversation[convId!] ?? IDLE_RUN),
          isRunning: true,
          runPhase: "Thinking…",
        },
      },
    }));
    wsStore.setConversationRunning(convId, true);

    try {
      const turnStart = performance.now();
      const prevBlockCount = updatedConv.ui_events.length;
      if (appState.serverStatus.state !== "ready") {
        throw new Error("Model server is not ready yet.");
      }
      await runAgentTurn({
        port: appState.serverStatus.port,
        workspacePath: workspace?.path ?? null,
        mode: isGeneralChat ? "chat" : appState.mode,
        contextLimit,
        temperature,
        enableThinking: appState.enableThinking,
        verboseSteps: appState.config.verbose_steps,
        history: updatedConv.messages,
        initialBlocks: updatedConv.ui_events,
        attachments,
        signal: controller.signal,
        callbacks: {
          onPhase: (phase) =>
            set((s) => ({
              runsByConversation: {
                ...s.runsByConversation,
                [convId!]: {
                  ...(s.runsByConversation[convId!] ?? IDLE_RUN),
                  isRunning: true,
                  runPhase: phase,
                },
              },
            })),
          onUpdateBlocks: (updater, persist = true) => {
            set((s) => {
              const curr = s.conversations[convId!];
              if (!curr) return s;
              const nextConv: Conversation = {
                ...curr,
                updated_at: new Date().toISOString(),
                ui_events: updater(curr.ui_events),
              };
              if (persist) {
                scheduleSave(nextConv);
              }
              return {
                conversations: { ...s.conversations, [convId!]: nextConv },
              };
            });
          },
          onUpdateMessages: (messages, persist = true) => {
            set((s) => {
              const curr = s.conversations[convId!];
              if (!curr) return s;
              const nextConv: Conversation = {
                ...curr,
                updated_at: new Date().toISOString(),
                messages,
              };
              if (persist) {
                scheduleSave(nextConv);
              }
              return {
                conversations: { ...s.conversations, [convId!]: nextConv },
              };
            });
          },
          onTimings: (timings, usedTokens) => {
            useStatsStore
              .getState()
              .setTimings(timings, usedTokens, contextLimit);
          },
          onLiveSpeed: (tokPerSec) => {
            useStatsStore.getState().setLiveTokPerSec(tokPerSec);
          },
          requestApproval: (_blockId, rowId) =>
            new Promise<boolean>((resolve) => {
              rowApprovals.set(rowId, resolve);
            }),
        },
      });
      const elapsedMs = Math.max(0, Math.round(performance.now() - turnStart));
      if (!controller.signal.aborted) {
        set((s) => {
          const curr = s.conversations[convId!];
          if (!curr) return s;
          const idx = curr.ui_events.map((b) => b.type).lastIndexOf("assistant");
          if (idx < prevBlockCount) return s;
          const nextEvents = curr.ui_events.map((b, i) =>
            i === idx && b.type === "assistant" ? { ...b, elapsedMs } : b
          );
          const nextConv: Conversation = {
            ...curr,
            updated_at: new Date().toISOString(),
            ui_events: nextEvents,
          };
          scheduleSave(nextConv);
          return {
            conversations: { ...s.conversations, [convId!]: nextConv },
          };
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const errMsg = `Agent error: ${String(err)}`;
        appState.pushToast("error", errMsg);
        set((s) => {
          const curr = s.conversations[convId!];
          if (!curr) return s;
          const nextConv: Conversation = {
            ...curr,
            ui_events: [
              ...curr.ui_events,
              { id: `err-${Date.now()}`, type: "assistant", content: errMsg },
            ],
          };
          scheduleSave(nextConv);
          return {
            conversations: { ...s.conversations, [convId!]: nextConv },
          };
        });
      }
    } finally {
      if (abortControllers.get(convId) === controller) {
        abortControllers.delete(convId);
      }
      pendingApprovals.delete(convId);
      set((s) => ({
        runsByConversation: {
          ...s.runsByConversation,
          [convId!]: {
            ...(s.runsByConversation[convId!] ?? IDLE_RUN),
            isRunning: false,
            runPhase: null,
          },
        },
      }));
      wsStore.setConversationRunning(convId, false);
    }

    const remainingQueue = get().runsByConversation[convId]?.queuedMessages ?? [];
    if (!controller.signal.aborted && remainingQueue.length > 0) {
      const [nextMsg, ...rest] = remainingQueue;
      set((s) => ({
        runsByConversation: {
          ...s.runsByConversation,
          [convId!]: {
            ...(s.runsByConversation[convId!] ?? IDLE_RUN),
            queuedMessages: rest,
          },
        },
      }));
      setTimeout(() => {
        void get().sendMessage(nextMsg, convId);
      }, 0);
    }
    return true;
  },

  retryResponse: async (blockId) => {
    const convId = get().activeConversationId;
    if (!convId) return;
    if (get().runsByConversation[convId]?.isRunning) return;

    const conv = get().conversations[convId];
    if (!conv) return;

    const blkIdx = conv.ui_events.findIndex((b) => b.id === blockId);
    if (blkIdx === -1) return;

    let userIdx = -1;
    for (let i = blkIdx - 1; i >= 0; i--) {
      if (conv.ui_events[i].type === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return;

    const userBlock = conv.ui_events[userIdx];
    if (userBlock.type !== "user") return;

    // Count which user message index in conv.messages corresponds to userBlock
    const userTurnCount = conv.ui_events
      .slice(0, userIdx + 1)
      .filter((b) => b.type === "user").length;
    let seenUsers = 0;
    let msgCutIdx = conv.messages.length;
    for (let i = 0; i < conv.messages.length; i++) {
      if (conv.messages[i].role === "user") {
        seenUsers += 1;
        if (seenUsers === userTurnCount) {
          msgCutIdx = i;
          break;
        }
      }
    }

    const trimmedConv: Conversation = {
      ...conv,
      ui_events: conv.ui_events.slice(0, userIdx),
      messages: conv.messages.slice(0, msgCutIdx),
    };
    set((s) => ({
      attachedFiles: userBlock.attachments ? [...userBlock.attachments] : [],
      conversations: { ...s.conversations, [convId]: trimmedConv },
    }));
    scheduleSave(trimmedConv);

    await get().sendMessage(userBlock.content, convId);
  },

  clearQueuedMessages: (targetConversationId) => {
    const id = targetConversationId ?? get().activeConversationId;
    if (!id) return;
    set((s) => ({
      runsByConversation: {
        ...s.runsByConversation,
        [id]: {
          ...(s.runsByConversation[id] ?? IDLE_RUN),
          queuedMessages: [],
        },
      },
    }));
  },

  stopRun: (targetConversationId) => {
    const id = targetConversationId ?? get().activeConversationId;
    if (!id) return;

    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    const approvals = pendingApprovals.get(id);
    if (approvals) {
      for (const [, resolve] of approvals.entries()) {
        resolve(false);
      }
      pendingApprovals.delete(id);
    }

    const conv = get().conversations[id];
    if (conv) {
      const nextEvents = conv.ui_events.map((blk) =>
        blk.type === "tool_group"
          ? {
              ...blk,
              rows: blk.rows.map((r) =>
                r.status === "running" || r.status === "needs_approval"
                  ? { ...r, status: "stopped" as const }
                  : r
              ),
            }
          : blk
      );
      const nextConv = { ...conv, ui_events: nextEvents };
      set((s) => ({
        runsByConversation: {
          ...s.runsByConversation,
          [id]: {
            ...(s.runsByConversation[id] ?? IDLE_RUN),
            isRunning: false,
            runPhase: null,
          },
        },
        conversations: { ...s.conversations, [id]: nextConv },
      }));
      scheduleSave(nextConv);
    } else {
      set((s) => ({
        runsByConversation: {
          ...s.runsByConversation,
          [id]: {
            ...(s.runsByConversation[id] ?? IDLE_RUN),
            isRunning: false,
            runPhase: null,
          },
        },
      }));
    }
    useWorkspaceStore.getState().setConversationRunning(id, false);
  },

  toggleToolGroupCollapse: (blockId) => {
    const id = get().activeConversationId;
    if (!id) return;
    const conv = get().conversations[id];
    if (!conv) return;
    const nextConv: Conversation = {
      ...conv,
      ui_events: conv.ui_events.map((blk) =>
        blk.id === blockId && blk.type === "tool_group"
          ? { ...blk, collapsed: !blk.collapsed }
          : blk
      ),
    };
    set((s) => ({
      conversations: { ...s.conversations, [id]: nextConv },
    }));
    scheduleSave(nextConv);
  },

  approveToolRow: (blockId, rowId) => {
    const id = get().activeConversationId;
    if (!id) return;
    const resolver = pendingApprovals.get(id)?.get(rowId);
    if (resolver) {
      pendingApprovals.get(id)?.delete(rowId);
      resolver(true);
      return;
    }
    const conv = get().conversations[id];
    if (!conv) return;
    const updateRow = (row: ToolRowItem): ToolRowItem =>
      row.id === rowId ? { ...row, status: "done" } : row;
    set((s) => ({
      conversations: {
        ...s.conversations,
        [id]: {
          ...conv,
          ui_events: conv.ui_events.map((blk) =>
            blk.id === blockId && blk.type === "tool_group"
              ? { ...blk, rows: blk.rows.map(updateRow) }
              : blk
          ),
        },
      },
    }));
  },

  rejectToolRow: (blockId, rowId) => {
    const id = get().activeConversationId;
    if (!id) return;
    const resolver = pendingApprovals.get(id)?.get(rowId);
    if (resolver) {
      pendingApprovals.get(id)?.delete(rowId);
      resolver(false);
      return;
    }
    const conv = get().conversations[id];
    if (!conv) return;
    const updateRow = (row: ToolRowItem): ToolRowItem =>
      row.id === rowId ? { ...row, status: "rejected" } : row;
    set((s) => ({
      conversations: {
        ...s.conversations,
        [id]: {
          ...conv,
          ui_events: conv.ui_events.map((blk) =>
            blk.id === blockId && blk.type === "tool_group"
              ? { ...blk, rows: blk.rows.map(updateRow) }
              : blk
          ),
        },
      },
    }));
  },

  attachFile: (relPath) =>
    set((s) =>
      s.attachedFiles.includes(relPath)
        ? s
        : { attachedFiles: [...s.attachedFiles, relPath] }
    ),

  removeAttachment: (relPath) =>
    set((s) => ({
      attachedFiles: s.attachedFiles.filter((f) => f !== relPath),
    })),

  updateTitleLocal: (id, title) =>
    set((s) => {
      const conv = s.conversations[id];
      if (!conv) return s;
      return {
        conversations: { ...s.conversations, [id]: { ...conv, title } },
      };
    }),
}));
