import React, { useEffect } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { useAppStore } from "./store/appStore";
import { openExternalUrl } from "./lib/tauri";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { Header } from "./components/Header/Header";
import { ConversationView } from "./components/Conversation/ConversationView";
import { Composer } from "./components/Composer/Composer";
import { SearchDialog } from "./components/Overlays/SearchDialog";
import { SetupWizard } from "./components/Overlays/SetupWizard";
import { SettingsDialog } from "./components/Overlays/SettingsDialog";

export const App: React.FC = () => {
  const init = useAppStore((s) => s.init);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setShowSearch = useAppStore((s) => s.setShowSearch);
  const fontSize = useAppStore((s) => s.config.font_size || 14);
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const updateDismissed = useAppStore((s) => s.updateDismissed);
  const dismissUpdate = useAppStore((s) => s.dismissUpdate);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void init().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, [init]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearch(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setShowSearch, toggleSidebar]);

  return (
    <div
      style={{ fontSize: `${fontSize}px` }}
      className="flex h-screen w-screen overflow-hidden bg-app text-ink"
    >
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        <Header />
        {updateInfo?.update_available && !updateDismissed && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-4 py-2 text-[12.5px] text-ink">
            <div className="flex min-w-0 items-center gap-2">
              <Download className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">
                <strong className="font-semibold">
                  Update available: LocalAI v{updateInfo.latest_version}
                </strong>{" "}
                <span className="text-muted">
                  (you are running v{updateInfo.current_version}). Download the latest LocalAI.exe?
                </span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void openExternalUrl(updateInfo.release_url)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-ink transition-colors"
              >
                <span>Release Notes</span>
                <ExternalLink className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => void openExternalUrl(updateInfo.download_url)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={dismissUpdate}
                title="Later"
                className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink transition-colors"
                aria-label="Dismiss update notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        <ConversationView />
        <Composer />
      </main>

      <SearchDialog />
      <SetupWizard />
      <SettingsDialog />

      {toasts.length > 0 && (
        <div className="fixed right-4 top-14 z-50 flex max-w-sm flex-col gap-2">
          {toasts.map((toast) => {
            const border =
              toast.level === "error"
                ? "border-danger/50 text-danger"
                : toast.level === "warning"
                  ? "border-warning/50 text-warning"
                  : toast.level === "success"
                    ? "border-success/50 text-success"
                    : "border-border text-ink";
            return (
              <div
                key={toast.id}
                onClick={() => removeToast(toast.id)}
                className={`cursor-pointer rounded-card border bg-card px-3.5 py-2.5 text-[12.5px] ${border}`}
              >
                {toast.message}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default App;
