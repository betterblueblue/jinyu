import { streamChat, type ChatClientOptions } from "@/providers/chat";

/**
 * 简化版的模型调用（2026-11-06，用户定：另做一套，不动现有系统）。
 *
 * 和现在的系统比只差两处：一段短提示词、思考档位 low。
 * 盲选（data/eval/simple-vs-current，scripts/simple-vs-current/）这样写的名字用户 17 比 3 选它；
 * 完整起名从 xhigh 中位 142 秒降到 47 秒。不验收重试：程序检查只把有问题的名字去掉。
 * 输出上限 8192：4096 时没写出 JSON 的有 6 次（直播起名 2、完整起名 3、打分改字 1）。
 * 那 6 次当时以为是推理吃光预算；后来查到至少有一部分是网关中途断线，评测脚本当时没认流里的 error（现在 streamChat 认了）。
 */

export const SIMPLE_SYSTEM = "你是一位懂汉字、懂古典诗文的起名老师，说话像跟家长聊天，具体、不说空话。只输出一个 JSON 对象。";
const MAX_TOKENS = 8192;

export function simpleClient(): ChatClientOptions | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || process.env.LLM_USE_FAKE === "true" || process.env.LLM_USE_FAKE === "1") return null;
  return {
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
    temperature: 0.6,
    reasoningEffort: "low",
  };
}

export interface SimpleCallResult {
  json: Record<string, unknown> | null;
  finishReason: string | null;
  reasoningChars: number;
  firstTokenMs: number;
}

/**
 * 调一次模型。onThinking 收推理增量（提词页「模型正在看」），onContent 收正文增量（边写边拆出名字）。
 * 网关中途断线：streamChat 已经会认（2026-11-06 修），正文没开始就重发一次，写到一半断就把写出来的交回来（finishReason "error"）。
 */
export async function simpleCall(
  user: string,
  opts: { onThinking?: (chunk: string) => void; onContent?: (chunk: string) => void; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SimpleCallResult> {
  const client = simpleClient();
  if (!client) throw new Error("没有配模型（LLM_API_KEY）");
  const r = await streamChat(client, {
    messages: [
      { role: "system", content: SIMPLE_SYSTEM },
      { role: "user", content: user },
    ],
    maxTokens: MAX_TOKENS,
    ...(opts.onThinking ? { onThinking: opts.onThinking } : {}),
    ...(opts.onContent ? { onContent: opts.onContent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    timeoutMs: opts.timeoutMs ?? 120_000,
    idleTimeoutMs: 45_000,
  });
  return { json: parseObject(r.content), finishReason: r.finishReason, reasoningChars: r.reasoningChars, firstTokenMs: r.firstTokenMs };
}

/** 没拿到能用的 JSON 时给人看的原因 */
export function failText(finishReason: string | null): string {
  if (finishReason === "length") return "模型写得太长被截断了";
  if (finishReason === "error") return "模型写到一半网关断线了";
  return "模型没按格式写";
}

export function parseObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  for (const s of [t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    if (!s) continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* 试下一种 */
    }
  }
  return null;
}

/**
 * 边写边拆：正文是 {"names":[{...},{...}]} 这种，key 数组里每写完一个对象就交出来。
 * 只按括号深度和字符串引号扫，不解析整段（整段要等写完）。
 */
export function arrayItemReader(key: string, onItem: (item: Record<string, unknown>) => void): (chunk: string) => void {
  let buf = "";
  let scanned = 0;
  let inArray = false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  return (chunk) => {
    buf += chunk;
    if (!inArray) {
      const m = buf.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
      if (!m || m.index === undefined) return;
      inArray = true;
      scanned = m.index + m[0].length;
    }
    for (; scanned < buf.length; scanned++) {
      const ch = buf[scanned]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") {
        if (depth === 0) start = scanned;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          const v = parseObject(buf.slice(start, scanned + 1));
          if (v) onItem(v);
          start = -1;
        }
      } else if (ch === "]" && depth === 0) {
        inArray = false;
        buf = buf.slice(scanned + 1);
        scanned = 0;
        return;
      }
    }
  };
}

export const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const strs = (v: unknown, n: number, max = 120): string[] => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** 推理增量拆成一句一句（提词页「模型正在看」），太短、像格式说明的不要 */
export function thoughtSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    const parts = buf.split(/(?<=[。！？\n])/);
    // 最后一段没有句号才是半句，留着等下一块；正好以句号结尾的这一段是整句，照样交出去
    buf = /[。！？\n]$/.test(parts[parts.length - 1] ?? "") ? "" : (parts.pop() ?? "");
    for (const p of parts) {
      const line = p.replace(/\s+/g, " ").trim();
      if (line.length >= 8 && line.length <= 80 && !/json|JSON|格式|字段|输出/.test(line)) onLine(line);
    }
  };
}
