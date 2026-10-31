import { extractJson, streamChat, type ChatClientOptions } from "@/providers/chat";
import { buildCitePrompt, buildFastSystem, buildFastUser } from "./prompt";
import type { FastRequest } from "./types";

/**
 * 精简版 provider：一次调用，只取 4 个字段。
 *
 * 与完整版 StepFunProvider 的区别（都是刻意的）：
 * - 不设 reasoning_effort。完整版挂的是 "xhigh"，实测该项目里 effort 对耗时无影响，
 *   挂最慢的一档纯属白等。
 * - max_tokens 2048（完整版 8192）。6 个名 + 6 句 why 约 300 token，够用。
 * - 截断/解析失败只重试一次，且不清空已拿到的结果。
 */

const MAX_TOKENS = 4096;
const RETRY_MAX_TOKENS = 8192;

export interface RawFast {
  givenName: string;
  why?: string;
  source?: string;
  piece?: string;
  /** 模型想引的那一句原话，由 cite.ts 逐字核 */
  line?: string;
}

export interface FastClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class FastProvider {
  private readonly client: ChatClientOptions;

  constructor(opts: FastClientOptions) {
    // reasoning_effort 必须显式 low。实测（同一提示词，2026-10-31）：
    //   默认档 → 12.7s，推理吃满 2048 token，finish=length，只出 4 个名还被截断
    //   low   →  5.2s，835 token，finish=stop，6 个名完整
    // 这就是「限推理」最有效的那个旋钮，别删。
    this.client = { ...opts, temperature: 0.5, reasoningEffort: "low" };
  }

  async draft(req: FastRequest, baziPillars?: string): Promise<RawFast[]> {
    const messages = [
      { role: "system" as const, content: buildFastSystem() },
      { role: "user" as const, content: buildFastUser(req, baziPillars) },
    ];

    const first = await streamChat(this.client, { messages, maxTokens: MAX_TOKENS });
    let list = parseFast(first.content);

    if (list.length === 0 || first.finishReason === "length") {
      const retry = await streamChat(this.client, { messages, maxTokens: RETRY_MAX_TOKENS });
      const retryList = parseFast(retry.content);
      if (retryList.length > list.length) list = retryList;
    }

    if (!list.length) {
      throw new Error("模型没有返回可用的名字");
    }
    return list;
  }

  /**
   * 只给一个名字补出处。仅在「首推没出处」时兜底调用，触发率约 20%。
   * 想不出就返回 null，调用方留白——不编。
   */
  async citeOne(givenName: string): Promise<{ source?: string; piece?: string; line?: string } | null> {
    const p = buildCitePrompt(givenName);
    const { content } = await streamChat(this.client, {
      messages: [
        { role: "system" as const, content: p.system },
        { role: "user" as const, content: p.user },
      ],
      maxTokens: 512,
    });
    const json = extractJson(content);
    if (!json) return null;
    try {
      const o = JSON.parse(json) as { source?: string; piece?: string; line?: string };
      const source = (o.source ?? "").trim();
      const piece = (o.piece ?? "").trim();
      const line = (o.line ?? "").trim();
      if (!source && !piece) return null;
      return {
        ...(source ? { source } : {}),
        ...(piece ? { piece } : {}),
        ...(line ? { line } : {}),
      };
    } catch {
      return null;
    }
  }
}

function parseFast(content: string): RawFast[] {
  const jsonText = extractJson(content);
  if (!jsonText) return salvage(content);
  try {
    const parsed = JSON.parse(jsonText) as { candidates?: RawFast[]; names?: RawFast[] };
    const list = parsed.candidates ?? parsed.names ?? [];
    return clean(list);
  } catch {
    return salvage(content);
  }
}

/** 被 max_tokens 截断时，把已经完整的对象捞回来 */
function salvage(content: string): RawFast[] {
  const out: RawFast[] = [];
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    try {
      const obj = JSON.parse(m[0]) as Record<string, unknown>;
      if (typeof obj.givenName === "string") out.push(obj as unknown as RawFast);
    } catch {
      /* 半截对象跳过 */
    }
  }
  return clean(out);
}

function clean(list: RawFast[]): RawFast[] {
  return list
    .filter((c) => c && typeof c.givenName === "string")
    .map((c) => ({
      givenName: String(c.givenName).trim(),
      why: c.why ? String(c.why).trim() : undefined,
      source: c.source ? String(c.source).trim() : undefined,
      piece: c.piece ? String(c.piece).trim() : undefined,
      line: c.line ? String(c.line).trim() : undefined,
    }));
}

export function createFastProvider(): FastProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY 缺失（检查 .env.local）");
  return new FastProvider({
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
  });
}
