import React from "react";
import { ChevronDown } from "lucide-react";
import type { AgentMode } from "../../types";
import { useAppStore } from "../../store/appStore";
import { Menu } from "../ui/Menu";

export const ModeSelect: React.FC = () => {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);

  const labelMap: Record<AgentMode, string> = {
    ask: "Ask",
    auto: "Auto",
    chat: "Chat",
  };

  const colorMap: Record<AgentMode, string> = {
    ask: "text-ink",
    auto: "text-danger",
    chat: "text-accent",
  };

  return (
    <Menu
      align="left"
      direction="up"
      trigger={
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-hover transition-colors ${colorMap[mode]}`}
          title="Execution mode"
        >
          <span>{labelMap[mode]}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted" />
        </button>
      }
      items={[
        {
          label: "Chat",
          description: "General conversation, no tools",
          active: mode === "chat",
          onClick: () => setMode("chat"),
        },
        {
          label: "Ask",
          description: "Code mode: approve edits & commands",
          active: mode === "ask",
          onClick: () => setMode("ask"),
        },
        {
          label: "Auto",
          description: "Code mode: auto-edits, confirm risky",
          active: mode === "auto",
          onClick: () => setMode("auto"),
        },
      ]}
    />
  );
};
