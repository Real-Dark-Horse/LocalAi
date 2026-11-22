import type { InferenceTimings, OpenAIMessage } from "../types";
import type { ToolDefinition } from "./tools";
import { buildFallbackToolsPrompt } from "./prompts";

export interface StreamCompletionOptions {
  port: number;
  messages: OpenAIMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  signal?: AbortSignal;
  onTextDelta?: (delta: string, accumulated: string) => void;
  onReasoningDelta?: (delta: string, accumulated: string) => void;
  onToolCallStart?: () => void;
  onLiveSpeed?: (tokPerSec: number) => void;
}

export interface StreamCompletionResult {
  content: string;
  reasoning: string;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  timings: InferenceTimings | null;
  promptTokens: number;
  completionTokens: number;
}

interface RawToolCallDelta {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface PortCapabilities {
  supportsTools: boolean;
  supportsSystemRole: boolean;
  supportsTemplateKwargs: boolean;
  supportsReasoningBudget: boolean;
  strictAlternation: boolean;
}

const portCaps = new Map<number, PortCapabilities>();

function getCaps(port: number): PortCapabilities {
  let caps = portCaps.get(port);
  if (!caps) {
    caps = {
      supportsTools: true,
      supportsSystemRole: true,
      supportsTemplateKwargs: true,
      supportsReasoningBudget: true,
      strictAlternation: false,
    };
    portCaps.set(port, caps);
  }
  return caps;
}

export function resetPortCapabilities(port?: number): void {
  if (typeof port === "number") {
    portCaps.delete(port);
  } else {
    portCaps.clear();
  }
}

/** O(1) tail-only repetition check that ignores normal code/markdown dividers and whitespace. */
export function isRepetitionLoop(text: string): boolean {
  if (text.length < 48) return false;
  const tail = text.slice(-200);
  // 40+ identical non-formatting characters in a row
  if (/([^\s\-=#/*_.~|+])\1{39,}/.test(tail)) {
    return true;
  }
  // 12-40 char chunk with alphanumeric content repeated 6+ times consecutively at the tail
  const phraseMatch = tail.match(/(.{12,40}?)\1{5,}$/);
  if (phraseMatch && /[a-zA-Z0-9]/.test(phraseMatch[1])) {
    return true;
  }
  return false;
}

function adaptMessagesForCaps(
  messages: OpenAIMessage[],
  tools: ToolDefinition[] | undefined,
  caps: PortCapabilities
): OpenAIMessage[] {
  const needsFallbackTools = !caps.supportsTools && Boolean(tools && tools.length > 0);
  let adapted: OpenAIMessage[] = messages.map((m) => ({ ...m }));

  // Inject prompt-based tool schema if native OpenAI tools are unsupported by this model's template
  if (needsFallbackTools && tools) {
    const toolsDoc = buildFallbackToolsPrompt(tools);
    if (adapted.length > 0 && adapted[0].role === "system") {
      adapted[0] = {
        ...adapted[0],
        content: `${adapted[0].content ?? ""}\n\n${toolsDoc}`,
      };
    } else {
      adapted.unshift({ role: "system", content: toolsDoc });
    }
  }

  // Convert tool_calls and role:"tool" into plain assistant/user text when native tools are off
  if (!caps.supportsTools) {
    adapted = adapted.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: `Tool result (${m.name ?? "tool"}):\n${m.content ?? ""}`,
        };
      }
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        const blocks = m.tool_calls
          .map((tc) => {
            let parsedArgs: unknown = tc.function.arguments;
            try {
              parsedArgs = JSON.parse(tc.function.arguments || "{}");
            } catch {
              // Keep raw string if malformed
            }
            return `\`\`\`tool\n${JSON.stringify({ name: tc.function.name, arguments: parsedArgs })}\n\`\`\``;
          })
          .join("\n");
        const prefix = m.content ? `${m.content}\n\n` : "";
        return {
          role: "assistant" as const,
          content: `${prefix}${blocks}`,
        };
      }
      return {
        role: m.role,
        content: m.content ?? "",
      };
    });
  }

  // Fold system message into first user message for strict templates (e.g., Gemma 2, older Mistral)
  if (!caps.supportsSystemRole && adapted.length > 0 && adapted[0].role === "system") {
    const sysText = adapted[0].content ?? "";
    adapted = adapted.slice(1);
    if (sysText.trim()) {
      const firstUserIdx = adapted.findIndex((m) => m.role === "user");
      if (firstUserIdx !== -1) {
        adapted[firstUserIdx] = {
          ...adapted[firstUserIdx],
          content: `${sysText}\n\n---\n\n${adapted[firstUserIdx].content ?? ""}`,
        };
      } else {
        adapted.unshift({ role: "user", content: sysText });
      }
    }
  }

  // Enforce strict user/assistant alternation when required (or after converting tool -> user)
  if (caps.strictAlternation || !caps.supportsTools) {
    const merged: OpenAIMessage[] = [];
    for (const msg of adapted) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.role === msg.role &&
        (msg.role === "user" || msg.role === "assistant") &&
        !prev.tool_calls &&
        !msg.tool_calls
      ) {
        prev.content = `${prev.content ?? ""}\n\n${msg.content ?? ""}`.trim();
      } else {
        merged.push({ ...msg });
      }
    }
    adapted = merged;
  }

  return adapted;
}

