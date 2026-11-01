import { extractJson, streamChat, type ChatClientOptions } from "@/providers/chat";
import { buildFastSystem, buildFastUser, type FastPromptRound } from "./prompt";
import type { FastRequest } from "./types";

/**
 * 精简版 provider：一次调用，取名字和 why 两个字段。
 *
 * 出处字段（source/piece/line）提示词已经不要了，但模型自己给了照样解析，交给 run.ts 逐字核。
 * 原来的「首推没出处就单独补查一次」已删：提示词不要出处以后它每轮都会触发，白白多 2–3 秒。
 *
 * 与完整版 StepFunProvider 的区别（都是刻意的）：
 * - reasoning_effort 显式 low（见构造函数注释）。
 * - max_tokens 4096（完整版 8192）。5 个名 + 5 句 why 约 250 token，余量给推理。
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

/** 提示词怎么拼。线上用 prompt.ts 那一套；评测脚本（scripts/eval-fast.ts）换别的版本来比 */
export interface FastPromptBuilders {
  system: () => string;
  user: (req: FastRequest, round: FastPromptRound) => string;
}

export interface FastClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 第一路多久没回就补发第二路，默认 HEDGE_MS；测试可调小 */
  hedgeMs?: number;
  /** 不传就用 prompt.ts */
  prompt?: FastPromptBuilders;
}

/**
 * 补发：第一路 5 秒没回，就再发一路，谁先成功用谁，另一路取消。
 *
 * 为什么（2026-10-31，只用 DeepSeek v4.1 Flash）：慢轮次是模型那一轮自己想多了（推理 1000–3600 字），
 * 不是网关排队——第一个字都在 0.7 秒内到。两路同时跑时首字仍在 0.3–0.6 秒，网关扛得住。
 *
 * 补发那一路要**换一组起手字**（调用方传 hedgeRound）：第一版补发一模一样的请求，
 * 沈姓 20 轮补发了 10 轮、只赢 2 轮——难配的那组字两路一样难，一起慢。
 * 第一路在 5 秒内就报错的，立刻补发，相当于自动重试一次。代价：慢的那些轮次多一次模型调用。
 */
export const HEDGE_MS = 5000;

/** 一次 draft 的耗时构成：推理字数是 3–5 秒预算里唯一还能压的部分 */
export interface DraftStats {
  reasoningChars: number;
  firstTokenMs: number;
  retried: boolean;
  finishReason: string | null;
  /** 这一轮补发过第二路 */
  hedged: boolean;
  /** 最后用的是补发的那一路 */
  hedgeWon: boolean;
  /** 最后用的是第几路：0 是第一路，1 起是补发的（第几组起手字） */
  lane: number;
}

type LaneResult = { list: RawFast[]; stats: Omit<DraftStats, "hedged" | "hedgeWon" | "lane"> };

export class FastProvider {
  private readonly client: ChatClientOptions;
  private readonly hedgeMs: number;
  private readonly prompt: FastPromptBuilders;
  /** 最近一次 draft 的耗时构成，写给 run.ts 的 debug，不进提示词、不影响结果 */
  lastDraft: DraftStats = {
    reasoningChars: 0,
    firstTokenMs: -1,
    retried: false,
    finishReason: null,
    hedged: false,
    hedgeWon: false,
    lane: 0,
  };

  constructor(opts: FastClientOptions) {
    const { hedgeMs, prompt, ...client } = opts;
    this.prompt = prompt ?? { system: buildFastSystem, user: buildFastUser };
    // reasoning_effort 必须显式 low。实测（同一提示词，2026-10-31）：
    //   默认档 → 12.7s，推理吃满 2048 token，finish=length，只出 4 个名还被截断
    //   low   →  5.2s，835 token，finish=stop，6 个名完整
    // 这就是「限推理」最有效的那个旋钮，别删。
    this.client = { ...client, temperature: 0.5, reasoningEffort: "low" };
    this.hedgeMs = hedgeMs ?? HEDGE_MS;
  }

