import type {
  AgentMode,
  ConversationBlock,
  InferenceTimings,
  OpenAIMessage,
  ToolKind,
  ToolRowItem,
} from "../types";
import { streamChatCompletion } from "./llm";
import { AGENT_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, formatWorkspaceTree } from "./prompts";
import { AGENT_TOOLS } from "./tools";
import {
  applyWrite,
  isDangerousCommand,
  listDir,
  previewReplace,
  previewWrite,
  readFile,
  runCommand,
  searchFiles,
} from "./tauri";

const MAX_STEPS = 15;
const STREAM_FLUSH_MS = 50;

const VALID_TOOL_NAMES = new Set([
  ...AGENT_TOOLS.map((t) => t.function.name),
  "finish",
]);

const READ_ONLY_TOOLS = new Set(["list_dir", "read_file", "search_files"]);

export interface ApprovalDecision {
  approved: boolean;
}

export interface AgentCallbacks {
  onUpdateBlocks: (
    updater: (blocks: ConversationBlock[]) => ConversationBlock[],
    persist?: boolean
  ) => void;
  onUpdateMessages: (messages: OpenAIMessage[], persist?: boolean) => void;
  onTimings: (timings: InferenceTimings, promptTokens: number) => void;
  onLiveSpeed?: (tokPerSec: number) => void;
  onPhase?: (phase: string) => void;
  requestApproval: (blockId: string, rowId: string) => Promise<boolean>;
}

export interface RunAgentParams {
  port: number;
  workspacePath: string | null;
  mode: AgentMode;
  contextLimit: number;
  temperature: number;
  enableThinking: boolean;
  verboseSteps: boolean;
  history: OpenAIMessage[];
  initialBlocks: ConversationBlock[];
  attachments: string[];
  signal: AbortSignal;
  callbacks: AgentCallbacks;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function truncateToolOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kb = Math.max(1, Math.round(maxChars / 1024));
  return `${text.slice(0, maxChars)}\n…[truncated to ${kb} KB]`;
}

function createCoalescedFlusher(fn: () => void, delayMs = STREAM_FLUSH_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  return {
    schedule() {
      dirty = true;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (dirty) {
          dirty = false;
          fn();
        }
      }, delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (dirty) {
        dirty = false;
        fn();
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      dirty = false;
    },
  };
}

function extractValidToolCallsFromJson(
  rawJson: string
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const out: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  try {
    const parsed = JSON.parse(rawJson.trim()) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const obj = item as { name?: unknown; arguments?: unknown; parameters?: unknown };
      if (typeof obj.name !== "string" || !VALID_TOOL_NAMES.has(obj.name)) continue;
      let rawArgs = obj.arguments ?? obj.parameters ?? {};
      if (typeof rawArgs === "string") {
        try {
          rawArgs = JSON.parse(rawArgs);
        } catch {
          rawArgs = {};
        }
      }
      const args =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {};
      out.push({ name: obj.name, arguments: args });
    }
  } catch {
    // Ignore malformed JSON
  }
  return out;
}

/**
 * Universal fallback tool-call parser supporting all common open-weight formats:
 * - ```tool { ... } ```
 * - <tool_call>{ ... }</tool_call>  (Qwen / Hermes / DeepSeek)
 * - [TOOL_CALLS] [...]              (Mistral / Devstral)
 * - ```json {"name": "<known_tool>", "arguments": {...}} ``` (Gemma / Phi / Llama / CodeLlama)
 */
