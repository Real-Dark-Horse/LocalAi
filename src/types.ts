export type AgentMode = "ask" | "auto" | "chat";

export type ServerStatus =
  | { state: "stopped" }
  | { state: "loading" }
  | { state: "ready"; port: number }
  | { state: "error"; message: string };

export interface ModelOverride {
  backend?: "auto" | "vulkan" | "cpu";
  context: number;
  gpu_layers: number;
  threads: number;
  temperature: number;
}

export interface AppConfig {
  version: number;
  models_dir: string;
  last_model: string | null;
  last_workspace_id: string | null;
  last_conversation_id: string | null;
  default_mode: AgentMode;
  sidebar_collapsed: boolean;
  model_overrides: Record<string, ModelOverride>;
  monitor_interval_ms: number;
  font_size: number;
  verbose_steps: boolean;
  default_thinking: boolean;
}

export interface AppPaths {
  exe_dir: string;
  runtime_dir: string;
  default_models_dir: string;
  data_dir: string;
  conversations_dir: string;
  logs_dir: string;
  config_file: string;
  workspaces_file: string;
  app_log_file: string;
  server_log_file: string;
  using_temp_fallback: boolean;
  fallback_warning: string | null;
}

export interface GpuInfo {
  name: string;
  vendor: string;
  vram_total_mb: number;
  vram_free_mb: number;
  estimated?: boolean;
}

export interface HardwareInfo {
  cpu_name: string;
  physical_cores: number;
  logical_cores: number;
  total_ram_mb: number;
  available_ram_mb: number;
  gpus: GpuInfo[];
  recommended_backend: "vulkan" | "cpu";
}

export interface ServerProcessStats {
  cpu_percent: number;
  ram_mb: number;
}

export interface PerfStats {
  ts: number;
  cpu_percent: number;
  ram_used_mb: number;
  ram_total_mb: number;
  gpu_percent: number | null;
  vram_used_mb: number | null;
  vram_total_mb: number | null;
  server_proc: ServerProcessStats | null;
}

export interface InferenceTimings {
  predicted_per_second: number;
  prompt_per_second: number;
  prompt_n: number;
  predicted_n: number;
}

export interface ModelInfo {
  name: string;
  filename: string;
  path: string;
  size_mb: number;
  quantization: string | null;
  architecture?: string | null;
  max_context?: number | null;
  layer_count?: number | null;
  auto_settings: {
    backend: "vulkan" | "cpu";
    threads: number;
    gpu_layers: number;
    context: number;
    temperature: number;
  };
  warnings: string[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  added_at: string;
  collapsed: boolean;
  missing?: boolean;
}

export interface ConversationSummary {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model: string | null;
  mode: AgentMode;
}

export type ToolKind = "run" | "read" | "search" | "edit" | "create" | "list";

export type ToolRowStatus =
  | "running"
  | "needs_approval"
  | "done"
  | "error"
  | "rejected"
  | "stopped";

export interface DiffData {
  oldText: string;
  newText: string;
  added: number;
  removed: number;
}

export interface ToolRowItem {
  id: string;
  kind: ToolKind;
  verb: string;
  target: string;
  detail?: string;
  status: ToolRowStatus;
  dangerous?: boolean;
  output?: string;
  diff?: DiffData;
  toolName: string;
  args: Record<string, unknown>;
}

export type ConversationBlock =
  | {
      id: string;
      type: "user";
      content: string;
      attachments?: string[];
      timestamp: string;
    }
  | {
      id: string;
      type: "thinking";
      content: string;
    }
  | {
      id: string;
      type: "assistant";
      content: string;
      elapsedMs?: number;
      timestamp?: string;
    }
  | {
      id: string;
      type: "tool_group";
      rows: ToolRowItem[];
      collapsed?: boolean;
    };

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model: string | null;
  mode: AgentMode;
  messages: OpenAIMessage[];
  ui_events: ConversationBlock[];
}

export interface ToastItem {
  id: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
}

export interface UpdateInfo {
  checked: boolean;
  update_available: boolean;
  current_version: string;
  latest_version: string | null;
  download_url: string;
  release_url: string;
  release_notes: string | null;
  error: string | null;
}