  /**
   * @param round  第一路用的这一轮参数
   * @param hedge  补发用的参数（每一路换一组起手字）：给一组就补发一路，给两组就补发两路；不给就补发同样的请求
   */
  async draft(
    req: FastRequest,
    round: FastPromptRound,
    hedge?: FastPromptRound | readonly FastPromptRound[],
  ): Promise<RawFast[]> {
    const hedges = hedge === undefined ? [] : Array.isArray(hedge) ? hedge : [hedge as FastPromptRound];
    const messagesOf = (r: FastPromptRound) => [
      { role: "system" as const, content: this.prompt.system() },
      { role: "user" as const, content: this.prompt.user(req, r) },
    ];

    // 一路请求：截断/解析失败只重试一次，且不清空已拿到的结果。index 0 是第一路，1 起是补发的
    const lane = async (signal: AbortSignal, index: number): Promise<LaneResult> => {
      const messages = messagesOf(index === 0 ? round : (hedges[index - 1] ?? round));
      const first = await streamChat(this.client, { messages, maxTokens: MAX_TOKENS, signal });
      let list = parseFast(first.content);
      let stats: LaneResult["stats"] = {
        reasoningChars: first.reasoningChars,
        firstTokenMs: first.firstTokenMs,
        retried: false,
        finishReason: first.finishReason,
      };
      if (list.length === 0 || first.finishReason === "length") {
        const retry = await streamChat(this.client, { messages, maxTokens: RETRY_MAX_TOKENS, signal });
        const retryList = parseFast(retry.content);
        if (retryList.length > list.length) list = retryList;
        stats = {
          reasoningChars: stats.reasoningChars + retry.reasoningChars,
          firstTokenMs: retry.firstTokenMs,
          retried: true,
          finishReason: retry.finishReason,
        };
      }
      if (!list.length) throw new Error("模型没有返回可用的名字");
      return { list, stats };
    };

    const won = await this.race(lane, Math.max(1, hedges.length));
    this.lastDraft = { ...won.stats, hedged: won.hedged, hedgeWon: won.lane > 0, lane: won.lane };
    return won.list;
  }

  /**
   * 先发一路；hedgeMs 内没回（或已经报错）就把补发的几路一起发出去。谁先成功用谁，其余取消；全都失败才报错
   */
  private race(
    lane: (signal: AbortSignal, index: number) => Promise<LaneResult>,
    hedgeCount: number,
  ): Promise<LaneResult & { hedged: boolean; lane: number }> {
    return new Promise((resolve, reject) => {
      const controllers: AbortController[] = [];
      let settled = false;
      let failed = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const launch = (index: number) => {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        lane(ctrl.signal, index).then(
          (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            for (const c of controllers) if (c !== ctrl) c.abort();
            resolve({ ...value, hedged: controllers.length > 1, lane: index });
          },
          (err: unknown) => {
            if (settled) return;
            failed++;
            if (controllers.length === 1) {
              // 还没补发就失败了：立刻补发，不等满 hedgeMs
              clearTimeout(timer);
              launchHedges();
            } else if (failed >= controllers.length) {
              settled = true;
              reject(err);
            }
          },
        );
      };
      const launchHedges = () => {
        for (let i = 1; i <= hedgeCount; i++) launch(i);
      };

      launch(0);
      timer = setTimeout(() => {
        if (!settled && controllers.length === 1) launchHedges();
      }, this.hedgeMs);
    });
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

export function createFastProvider(prompt?: FastPromptBuilders): FastProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY 缺失（检查 .env.local）");
  // FAST_HEDGE_MS：补发等多久，不设就是 HEDGE_MS。设 0 等于每轮一开始就两路一起发
  const hedge = Number(process.env.FAST_HEDGE_MS);
  return new FastProvider({
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
    ...(process.env.FAST_HEDGE_MS && Number.isFinite(hedge) && hedge >= 0 ? { hedgeMs: hedge } : {}),
    ...(prompt ? { prompt } : {}),
  });
}
