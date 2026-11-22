import React from "react";
import { ArrowUp, Square } from "lucide-react";

interface SendStopButtonProps {
  isRunning: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}

export const SendStopButton: React.FC<SendStopButtonProps> = ({
  isRunning,
  canSend,
  onSend,
  onStop,
}) => {
  if (isRunning) {
    return (
      <button
        type="button"
        onClick={onStop}
        title="Stop generation (Esc)"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25 transition-colors"
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSend}
      disabled={!canSend}
      title="Send message (Enter)"
      className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white hover:bg-blue-500 disabled:opacity-35 disabled:pointer-events-none transition-colors"
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
};
