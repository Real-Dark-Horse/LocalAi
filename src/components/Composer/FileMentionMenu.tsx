import React, { useEffect, useRef } from "react";
import { Check, FileCode2, FileText } from "lucide-react";

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "java",
  "kt",
  "c",
  "cpp",
  "cc",
  "h",
  "hpp",
  "cs",
  "php",
  "rb",
  "swift",
  "html",
  "css",
  "scss",
  "json",
  "toml",
  "yaml",
  "yml",
  "sql",
  "sh",
  "ps1",
  "bat",
  "vue",
  "svelte",
]);

function isCodeFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function isSubsequence(needle: string, haystack: string): boolean {
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

export function filterWorkspaceFiles(
  files: string[],
  query: string,
  maxResults = 30
): string[] {
  const q = query.trim().toLowerCase().replace(/\\/g, "/");
  if (!q) {
    return files.slice(0, maxResults);
  }

  const scored: Array<{ path: string; score: number }> = [];
  for (const path of files) {
    const lowerPath = path.toLowerCase();
    const slash = lowerPath.lastIndexOf("/");
    const basename = slash === -1 ? lowerPath : lowerPath.slice(slash + 1);

    let score = 0;
    if (basename === q) {
      score = 1000;
    } else if (basename.startsWith(q)) {
      score = 850 - basename.length * 0.1;
    } else if (basename.includes(q)) {
      score = 650 - basename.indexOf(q);
    } else if (lowerPath.includes(q)) {
      score = 450 - lowerPath.indexOf(q) * 0.2;
    } else if (isSubsequence(q, basename)) {
      score = 260 - basename.length * 0.2;
    } else if (isSubsequence(q, lowerPath)) {
      score = 120 - lowerPath.length * 0.1;
    }

    if (score > 0) {
      // Slight boost for shallower files
      const depth = (lowerPath.match(/\//g) ?? []).length;
      scored.push({ path, score: score - depth * 4 });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, maxResults).map((s) => s.path);
}

interface FileMentionMenuProps {
  workspaceName: string;
  query: string;
  items: string[];
  attachedFiles: string[];
  activeIndex: number;
  loading: boolean;
  onSelect: (relPath: string) => void;
  onHoverIndex: (idx: number) => void;
}

export const FileMentionMenu: React.FC<FileMentionMenuProps> = React.memo(
  ({
    workspaceName,
    query,
    items,
    attachedFiles,
    activeIndex,
    loading,
    onSelect,
    onHoverIndex,
  }) => {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(
        `[data-mention-idx="${activeIndex}"]`
      );
      el?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    return (
      <div
        role="listbox"
        aria-label="Workspace files"
        className="absolute bottom-full left-0 z-40 mb-2 w-full max-w-[540px] overflow-hidden rounded-[12px] border border-border bg-[#161618] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/80 bg-[#1B1B1F] px-3 py-1.5 text-[11.5px] text-muted">
          <span className="truncate">
            Files in <span className="font-medium text-ink">{workspaceName}</span>
            {query ? ` · "${query}"` : ""}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted/80">
            ↑↓ · Enter/Tab · Esc
          </span>
        </div>

        <div ref={listRef} className="max-h-[250px] overflow-y-auto p-1">
          {loading && items.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12.5px] text-muted">
              Scanning workspace files…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12.5px] text-muted">
              No matching files found
            </div>
          ) : (
            items.map((relPath, idx) => {
              const slash = relPath.lastIndexOf("/");
              const filename = slash === -1 ? relPath : relPath.slice(slash + 1);
              const dir = slash === -1 ? "" : relPath.slice(0, slash + 1);
              const isActive = idx === activeIndex;
              const isAttached = attachedFiles.includes(relPath);
              const Icon = isCodeFile(relPath) ? FileCode2 : FileText;

              return (
                <button
                  key={relPath}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-mention-idx={idx}
                  onMouseEnter={() => onHoverIndex(idx)}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before selection completes
                    e.preventDefault();
                    onSelect(relPath);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                    isActive
                      ? "bg-selected text-ink"
                      : "text-ink/85 hover:bg-hover/70"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isActive ? "text-accent" : "text-muted"
                      }`}
                    />
                    <span className="shrink-0 text-[13px] font-medium text-ink">
                      {filename}
                    </span>
                    {dir && (
                      <span className="truncate font-mono text-[11.5px] text-muted">
                        {dir}
                      </span>
                    )}
                  </div>

                  {isAttached && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                      <Check className="h-2.5 w-2.5" />
                      Attached
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }
);

FileMentionMenu.displayName = "FileMentionMenu";
