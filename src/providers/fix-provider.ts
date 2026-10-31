import { streamChat, type ChatClientOptions } from "./chat";
import { buildFixMessages, parseFixOutput, type FixPromptInput, type RawFix } from "@/domain/score/fix-prompt";

/**
 * 改字的模型端口：从同音候选里挑字。
 *
 * 和名字分析共用一个网关，但单独一个口子：这一步要快（直播里观众在等），
 * 推理强度固定 low，输出只有几个字和一句话。
 */

export interface CharFixProvider {
  readonly name: string;
  pick(input: FixPromptInput): Promise<RawFix | null>;
}

/** 推理也计入 max_tokens；只挑几个字，2048 足够，截断了宁可当作没挑出来 */
const MAX_TOKENS = 2048;
/** 直播里等不起：12 秒没回来就放弃，主播可以再点一次 */
const TIMEOUT_MS = 12_000;
const IDLE_TIMEOUT_MS = 8_000;

export class LlmFixProvider implements CharFixProvider {
  readonly name = "llm";

  constructor(private readonly opts: ChatClientOptions) {}

  async pick(input: FixPromptInput): Promise<RawFix | null> {
    const res = await streamChat(this.opts, {
      messages: buildFixMessages(input),
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    });
    return parseFixOutput(res.content);
  }
}

/** 测试与示例模式：每个要换的字挑第一个候选，不联网 */
export class FakeFixProvider implements CharFixProvider {
  readonly name = "fake";

  async pick(input: FixPromptInput): Promise<RawFix | null> {
    return {
      fixes: input.targets.map((t) => ({
        from: t.char,
        picks: t.candidates.slice(0, 1).map((c) => ({ char: c.char, why: `示例模式：同音的「${c.char}」` })),
      })),
    };
  }
}
