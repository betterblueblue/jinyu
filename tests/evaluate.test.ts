import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// 字表指向打分专用夹具，和 score.test.ts 用同一份
process.env.JINYU_CORPUS_DIR = path.join(process.cwd(), "tests", "fixtures", "score-corpus");

import { resetCharTableCache } from "@/domain/analysis/chars";
import { evaluateName } from "@/domain/evaluate/evaluate";
import { buildFacts } from "@/domain/evaluate/facts";
import { completedOriginal, parseEvaluation, parseTierChoice } from "@/domain/evaluate/prompt";
import { FakeEvaluateProvider } from "@/domain/evaluate/provider";
import { BAND_CUTS, bandOf, capFor, clampTier } from "@/domain/evaluate/scoring";
import type { EvaluateProvider } from "@/domain/evaluate/provider";
import type { NameFacts, OriginalEvaluation, RawCandidate, RawEvaluation } from "@/domain/evaluate/types";
import { verifyCandidate } from "@/domain/evaluate/verify";
import { resolveSplit, scoreName } from "@/domain/score/score";
import type { AnalysisGender } from "@/domain/analysis/types";
import { parsePrompterRound } from "@/live/prompter";
import { readEvaluateStream } from "../app/live/evaluate-stream";
import { prompterFromEvaluation } from "../app/live/prompter-sync";

function factsOf(fullName: string, gender: AnalysisGender): NameFacts {
  const split = resolveSplit(fullName);
  if (!split) throw new Error(`拆不开：${fullName}`);
  return buildFacts(split, scoreName(split, gender));
}

function rawCandidate(patch: Partial<RawCandidate> = {}): RawCandidate {
  return {
    givenName: "妍",
    pronunciation: { tier: 16, reason: "读音更亮" },
    meaning: { tier: 16, reason: "妍是美好" },
    gender: { tier: 12, reason: "女性辨识度保住了" },
    style: { tier: 8, reason: "明亮大方" },
    solves: ["R1"],
    keeps: ["字义干净"],
    loss: "少一点安静",
    verdict: "better",
    why: "换掉老气的娟",
    spoken: "妍是美好、秀美，合起来是清清亮亮的样子，愿孩子明亮大方、自在成长。",
    ...patch,
  };
}

beforeEach(() => {
  resetCharTableCache();
});

describe("档位和算分", () => {
  it("档位向下取到合法值，不会虚高", () => {
    expect(clampTier("pronunciation", 18)).toBe(16);
    expect(clampTier("pronunciation", 20)).toBe(20);
    expect(clampTier("pronunciation", 4)).toBe(8);
    expect(clampTier("meaning", 4)).toBe(0);
    expect(clampTier("style", 3)).toBe(2);
  });

  it("分界是初值，边界按 >= 算", () => {
    expect(bandOf(BAND_CUTS.great).band).toBe("great");
    expect(bandOf(BAND_CUTS.great - 1).band).toBe("ok");
    expect(bandOf(BAND_CUTS.ok).band).toBe("ok");
    expect(bandOf(BAND_CUTS.ok - 1).band).toBe("change");
  });

  it("严重问题压 69，一般问题压 79，女孩中性名压 89", () => {
    const mild = factsOf("文娟", "female");
    expect(capFor({ gender: mild.gender, lean: mild.lean, risk: mild.risk, genderTier: 12 })).toBeNull();

    const neutral = factsOf("文安", "female");
    expect(capFor({ gender: neutral.gender, lean: neutral.lean, risk: neutral.risk, genderTier: 8 })?.cap).toBe(89);
    // 字表中性、模型认为女性辨识度足够：不压
    expect(capFor({ gender: neutral.gender, lean: neutral.lean, risk: neutral.risk, genderTier: 12 })).toBeNull();

    const wrong = factsOf("文海军", "female");
    expect(capFor({ gender: wrong.gender, lean: wrong.lean, risk: wrong.risk, genderTier: 4 })?.cap).toBe(79);

    const hard = factsOf("王招娣", "female");
    expect(capFor({ gender: hard.gender, lean: hard.lean, risk: hard.risk, genderTier: 12 })?.cap).toBe(69);
  });
});

