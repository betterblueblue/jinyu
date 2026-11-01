import { streamChat, type ChatClientOptions } from "./chat";
import {
  buildFixMessages,
  completedOptions,
  parseFixOutput,
  type FixPromptInput,
  type RawFix,
  type RawFixOption,
} from "@/domain/score/fix-prompt";

/**
 * 改字的模型端口：看扣分理由改一个字，配寓意。
 *
 * 和名字分析共用一个网关，但单独一个口子：直播里观众在等，推理强度固定 low；
 * 一边收一边把写完的改法交给 onItem，核过一条就推一条，主播不用干等整份写完。
 */

export interface CharFixProvider {
  readonly name: string;
  /** onItem：options 里每写完一个对象就交一次（没核过）。返回整份解析结果，收尾时补漏用 */
  pick(input: FixPromptInput, onItem?: (option: RawFixOption) => void): Promise<RawFix | null>;
}

/** 推理也计入 max_tokens；三个改法带寓意约 400 字，3072 够用，截断了也只丢最后没写完的那一条 */
const MAX_TOKENS = 3072;
/**
 * 25 秒没写完就放弃，已经核过的改法照样给。
 * 11-01 实测这个网关上推理常写到 2000–8000 字，一轮 5–20 秒；设 15 秒时文红艳会超时，
 * 主播再点一次又是十几秒，不如多等一会儿把这一轮写完。
 */
const TIMEOUT_MS = 25_000;
const IDLE_TIMEOUT_MS = 8_000;

export class LlmFixProvider implements CharFixProvider {
  readonly name = "llm";

  constructor(private readonly opts: ChatClientOptions) {}

  async pick(input: FixPromptInput, onItem?: (option: RawFixOption) => void): Promise<RawFix | null> {
    let text = "";
    let seen = 0;
    const res = await streamChat(this.opts, {
      messages: buildFixMessages(input),
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      onContent: (chunk) => {
        text += chunk;
        if (!onItem || !chunk.includes("}")) return;
        const done = completedOptions(text);
        for (; seen < done.length; seen++) onItem(done[seen]!);
      },
    });
    const parsed = parseFixOutput(res.content);
    if (parsed) return parsed;
    // 整份没解析出来（多半是截断了）：把写完的那几条交回去
    const partial = completedOptions(res.content);
    return partial.length ? { options: partial } : null;
  }
}

/** 示例模式（没配模型、测试）：不联网，保留读音的字挑第一个同音候选，其余试几个常用字，交给核验去筛 */
const FAKE_CHARS = [..."安明清宁"];

export class FakeFixProvider implements CharFixProvider {
  readonly name = "fake";

  async pick(input: FixPromptInput, onItem?: (option: RawFixOption) => void): Promise<RawFix | null> {
    const given = [...input.givenName];
    const swap = (index: number, ch: string): RawFixOption => ({
      givenName: given.map((c, i) => (i === index ? ch : c)).join(""),
      why: `示例模式：换成「${ch}」`,
      meaning: `示例模式：把「${given[index]}」换成「${ch}」，还没调模型，这里不是真寓意。`,
    });
    const options: RawFixOption[] = [];
    for (const s of input.sameSound) {
      const first = s.candidates[0];
      if (first) options.push(swap(s.index, first));
    }
    given.forEach((_, index) => {
      for (const ch of FAKE_CHARS) if (ch !== given[index]) options.push(swap(index, ch));
    });
    for (const o of options) onItem?.(o);
    return { options };
  }
}
