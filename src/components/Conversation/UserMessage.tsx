import React, { useState } from "react";
import { Check, Copy, Paperclip } from "lucide-react";
import { formatExactDateTime, formatRelativeTimeAgo } from "../../lib/format";

interface UserMessageProps {
  content: string;
  attachments?: string[];
  timestamp?: string;
}

export const UserMessage: React.FC<UserMessageProps> = React.memo(
  ({ content, attachments, timestamp }) => {
    const [copied, setCopied] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Ignore clipboard errors in restricted environments
      }
    };

    const relativeTime = timestamp ? formatRelativeTimeAgo(timestamp, nowMs) : "";
    const exactTime = timestamp ? formatExactDateTime(timestamp) : "";

    return (
      <div className="flex justify-end">
        <div
          className="group/user flex max-w-[80%] flex-col items-end"
          onMouseEnter={() => {
            if (timestamp) setNowMs(Date.now());
          }}
        >
          <div className="w-full rounded-[12px] border border-border/60 bg-hover px-4 py-2.5 text-[14px] text-ink">
            {attachments && attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((file) => (
                  <span
                    key={file}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11.5px] text-muted"
                  >
                    <Paperclip className="h-3 w-3" />
                    {file}
                  </span>
                ))}
              </div>
            )}
            <div className="whitespace-pre-wrap break-words leading-relaxed">
              {content}
            </div>
          </div>

          <div
            className={`mt-1 flex h-6 items-center justify-end gap-2 pr-1 text-muted transition-opacity duration-150 ${
              copied
                ? "opacity-100 pointer-events-auto"
                : "opacity-0 pointer-events-none group-hover/user:opacity-100 group-hover/user:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
            }`}
          >
            {relativeTime && (
              <div className="group/time relative inline-flex items-center">
                <span className="cursor-default select-none text-[12px] text-muted hover:text-ink/90 transition-colors">
                  {relativeTime}
                </span>
                {exactTime && (
                  <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-1.5 whitespace-nowrap rounded-lg border border-border bg-[#161618] px-2.5 py-1 text-[12px] font-medium text-ink shadow-lg opacity-0 transition-opacity duration-150 group-hover/time:opacity-100">
                    {exactTime}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleCopy()}
              title={copied ? "Copied" : "Copy message"}
              aria-label="Copy message"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink transition-colors"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

UserMessage.displayName = "UserMessage";