function buildRequestBody(
  opts: StreamCompletionOptions,
  caps: PortCapabilities
): Record<string, unknown> {
  const messages = adaptMessagesForCaps(opts.messages, opts.tools, caps);
  const body: Record<string, unknown> = {
    model: "local",
    messages,
    stream: true,
    cache_prompt: true,
    temperature: opts.temperature ?? 0.2,
    top_p: 0.9,
    min_p: 0.05,
    max_tokens: opts.maxTokens ?? 4096,
    repeat_penalty: 1.05,
  };

  if (caps.supportsTemplateKwargs) {
    body.chat_template_kwargs = {
      enable_thinking: opts.enableThinking ?? false,
    };
  }
  if (caps.supportsReasoningBudget && !(opts.enableThinking ?? false)) {
    body.reasoning_budget = 0;
  }
  if (caps.supportsTools && opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
  }

  return body;
}

function tryDowngradeCapsFromError(
  errText: string,
  caps: PortCapabilities,
  hasTools: boolean
): boolean {
  const lower = errText.toLowerCase();
  let changed = false;

  if (
    caps.supportsReasoningBudget &&
    (lower.includes("reasoning_budget") || lower.includes("unknown parameter"))
  ) {
    caps.supportsReasoningBudget = false;
    changed = true;
  }
  if (
    caps.supportsTemplateKwargs &&
    (lower.includes("chat_template_kwargs") || lower.includes("enable_thinking"))
  ) {
    caps.supportsTemplateKwargs = false;
    changed = true;
  }
  if (
    caps.supportsSystemRole &&
    (lower.includes("system role not supported") ||
      lower.includes("system message") ||
      (lower.includes("alternate") && lower.includes("user/assistant")))
  ) {
    caps.supportsSystemRole = false;
    caps.strictAlternation = true;
    changed = true;
  }
  if (
    !caps.strictAlternation &&
    (lower.includes("alternate") || lower.includes("consecutive") || lower.includes("role"))
  ) {
    caps.strictAlternation = true;
    changed = true;
  }
  if (
    caps.supportsTools &&
    hasTools &&
    (lower.includes("tool") ||
      lower.includes("template") ||
      lower.includes("jinja") ||
      lower.includes("grammar") ||
      lower.includes("json"))
  ) {
    caps.supportsTools = false;
    caps.strictAlternation = true;
    changed = true;
  }

  // Broad fallback if server returned 400/500 on template rendering without specific keyword
  if (!changed && (lower.includes("template") || lower.includes("jinja") || lower.includes("failed to render"))) {
    if (caps.supportsTools && hasTools) {
      caps.supportsTools = false;
      caps.strictAlternation = true;
      changed = true;
    } else if (caps.supportsSystemRole) {
      caps.supportsSystemRole = false;
      caps.strictAlternation = true;
      changed = true;
    } else if (caps.supportsTemplateKwargs) {
      caps.supportsTemplateKwargs = false;
      changed = true;
    }
  }

  return changed;
}