export function parseFallbackToolBlocks(text: string): Array<{
  name: string;
  arguments: Record<string, unknown>;
}> {
  const parsed: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  const patterns: RegExp[] = [
    /```tool\s*\n([\s\S]*?)```/gi,
    /<tool_call>\s*([\s\S]*?)<\/tool_call>/gi,
    /\[TOOL_CALLS\]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/gi,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      parsed.push(...extractValidToolCallsFromJson(match[1]));
    }
  }

  // Fallback for models emitting ```json blocks with an exact known tool name
  if (parsed.length === 0) {
    const jsonFence = /```json\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = jsonFence.exec(text)) !== null) {
      parsed.push(...extractValidToolCallsFromJson(match[1]));
    }
  }

  return parsed;
}

export function stripFallbackToolBlocks(text: string): string {
  return text
    .replace(/```tool\s*\n[\s\S]*?```/gi, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/\[TOOL_CALLS\]\s*(?:\[[\s\S]*?\]|\{[\s\S]*?\})/gi, "")
    .trim();
}

/** Universal reasoning tag extractor (<think>, <thought>, <reasoning>, plus stray closing tags). */
export function splitThinkTags(raw: string): { think: string; answer: string } {
  const thinkParts: string[] = [];
  let rest = raw.replace(
    /<(think|thought|reasoning)>([\s\S]*?)<\/\1>/gi,
    (_m, _tag: string, inner: string) => {
      if (inner.trim()) thinkParts.push(inner.trim());
      return "";
    }
  );

  // Handle models whose prompt template opened <think> before generation (only closing tag appears)
  const strayClose = rest.match(/^([\s\S]*?)<\/(think|thought|reasoning)>/i);
  if (strayClose) {
    if (strayClose[1].trim()) thinkParts.push(strayClose[1].trim());
    rest = rest.slice(strayClose[0].length);
  }

  // Handle unclosed opening tag while actively streaming
  const openMatch = rest.match(/<(think|thought|reasoning)>/i);
  if (openMatch && typeof openMatch.index === "number") {
    const partial = rest.slice(openMatch.index + openMatch[0].length).trim();
    if (partial) thinkParts.push(partial);
    rest = rest.slice(0, openMatch.index);
  }

  return {
    think: thinkParts.join("\n\n").trim(),
    answer: rest.trim(),
  };
}

export function trimMessagesToContext(
  messages: OpenAIMessage[],
  contextLimit: number
): OpenAIMessage[] {
  const budgetTokens = Math.floor(contextLimit * 0.72);
  const estimateTokens = (msgs: OpenAIMessage[]) =>
    msgs.reduce(
      (sum, m) =>
        sum +
        Math.ceil((m.content?.length ?? 0) / 3.5) +
        (m.tool_calls ? Math.ceil(JSON.stringify(m.tool_calls).length / 3.5) : 0) +
        12,
      0
    );

  const cloned = messages.map((m) => ({ ...m }));
  if (estimateTokens(cloned) <= budgetTokens) {
    return cloned;
  }

  // First pass: compress older tool results (keep latest 4 messages uncompressed)
  const cutoff = Math.max(2, cloned.length - 4);
  for (let i = 1; i < cutoff; i++) {
    const msg = cloned[i];
    if (msg.role === "tool" && msg.content && msg.content.length > 220) {
      const lineCount = msg.content.split("\n").length;
      const label = msg.name || "tool";
      msg.content = `[${label} output compressed — ${lineCount} lines]`;
    }
  }

  // Second pass: drop oldest non-system atomic turns (never orphan a tool reply from its assistant tool_call)
  while (cloned.length > 4 && estimateTokens(cloned) > budgetTokens) {
    let dropCount = 1;
    const target = cloned[1];
    if (target.role === "assistant" && target.tool_calls && target.tool_calls.length > 0) {
      while (1 + dropCount < cloned.length - 2 && cloned[1 + dropCount].role === "tool") {
        dropCount += 1;
      }
    }
    cloned.splice(1, dropCount);
    // Clean up any leading orphaned tool message
    while (cloned.length > 3 && cloned[1]?.role === "tool") {
      cloned.splice(1, 1);
    }
  }

  return cloned;
}

function mapToolPresentation(
  name: string,
  args: Record<string, unknown>
): { kind: ToolKind; verb: string; target: string } {
  switch (name) {
    case "list_dir":
      return {
        kind: "list",
        verb: "List",
        target: String(args.path ?? "."),
      };
    case "read_file":
      return {
        kind: "read",
        verb: "Read",
        target: String(args.path ?? ""),
      };
    case "search_files":
      return {
        kind: "search",
        verb: "Search",
        target: `"${String(args.query ?? "")}"`,
      };
    case "write_file":
      return {
        kind: "create",
        verb: "Create",
        target: String(args.path ?? ""),
      };
    case "replace_in_file":
      return {
        kind: "edit",
        verb: "Edit",
        target: String(args.path ?? ""),
      };
    case "run_command":
      return {
        kind: "run",
        verb: "Run",
        target: String(args.command ?? ""),
      };
    default:
      return {
        kind: "run",
        verb: name,
        target: JSON.stringify(args),
      };
  }
}

export async function runAgentTurn(params: RunAgentParams): Promise<void> {
  const {
    port,
    workspacePath,
    mode,
    contextLimit,
    temperature,
    enableThinking,
    verboseSteps,
    attachments,
    signal,
    callbacks,
  } = params;

  const maxToolResultChars = Math.min(16384, Math.max(4096, Math.floor(contextLimit * 1.2)));
  const maxTokens = Math.min(8192, Math.max(2048, Math.floor(contextLimit * 0.5)));

  const workingMessages: OpenAIMessage[] = [...params.history];

  // Append attached file contents in parallel to the latest user message for LLM context
  if (workspacePath && attachments.length > 0 && workingMessages.length > 0) {
    const lastIdx = workingMessages.length - 1;
    if (workingMessages[lastIdx].role === "user") {
      const snippets = await Promise.all(
        attachments.map(async (rel) => {
          try {
            const res = await readFile(workspacePath, rel);
            return `File \`${rel}\`:\n\`\`\`\n${truncateToolOutput(res.content, maxToolResultChars)}\n\`\`\``;
          } catch (err) {
            return `File \`${rel}\`: (could not read: ${String(err)})`;
          }
        })
      );
      workingMessages[lastIdx] = {
        ...workingMessages[lastIdx],
        content: `${workingMessages[lastIdx].content ?? ""}\n\n${snippets.join("\n\n")}`,
      };
    }
  }

  // Plain Chat mode (no tools)
  if (mode === "chat") {
    callbacks.onPhase?.("Thinking…");
    const assistantBlockId = uid("a");
    let thinkingBlockId: string | null = null;
    let latestThinking = "";
    let latestAnswer = "";

    callbacks.onUpdateBlocks(
      (blocks) => [
        ...blocks,
        { id: assistantBlockId, type: "assistant", content: "" },
      ],
      false
    );

    const flusher = createCoalescedFlusher(() => {
      callbacks.onUpdateBlocks((blocks) => {
        let next = blocks;
        if (latestThinking) {
          if (!thinkingBlockId) {
            thinkingBlockId = uid("t");
            const tid = thinkingBlockId;
            const idx = next.findIndex((b) => b.id === assistantBlockId);
            const copy = [...next];
            copy.splice(idx === -1 ? copy.length : idx, 0, {
              id: tid,
              type: "thinking",
              content: latestThinking,
            });
            next = copy;
          } else {
            const tid = thinkingBlockId;
            next = next.map((b) =>
              b.id === tid && b.type === "thinking"
                ? { ...b, content: latestThinking }
                : b
            );
          }
        }
        return next.map((b) =>
          b.id === assistantBlockId && b.type === "assistant"
            ? { ...b, content: latestAnswer }
            : b
        );
      }, false);
    });

    const chatMessages = trimMessagesToContext(
      [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...workingMessages],
      contextLimit
    );

    let lastPhase = "Thinking…";
    const setPhase = (p: string) => {
      if (p !== lastPhase) {
        lastPhase = p;
        callbacks.onPhase?.(p);
      }
    };

    try {
      const res = await streamChatCompletion({
        port,
        messages: chatMessages,
        temperature,
        maxTokens,
        enableThinking,
        signal,
        onLiveSpeed: callbacks.onLiveSpeed,
        onReasoningDelta: (_delta, accReasoning) => {
          setPhase("Thinking…");
          const trimmed = accReasoning.trim();
          if (trimmed) {
            latestThinking = trimmed;
            flusher.schedule();
          }
        },
        onTextDelta: (_delta, accumulated) => {
          const { think, answer } = splitThinkTags(accumulated);
          if (think) {
            latestThinking = think;
          }
          if (think && !answer) {
            setPhase("Thinking…");
          } else if (answer) {
            setPhase("Generating…");
          }
          latestAnswer = answer;
          flusher.schedule();
        },
      });

      flusher.flush();
      setPhase("Finalizing…");
      const { think, answer } = splitThinkTags(res.content);
      const finalThinking = res.reasoning.trim() || think;
      const finalAnswer = answer || res.content.trim();
      const finishedAt = new Date().toISOString();

      callbacks.onUpdateBlocks((blocks) => {
        let next = blocks;
        if (finalThinking && !thinkingBlockId) {
          thinkingBlockId = uid("t");
          const idx = next.findIndex((b) => b.id === assistantBlockId);
          const copy = [...next];
          copy.splice(idx === -1 ? copy.length : idx, 0, {
            id: thinkingBlockId,
            type: "thinking",
            content: finalThinking,
          });
          next = copy;
        }
        return next.map((b) =>
          b.id === assistantBlockId && b.type === "assistant"
            ? { ...b, content: finalAnswer, timestamp: finishedAt }
            : b
        );
      }, true);

      if (res.timings) {
        callbacks.onTimings(res.timings, res.promptTokens + res.completionTokens);
      }
      workingMessages.push({ role: "assistant", content: finalAnswer });
      callbacks.onUpdateMessages(workingMessages, true);
      return;
    } finally {
      flusher.cancel();
    }
  }

  if (!workspacePath) {
    const msg =
      "A project workspace folder is required for Ask/Auto coding tools. Select a folder or switch to Chat mode.";
    callbacks.onUpdateBlocks(
      (blocks) => [
        ...blocks,
        {
          id: uid("a"),
          type: "assistant",
          content: msg,
          timestamp: new Date().toISOString(),
        },
      ],
      true
    );
    workingMessages.push({ role: "assistant", content: msg });
    callbacks.onUpdateMessages(workingMessages, true);
    return;
  }

  // Build workspace tree once per turn for agent system context (stable prefix for KV cache hits)
  callbacks.onPhase?.("Preparing context…");
  let treeText = "Workspace tree: (unavailable)";
  try {
    const entries = await listDir(workspacePath, ".", 2, 40);
    treeText = formatWorkspaceTree(entries);
  } catch {
    // Non-fatal if workspace folder is temporarily inaccessible
  }

  const systemMessages: OpenAIMessage[] = [
    { role: "system", content: `${AGENT_SYSTEM_PROMPT}\n\n${treeText}` },
  ];

  let activeToolGroupId: string | null = null;
  const failureCounts = new Map<string, number>();

  const updateRow = (
    groupId: string,
    rowId: string,
    patch: Partial<ToolRowItem>,
    persist = false
  ) => {
    callbacks.onUpdateBlocks(
      (blocks) =>
        blocks.map((blk) => {
          if (blk.id !== groupId || blk.type !== "tool_group") return blk;
          return {
            ...blk,
            rows: blk.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
          };
        }),
      persist
    );
  };

  const maybeAutoCollapseGroup = (groupId: string | null) => {
    if (!groupId || verboseSteps) return;
    callbacks.onUpdateBlocks(
      (blocks) =>
        blocks.map((blk) => {
          if (blk.id !== groupId || blk.type !== "tool_group") return blk;
          const hasEdits = blk.rows.some(
            (r) => r.kind === "edit" || r.kind === "create"
          );
          const allSettled = blk.rows.every(
            (r) => r.status !== "running" && r.status !== "needs_approval"
          );
          if (!hasEdits && allSettled) {
            return { ...blk, collapsed: true };
          }
          return blk;
        }),
      true
    );
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) break;

    let lastPhase = step === 0 ? "Thinking…" : "Analyzing results…";
    callbacks.onPhase?.(lastPhase);
    const setPhase = (p: string) => {
      if (p !== lastPhase) {
        lastPhase = p;
        callbacks.onPhase?.(p);
      }
    };

    const payloadMessages = trimMessagesToContext(
      [...systemMessages, ...workingMessages],
      contextLimit
    );

    let thinkingBlockId: string | null = null;
    let latestStreamText = "";
    const flusher = createCoalescedFlusher(() => {
      if (!latestStreamText) return;
      if (!thinkingBlockId) {
        thinkingBlockId = uid("t");
        const createdId = thinkingBlockId;
        callbacks.onUpdateBlocks(
          (blocks) => [
            ...blocks,
            { id: createdId, type: "thinking", content: latestStreamText },
          ],
          false
        );
      } else {
        const targetId = thinkingBlockId;
        callbacks.onUpdateBlocks(
          (blocks) =>
            blocks.map((b) =>
              b.id === targetId && b.type === "thinking"
                ? { ...b, content: latestStreamText }
                : b
            ),
          false
        );
      }
    });

    let res;
    try {
      res = await streamChatCompletion({
        port,
        messages: payloadMessages,
        tools: AGENT_TOOLS,
        temperature,
        maxTokens,
        enableThinking,
        signal,
        onLiveSpeed: callbacks.onLiveSpeed,
        onReasoningDelta: (_delta, accReasoning) => {
          setPhase("Thinking…");
          const trimmed = accReasoning.trim();
          if (trimmed) {
            latestStreamText = trimmed;
            flusher.schedule();
          }
        },
        onToolCallStart: () => {
          setPhase("Generating tool call…");
        },
        onTextDelta: (_delta, accumulated) => {
          const cleaned = stripFallbackToolBlocks(accumulated);
          if (!cleaned) return;
          const { think, answer } = splitThinkTags(cleaned);
          if (think && !answer) {
            setPhase("Thinking…");
            latestStreamText = think;
            flusher.schedule();
          } else if (answer) {
            setPhase("Generating…");
            latestStreamText = think ? `${think}\n\n${answer}` : answer;
            flusher.schedule();
          }
        },
      });
      flusher.flush();
    } finally {
      flusher.cancel();
    }

    if (res.timings) {
      callbacks.onTimings(res.timings, res.promptTokens + res.completionTokens);
    }

    // Resolve tool calls (native or universal fallback formats)
    let toolCalls = res.toolCalls;
    if (toolCalls.length === 0 && res.content) {
      const fallback = parseFallbackToolBlocks(res.content);
      if (fallback.length > 0) {
        toolCalls = fallback.map((fb, idx) => ({
          id: `fallback_${step}_${idx}_${Date.now()}`,
          type: "function",
          function: {
            name: fb.name,
            arguments: JSON.stringify(fb.arguments),
          },
        }));
      }
    }

    // Plain answer with no tool calls -> finalize assistant response
    if (toolCalls.length === 0) {
      setPhase("Finalizing…");
      maybeAutoCollapseGroup(activeToolGroupId);
      const { think, answer } = splitThinkTags(stripFallbackToolBlocks(res.content));
      const finalThink = res.reasoning.trim() || think;
      const finalText = answer || stripFallbackToolBlocks(res.content).trim();
      const finishedAt = new Date().toISOString();

      if (thinkingBlockId) {
        const tid = thinkingBlockId;
        if (finalThink && finalText) {
          callbacks.onUpdateBlocks(
            (blocks) => [
              ...blocks.map((b) =>
                b.id === tid && b.type === "thinking"
                  ? { ...b, content: finalThink }
                  : b
              ),
              {
                id: uid("a"),
                type: "assistant",
                content: finalText,
                timestamp: finishedAt,
              },
            ],
            true
          );
        } else {
          callbacks.onUpdateBlocks(
            (blocks) =>
              blocks.map((b) =>
                b.id === tid
                  ? {
                      id: tid,
                      type: "assistant",
                      content: finalText,
                      timestamp: finishedAt,
                    }
                  : b
              ),
            true
          );
        }
      } else if (finalText) {
        callbacks.onUpdateBlocks(
          (blocks) => [
            ...blocks,
            {
              id: uid("a"),
              type: "assistant",
              content: finalText,
              timestamp: finishedAt,
            },
          ],
          true
        );
      }
      workingMessages.push({ role: "assistant", content: finalText });
      callbacks.onUpdateMessages(workingMessages, true);
      return;
    }

    setPhase("Running tools…");

    // Text arrived between tool groups -> start a fresh ToolGroup
    if (thinkingBlockId) {
      maybeAutoCollapseGroup(activeToolGroupId);
      activeToolGroupId = null;
    }

    workingMessages.push({
      role: "assistant",
      content: res.content || null,
      tool_calls: toolCalls,
    });

    if (!activeToolGroupId) {
      activeToolGroupId = uid("tg");
      const newGroupId = activeToolGroupId;
      callbacks.onUpdateBlocks(
        (blocks) => [
          ...blocks,
          { id: newGroupId, type: "tool_group", collapsed: false, rows: [] },
        ],
        false
      );
    }
    const groupId = activeToolGroupId;

    // Parse all tool calls in this step up front so read-only calls can run concurrently
    const parsedCalls = toolCalls.map((tc) => {
      const toolName = tc.function.name;
      try {
        const args = tc.function.arguments
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : {};
        return { tc, toolName, args, parseError: null as string | null };
      } catch (err) {
        return {
          tc,
          toolName,
          args: {} as Record<string, unknown>,
          parseError: `Invalid JSON arguments for ${toolName}: ${String(err)}`,
        };
      }
    });

    let i = 0;
    while (i < parsedCalls.length) {
      if (signal.aborted) break;

      const entry = parsedCalls[i];
      if (entry.parseError) {
        workingMessages.push({
          role: "tool",
          tool_call_id: entry.tc.id,
          name: entry.toolName,
          content: entry.parseError,
        });
        i += 1;
        continue;
      }

      if (entry.toolName === "finish") {
        setPhase("Finalizing…");
        const summary = String(entry.args.summary ?? "Done.");
        maybeAutoCollapseGroup(groupId);
        callbacks.onUpdateBlocks(
          (blocks) => [
            ...blocks,
            {
              id: uid("a"),
              type: "assistant",
              content: summary,
              timestamp: new Date().toISOString(),
            },
          ],
          true
        );
        workingMessages.push({
          role: "tool",
          tool_call_id: entry.tc.id,
          name: entry.toolName,
          content: "Finished.",
        });
        callbacks.onUpdateMessages(workingMessages, true);
        return;
      }

      // Batch consecutive read-only tool calls in parallel for maximum speed
      if (READ_ONLY_TOOLS.has(entry.toolName)) {
        const batch: typeof parsedCalls = [];
        while (
          i < parsedCalls.length &&
          !parsedCalls[i].parseError &&
          READ_ONLY_TOOLS.has(parsedCalls[i].toolName)
        ) {
          batch.push(parsedCalls[i]);
          i += 1;
        }

        const prepared = batch.map((item) => {
          const pres = mapToolPresentation(item.toolName, item.args);
          const rowId = uid("row");
          const row: ToolRowItem = {
            id: rowId,
            kind: pres.kind,
            verb: pres.verb,
            target: pres.target,
            status: "running",
            toolName: item.toolName,
            args: item.args,
          };
          return { item, rowId, row };
        });

        callbacks.onUpdateBlocks(
          (blocks) =>
            blocks.map((blk) =>
              blk.id === groupId && blk.type === "tool_group"
                ? { ...blk, rows: [...blk.rows, ...prepared.map((p) => p.row)] }
                : blk
            ),
          false
        );

        const batchResults = await Promise.all(
          prepared.map(async ({ item, rowId }) => {
            const { toolName, args } = item;
            try {
              if (toolName === "list_dir") {
                const items = await listDir(workspacePath, String(args.path ?? "."), 2, 200);
                const text =
                  items.map((it) => (it.is_dir ? `${it.path}/` : it.path)).join("\n") ||
                  "(empty)";
                updateRow(groupId, rowId, { status: "done", output: text }, false);
                return { item, text, failed: false };
              }
              if (toolName === "read_file") {
                const resFile = await readFile(
                  workspacePath,
                  String(args.path ?? ""),
                  typeof args.start_line === "number" ? args.start_line : undefined,
                  typeof args.end_line === "number" ? args.end_line : undefined
                );
                const previewLines = resFile.content.split("\n").slice(0, 30).join("\n");
                const text = resFile.truncated
                  ? `${resFile.content}\n[Truncated at 200 KB; ${resFile.total_lines} lines total]`
                  : resFile.content;
                updateRow(groupId, rowId, { status: "done", output: previewLines }, false);
                return { item, text, failed: false };
              }
              // search_files
              const hits = await searchFiles(
                workspacePath,
                String(args.query ?? ""),
                typeof args.glob === "string" ? args.glob : undefined
              );
              const text =
                hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n") ||
                "No matches found.";
              updateRow(
                groupId,
                rowId,
                {
                  status: "done",
                  target: `"${String(args.query ?? "")}" · ${hits.length} ${
                    hits.length === 1 ? "match" : "matches"
                  }`,
                  output: text,
                },
                false
              );
              return { item, text, failed: false };
            } catch (err) {
              const text = `Error: ${String(err)}`;
              updateRow(groupId, rowId, { status: "error", output: text }, false);
              return { item, text, failed: true };
            }
          })
        );

        for (const br of batchResults) {
          const sig = `${br.item.toolName}:${JSON.stringify(br.item.args)}`;
          if (br.failed) {
            const count = (failureCounts.get(sig) ?? 0) + 1;
            failureCounts.set(sig, count);
            if (count >= 3) {
              maybeAutoCollapseGroup(groupId);
              callbacks.onUpdateBlocks(
                (blocks) => [
                  ...blocks,
                  {
                    id: uid("a"),
                    type: "assistant",
                    content: `Stopped because \`${br.item.toolName}\` failed 3 times with the same arguments:\n\n\`\`\`\n${br.text}\n\`\`\``,
                    timestamp: new Date().toISOString(),
                  },
                ],
                true
              );
              callbacks.onUpdateMessages(workingMessages, true);
              return;
            }
          }
          workingMessages.push({
            role: "tool",
            tool_call_id: br.item.tc.id,
            name: br.item.toolName,
            content: truncateToolOutput(br.text, maxToolResultChars),
          });
        }
        continue;
      }

      // Sequential execution for mutating / approval-gated tools
      i += 1;
      const { tc, toolName, args } = entry;
      const pres = mapToolPresentation(toolName, args);
      const rowId = uid("row");
      const initialRow: ToolRowItem = {
        id: rowId,
        kind: pres.kind,
        verb: pres.verb,
        target: pres.target,
        status: "running",
        toolName,
        args,
      };

      callbacks.onUpdateBlocks(
        (blocks) =>
          blocks.map((blk) =>
            blk.id === groupId && blk.type === "tool_group"
              ? { ...blk, rows: [...blk.rows, initialRow] }
              : blk
          ),
        false
      );

      const sig = `${toolName}:${JSON.stringify(args)}`;
      let toolResultText = "";
      let failed = false;

      try {
        if (toolName === "write_file" || toolName === "replace_in_file") {
          const rel = String(args.path ?? "");
          const preview =
            toolName === "write_file"
              ? await previewWrite(workspacePath, rel, String(args.content ?? ""))
              : await previewReplace(
                  workspacePath,
                  rel,
                  String(args.old_text ?? ""),
                  String(args.new_text ?? "")
                );

          updateRow(
            groupId,
            rowId,
            {
              kind: preview.is_new ? "create" : "edit",
              verb: preview.is_new ? "Create" : "Edit",
              diff: {
                oldText: preview.old_text,
                newText: preview.new_text,
                added: preview.added,
                removed: preview.removed,
              },
            },
            false
          );

          let approved = mode === "auto";
          if (!approved) {
            updateRow(groupId, rowId, { status: "needs_approval" }, true);
            setPhase("Waiting for approval…");
            approved = await callbacks.requestApproval(groupId, rowId);
            setPhase("Running tools…");
          }

          if (signal.aborted) {
            updateRow(groupId, rowId, { status: "stopped" }, true);
            break;
          }
          if (!approved) {
            updateRow(groupId, rowId, { status: "rejected" }, true);
            toolResultText = "User rejected this edit.";
          } else {
            await applyWrite(workspacePath, rel, preview.new_text);
            updateRow(groupId, rowId, { status: "done" }, true);
            toolResultText = `Updated ${rel} (+${preview.added} -${preview.removed}).`;
          }
        } else if (toolName === "run_command") {
          const cmdStr = String(args.command ?? "");
          const dangerous = await isDangerousCommand(cmdStr);
          let approved = mode === "auto" && !dangerous;
          if (!approved) {
            updateRow(groupId, rowId, { status: "needs_approval", dangerous }, true);
            setPhase("Waiting for approval…");
            approved = await callbacks.requestApproval(groupId, rowId);
            setPhase("Running tools…");
          }

          if (signal.aborted) {
            updateRow(groupId, rowId, { status: "stopped" }, true);
            break;
          }
          if (!approved) {
            updateRow(groupId, rowId, { status: "rejected" }, true);
            toolResultText = "User rejected running this command.";
          } else {
            updateRow(groupId, rowId, { status: "running", dangerous }, false);
            const shellArg =
              args.shell === "powershell" || args.shell === "cmd"
                ? args.shell
                : undefined;
            const cmdRes = await runCommand(workspacePath, cmdStr, shellArg, 120);
            const combined = [
              `exit_code: ${cmdRes.exit_code}`,
              cmdRes.stdout_tail ? `stdout:\n${cmdRes.stdout_tail}` : "",
              cmdRes.stderr_tail ? `stderr:\n${cmdRes.stderr_tail}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            failed = cmdRes.exit_code !== 0;
            updateRow(
              groupId,
              rowId,
              {
                status: failed ? "error" : "done",
                output: combined,
              },
              true
            );
            toolResultText = combined;
          }
        } else {
          failed = true;
          toolResultText = `Unknown tool: ${toolName}`;
          updateRow(groupId, rowId, { status: "error", output: toolResultText }, true);
        }
      } catch (err) {
        failed = true;
        toolResultText = `Error: ${String(err)}`;
        updateRow(groupId, rowId, { status: "error", output: toolResultText }, true);
      }

      if (failed) {
        const count = (failureCounts.get(sig) ?? 0) + 1;
        failureCounts.set(sig, count);
        if (count >= 3) {
          maybeAutoCollapseGroup(groupId);
          callbacks.onUpdateBlocks(
            (blocks) => [
              ...blocks,
              {
                id: uid("a"),
                type: "assistant",
                content: `Stopped because \`${toolName}\` failed 3 times with the same arguments:\n\n\`\`\`\n${toolResultText}\n\`\`\``,
                timestamp: new Date().toISOString(),
              },
            ],
            true
          );
          callbacks.onUpdateMessages(workingMessages, true);
          return;
        }
      }

      workingMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: toolName,
        content: truncateToolOutput(toolResultText, maxToolResultChars),
      });
    }

    callbacks.onUpdateMessages(workingMessages, true);
  }

  maybeAutoCollapseGroup(activeToolGroupId);
  if (!signal.aborted) {
    callbacks.onUpdateBlocks(
      (blocks) => [
        ...blocks,
        {
          id: uid("a"),
          type: "assistant",
          content: `Reached the ${MAX_STEPS}-step limit for this turn. You can ask me to continue if more steps are needed.`,
          timestamp: new Date().toISOString(),
        },
      ],
      true
    );
  }
}
