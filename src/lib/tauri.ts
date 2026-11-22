import type {
  AppConfig,
  AppPaths,
  Conversation,
  ConversationSummary,
  HardwareInfo,
  ModelInfo,
  PerfStats,
  ServerStatus,
  UpdateInfo,
  Workspace,
} from "../types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getPaths(): Promise<AppPaths | null> {
  if (!isTauri()) return null;
  return invokeTauri<AppPaths>("get_paths");
}

export async function getConfig(): Promise<AppConfig | null> {
  if (!isTauri()) return null;
  return invokeTauri<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  if (!isTauri()) return config;
  return invokeTauri<AppConfig>("save_config", { config });
}

export async function pickFolder(title = "Select Folder"): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function detectHardware(): Promise<HardwareInfo | null> {
  if (!isTauri()) return null;
  return invokeTauri<HardwareInfo>("detect_hardware");
}

export async function scanModels(modelsDir: string): Promise<ModelInfo[]> {
  if (!isTauri()) return [];
  return invokeTauri<ModelInfo[]>("scan_models", { modelsDir });
}

export interface ServerSettingsArg {
  backend: string;
  context: number;
  gpu_layers: number;
  threads: number;
  auto_gpu_layers?: boolean;
}

export async function startServer(
  modelPath: string,
  settings: ServerSettingsArg
): Promise<number> {
  if (!isTauri()) return 0;
  return invokeTauri<number>("start_server", { modelPath, settings });
}

export async function stopServer(): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("stop_server");
}

export async function listWorkspaces(): Promise<Workspace[]> {
  if (!isTauri()) return [];
  return invokeTauri<Workspace[]>("list_workspaces");
}

export async function addWorkspace(path: string): Promise<Workspace> {
  return invokeTauri<Workspace>("add_workspace", { path });
}

export async function updateWorkspace(workspace: Workspace): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("update_workspace", { workspace });
}

export async function removeWorkspace(id: string): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("remove_workspace", { id });
}

export async function listConversations(
  workspaceId: string,
  limit: number,
  offset: number
): Promise<{ items: ConversationSummary[]; total: number }> {
  if (!isTauri()) return { items: [], total: 0 };
  return invokeTauri<{ items: ConversationSummary[]; total: number }>(
    "list_conversations",
    { workspaceId, limit, offset }
  );
}

export async function loadConversation(id: string): Promise<Conversation> {
  return invokeTauri<Conversation>("load_conversation", { id });
}

export async function saveConversation(conv: Conversation): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("save_conversation", { conv });
}

export async function deleteConversation(id: string): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("delete_conversation", { id });
}

export async function renameConversation(id: string, title: string): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("rename_conversation", { id, title });
}

export interface SearchHit {
  id: string;
  workspace_id: string;
  title: string;
  updated_at: string;
  snippet: string | null;
}

export async function searchConversations(query: string): Promise<SearchHit[]> {
  if (!isTauri()) return [];
  return invokeTauri<SearchHit[]>("search_conversations", { query });
}

export async function openInExplorer(path: string): Promise<void> {
  if (!isTauri()) return;
  return invokeTauri<void>("open_in_explorer", { path });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  return invokeTauri<void>("open_external_url", { url });
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!isTauri()) {
    return {
      checked: false,
      update_available: false,
      current_version: "0.2.0",
      latest_version: null,
      download_url:
        "https://github.com/Real-Dark-Horse/LocalAi/releases/latest/download/LocalAI.exe",
      release_url: "https://github.com/Real-Dark-Horse/LocalAi/releases/latest",
      release_notes: null,
      error: null,
    };
  }
  return invokeTauri<UpdateInfo>("check_for_update");
}

export interface DirEntryItem {
  path: string;
  is_dir: boolean;
  size_bytes: number;
}

export async function listDir(
  workspacePath: string,
  rel: string,
  depth?: number,
  maxEntries?: number
): Promise<DirEntryItem[]> {
  return invokeTauri<DirEntryItem[]>("list_dir", {
    workspacePath,
    rel,
    depth,
    maxEntries,
  });
}

export async function listWorkspaceFiles(
  workspacePath: string,
  maxFiles?: number
): Promise<string[]> {
  if (!isTauri()) return [];
  return invokeTauri<string[]>("list_workspace_files", {
    workspacePath,
    maxFiles,
  });
}

export interface ReadFileResult {
  path: string;
  content: string;
  total_lines: number;
  truncated: boolean;
}

export async function readFile(
  workspacePath: string,
  rel: string,
  startLine?: number,
  endLine?: number
): Promise<ReadFileResult> {
  return invokeTauri<ReadFileResult>("read_file", {
    workspacePath,
    rel,
    startLine,
    endLine,
  });
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export async function searchFiles(
  workspacePath: string,
  query: string,
  glob?: string
): Promise<SearchMatch[]> {
  return invokeTauri<SearchMatch[]>("search_files", {
    workspacePath,
    query,
    glob,
  });
}

export interface WritePreview {
  path: string;
  old_text: string;
  new_text: string;
  added: number;
  removed: number;
  is_new: boolean;
}

export async function previewWrite(
  workspacePath: string,
  rel: string,
  content: string
): Promise<WritePreview> {
  return invokeTauri<WritePreview>("preview_write", {
    workspacePath,
    rel,
    content,
  });
}

export async function previewReplace(
  workspacePath: string,
  rel: string,
  oldText: string,
  newText: string
): Promise<WritePreview> {
  return invokeTauri<WritePreview>("preview_replace", {
    workspacePath,
    rel,
    oldText,
    newText,
  });
}

export async function applyWrite(
  workspacePath: string,
  rel: string,
  content: string
): Promise<void> {
  return invokeTauri<void>("apply_write", {
    workspacePath,
    rel,
    content,
  });
}

export interface CommandResult {
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  timed_out: boolean;
}

export async function runCommand(
  workspacePath: string,
  command: string,
  shell?: "cmd" | "powershell",
  timeoutSecs?: number
): Promise<CommandResult> {
  return invokeTauri<CommandResult>("run_command", {
    workspacePath,
    command,
    shell,
    timeoutSecs,
  });
}

export async function isDangerousCommand(command: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invokeTauri<boolean>("is_dangerous_command", { command });
}

export async function listenEvents(handlers: {
  onStats: (stats: PerfStats) => void;
  onServerStatus: (status: ServerStatus) => void;
  onServerToast: (toast: { level: "info" | "warning" | "error" | "success"; message: string }) => void;
}): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisteners = await Promise.all([
    listen<PerfStats>("stats", (e) => handlers.onStats(e.payload)),
    listen<ServerStatus>("server-status", (e) => handlers.onServerStatus(e.payload)),
    listen<{ level: "info" | "warning" | "error" | "success"; message: string }>(
      "server-toast",
      (e) => handlers.onServerToast(e.payload)
    ),
  ]);
  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
