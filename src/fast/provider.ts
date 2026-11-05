import { extractJson, streamChat, type ChatClientOptions } from "@/providers/chat";
import { buildFastSystem, buildFastUser, type FastPromptRound } from "./prompt";
import type { FastRequest, FastTierScores } from "./types";

/**
 * 精简版 provider：一轮发几路请求（默认两路一起发），每路取名字、why 和三个档位，回来的几路都交给调用方合起来用。
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
/** 单次模型请求最长等 15 秒（截断重试另算）：三路都没回就从名字库补位，不让直播台干等 240 秒 */
const LANE_TIMEOUT_MS = 15_000;

export interface RawFast {
  givenName: string;
  why?: string;
  /** 六维闸门用的三个档位数字；模型没给就回退旧规则 */
  scores?: FastTierScores;
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
  /** 第一路多久没回就发其余几路，默认 HEDGE_MS（0，一起发）；测试可调 */
  hedgeMs?: number;
  /** 整轮最长等多久，到点用手里已有的，默认 ROUND_TIMEOUT_MS；测试可调小 */
  roundTimeoutMs?: number;
  /** 不传就用 prompt.ts */
  prompt?: FastPromptBuilders;
}

/**
 * 第一路发出去多少毫秒以后发其余几路。默认 0：几路一起发（2026-11-05 改，原来 5000）。
 *
 * 回来的几路现在都合起来用（draftLanes），晚发的那一路晚回来就白等；
 * 独立评审按 5000 重放，中位 8.9 秒、p90 12.0 秒，一起发是 7.3 / 11.1 秒。本机 .env.local 早就设的 0。
 * 每一路**换一组起手字**：一模一样的请求两路一样难配、一起慢（10-31 沈姓 20 轮实测）。
 * 第一路出错时，还没发的几路立刻发。
 */
export const HEDGE_MS = 0;

/**
 * 整轮最长等多久（2026-11-05）：到点没回的取消，用手里已有的，不够从名字库补。
 * 单路请求 15 秒超时，截断重试另算，整轮可能拖到 30 秒；直播里不能让观众干等。
 * 给 18 秒：第一次请求能跑满 15 秒，重试的不再等。
 */
export const ROUND_TIMEOUT_MS = 18_000;

type LaneResult = { list: RawFast[]; stats: LaneStats };

/** 一路回来的名字和这一路的耗时构成 */
export interface LaneStats {
  reasoningChars: number;
  firstTokenMs: number;
  retried: boolean;
  finishReason: string | null;
}

export interface LaneOutcome {
  /** 第几路：0 是第一路（第几组起手字） */
  index: number;
  list: RawFast[];
  stats: LaneStats;
  /** 从这一轮开始到这一路回来的毫秒数 */
  ms: number;
}

export interface DraftSummary {
  /** 成功回来的几路，按回来的先后 */
  lanes: LaneOutcome[];
  /** 一共发出去几路（含出错、被取消的） */
  launched: number;
}

export class FastProvider {
  private readonly client: ChatClientOptions;
  private readonly hedgeMs: number;
  private readonly roundTimeoutMs: number;
  private readonly prompt: FastPromptBuilders;

  constructor(opts: FastClientOptions) {
    const { hedgeMs, roundTimeoutMs, prompt, ...client } = opts;
    this.roundTimeoutMs = roundTimeoutMs ?? ROUND_TIMEOUT_MS;
    this.prompt = prompt ?? { system: buildFastSystem, user: buildFastUser };
    // reasoning_effort 必须显式 low。实测（同一提示词，2026-10-31）：
    //   默认档 → 12.7s，推理吃满 2048 token，finish=length，只出 4 个名还被截断
    //   low   →  5.2s，835 token，finish=stop，6 个名完整
    // 这就是「限推理」最有效的那个旋钮，别删。
    this.client = { ...client, temperature: 0.5, reasoningEffort: "low" };
    this.hedgeMs = hedgeMs ?? HEDGE_MS;
  }

