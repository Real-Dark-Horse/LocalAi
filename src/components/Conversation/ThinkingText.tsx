import React from "react";

interface ThinkingTextProps {
  content: string;
}

export const ThinkingText: React.FC<ThinkingTextProps> = React.memo(({ content }) => {
  if (!content.trim()) return null;
  return (
    <div className="text-[14px] leading-relaxed text-muted whitespace-pre-wrap">
      {content}
    </div>
  );
});

ThinkingText.displayName = "ThinkingText";