export async function streamChatCompletion(
  opts: StreamCompletionOptions
): Promise<StreamCompletionResult> {
  const url = `http://127.0.0.1:${opts.port}/v1/chat/completions`;
  const caps = getCaps(opts.port);
  const hasTools = Boolean(opts.tools && opts.tools.length > 0);

  let res: Response | null = null;
  let lastErr = "";

  // Up to 3 automatic compatibility adaptations for universal model support
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = buildRequestBody(opts, caps);
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (res.ok) break;

    lastErr = await res.text().catch(() => res!.statusText);
    if ((res.status === 400 || res.status === 500) && attempt < 2) {
      const adapted = tryDowngradeCapsFromError(lastErr, caps, hasTools);
      if (adapted) {
        continue;
      }
    }
    throw new Error(`llama-server error (${res.status}): ${lastErr}`);
  }

  if (!res || !res.ok) {
    throw new Error(`llama-server error: ${lastErr}`);
  }
  if (!res.body) {
    throw new Error("llama-server returned an empty response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let announcedToolCall = false;
  let generatedChunks = 0;
  let firstGenAt = 0;
  let lastSpeedEmitAt = 0;
  const toolMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let timings: InferenceTimings | null = null;
  let promptTokens = 0;
  let completionTokens = 0;

  const maybeEmitLiveSpeed = () => {
    const now = performance.now();
    if (firstGenAt === 0) firstGenAt = now;
    generatedChunks += 1;
    if (now - lastSpeedEmitAt < 350) return;
    const elapsed = (now - firstGenAt) / 1000;
    if (elapsed > 0.35 && generatedChunks > 2) {
      lastSpeedEmitAt = now;
      opts.onLiveSpeed?.(generatedChunks / elapsed);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (parsed.timings && typeof parsed.timings === "object") {
        const t = parsed.timings as Record<string, unknown>;
        const predicted_n = Number(t.predicted_n ?? 0);
        const prompt_n = Number(t.prompt_n ?? 0);
        timings = {
          predicted_per_second: Number(t.predicted_per_second ?? 0),
          prompt_per_second: Number(t.prompt_per_second ?? 0),
          prompt_n,
          predicted_n,
        };
        promptTokens = prompt_n;
        completionTokens = predicted_n;
      }

      if (parsed.usage && typeof parsed.usage === "object") {
        const u = parsed.usage as Record<string, unknown>;
        if (typeof u.prompt_tokens === "number") promptTokens = u.prompt_tokens;
        if (typeof u.completion_tokens === "number") {
          completionTokens = u.completion_tokens;
        }
      }

      const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
      const choice = choices?.[0];
      if (!choice) continue;
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      const reasoningDelta =
        typeof delta.reasoning_content === "string"
          ? delta.reasoning_content
          : typeof delta.reasoning === "string"
            ? delta.reasoning
            : "";

      if (reasoningDelta.length > 0) {
        maybeEmitLiveSpeed();
        reasoning += reasoningDelta;
        if (isRepetitionLoop(reasoning)) {
          await reader.cancel().catch(() => {});
          throw new Error("Model entered a repetition loop. Please retry.");
        }
        opts.onReasoningDelta?.(reasoningDelta, reasoning);
      }

      if (typeof delta.content === "string" && delta.content.length > 0) {
        maybeEmitLiveSpeed();
        content += delta.content;
        if (isRepetitionLoop(content)) {
          await reader.cancel().catch(() => {});
          throw new Error("Model entered a repetition loop. Please retry.");
        }
        opts.onTextDelta?.(delta.content, content);
      }

      if (Array.isArray(delta.tool_calls)) {
        if (!announcedToolCall) {
          announcedToolCall = true;
          opts.onToolCallStart?.();
        }
        for (const tc of delta.tool_calls as RawToolCallDelta[]) {
          const idx = tc.index ?? 0;
          const existing = toolMap.get(idx) ?? {
            id: tc.id || `call_${idx}_${Date.now()}`,
            name: "",
            arguments: "",
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolMap.set(idx, existing);
        }
      }
    }
  }

  const toolCalls = Array.from(toolMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));

  return {
    content,
    reasoning,
    toolCalls,
    timings,
    promptTokens,
    completionTokens,
  };
}
