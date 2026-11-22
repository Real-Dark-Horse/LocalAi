import React, { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

export interface MenuItem {
  label: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
  dividerBefore?: boolean;
}

interface MenuProps {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  direction?: "down" | "up";
}

export const Menu: React.FC<MenuProps> = ({
  trigger,
  items,
  align = "right",
  direction = "down",
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const verticalPos =
    direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <div
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </div>
      {open && (
        <div
          className={`absolute ${verticalPos} z-50 max-h-[280px] min-w-[215px] overflow-y-auto rounded-[10px] border border-border bg-card p-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item, idx) => (
            <React.Fragment key={`${item.label}-${idx}`}>
              {item.dividerBefore && <div className="my-1 border-t border-border" />}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                  item.danger
                    ? "text-danger hover:bg-danger/10"
                    : item.active
                      ? "bg-selected text-ink"
                      : "text-ink hover:bg-hover"
                }`}
              >
                <div className="min-w-0">
                  <div className="whitespace-nowrap text-[13px] font-medium leading-snug">
                    {item.label}
                  </div>
                  {item.description && (
                    <div className="whitespace-nowrap text-[11px] text-muted leading-snug">
                      {item.description}
                    </div>
                  )}
                </div>
                {item.active && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
