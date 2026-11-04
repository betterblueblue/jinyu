import { streamChat, type ChatClientOptions } from "@/providers/chat";
import {
  buildEvaluateMessages,
  completedCandidateObjects,
  completedOriginal,
  completedScores,
  parseEvaluation,
  parseScores,
  type ParsedScores,
} from "./prompt";
import { clampTier } from "./scoring";
import type { NameFacts, RawCandidate, RawEvaluation, RawOriginal } from "./types";

/**
 * 评价模型的端口。一次调用写原名评价和候选；模型不输出分数。
 *
 * 输出顺序是 scores → original → options：
 *   scores   四个档位数字，先交出去，程序立刻算分上屏；
 *   original 理由、优点、问题，写完再交；
 *   候选最后写，写完一个交一个。
 * 推理过程中通过 onThought 把模型正在看的判断逐句交出去，主播可以照着念，不用干等。
 */

export interface EvaluateProvider {
  readonly name: string;
  evaluate(
    facts: NameFacts,
    onScores?: (scores: ParsedScores) => void,
    onOriginal?: (raw: RawOriginal) => void,
    onOption?: (raw: RawCandidate) => void,
    onThought?: (text: string) => void,
  ): Promise<RawEvaluation | null>;
}

export class LlmEvaluateProvider implements EvaluateProvider {
  readonly name: string;

  constructor(
    private readonly opts: ChatClientOptions,
    /** 用户说速度可以慢，给 60 秒 */
    private readonly timeoutMs = 60_000,
    /** 直播默认精简：理由 12 字、候选 2 个 */
    private readonly compact = true,
  ) {
    const effort = opts.reasoningEffort ? `:${opts.reasoningEffort}` : "";
    this.name = `llm:${opts.model}${effort}${compact ? ":compact" : ""}`;
  }

