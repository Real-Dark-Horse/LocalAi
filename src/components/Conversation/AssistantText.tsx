import React, { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, MoreHorizontal, RotateCcw } from "lucide-react";
import { Menu } from "../ui/Menu";
import {
  formatDurationMs,
  formatExactDateTime,
  formatRelativeTimeAgo,
} from "../../lib/format";

interface AssistantTextProps {
  blockId?: string;
  content: string;
  titleHint?: string;
  elapsedMs?: number;
  timestamp?: string;
  isStreaming?: boolean;
  showActions?: boolean;
  onRetry?: (blockId: string) => void;
}

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS_HIGHLIGHT = [rehypeHighlight];
const REHYPE_PLUGINS_STREAMING: never[] = [];

const CodeBlock: React.FC<{
  className?: string;
  children?: React.ReactNode;
}> = React.memo(({ className, children }) => {
  const [copied, setCopied] = useState(false);
  const raw = String(children ?? "").replace(/\n$/, "");
  const isBlock = Boolean(className) || raw.includes("\n");

  if (!isBlock) {
    return (
      <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12.5px] text-ink border border-border">
        {children}
      </code>
    );
  }

  const lang = className?.replace(/^language-/, "") ?? "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be restricted in headless preview
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-card border border-border bg-[#141414]">
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-1.5 text-[11.5px] text-muted">
        <span className="font-mono">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-ink transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
});

CodeBlock.displayName = "CodeBlock";

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-lg font-semibold text-ink">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold text-ink">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[14px] font-semibold text-ink">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 text-muted">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-card px-3 py-1.5 font-medium text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border/60 px-3 py-1.5 text-ink/90">{children}</td>
  ),
  code: ({ className, children }) => (
    <CodeBlock className={className}>{children}</CodeBlock>
  ),
  pre: ({ children }) => <>{children}</>,
};

export const AssistantText: React.FC<AssistantTextProps> = React.memo(
  ({
    blockId,
    content,
    titleHint,
    elapsedMs,
    timestamp,
    isStreaming = false,
    showActions = false,
    onRetry,
  }) => {
    const [copiedResponse, setCopiedResponse] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const handleCopyResponse = async () => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedResponse(true);
        setTimeout(() => setCopiedResponse(false), 1500);
      } catch {
        // Ignore clipboard errors
      }
    };

    const handleDownloadMd = () => {
      const slug = (titleHint || "response")
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug || "response"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const relativeTime = timestamp ? formatRelativeTimeAgo(timestamp, nowMs) : "";
    const exactTime = timestamp ? formatExactDateTime(timestamp) : "";

    return (
      <div
        className="group/resp"
        onMouseEnter={() => {
          if (timestamp) setNowMs(Date.now());
        }}
      >
        <div className="prose-localai max-w-none text-[14px] leading-relaxed text-ink">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={
              isStreaming ? REHYPE_PLUGINS_STREAMING : REHYPE_PLUGINS_HIGHLIGHT
            }
            components={MARKDOWN_COMPONENTS}
          >
            {content}
          </ReactMarkdown>
        </div>

        {showActions && content.trim().length > 0 && (
          <div className="mt-2 flex items-center gap-1 text-muted">
            <button
              type="button"
              onClick={() => void handleCopyResponse()}
              title={copiedResponse ? "Copied" : "Copy response"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-ink transition-colors"
            >
              {copiedResponse ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>

            {onRetry && blockId && (
              <button
                type="button"
                onClick={() => onRetry(blockId)}
                title="Retry response"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-ink transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}

            <Menu
              align="left"
              direction="up"
              trigger={
                <button
                  type="button"
                  title="More actions"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-ink transition-colors"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              }
              items={[
                {
                  label: "Download (.md)",
                  onClick: handleDownloadMd,
                },
              ]}
            />

            {typeof elapsedMs === "number" && elapsedMs >= 0 && (
              <span
                className="ml-1 font-mono text-[11.5px] text-muted"
                title="Time taken to complete this prompt"
              >
                · {formatDurationMs(elapsedMs)}
              </span>
            )}

            {relativeTime && (
              <div className="group/atime relative ml-1 inline-flex items-center">
                <span className="cursor-default select-none text-[11.5px] text-muted hover:text-ink/90 transition-colors">
                  · {relativeTime}
                </span>
                {exactTime && (
                  <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 whitespace-nowrap rounded-lg border border-border bg-[#161618] px-2.5 py-1 text-[12px] font-medium text-ink shadow-lg opacity-0 transition-opacity duration-150 group-hover/atime:opacity-100">
                    {exactTime}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

AssistantText.displayName = "AssistantText";
