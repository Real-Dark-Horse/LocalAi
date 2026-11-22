import React, { useMemo } from "react";
import { diffLines } from "diff";

interface DiffViewProps {
  oldText: string;
  newText: string;
}

interface DiffDisplayLine {
  type: "add" | "remove" | "context";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export const DiffView: React.FC<DiffViewProps> = ({ oldText, newText }) => {
  const rows = useMemo<DiffDisplayLine[]>(() => {
    const changes = diffLines(oldText, newText);
    const out: DiffDisplayLine[] = [];
    let oldCursor = 1;
    let newCursor = 1;

    for (const part of changes) {
      const lines = part.value.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      for (const line of lines) {
        if (part.added) {
          out.push({
            type: "add",
            oldLine: null,
            newLine: newCursor++,
            text: line,
          });
        } else if (part.removed) {
          out.push({
            type: "remove",
            oldLine: oldCursor++,
            newLine: null,
            text: line,
          });
        } else {
          out.push({
            type: "context",
            oldLine: oldCursor++,
            newLine: newCursor++,
            text: line,
          });
        }
      }
    }
    return out;
  }, [oldText, newText]);

  return (
    <div className="max-h-[260px] overflow-auto rounded-md border border-border bg-[#141414] font-mono text-[12px] leading-[1.45]">
      {rows.map((line, i) => {
        const bgClass =
          line.type === "add"
            ? "diff-line-add text-[#86EFAC]"
            : line.type === "remove"
              ? "diff-line-remove text-[#FCA5A5]"
              : "text-ink/80";
        const marker =
          line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";

        return (
          <div key={i} className={`flex px-2 ${bgClass}`}>
            <span className="w-8 shrink-0 select-none pr-2 text-right text-muted/60">
              {line.oldLine ?? ""}
            </span>
            <span className="w-8 shrink-0 select-none pr-2 text-right text-muted/60">
              {line.newLine ?? ""}
            </span>
            <span className="w-4 shrink-0 select-none font-semibold">
              {marker}
            </span>
            <span className="whitespace-pre">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
};