describe("程序事实", () => {
  it("文娟：年代感进流行，不压上限，字表看是女孩名", () => {
    const f = factsOf("文娟", "female");
    expect(f.lean.overall).toBe("female");
    expect(f.popularityFacts.era?.kind).toBe("single");
    expect(f.program.popularity.score).toBe(4);
    expect(f.issues.some((i) => i.rule === "era")).toBe(true);
    expect(f.risk.severe).toHaveLength(0);
    expect(f.risk.minor).toHaveLength(0);
  });

  it("文安：整体中性，记进流行事实但不扣分", () => {
    const f = factsOf("文安", "female");
    expect(f.lean.overall).toBe("neutral");
    expect(f.risk.severe).toHaveLength(0);
    expect(f.risk.minor).toHaveLength(0);
  });

  it("文海军（女）：整名偏另一个性别，算一般问题", () => {
    const f = factsOf("文海军", "female");
    expect(f.risk.genderMismatch).toBe("whole");
    expect(f.risk.minor.some((i) => i.rule === "gender")).toBe(true);
  });

  it("王招娣：娣是读音上的严重不宜字", () => {
    const f = factsOf("王招娣", "female");
    expect(f.risk.severe.some((i) => i.rule === "swap")).toBe(true);
  });

  it("王梓涵：撞烂大街名只进流行维度", () => {
    const f = factsOf("王梓涵", "female");
    expect(f.popularityFacts.template).toBe(true);
    expect(f.popularityFacts.hotChars).toHaveLength(0);
    expect(f.program.popularity.score).toBe(4);
    expect(f.risk.severe).toHaveLength(0);
  });
});

const ORIGINAL: OriginalEvaluation = {
  scores: {
    dimensions: { pronunciation: 16, meaning: 16, gender: 12, style: 6, temperament: 18, literacy: 15, popularity: 4, homophone: 15 },
    base: 84,
    cap: null,
    capReason: null,
    total: 84,
    band: "ok",
    bandLabel: "可以用",
  },
  tiers: {
    pronunciation: { tier: 16, reason: "顺" },
    meaning: { tier: 16, reason: "正面" },
    gender: { tier: 12, reason: "女孩名" },
    style: { tier: 6, reason: "温和" },
  },
  strengths: ["字义干净"],
  issues: [],
  reminders: [],
};

describe("候选验收", () => {
  it("文娟 → 文安：三维都没变好，只是换了个中性字，拒", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "安", style: { tier: 6, reason: "安静温和" }, solves: ["R1"] }),
      factsOf("文娟", "female"),
      ORIGINAL,
    );
    expect(out.candidate).toBeUndefined();
    expect(out.rejected?.reasons.join("；")).toContain("没有一项比原名好");
  });

  it("文娟 → 文晴：中性但更亮，收下", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "晴", style: { tier: 8, reason: "更亮" } }),
      factsOf("文娟", "female"),
      ORIGINAL,
    );
    expect(out.candidate?.fullName).toBe("文晴");
  });

  it("文娟 → 文妍：风格变好，收下", () => {
    const out = verifyCandidate(rawCandidate(), factsOf("文娟", "female"), ORIGINAL);
    expect(out.candidate?.fullName).toBe("文妍");
    expect(out.candidate?.gain).toBeGreaterThan(0);
  });

  it("不是只换一个字的不收", () => {
    const out = verifyCandidate(rawCandidate({ givenName: "宸梓" }), factsOf("马梓宸", "male"), ORIGINAL);
    expect(out.rejected?.reasons.join("；")).toContain("只换一个字");
  });
});

