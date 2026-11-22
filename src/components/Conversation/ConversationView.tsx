import React, { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../store/chatStore";
import { useAppStore } from "../../store/appStore";
import { BrandLogo } from "../ui/BrandLogo";
import { LoadingAnimation } from "../ui/LoadingAnimation";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { UserMessage } from "./UserMessage";
import { ThinkingText } from "./ThinkingText";
import { AssistantText } from "./AssistantText";
import { ToolGroup } from "./ToolGroup";
import { ScrollToBottom } from "./ScrollToBottom";

const CODE_SUGGESTION_CHIPS = [
  "Find and fix bugs",
  "Explain this project",
  "Create a landing page",
];

const CHAT_SUGGESTION_CHIPS = [
  "Explain how async/await works",
  "Write a Python script to organize files",
  "Compare REST vs GraphQL",
];

export const ConversationView: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversation = useChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId] ?? null : null
  );
  const runState = useChatStore((s) =>
    s.activeConversationId ? s.runsByConversation[s.activeConversationId] : undefined
  );
  const isRunning = Boolean(runState?.isRunning);
  const runPhase = runState?.runPhase ?? null;
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryResponse = useChatStore((s) => s.retryResponse);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const isChatExperience = mode === "chat" || !activeWs;
  const chips = isChatExperience ? CHAT_SUGGESTION_CHIPS : CODE_SUGGESTION_CHIPS;

  const blocks = conversation?.ui_events ?? [];
  const lastBlock = blocks[blocks.length - 1];
  const lastBlockContentLen =
    lastBlock && "content" in lastBlock ? lastBlock.content.length : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolledUp) return;
    el.scrollTop = el.scrollHeight;
  }, [
    blocks.length,
    lastBlockContentLen,
    activeConversationId,
    isRunning,
    runPhase,
    userScrolledUp,
  ]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 48);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUserScrolledUp(false);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative flex-1 overflow-y-auto px-6 py-6"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col">
        {blocks.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4">
              <BrandLogo size="lg" />
            </div>
            <h1 className="text-[18px] font-semibold text-ink">
              {mode === "chat"
                ? "How can I help you today?"
                : activeWs
                  ? `What should we build in ${activeWs.name}?`
                  : "Start a chat or add a project folder"}
            </h1>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    if (!activeWs && mode !== "chat") {
                      setMode("chat");
                    }
                    void sendMessage(chip);
                  }}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] text-ink/90 hover:bg-hover transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {blocks.map((blk) => {
              if (blk.type === "user") {
                return (
                  <UserMessage
                    key={blk.id}
                    content={blk.content}
                    attachments={blk.attachments}
                    timestamp={blk.timestamp}
                  />
                );
              }
              if (blk.type === "thinking") {
                return <ThinkingText key={blk.id} content={blk.content} />;
              }
              if (blk.type === "tool_group") {
                return (
                  <ToolGroup
                    key={blk.id}
                    blockId={blk.id}
                    rows={blk.rows}
                    collapsed={blk.collapsed}
                  />
                );
              }
              if (blk.type !== "assistant") {
                return null;
              }
              const isLast = blk.id === blocks[blocks.length - 1]?.id;
              return (
                <AssistantText
                  key={blk.id}
                  blockId={blk.id}
                  content={blk.content}
                  titleHint={conversation?.title}
                  elapsedMs={blk.elapsedMs}
                  timestamp={blk.timestamp}
                  isStreaming={isRunning && isLast}
                  showActions={!isRunning || !isLast}
                  onRetry={retryResponse}
                />
              );
            })}

            {isRunning && (
              <div className="flex items-center gap-2 py-1 text-[13px] text-muted">
                <LoadingAnimation size={18} className="text-accent" />
                <span>{runPhase ?? "Thinking…"}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <ScrollToBottom visible={userScrolledUp} onClick={scrollToBottom} />
    </div>
  );
};
