import type {
  Conversation,
  ConversationSummary,
  HardwareInfo,
  ModelInfo,
  PerfStats,
  Workspace,
} from "../types";

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const MOCK_HARDWARE: HardwareInfo = {
  cpu_name: "Intel Core i7-8700",
  physical_cores: 6,
  logical_cores: 12,
  total_ram_mb: 16384,
  available_ram_mb: 7200,
  gpus: [
    {
      name: "NVIDIA GeForce GTX 1050",
      vendor: "NVIDIA",
      vram_total_mb: 2048,
      vram_free_mb: 1720,
    },
  ],
  recommended_backend: "vulkan",
};

export const MOCK_MODELS: ModelInfo[] = [
  {
    name: "Qwen2.5-Coder-7B",
    filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    path: "models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    size_mb: 4480,
    quantization: "Q4_K_M",
    auto_settings: {
      backend: "vulkan",
      threads: 6,
      gpu_layers: 9,
      context: 16384,
      temperature: 0.2,
    },
    warnings: [],
  },
  {
    name: "Qwen2.5-Coder-3B",
    filename: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    path: "models/qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    size_mb: 1980,
    quantization: "Q4_K_M",
    auto_settings: {
      backend: "vulkan",
      threads: 6,
      gpu_layers: 21,
      context: 16384,
      temperature: 0.2,
    },
    warnings: ["Small models are unreliable in Auto mode"],
  },
];

export const MOCK_WORKSPACES: Workspace[] = [
  {
    id: "ws-my-site",
    name: "my-site",
    path: "D:\\Projects\\my-site",
    added_at: ago(60 * 24 * 60),
    collapsed: false,
  },
  {
    id: "ws-api-server",
    name: "api-server",
    path: "D:\\Projects\\api-server",
    added_at: ago(60 * 24 * 62),
    collapsed: false,
  },
  {
    id: "ws-m0901",
    name: "m0901",
    path: "D:\\Projects\\m0901",
    added_at: ago(60 * 24 * 10),
    collapsed: false,
  },
];

export const MOCK_SUMMARIES: Record<string, ConversationSummary[]> = {
  "ws-my-site": [
    {
      id: "conv-navbar",
      workspace_id: "ws-my-site",
      title: "Fix navbar on mobile",
      created_at: ago(2),
      updated_at: ago(0),
      model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
      mode: "auto",
    },
    {
      id: "conv-contact",
      workspace_id: "ws-my-site",
      title: "Add contact form validation",
      created_at: ago(60 * 23),
      updated_at: ago(60 * 23),
      model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
      mode: "ask",
    },
    {
      id: "conv-landing",
      workspace_id: "ws-my-site",
      title: "Landing page hero spacing",
      created_at: ago(60 * 24 * 7),
      updated_at: ago(60 * 24 * 7),
      model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
      mode: "ask",
    },
  ],
  "ws-api-server": [
    {
      id: "conv-login",
      workspace_id: "ws-api-server",
      title: "Fix login token expiry check",
      created_at: ago(60 * 24 * 60),
      updated_at: ago(60 * 24 * 60),
      model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
      mode: "ask",
    },
  ],
  "ws-m0901": [],
};

export const MOCK_CONVERSATION: Conversation = {
  id: "conv-navbar",
  workspace_id: "ws-my-site",
  title: "Fix navbar on mobile",
  created_at: ago(2),
  updated_at: ago(0),
  model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  mode: "auto",
  messages: [],
  ui_events: [
    {
      id: "u-1",
      type: "user",
      content: "fix the navbar on mobile — the menu links overflow below 640px",
      timestamp: ago(2),
    },
    {
      id: "t-1",
      type: "thinking",
      content: "The menu overflows below 640px. Let me inspect the markup and stylesheet first.",
    },
    {
      id: "tg-1",
      type: "tool_group",
      collapsed: false,
      rows: [
        {
          id: "row-1",
          kind: "read",
          verb: "Read",
          target: "index.html",
          status: "done",
          toolName: "read_file",
          args: { path: "index.html", start_line: 1, end_line: 60 },
          output: `<header class="site-header">\n  <nav class="nav-bar">\n    <a class="brand" href="/">my-site</a>\n    <ul class="nav-links">\n      <li><a href="#features">Features</a></li>\n      <li><a href="#pricing">Pricing</a></li>\n      <li><a href="#docs">Docs</a></li>\n      <li><a href="#contact">Contact</a></li>\n    </ul>\n  </nav>\n</header>`,
        },
        {
          id: "row-2",
          kind: "search",
          verb: "Search",
          target: '"nav" · 4 matches',
          status: "done",
          toolName: "search_files",
          args: { query: "nav" },
          output: `css/style.css:14: .nav-bar { display: flex; align-items: center; justify-content: space-between; }\ncss/style.css:18: .nav-links { display: flex; gap: 24px; white-space: nowrap; }\nindex.html:12: <nav class="nav-bar">\njs/main.js:4: const nav = document.querySelector('.nav-links');`,
        },
        {
          id: "row-3",
          kind: "edit",
          verb: "Edit",
          target: "css/style.css",
          status: "done",
          toolName: "replace_in_file",
          args: { path: "css/style.css" },
          diff: {
            oldText: `.nav-bar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.nav-links {\n  display: flex;\n  gap: 24px;\n  white-space: nowrap;\n}`,
            newText: `.nav-bar {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n}\n.nav-links {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 16px 24px;\n}\n@media (max-width: 640px) {\n  .nav-links { width: 100%; justify-content: flex-start; }\n}`,
            added: 8,
            removed: 2,
          },
        },
      ],
    },
    {
      id: "a-1",
      type: "assistant",
      content: `I updated \`css/style.css\` so the navbar wraps cleanly under **640px** instead of overflowing horizontally:\n\n- Added \`flex-wrap: wrap\` and a \`12px\` gap to \`.nav-bar\`.\n- Removed \`white-space: nowrap\` forcing a single row on \`.nav-links\` and added responsive \`@media (max-width: 640px)\` alignment.\n\n\`\`\`css\n@media (max-width: 640px) {\n  .nav-links {\n    width: 100%;\n    justify-content: flex-start;\n  }\n}\n\`\`\``,
    },
  ],
};

export const MOCK_STATS_HISTORY: PerfStats[] = Array.from({ length: 30 }, (_, i) => ({
  ts: now - (30 - i) * 1000,
  cpu_percent: 28 + Math.round(Math.sin(i * 0.4) * 9 + (i % 4)),
  ram_used_mb: 9800 + (i % 5) * 32,
  ram_total_mb: 16384,
  gpu_percent: 54 + Math.round(Math.cos(i * 0.35) * 11),
  vram_used_mb: 1620,
  vram_total_mb: 2048,
  server_proc: {
    cpu_percent: 195 + (i % 20),
    ram_mb: 5120,
  },
}));