describe("编排", () => {
  it("性别没填不出分，也不调模型", async () => {
    let called = false;
    const provider: EvaluateProvider = {
      name: "spy",
      evaluate: async () => {
        called = true;
        return null;
      },
    };
    const out = await evaluateName({ fullName: "文娟", gender: "unknown" }, provider);
    expect(out.status).toBe("needs_gender");
    expect(out.original).toBeNull();
    expect(called).toBe(false);
  });

  it("示例模型跑通文娟：原名有分，候选文妍通过", async () => {
    const out = await evaluateName({ fullName: "文娟", gender: "female" }, new FakeEvaluateProvider());
    expect(out.status).toBe("options");
    expect(out.original?.scores.total).toBeGreaterThan(0);
    expect(out.candidates[0]?.fullName).toBe("文妍");
    expect(out.candidates[0]!.scores.total).toBeGreaterThan(out.original!.scores.total);
  });

  it("模型没给出完整评价时，状态是 error 并保留事实", async () => {
    const provider: EvaluateProvider = {
      name: "bad",
      evaluate: async () => ({ status: "options", scores: { pronunciation: 16, meaning: 16, gender: 12, style: 6 } }),
    };
    const out = await evaluateName({ fullName: "文娟", gender: "female" }, provider);
    expect(out.status).toBe("error");
    expect(out.original).toBeNull();
    expect(out.facts.fullName).toBe("文娟");
  });
});

describe("解析", () => {
  it("提取 JSON 并允许多余文字", () => {
    const raw = parseEvaluation('说明\n{"status":"no_better","original":{},"options":[],"note":""}');
    expect(raw?.status).toBe("no_better");
  });

  it("档位必须是数字、理由不能为空", () => {
    expect(parseTierChoice({ tier: 18, reason: "顺" }, "pronunciation")?.tier).toBe(16);
    expect(parseTierChoice({ tier: "16", reason: "顺" }, "pronunciation")?.tier).toBe(16);
    expect(parseTierChoice({ tier: 16 }, "pronunciation")).toBeNull();
    expect(parseTierChoice({ tier: 16, reason: "  " }, "pronunciation")).toBeNull();
  });

  it("原名评价写完就能先取出来，不用等候选", () => {
    const full = '{"status":"options","original":{"pronunciation":{"tier":16,"reason":"顺"},"strengths":["干净"],"reminders":[]},"options":[]}';
    expect(completedOriginal(full)?.strengths).toEqual(["干净"]);
    expect(completedOriginal('{"original":{"pronunciation":{"tier":16,"reason":"顺"')).toBeNull();
    expect(completedOriginal('{"original":{"issues":[{"text":"a"},{"text":"b"}],"reminders":[]}}')?.reminders).toEqual([]);
  });
});

describe("接提词页和流", () => {
  it("评价结果变成提词页数据后能通过格式校验", async () => {
    const out = await evaluateName({ fullName: "文娟", gender: "female" }, new FakeEvaluateProvider());
    const round = prompterFromEvaluation({
      no: 1,
      facts: out.facts,
      original: out.original,
      candidates: out.candidates,
      status: out.status,
      note: out.note,
      fixShown: true,
    });
    const parsed = parsePrompterRound(round);
    expect(parsed).not.toBeNull();
    if (parsed?.state !== "score") throw new Error("应该是一轮打分");
    expect(parsed.score).toBe(out.original?.scores.total);
    expect(parsed.strengths?.length).toBeGreaterThan(0);
    expect(parsed.fix?.options[0]?.full).toBe(out.candidates[0]?.fullName);
  });

  it("流按 facts → analysis → option → result 的顺序交给面板", async () => {
    const out = await evaluateName({ fullName: "文娟", gender: "female" }, new FakeEvaluateProvider());
    const frames = [
      { type: "facts", facts: out.facts },
      { type: "analysis", original: out.original },
      { type: "option", option: out.candidates[0] },
      { type: "result", result: out },
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(`${JSON.stringify(f)}\n`));
        controller.close();
      },
    });
    const res = new Response(body, { headers: { "content-type": "application/x-ndjson" } });
    const seen: string[] = [];
    const result = await readEvaluateStream(res, {
      onFacts: () => seen.push("facts"),
      onAnalysis: () => seen.push("analysis"),
      onOption: () => seen.push("option"),
    });
    expect(seen).toEqual(["facts", "analysis", "option"]);
    expect(result?.status).toBe(out.status);
  });
});

