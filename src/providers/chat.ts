/**
 * OpenAI 兼容 Chat Completions 的流式客户端。
 *
 * 取名和名字分析都走这一个入口，避免两份流解析代码各修各的。
 * 网关特性：推理增量可能在 delta.reasoning，也可能在 delta.reasoning_content，两个都读。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  reasoningEffort?: string;
}

/** 首轮预算：推理模型的推理 token 计入 max_tokens */
const DEFAULT_TIMEOUT_MS = 240_000;
const IDLE_TIMEOUT_MS = 90_000;

export interface ChatStreamResult {
  content: string;
  finishReason: string | null;
  /** 推理增量累计的字数。3–5 秒的预算全花在这上面，必须能看到 */
  reasoningChars: number;
  /** 第一个增量（推理或正文）到达的毫秒数，网关排队的地板 */
  firstTokenMs: number;
}

export async function streamChat(
  client: ChatClientOptions,
  args: {
    messages: ChatMessage[];
    maxTokens: number;
    onThinking?: (chunk: string) => void;
    timeoutMs?: number;
    idleTimeoutMs?: number;
    /** 调用方主动取消（精简版补发时，输掉的那一路要停掉，别白占网关） */
    signal?: AbortSignal;
  },
): Promise<ChatStreamResult> {
  const url = `${client.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (args.signal?.aborted) controller.abort();
  else args.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const totalTimer = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const pokeIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), args.idleTimeoutMs ?? IDLE_TIMEOUT_MS);
  };

  try {
    pokeIdle();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify({
        model: client.model,
        messages: args.messages,
        temperature: client.temperature ?? 0.5,
        max_tokens: args.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        response_format: { type: "json_object" },
        ...(client.reasoningEffort ? { reasoning_effort: client.reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) throw new Error("LLM 未返回响应体");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const t0 = Date.now();
    let buffer = "";
    let content = "";
    let finishReason: string | null = null;
    let reasoningChars = 0;
    let firstTokenMs = -1;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pokeIdle();
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let ev: {
            choices?: {
              delta?: { reasoning_content?: string; reasoning?: string; content?: string };
              finish_reason?: string | null;
            }[];
          };
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = ev.choices?.[0]?.delta;
          const thinking = delta?.reasoning_content ?? delta?.reasoning;
          if (firstTokenMs < 0 && (thinking || delta?.content)) firstTokenMs = Date.now() - t0;
          if (thinking) {
            reasoningChars += thinking.length;
            args.onThinking?.(thinking);
          }
          if (delta?.content) content += delta.content;
          if (ev.choices?.[0]?.finish_reason) {
            finishReason = ev.choices[0].finish_reason;
          }
        }
      }
    }

    return { content: content.trim(), finishReason, reasoningChars, firstTokenMs };
  } catch (err) {
    if (args.signal?.aborted) throw new Error("LLM 请求已取消");
    if (controller.signal.aborted) throw new Error("LLM 生成超时，请重试");
    throw err;
  } finally {
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    args.signal?.removeEventListener("abort", onCallerAbort);
  }
}

export function extractJson(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const lastObj = text.lastIndexOf("{");
  if (lastObj >= 0) {
    const end = text.lastIndexOf("}");
    if (end > lastObj) {
      const slice = text.slice(lastObj, end + 1);
      try {
        JSON.parse(slice);
        return slice;
      } catch {
        /* fall through */
      }
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}