  /**
   * 发几路请求，**每一路回来都交给 onLane**，不再只用最先回来的那一路（2026-11-05 用户定）。
   *
   * 原来是「谁先回用谁，其余取消」：三路一起发，另两路的 10 个名字全扔掉；第一路过闸不够 3 个就去名字库补。
   * 用户说模型正常返回还从名字库拿名字不合理，三路并发、扔两路也浪费。独立评审实测（本地网关，女孩为主）：
   * 两路一起发、回来的都合起来用，补位从 48 轮 8 轮 14 个降到 1 轮 2 个，请求少三分之一。
   *
   * onLane 返回 true 表示够了：其余还没回的取消，这一轮结束。
   * 全部回来、或到了整轮的截止时间（roundTimeoutMs）就结束，用手里已有的。
   * 一路都没成功才报错（调用方从名字库兜底）。
   *
   * @param rounds  每一路用的参数（每路一组不同的起手字）；第 0 路先发，其余 hedgeMs 后发（hedgeMs=0 就一起发）
   */
  async draftLanes(
    req: FastRequest,
    rounds: readonly FastPromptRound[],
    onLane: (lane: LaneOutcome) => boolean,
  ): Promise<DraftSummary> {
    const messagesOf = (r: FastPromptRound) => [
      { role: "system" as const, content: this.prompt.system() },
      { role: "user" as const, content: this.prompt.user(req, r) },
    ];
    const started = Date.now();

    // 一路请求：截断/解析失败只重试一次，且不清空已拿到的结果
    const lane = async (signal: AbortSignal, index: number): Promise<LaneResult> => {
      const messages = messagesOf(rounds[index] ?? rounds[0]!);
      const first = await streamChat(this.client, {
        messages,
        maxTokens: MAX_TOKENS,
        timeoutMs: LANE_TIMEOUT_MS,
        signal,
      });
      let list = parseFast(first.content);
      let stats: LaneResult["stats"] = {
        reasoningChars: first.reasoningChars,
        firstTokenMs: first.firstTokenMs,
        retried: false,
        finishReason: first.finishReason,
      };
      if (list.length === 0 || first.finishReason === "length") {
        const retry = await streamChat(this.client, {
          messages,
          maxTokens: RETRY_MAX_TOKENS,
          timeoutMs: LANE_TIMEOUT_MS,
          signal,
        });
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

    return new Promise((resolve, reject) => {
      const controllers: AbortController[] = [];
      const outcomes: LaneOutcome[] = [];
      let settled = false;
      let pending = 0;
      let lastError: unknown;
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      let roundTimer: ReturnType<typeof setTimeout> | undefined;
      const total = Math.max(1, rounds.length);

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        clearTimeout(roundTimer);
        // 够了或到点：没回的取消，免得网关白跑
        for (const c of controllers) c.abort();
        if (outcomes.length) resolve({ lanes: outcomes, launched: controllers.length });
        else reject(lastError ?? new Error("模型这一轮没有返回"));
      };

      const launch = (index: number) => {
        if (settled) return;
        const ctrl = new AbortController();
        controllers.push(ctrl);
        pending++;
        lane(ctrl.signal, index).then(
          (value) => {
            pending--;
            if (settled) return;
            const outcome: LaneOutcome = { index, ...value, ms: Date.now() - started };
            outcomes.push(outcome);
            let enough: boolean;
            try {
              enough = onLane(outcome);
            } catch (err) {
              // 调用方处理这一路时出错（过闸、核出处……）：整轮直接报错，不干等到截止时间
              settled = true;
              clearTimeout(hedgeTimer);
              clearTimeout(roundTimer);
              for (const c of controllers) c.abort();
              reject(err);
              return;
            }
            if (enough) {
              finish();
            } else if (controllers.length < total) {
              // 回来了但不够、其余还没发：立刻发，不等满 hedgeMs
              clearTimeout(hedgeTimer);
              launchRest();
            } else if (pending === 0) {
              finish();
            }
          },
          (err: unknown) => {
            pending--;
            if (settled) return;
            lastError = err;
            // 还没补发的几路：这一路出错就立刻发，不等满 hedgeMs
            if (controllers.length < total) {
              clearTimeout(hedgeTimer);
              launchRest();
            } else if (pending === 0) {
              finish();
            }
          },
        );
      };
      const launchRest = () => {
        for (let i = controllers.length; i < total; i++) launch(i);
      };

      launch(0);
      if (total > 1) {
        if (this.hedgeMs <= 0) launchRest();
        else hedgeTimer = setTimeout(launchRest, this.hedgeMs);
      }
      roundTimer = setTimeout(finish, this.roundTimeoutMs);
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

/** 被 max_tokens 截断时，把已经完整的候选对象捞回来（scores 是嵌套对象，必须按括号深度扫） */
function salvage(content: string): RawFast[] {
  const out: unknown[] = [];
  const key = content.search(/"candidates"\s*:\s*\[/);
  if (key >= 0) {
    let i = content.indexOf("[", key) + 1;
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (; i < content.length; i++) {
      const c = content[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth < 0) break;
        if (depth === 0 && start >= 0) {
          try {
            const obj = JSON.parse(content.slice(start, i + 1)) as Record<string, unknown>;
            if (typeof obj.givenName === "string") out.push(obj);
          } catch {
            /* 这一条写坏了，跳过 */
          }
          start = -1;
        }
      } else if (c === "]" && depth === 0) {
        break;
      }
    }
  }
  // 老格式的扁平对象再兜一层
  if (!out.length) {
    const re = /\{[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      try {
        const obj = JSON.parse(m[0]) as Record<string, unknown>;
        if (typeof obj.givenName === "string") out.push(obj);
      } catch {
        /* 半截对象跳过 */
      }
    }
  }
  return clean(out as RawFast[]);
}

function clean(list: RawFast[]): RawFast[] {
  return list
    .filter((c) => c && typeof c.givenName === "string")
    .map((c) => ({
      givenName: String(c.givenName).trim(),
      why: c.why ? String(c.why).trim() : undefined,
      scores: cleanScores(c.scores),
      source: c.source ? String(c.source).trim() : undefined,
      piece: c.piece ? String(c.piece).trim() : undefined,
      line: c.line ? String(c.line).trim() : undefined,
    }));
}

/** 模型把档位写成数字或数字字符串都收；三个数缺一个就当没给，回退旧规则 */
function cleanScores(raw: unknown): FastTierScores | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
  const pronunciation = num(o.pronunciation);
  const meaning = num(o.meaning);
  const gender = num(o.gender);
  if (![pronunciation, meaning, gender].every(Number.isFinite)) return undefined;
  const style = num(o.style);
  return {
    pronunciation,
    meaning,
    gender,
    ...(Number.isFinite(style) ? { style } : {}),
  };
}

export function createFastProvider(prompt?: FastPromptBuilders): FastProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY 缺失（检查 .env.local）");
  // FAST_HEDGE_MS：第一路发出去多久以后发其余几路，不设就是 HEDGE_MS（0，一起发）
  const hedge = Number(process.env.FAST_HEDGE_MS);
  return new FastProvider({
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
    ...(process.env.FAST_HEDGE_MS && Number.isFinite(hedge) && hedge >= 0 ? { hedgeMs: hedge } : {}),
    ...(prompt ? { prompt } : {}),
  });
}
