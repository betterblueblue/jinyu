import { streamChat, type ChatClientOptions } from "@/providers/chat";
import { buildReadingMessages, parseReadingOutput, type RawReading } from "./prompt";
import type { FortuneChart } from "./types";

/**
 * 八字解读的模型端口。走和取名、名字分析同一个 OpenAI 兼容网关，只是提示词和输出形状不同。
 * 排盘全在本地算完，模型只负责写解读。
 */

export interface ReadingProvider {
  readonly name: string;
  read(chart: FortuneChart): Promise<RawReading | null>;
}

/** 推理 token 也算在 max_tokens 里；首轮被截断就放大预算重来一次 */
const FIRST_MAX_TOKENS = 8192;
const RETRY_MAX_TOKENS = 16384;

export class LlmReadingProvider implements ReadingProvider {
  readonly name = process.env.LLM_PROVIDER?.trim() || "llm";

  constructor(private readonly opts: ChatClientOptions) {}

  async read(chart: FortuneChart): Promise<RawReading | null> {
    const messages = buildReadingMessages(chart);
    const first = await streamChat(this.opts, { messages, maxTokens: FIRST_MAX_TOKENS });
    const parsed = parseReadingOutput(first.content);
    if (parsed && first.finishReason !== "length") return parsed;

    const retry = await streamChat(this.opts, { messages, maxTokens: RETRY_MAX_TOKENS });
    return parseReadingOutput(retry.content) ?? parsed;
  }
}

/** 测试与示例模式：不联网，只把盘面事实摆出来，并写明正式模式会写什么 */
export class FakeReadingProvider implements ReadingProvider {
  readonly name = "fake";

  async read(chart: FortuneChart): Promise<RawReading> {
    const s = chart.strength;
    const day = chart.pillars[2];
    const month = chart.pillars[1];
    const note = "示例模式（未接入模型）：";
    const section = (basis: string, what: string) => ({
      basis,
      text: `${note}正式模式会在这里结合${basis}写${what}。`,
    });
    return {
      overview: `${note}日主${s.dayMaster.gan}${s.dayMaster.element}，生在${month.zhi}月，规则粗算为${s.level}，喜${s.favorable.join("、") || "不明显"}，忌${s.unfavorable.join("、") || "不明显"}。`,
      personality: section(`日柱${day.ganzhi}、月干${month.gan}（${month.tenGod}）`, "性格"),
      career: section(`月柱${month.ganzhi}与喜用${s.favorable[0] ?? ""}`, "事业方向"),
      wealth: section("财星的位置与强弱", "财运"),
      relationship: section(`日支${day.zhi}（夫妻宫）`, "感情婚姻"),
      health: section(`五行占比中最弱的一行`, "保养方向"),
      luck: chart.luck.steps.map((x) => ({
        ganzhi: x.ganzhi,
        text: `${note}${x.ganzhi}运，天干${x.ganTenGod}、地支${x.zhiTenGod}。`,
      })),
      years: chart.years.map((y) => ({
        year: y.year,
        text: `${note}${y.year} ${y.ganzhi}年，天干${y.ganTenGod}、地支${y.zhiTenGod}。`,
      })),
      advice: [`${note}建议需接入模型后生成。`],
    };
  }
}

function useFake(): boolean {
  return (
    process.env.LLM_USE_FAKE === "true" ||
    process.env.LLM_USE_FAKE === "1" ||
    process.env.NODE_ENV === "test" ||
    !process.env.LLM_API_KEY
  );
}

/** 判定方式与 src/providers/index.ts 一致：测试、显式开关或没配 key 时走示例模式 */
export function createReadingProvider(): ReadingProvider {
  if (useFake()) return new FakeReadingProvider();
  return new LlmReadingProvider({
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey: process.env.LLM_API_KEY!,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
    temperature: 0.6,
    reasoningEffort: "low",
  });
}
