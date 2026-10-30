import { streamChat, type ChatClientOptions } from "./chat";
import {
  buildAnalysisMessages,
  parseAnalysisOutput,
  type AnalysisPromptInput,
  type RawAnalysis,
} from "@/domain/analysis/prompt";

/**
 * 名字分析的模型端口。
 *
 * 和取名共用一个 OpenAI 兼容客户端，只是提示词和输出形状不同。
 * 模型只负责「看得懂的部分」：谐音、字义、年代感、措辞。
 * 笔画、字集、性别倾向字这些能在本地查表的，一律不交给它。
 */

export interface AnalysisProvider {
  readonly name: string;
  analyze(input: AnalysisPromptInput, onThinking?: (chunk: string) => void): Promise<RawAnalysis | null>;
}

const DEFAULT_MAX_TOKENS = 8192;
const RETRY_MAX_TOKENS = 16384;

export class LlmAnalysisProvider implements AnalysisProvider {
  readonly name = process.env.LLM_PROVIDER?.trim() || "stepfun";

  constructor(private readonly opts: ChatClientOptions & { reasoningEffort?: string }) {}

  async analyze(input: AnalysisPromptInput, onThinking?: (chunk: string) => void): Promise<RawAnalysis | null> {
    const messages = buildAnalysisMessages(input);

    const first = await streamChat(this.opts, {
      messages,
      maxTokens: DEFAULT_MAX_TOKENS,
      onThinking,
    });

    let parsed = parseAnalysisOutput(first.content);
    if (!parsed || first.finishReason === "length") {
      const retry = await streamChat(this.opts, {
        messages,
        maxTokens: RETRY_MAX_TOKENS,
        onThinking,
      });
      const retryParsed = parseAnalysisOutput(retry.content);
      if (retryParsed) parsed = retryParsed;
    }
    return parsed;
  }
}

/** 测试与示例模式：给一份固定结构的分析，不联网 */
export class FakeAnalysisProvider implements AnalysisProvider {
  readonly name = "fake";

  async analyze(input: AnalysisPromptInput): Promise<RawAnalysis | null> {
    const { fullName, givenName } = input;
    return {
      headline: `${fullName}这个名字没有硬伤，能不能更好听见人。`,
      goodPoints: [
        `三个字都在常用字里，办证、买票、打名字都不会卡。`,
        `读音连起来顺，不用刻意记。`,
      ],
      issues: [
        {
          kind: "phonology",
          severity: "cost",
          text: `「${givenName}」两个字声调挨得近，喊起来起伏不大。`,
          hint: "换一个开口的字，喊起来会亮一些。",
        },
      ],
      citations: [
        { source: "诗经", piece: "周南·桃夭", quote: "桃之夭夭，灼灼其华", gloss: "取花木繁盛之意" },
      ],
      closing: "想更耐听，动末字就够了，前面不用碰。",
      fitAngle: "",
      regenBrief: { tabooChars: [], styleNotes: "声音更亮，避开同调字", avoidPopular: false },
    };
  }
}