describe("三个已确认 bug 的回归", () => {
  const baseRaw = (
    options: RawCandidate[] = [],
    issues: { text: string; importance: "major" | "minor" }[] = [],
  ): RawEvaluation => ({
    status: "options",
    scores: { pronunciation: 20, meaning: 20, gender: 8, style: 6 },
    original: {
      pronunciation: "顺",
      meaning: "正",
      gender: "可",
      style: "稳",
      strengths: ["正"],
      charMeaning: "x",
      whole: "合起来 x",
      comment: "x",
      issues,
      reminders: [],
    },
    options,
    note: "",
  });

  it("同一个被拒候选只记一次（流式 + 收尾各核一遍不翻倍）", async () => {
    const bad = rawCandidate({ givenName: "志" }); // 长度不对，必拒
    const raw = baseRaw([bad]);
    const provider: EvaluateProvider = {
      name: "dup",
      evaluate: async (_facts, onScores, onOriginal, onOption) => {
        onScores?.({ pronunciation: 20, meaning: 20, gender: 8, style: 6 });
        onOriginal?.(raw.original!);
        onOption?.(bad); // 流式已经交过一次
        return raw; // 收尾的 raw.options 里还有同一个
      },
    };
    const out = await evaluateName({ fullName: "李志明", gender: "male" }, provider, { maxCandidates: 2 });
    expect(out.rejected).toHaveLength(1);
  });

  it("solves 只保留原名真实存在的问题编号", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "嘉明", solves: ["R1", "R9"] }),
      factsOf("李志明", "male"), // 没有问题
      ORIGINAL,
    );
    expect(out.candidate?.fullName).toBe("李嘉明");
    expect(out.candidate?.solves).toEqual([]);
  });

  it("原名有规则问题时，候选至少要引用一条真实编号", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "晴", solves: [] }),
      factsOf("文娟", "female"),
      ORIGINAL,
    );
    expect(out.candidate).toBeUndefined();
    expect(out.rejected?.reasons.join("；")).toContain("没有对应原名的问题编号");
  });

  it("原名没有规则问题时，solves 为空也允许", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "嘉明", solves: [] }),
      factsOf("李志明", "male"),
      ORIGINAL,
    );
    expect(out.candidate?.fullName).toBe("李嘉明");
  });

  it.each([
    ["文海军", "male", "海军是军种词，容易和职业混"],
    ["王秀英", "female", "全国重名最多，像奶奶那辈"],
    ["吴智宇", "male", "「吴智」连读像「无知」，易被起外号"],
    ["马梓宸", "male", "马梓连读像「马子」，易被起外号"],
  ] as const)("%s：模型换个说法重复规则问题时不重复列", async (fullName, gender, text) => {
    const raw = baseRaw([], [{ text, importance: "major" }]);
    const provider: EvaluateProvider = {
      name: "dup-issue",
      evaluate: async (_facts, onScores, onOriginal) => {
        onScores?.({ pronunciation: 20, meaning: 20, gender: 8, style: 6 });
        onOriginal?.(raw.original!);
        return raw;
      },
    };
    const out = await evaluateName({ fullName, gender }, provider, { maxCandidates: 2 });
    expect(out.original?.issues.filter((it) => it.source === "model")).toHaveLength(0);
  });
});

describe("中止信号", () => {
  it("外部 signal 会传给模型端口", async () => {
    let seen: AbortSignal | undefined;
    const provider: EvaluateProvider = {
      name: "spy",
      evaluate: async (_facts, _onScores, _onOriginal, _onOption, _onThought, _banned, signal) => {
        seen = signal;
        return null;
      },
    };
    const ac = new AbortController();
    const out = await evaluateName({ fullName: "文娟", gender: "female" }, provider, { signal: ac.signal });
    expect(seen).toBe(ac.signal);
    expect(out.status).toBe("error");
  });
});
