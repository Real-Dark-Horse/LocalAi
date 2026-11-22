import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Brain, Paperclip, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useChatStore } from "../../store/chatStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { isTauri, listWorkspaceFiles } from "../../lib/tauri";
import { FileMentionMenu, filterWorkspaceFiles } from "./FileMentionMenu";
import { ModeSelect } from "./ModeSelect";
import { PerfPill } from "./PerfPill";
import { ModelSelect } from "./ModelSelect";
import { SendStopButton } from "./SendStopButton";

interface MentionMatch {
  start: number;
  end: number;
  query: string;
}

const MOCK_WORKSPACE_FILES = [
  "index.html",
  "package.json",
  "css/style.css",
  "js/main.js",
  "src/App.tsx",
  "src/components/Navbar.tsx",
  "src/components/Hero.tsx",
  "src/utils/api.ts",
];

function detectMentionAtCursor(text: string, cursorPos: number): MentionMatch | null {
  if (cursorPos < 1 || cursorPos > text.length) return null;
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      // Only trigger @ mentions at start of text or after whitespace / opening punctuation
      if (i > 0 && !/[\s([{"',;]/.test(text[i - 1])) {
        return null;
      }
      return {
        start: i,
        end: cursorPos,
        query: text.slice(i + 1, cursorPos),
      };
    }
    if (/\s/.test(ch)) {
      return null;
    }
    i -= 1;
  }
  return null;
}

export const Composer: React.FC = () => {
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerCardRef = useRef<HTMLDivElement>(null);
  const dismissedAtStartRef = useRef<number | null>(null);
  const filesCacheRef = useRef<{ path: string; fetchedAt: number; files: string[] } | null>(
    null
  );

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const runState = useChatStore((s) =>
    s.activeConversationId ? s.runsByConversation[s.activeConversationId] : undefined
  );
  const isRunning = Boolean(runState?.isRunning);
  const queuedMessages = runState?.queuedMessages ?? [];
  const attachedFiles = useChatStore((s) => s.attachedFiles);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopRun = useChatStore((s) => s.stopRun);
  const clearQueuedMessages = useChatStore((s) => s.clearQueuedMessages);
  const attachFile = useChatStore((s) => s.attachFile);
  const removeAttachment = useChatStore((s) => s.removeAttachment);

  const mode = useAppStore((s) => s.mode);
  const models = useAppStore((s) => s.models);
  const selectedFilename = useAppStore((s) => s.selectedModelFilename);
  const serverStatus = useAppStore((s) => s.serverStatus);
  const restartActiveModel = useAppStore((s) => s.restartActiveModel);
  const enableThinking = useAppStore((s) => s.enableThinking);
  const setEnableThinking = useAppStore((s) => s.setEnableThinking);
  const dismissedWarnings = useAppStore((s) => s.dismissedWarnings);
  const dismissWarning = useAppStore((s) => s.dismissWarning);
  const pushToast = useAppStore((s) => s.pushToast);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const activeModel = models.find((m) => m.filename === selectedFilename) ?? null;
  const activeWarnings = (activeModel?.warnings ?? []).filter(
    (w) => !dismissedWarnings[`${activeModel?.filename}:${w}`]
  );

  const loadFilesForWorkspace = useCallback(async (wsPath: string) => {
    const cached = filesCacheRef.current;
    if (cached && cached.path === wsPath && Date.now() - cached.fetchedAt < 10_000) {
      setWorkspaceFiles(cached.files);
      return;
    }
    if (!isTauri()) {
      filesCacheRef.current = {
        path: wsPath,
        fetchedAt: Date.now(),
        files: MOCK_WORKSPACE_FILES,
      };
      setWorkspaceFiles(MOCK_WORKSPACE_FILES);
      return;
    }
    setLoadingFiles(true);
    try {
      const list = await listWorkspaceFiles(wsPath, 1500);
      filesCacheRef.current = { path: wsPath, fetchedAt: Date.now(), files: list };
      setWorkspaceFiles(list);
    } catch {
      setWorkspaceFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  // Reset file cache when switching workspaces
  useEffect(() => {
    setMention(null);
    dismissedAtStartRef.current = null;
    if (!activeWs) {
      setWorkspaceFiles([]);
      filesCacheRef.current = null;
    }
  }, [activeWs?.path]);

  // Fetch workspace files lazily when @ mention opens
  useEffect(() => {
    if (mention && activeWs) {
      void loadFilesForWorkspace(activeWs.path);
    }
  }, [mention !== null, activeWs?.path, loadFilesForWorkspace]);

  // Close @ mention menu when clicking outside the composer
  useEffect(() => {
    if (!mention) return;
    const onMouseDown = (e: MouseEvent) => {
      if (composerCardRef.current && !composerCardRef.current.contains(e.target as Node)) {
        setMention(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [mention]);

  const filteredFiles = useMemo(() => {
    if (!mention) return [];
    return filterWorkspaceFiles(workspaceFiles, mention.query, 30);
  }, [mention, workspaceFiles]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query, filteredFiles.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 10 * 22;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [draft]);

  const syncMentionState = (value: string, cursorPos: number) => {
    if (!activeWs) {
      setMention(null);
      return;
    }
    const found = detectMentionAtCursor(value, cursorPos);
    if (!found) {
      dismissedAtStartRef.current = null;
      setMention(null);
      return;
    }
    if (dismissedAtStartRef.current === found.start) {
      return;
    }
    setMention(found);
  };

  const handleSelectMention = useCallback(
    (relPath: string) => {
      if (!mention) return;
      const before = draft.slice(0, mention.start);
      const after = draft.slice(mention.end);
      const insertion = `@${relPath} `;
      const nextDraft = `${before}${insertion}${after}`;
      const nextCursor = before.length + insertion.length;

      setDraft(nextDraft);
      setMention(null);
      dismissedAtStartRef.current = null;
      attachFile(relPath);

      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
      });
    },
    [mention, draft, attachFile]
  );

  const handleSend = () => {
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    setMention(null);
    dismissedAtStartRef.current = null;
    void sendMessage(text).then((accepted) => {
      if (!accepted) {
        setDraft((curr) => (curr ? curr : text));
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredFiles.length > 0) {
          setMentionIndex((idx) => (idx + 1) % filteredFiles.length);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredFiles.length > 0) {
          setMentionIndex(
            (idx) => (idx - 1 + filteredFiles.length) % filteredFiles.length
          );
        }
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        if (filteredFiles.length > 0) {
          e.preventDefault();
          const chosen = filteredFiles[mentionIndex] ?? filteredFiles[0];
          if (chosen) handleSelectMention(chosen);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedAtStartRef.current = mention.start;
        setMention(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape" && isRunning) {
      e.preventDefault();
      stopRun(activeConversationId ?? undefined);
    }
  };

  const handleAttachPrompt = async () => {
    if (isTauri() && activeWs) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        directory: false,
        defaultPath: activeWs.path,
        title: "Attach workspace file(s)",
      });
      const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
      const rootNorm = activeWs.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      for (const f of files) {
        const norm = f.replace(/\\/g, "/");
        if (norm.toLowerCase().startsWith(`${rootNorm}/`)) {
          attachFile(norm.slice(rootNorm.length + 1));
        } else {
          pushToast("warning", "Attached files must be inside the active workspace.");
        }
      }
      return;
    }

    if (!activeWs) {
      pushToast("warning", "Add a workspace folder to attach project files.");
      return;
    }

    const rel = window.prompt("Attach workspace file (relative path, e.g. src/app.ts):");
    if (rel && rel.trim()) {
      attachFile(rel.trim());
    }
  };

  return (
    <div className="shrink-0 px-6 pb-4 pt-2">
      <div className="mx-auto w-full max-w-[760px] space-y-2">
        {/* Server error banner */}
        {serverStatus.state === "error" && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-[12.5px] text-danger">
            <div className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{serverStatus.message}</span>
            </div>
            {selectedFilename && (
              <button
                type="button"
                onClick={() => void restartActiveModel()}
                className="shrink-0 rounded border border-danger/40 px-2 py-0.5 text-[11.5px] font-medium hover:bg-danger/20"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Model warnings */}
        {activeWarnings.map((warning) => (
          <div
            key={warning}
            className="flex items-center justify-between gap-2 rounded-lg border border-warning/35 bg-warning/10 px-3 py-1.5 text-[12.5px] text-warning"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </div>
            <button
              type="button"
              onClick={() => dismissWarning(`${activeModel?.filename}:${warning}`)}
              className="rounded p-0.5 hover:bg-warning/20"
              aria-label="Dismiss warning"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Queued messages indicator */}
        {queuedMessages.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1 text-[12px] text-muted">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-accent font-medium">
                Queued ({queuedMessages.length}):
              </span>
              <span className="truncate text-ink">{queuedMessages[0]}</span>
            </div>
            <button
              type="button"
              onClick={() => clearQueuedMessages(activeConversationId ?? undefined)}
              className="shrink-0 rounded p-0.5 text-muted hover:text-ink"
              title="Clear queued messages"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Main composer card */}
        <div
          ref={composerCardRef}
          className="relative rounded-composer border border-border bg-card px-3.5 pb-2.5 pt-3 focus-within:border-muted/70 transition-colors"
        >
          {/* @ file mention autocomplete popover */}
          {mention && activeWs && (
            <FileMentionMenu
              workspaceName={activeWs.name}
              query={mention.query}
              items={filteredFiles}
              attachedFiles={attachedFiles}
              activeIndex={mentionIndex}
              loading={loadingFiles}
              onSelect={handleSelectMention}
              onHoverIndex={setMentionIndex}
            />
          )}

          {/* Attached files */}
          {attachedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachedFiles.map((file) => (
                <span
                  key={file}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-hover px-2 py-0.5 font-mono text-[11.5px] text-ink"
                >
                  {file}
                  <button
                    type="button"
                    onClick={() => removeAttachment(file)}
                    className="text-muted hover:text-ink"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              const val = e.target.value;
              setDraft(val);
              syncMentionState(val, e.target.selectionStart ?? val.length);
            }}
            onClick={(e) => {
              const el = e.currentTarget;
              syncMentionState(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyUp={(e) => {
              if (
                e.key === "ArrowLeft" ||
                e.key === "ArrowRight" ||
                e.key === "Home" ||
                e.key === "End"
              ) {
                const el = e.currentTarget;
                syncMentionState(el.value, el.selectionStart ?? el.value.length);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isRunning
                ? "Press Enter to queue · Esc to stop"
                : mode === "chat"
                  ? activeWs
                    ? "Chat with LocalAI… (no tools, @ to attach files)"
                    : "Message LocalAI…"
                  : "Ask LocalAI to do something… (type @ to mention files)"
            }
            className="w-full resize-none bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none leading-[22px]"
          />

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={handleAttachPrompt}
                title="Attach file from workspace (or type @)"
                className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <ModeSelect />
              <button
                type="button"
                onClick={() => setEnableThinking(!enableThinking)}
                title={
                  enableThinking
                    ? "Thinking ON (slower, deeper reasoning). Click for Fast mode."
                    : "Fast mode ON (direct answers, 5-10x faster). Click to enable deep thinking."
                }
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${
                  enableThinking
                    ? "bg-accent/15 text-accent hover:bg-accent/25"
                    : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                {enableThinking ? (
                  <>
                    <Brain className="h-3.5 w-3.5" />
                    <span>Think</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    <span>Fast</span>
                  </>
                )}
              </button>
              <PerfPill />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ModelSelect />
              <SendStopButton
                isRunning={isRunning}
                canSend={Boolean(draft.trim())}
                onSend={handleSend}
                onStop={() => stopRun(activeConversationId ?? undefined)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
