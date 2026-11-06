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

interface StreamArgs {
  messages: ChatMessage[];
  maxTokens: number;
  onThinking?: (chunk: string) => void;
  /** 正文增量，边收边交出去（改字要边写边核、写好一条推一条）。不传就只在最后一次性返回 */
  onContent?: (chunk: string) => void;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  /** 调用方主动取消（精简版补发时，输掉的那一路要停掉，别白占网关） */
  signal?: AbortSignal;
}

/**
 * 网关在流里报的错（`data: {"error":{...}}`）或连接中途断了。
 * network：断线、socket、5xx 这一类，重发一次多半能好；正文已经写出来的字放在 partial。
 */
export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly network: boolean,
    readonly partial: ChatStreamResult | null,
  ) {
    super(message);
  }
}

/** 还剩不到这么多时间就不重发了：重发也来不及写完 */
const RETRY_MIN_LEFT_MS = 5_000;

/**
 * 2026-11-06 修：网关中途断线时（`connection lost mid-reply (ECONNRESET)`）流里给的是一条 error，
 * 原来这里不认，当成空正文返回，调用方看到的是「模型没按格式写 / 没返回名字」，打分榜上王旭三次里两次这样。
 * 现在：
 *   - 正文一个字还没到就断（网络问题）：在剩下的时间里自动重发一次；
 *   - 正文已经写了一部分再断：把写出来的交回去（finishReason 记 "error"），调用方原来那套「截断了捞已完成的」照常用；
 *   - 别的错（网关报的业务错、重发也失败）：抛出来，报真正的原因。
 * 调用方原来就都 catch 了超时这类抛错，所以抛出来不会多出没接住的异常。
 */
export async function streamChat(client: ChatClientOptions, args: StreamArgs): Promise<ChatStreamResult> {
  const started = Date.now();
  const budget = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await streamChatOnce(client, args);
  } catch (err) {
    if (!(err instanceof ChatStreamError)) throw err;
    if (err.partial?.content) return { ...err.partial, finishReason: "error" };
    const left = budget - (Date.now() - started);
    if (!err.network || args.signal?.aborted || left < RETRY_MIN_LEFT_MS) throw err;
    return streamChatOnce(client, { ...args, timeoutMs: left });
  }
}

async function streamChatOnce(client: ChatClientOptions, args: StreamArgs): Promise<ChatStreamResult> {
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

  // 放在 try 外面：断线时要把已经写出来的交回去
  let content = "";
  let finishReason: string | null = null;
  let reasoningChars = 0;
  let firstTokenMs = -1;
  let gotResponse = false;
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

    gotResponse = true;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 5xx、429 是网关一时的问题，重发一次；4xx 是请求本身不对，重发也一样
      throw new ChatStreamError(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`, res.status >= 500 || res.status === 429, null);
    }
    if (!res.body) throw new Error("LLM 未返回响应体");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const t0 = Date.now();
    let buffer = "";

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
            error?: { message?: string };
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
          if (ev.error) {
            const msg = ev.error.message || "模型接口出错";
            throw new ChatStreamError(
              `LLM 流中报错：${msg.slice(0, 200)}`,
              /ECONNRESET|connection lost|socket|timed? ?out|overloaded|5\d\d/i.test(msg),
              { content: content.trim(), finishReason, reasoningChars, firstTokenMs },
            );
          }
          const delta = ev.choices?.[0]?.delta;
          const thinking = delta?.reasoning_content ?? delta?.reasoning;
          if (firstTokenMs < 0 && (thinking || delta?.content)) firstTokenMs = Date.now() - t0;
          if (thinking) {
            reasoningChars += thinking.length;
            args.onThinking?.(thinking);
          }
          if (delta?.content) {
            content += delta.content;
            args.onContent?.(delta.content);
          }
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
    if (err instanceof ChatStreamError) throw err;
    // fetch 本身失败、读流时 socket 断了：都是网络问题
    if (err instanceof TypeError || /ECONNRESET|socket|network|terminated|fetch failed/i.test(String(err))) {
      throw new ChatStreamError(
        `LLM 连接中断：${err instanceof Error ? err.message : String(err)}`,
        true,
        gotResponse ? { content: content.trim(), finishReason, reasoningChars, firstTokenMs } : null,
      );
    }
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
