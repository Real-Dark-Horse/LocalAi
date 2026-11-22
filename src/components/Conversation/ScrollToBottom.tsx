import React from "react";
import { ArrowDown } from "lucide-react";

interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
}

export const ScrollToBottom: React.FC<ScrollToBottomProps> = ({ visible, onClick }) => {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to bottom"
      className="fixed bottom-32 left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-ink hover:bg-hover transition-colors"
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  );
};