  async evaluate(
    facts: NameFacts,
    onScores?: (scores: ParsedScores) => void,
    onOriginal?: (raw: RawOriginal) => void,
    onOption?: (raw: RawCandidate) => void,
    onThought?: (text: string) => void,
  ): Promise<RawEvaluation | null> {
    let text = "";
    let scoresDone = false;
    let originalDone = false;
    let seenOptions = 0;
    // 推理里模型正在看的判断，逐句交出去
    let thoughtBuf = "";
    const thoughtSeen = new Set<string>();
    const emitThought = (chunk: string) => {
      if (!onThought) return;
      thoughtBuf += chunk;
      const parts = thoughtBuf.split(/[。；\n]/);
      thoughtBuf = parts.pop() ?? "";
      for (const p of parts) {
        // 推理里多是 JSON 草稿：去掉字段名、引号、括号，只留能念的那句
        const s = p
          .replace(/^[\s\-*0-9.、]+/, "")
          .replace(/^[a-zA-Z_]+["']?\s*:\s*/, "")
          .replace(/["“”]/g, "")
          .replace(/[{}[\]]/g, "")
          .replace(/\(\d+\s*字\)/g, "")
          .trim();
        if (s.length < 6 || s.length > 40) continue;
        const hasTopic = /读音|字义|性别|气质|风格|识读|流行|谐音|年代|重名|同调|连姓/.test(s);
        const hasNameChar = [...facts.givenName].some((c) => s.includes(c));
        if (!hasTopic && !hasNameChar) continue;
        if (thoughtSeen.has(s)) continue;
        thoughtSeen.add(s);
        if (thoughtSeen.size > 6) return;
        onThought(s);
      }
    };
    const r = await streamChat(
      { ...this.opts, temperature: 0.4, reasoningEffort: this.opts.reasoningEffort ?? "low" },
      {
        messages: buildEvaluateMessages(facts, this.compact),
        // 6144 在推理写 8000 字时可能不够；用户说可以慢，给到 8192 保证不截断
        maxTokens: 8192,
        timeoutMs: this.timeoutMs,
        // 推理时可能十几秒没有新 token，空闲超时给太短会把还在想的长名字误杀
        idleTimeoutMs: 30_000,
        onThinking: emitThought,
        onContent: (chunk) => {
          if (!onScores && !onOriginal && !onOption) return;
          text += chunk;
          if (!chunk.includes("}")) return;
          if (!scoresDone && onScores) {
            const s = completedScores(text);
            if (s) {
              scoresDone = true;
              onScores(s);
            }
          }
          if (!originalDone && onOriginal) {
            const o = completedOriginal(text);
            if (o) {
              originalDone = true;
              onOriginal(o);
            }
          }
          if (onOption) {
            const done = completedCandidateObjects(text);
            for (; seenOptions < done.length; seenOptions++) onOption(done[seenOptions]!);
          }
        },
      },
    );
    return parseEvaluation(r.content);
  }
}

/** 示例模式：不联网，档位写死，候选固定换一个字。只用来跑通流程和单测 */
export class FakeEvaluateProvider implements EvaluateProvider {
  readonly name = "fake";

  async evaluate(
    facts: NameFacts,
    onScores?: (scores: ParsedScores) => void,
    onOriginal?: (raw: RawOriginal) => void,
    onOption?: (raw: RawCandidate) => void,
  ): Promise<RawEvaluation> {
    const genderTier =
      facts.gender === "female"
        ? facts.lean.overall === "female"
          ? 12
          : 8
        : facts.gender === "male"
          ? facts.lean.overall === "male"
            ? 12
            : 8
          : 8;
    const given = [...facts.givenName];
    const replacement = facts.gender === "male" ? "宁" : "妍";
    const index = given.length - 1;
    const candidate: RawCandidate = {
      givenName: given.map((c, i) => (i === index ? replacement : c)).join(""),
      pronunciation: { tier: 16, reason: "示例模式：读音基本顺畅" },
      meaning: { tier: 16, reason: "示例模式：字义正面" },
      gender: { tier: clampTier("gender", genderTier), reason: "示例模式：性别辨识不变" },
      style: { tier: 8, reason: "示例模式：风格更合适" },
      solves: facts.issues.length ? [facts.issues[0]!.id] : [],
      keeps: ["示例模式：字义正面"],
      loss: "示例模式：只换一个字，取舍有限",
      verdict: "better",
      why: "示例模式：换一个字更顺",
      spoken: `示例模式：把最后一个字换成「${replacement}」，这个名字还没真调模型，这里不是真寓意。`,
    };
    const raw: RawEvaluation = {
      status: "options",
      scores: { pronunciation: 16, meaning: 16, gender: genderTier, style: 6 },
      original: {
        pronunciation: "示例模式：连姓念基本顺畅",
        meaning: "示例模式：字义正面清楚",
        gender: "示例模式：按字表看整体倾向",
        style: "示例模式：气质基本符合",
        strengths: ["示例模式：字义正面"],
        charMeaning: "示例模式：拆字还没真调模型。",
        whole: "示例模式：合起来的话还没真调模型。",
        issues: facts.issues.map((it) => ({ text: it.line, importance: "major" })),
        reminders: [],
      },
      options: [candidate],
      note: "",
    };
    const scores = parseScores(raw.scores);
    if (scores) onScores?.(scores);
    if (raw.original) onOriginal?.(raw.original);
    onOption?.(candidate);
    return raw;
  }
}

/** 评价接口的模型端口：直播默认精简、low、60 秒。没配钥匙返回 null，接口回 503 */
export function createEvaluateProvider(): EvaluateProvider | null {
  if (process.env.LLM_USE_FAKE === "true" || process.env.LLM_USE_FAKE === "1") {
    return new FakeEvaluateProvider();
  }
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return new LlmEvaluateProvider(
    {
      baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
      apiKey,
      model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
      reasoningEffort: process.env.EVALUATE_EFFORT ?? "low",
    },
    60_000,
    true,
  );
}
