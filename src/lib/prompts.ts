import type { DirEntryItem } from "./tauri";
import type { ToolDefinition } from "./tools";

export const AGENT_SYSTEM_PROMPT = `You are LocalAI, a fast, expert offline coding agent operating inside the user's project workspace.
Work wisely and minimize round-trips:
- Batch independent read-only calls (read_file, search_files, list_dir) in a single turn whenever possible.
- Use replace_in_file for targeted edits, write_file for new files, and run_command (cmd or powershell) for builds, tests, or checks.
- Inspect unfamiliar files before editing; never re-read a file you just wrote.
- When the user mentions files with @path/to/file or attaches them, focus directly on those files.
- All file paths are relative to the project root.
- When finished, reply directly in plain text with a concise summary (no extra tool call needed).`;

export const CHAT_SYSTEM_PROMPT = `You are LocalAI, an expert offline coding assistant.
Give clear, accurate, concise answers with clean code. When project files are attached, rely on their exact contents.`;

export function formatWorkspaceTree(entries: DirEntryItem[]): string {
  if (entries.length === 0) {
    return "Workspace tree: (empty directory)";
  }
  const lines = entries
    .slice(0, 40)
    .map((e) => (e.is_dir ? `${e.path}/` : e.path));
  return `Workspace tree (${lines.length} entries):\n${lines.join("\n")}`;
}

export function buildFallbackToolsPrompt(tools: ToolDefinition[]): string {
  const specs = tools
    .map((t) => {
      const props = Object.keys(t.function.parameters.properties).join(", ");
      const req = t.function.parameters.required.join(", ");
      return `- ${t.function.name}(${props})${req ? ` [required: ${req}]` : ""}: ${t.function.description}`;
    })
    .join("\n");

  return `To invoke a tool, output a fenced block with valid JSON:
\`\`\`tool
{"name": "tool_name", "arguments": {"key": "value"}}
\`\`\`
Available tools:
${specs}`;
}
