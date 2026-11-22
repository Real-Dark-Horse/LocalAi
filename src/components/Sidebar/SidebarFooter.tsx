import React from "react";
import { Settings } from "lucide-react";
import { useAppStore } from "../../store/appStore";

export const SidebarFooter: React.FC = () => {
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const updateAvailable = useAppStore((s) => Boolean(s.updateInfo?.update_available));

  return (
    <div className="border-t border-border p-2">
      <button
        type="button"
        onClick={() => setShowSettings(true)}
        className="flex w-full items-center justify-between gap-2.5 rounded-sidebar px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-ink transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </span>
        {updateAvailable && (
          <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            Update
          </span>
        )}
      </button>
    </div>
  );
};
