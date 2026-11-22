import React, { useState } from "react";
import { Check, FolderOpen } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { formatContextSize, formatMbDetailed } from "../../lib/format";
import { pickFolder } from "../../lib/tauri";
import { BrandLogo } from "../ui/BrandLogo";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

export const SetupWizard: React.FC = () => {
  const open = useAppStore((s) => s.showSetupWizard);
  const setOpen = useAppStore((s) => s.setShowSetupWizard);
  const modelsDir = useAppStore((s) => s.config.models_dir);
  const models = useAppStore((s) => s.models);
  const setModelsDir = useAppStore((s) => s.setModelsDir);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const [chosenFile, setChosenFile] = useState<string | null>(null);

  const activeChoice = chosenFile ?? models[0]?.filename ?? null;

  const handleChooseModels = async () => {
    const folder = await pickFolder("Choose GGUF Models Folder");
    if (folder) {
      await setModelsDir(folder);
    }
  };

  const handleStart = async () => {
    setOpen(false);
    if (activeChoice) {
      await setSelectedModel(activeChoice);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Welcome to LocalAI"
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <BrandLogo size="md" />
          <div className="h-5 w-px bg-border" />
          <div className="text-[13px] font-medium text-muted">
            Offline AI Coding Agent
          </div>
        </div>

        <div className="rounded-card border border-border bg-[#141414] p-3">
          <div className="text-[11.5px] font-medium text-muted">Models folder</div>
          <div className="mt-1 truncate font-mono text-[12.5px] text-ink">
            {modelsDir || "Not selected yet"}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleChooseModels}
            className="mt-2.5"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose Models Folder
          </Button>
        </div>

        {models.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium text-muted">
              Detected Models ({models.length})
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-card border border-border bg-[#141414] p-1.5">
              {models.map((m) => {
                const selected = activeChoice === m.filename;
                return (
                  <button
                    key={m.filename}
                    type="button"
                    onClick={() => setChosenFile(m.filename)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                      selected ? "bg-selected text-ink" : "text-ink/85 hover:bg-hover"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      <div className="text-[11px] text-muted font-mono">
                        {formatMbDetailed(m.size_mb)} · {m.auto_settings.backend.toUpperCase()} ·{" "}
                        {m.auto_settings.gpu_layers} layers · ctx{" "}
                        {formatContextSize(m.auto_settings.context)}
                      </div>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Later
          </Button>
          <Button
            variant="primary"
            disabled={!activeChoice}
            onClick={() => void handleStart()}
          >
            Load Model
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
