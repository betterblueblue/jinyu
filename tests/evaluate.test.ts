import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// 字表指向打分专用夹具，和 score.test.ts 用同一份
process.env.JINYU_CORPUS_DIR = path.join(process.cwd(), "tests", "fixtures", "score-corpus");

import { resetCharTableCache } from "@/domain/analysis/chars";
import { evaluateName } from "@/domain/evaluate/evaluate";
import { buildFacts } from "@/domain/evaluate/facts";
import { buildEvaluateMessages, completedOriginal, parseEvaluation, parseScores, parseTierChoice } from "@/domain/evaluate/prompt";
import { cleanThought, FakeEvaluateProvider } from "@/domain/evaluate/provider";
import { anchorPronunciation, BAND_CUTS, bandOf, capFor, clampTier, pronunciationBase, SCORING_REV, scoreBreakdown } from "@/domain/evaluate/scoring";
import { checkFastCandidate } from "@/fast/gate";
import type { EvaluateProvider } from "@/domain/evaluate/provider";
import type { NameFacts, OriginalEvaluation, RawCandidate, RawEvaluation } from "@/domain/evaluate/types";
import { verifyCandidate } from "@/domain/evaluate/verify";
import { cacheKey, clearEvalCache, getCached, setCached } from "@/domain/evaluate/cache";
import { isSensitiveName } from "@/domain/evaluate/sensitive";
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

// 文娟（女）的原名评价。读音按规则定档（2026-11-05）：文娟没有读音毛病，读音只能是 20
const ORIGINAL: OriginalEvaluation = {
  scores: {
    dimensions: { pronunciation: 20, meaning: 16, gender: 12, style: 6, temperament: 18, literacy: 15, popularity: 4, homophone: 15 },
    base: 88,
    cap: null,
    capReason: null,
    total: 88,
    band: "ok",
    bandLabel: "可以用",
  },
  tiers: {
    pronunciation: { tier: 20, reason: "顺" },
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

  it("文娟 → 文涓：读音没变，年代感念出来还在，流行分按原名算，只靠这一维涨分的拒", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "涓", style: { tier: 8, reason: "清一点" } }),
      factsOf("文娟", "female"),
      ORIGINAL,
    );
    expect(out.candidate).toBeUndefined();
    expect(out.rejected?.reasons.join("；")).toContain("读音没变");
  });

  it("读音没变但字义确实更好：收下，只算字义那部分的提升", () => {
    const out = verifyCandidate(
      rawCandidate({ givenName: "涓", meaning: { tier: 20, reason: "涓是细水长流" } }),
      factsOf("文娟", "female"),
      ORIGINAL,
    );
    expect(out.candidate?.soundLine).toBe("读音不变");
    expect(out.candidate?.scores.dimensions.popularity).toBe(ORIGINAL.scores.dimensions.popularity);
    expect(out.candidate?.gain).toBe(4);
  });

  it.each([
    ["子衡", "四个档位都和原名一样，只解决了谐音"],
    ["宇腾", "宇是热门字，流行分降了，但解决了谐音"],
  ])("杜子腾 → 杜%s：%s，收下", (given) => {
    const facts = factsOf("杜子腾", "male");
    const out = verifyCandidate(
      rawCandidate({
        givenName: given,
        pronunciation: { tier: 16, reason: "顺" },
        meaning: { tier: 16, reason: "正面" },
        gender: { tier: 12, reason: "男孩名" },
        style: { tier: 6, reason: "温和" },
        solves: facts.issues.map((i) => i.id),
      }),
      facts,
      { ...ORIGINAL, scores: { ...ORIGINAL.scores, dimensions: { ...ORIGINAL.scores.dimensions, homophone: 0 }, total: 69 } },
    );
    expect(out.rejected?.reasons).toBeUndefined();
    expect(out.candidate?.scores.dimensions.homophone).toBe(15);
  });

  it("陈俊熙 → 陈俊朗：四个档位和原名一样，只解决了撞名，收下（热门名封顶 89 以后要有改法）", () => {
    const facts = factsOf("陈俊熙", "male");
    const tiers = {
      pronunciation: { tier: 20, reason: "顺" },
      meaning: { tier: 16, reason: "正面" },
      gender: { tier: 12, reason: "男孩名" },
      style: { tier: 6, reason: "温和" },
    };
    const original = { ...ORIGINAL, tiers, scores: scoreBreakdown(facts, tiers, { styleBaseline: true }) };
    expect(original.scores.total).toBeLessThan(90);
    const out = verifyCandidate(rawCandidate({ givenName: "俊朗", ...tiers, solves: facts.issues.map((i) => i.id) }), facts, original);
    expect(out.rejected?.reasons).toBeUndefined();
    expect(out.candidate?.scores.total).toBeGreaterThan(original.scores.total);
  });

  it("文娟 → 文安 照样拒：年代感不算在「解决了撞名」里", () => {
    const out = verifyCandidate(rawCandidate({ givenName: "安", style: { tier: 6, reason: "安静温和" } }), factsOf("文娟", "female"), ORIGINAL);
    expect(out.candidate).toBeUndefined();
  });

  describe("大姓配单名：加一个字变双名", () => {
    const tiers = {
      pronunciation: { tier: 20, reason: "顺" },
      meaning: { tier: 20, reason: "旭是初升太阳" },
      gender: { tier: 12, reason: "男孩名" },
      style: { tier: 6, reason: "明亮" },
    };
    const facts = factsOf("王旭", "male");
    const original = { ...ORIGINAL, tiers, scores: scoreBreakdown(facts, tiers, { styleBaseline: true }) };
    const add = (givenName: string) =>
      verifyCandidate(rawCandidate({ givenName, ...tiers, solves: facts.issues.map((i) => i.id), why: "加一个字不撞名" }), facts, original);

    it("王旭原来封顶 89：换一个字（王晨）还是单名，涨不了分，拒", () => {
      expect(original.scores.total).toBe(89);
      expect(add("晨").candidate).toBeUndefined();
    });

    it("王旭 → 王旭阳、王子旭：原来的字留着，加一个字，收下，分数过 89", () => {
      const back = add("旭阳");
      expect(back.rejected?.reasons).toBeUndefined();
      expect(back.candidate).toMatchObject({ kind: "add", from: "", to: "阳", index: 1, fullName: "王旭阳" });
      expect(back.candidate!.scores.total).toBeGreaterThan(89);
      const front = add("子旭");
      expect(front.candidate).toMatchObject({ kind: "add", to: "子", index: 0 });
    });

    it("加字时把原来的字换掉了、或者加的是同一个字：拒", () => {
      expect(add("晨阳").rejected?.reasons.join("；")).toContain("原来那个字要留着");
      expect(add("旭旭").rejected?.reasons.join("；")).toContain("叠字");
    });

    it("不是大姓（林旭）照旧只能换一个字，写两个字的拒", () => {
      const lin = factsOf("林旭", "male");
      expect(lin.popularityFacts.singleNameBigSurname).toBe(false);
      const out = verifyCandidate(rawCandidate({ givenName: "旭阳", ...tiers }), lin, { ...original, scores: scoreBreakdown(lin, tiers, { styleBaseline: true }) });
      expect(out.rejected?.reasons.join("；")).toContain("长度变了");
    });

    it("大姓配单名没出改法：不再说「只改一个字解决不了」，说可以再试一次或重新起名", async () => {
      const provider: EvaluateProvider = {
        name: "no-opt",
        evaluate: async (_f, onScores, onOriginal) => {
          const raw: RawEvaluation = {
            status: "one_char_insufficient",
            scores: { pronunciation: 20, meaning: 20, gender: 12, style: 6, old: false },
            original: { pronunciation: "顺", meaning: "正", gender: "可", style: "稳", strengths: ["正"], issues: [], reminders: [] },
            options: [],
            note: "",
          };
          onScores?.(parseScores(raw.scores)!);
          onOriginal?.(raw.original!);
          return raw;
        },
      };
      const out = await evaluateName({ fullName: "王旭", gender: "male" }, provider);
      expect(out.status).not.toBe("one_char_insufficient");
      expect(out.note).toContain("加一个字");
    });
  });

  it("提示词：大姓配单名时告诉模型加一个字，别的名字不说", () => {
    const sys = (n: string) => buildEvaluateMessages(factsOf(n, "male"), true).find((m) => m.role === "user")!.content;
    expect(sys("王旭")).toContain("大姓配单名");
    expect(sys("林旭")).not.toContain("大姓配单名");
  });

  it("杜子腾 → 杜子藤：读音没变，谐音没解决，不放宽", () => {
    const facts = factsOf("杜子腾", "male");
    const out = verifyCandidate(rawCandidate({ givenName: "子藤", solves: facts.issues.map((i) => i.id) }), facts, ORIGINAL);
    expect(out.candidate).toBeUndefined();
    expect(out.rejected?.reasons.join("；")).toContain("谐音");
  });

  it("读音变了的照旧按候选自己的字查流行分", () => {
    const out = verifyCandidate(rawCandidate(), factsOf("文娟", "female"), ORIGINAL);
    expect(out.candidate?.soundLine).not.toBe("读音不变");
    expect(out.candidate?.scores.dimensions.popularity).toBeGreaterThan(ORIGINAL.scores.dimensions.popularity);
  });
});

describe("读音档以规则为准", () => {
  const tier = (t: number, reason = "") => ({ tier: t, reason });

  it("洪锐、黄锐声调一样、规则没查到读音毛病：模型给 16 还是 20，都按 20 算", () => {
    for (const n of ["洪锐", "黄锐"]) {
      const f = factsOf(n, "male");
      expect(anchorPronunciation(f, tier(16, "阳平接去声，顺口")).tier).toBe(20);
      expect(anchorPronunciation(f, tier(20, "收尾响亮")).tier).toBe(20);
    }
  });

  it("三个字同调：模型给 20 也按 16 算，理由换成规则那句", () => {
    const f = factsOf("张天星", "male");
    const out = anchorPronunciation(f, tier(20, "顺"));
    expect(out.tier).toBe(16);
    expect(out.reason).toContain("一个调");
  });

  it("模型说出具体哪个字怎么不顺，才往下调一档；只说「基本顺畅」「略绕口」不算", () => {
    const f = factsOf("洪锐", "male");
    expect(anchorPronunciation(f, tier(12, "洪和锐连读拗口")).tier).toBe(16);
    expect(anchorPronunciation(f, tier(8, "洪锐念着拗口")).tier).toBe(16); // 最多降一档
    expect(anchorPronunciation(f, tier(12, "略绕口")).tier).toBe(20);
    expect(anchorPronunciation(f, tier(16, "基本顺畅")).tier).toBe(20);
  });

  it("起名闸门：模型给的读音档不影响总分", () => {
    const hi = checkFastCandidate("荷晴", "刘", "female", { pronunciation: 20, meaning: 16, gender: 12 });
    const lo = checkFastCandidate("荷晴", "刘", "female", { pronunciation: 8, meaning: 16, gender: 12 });
    expect(hi.score).toBe(lo.score);
    expect(pronunciationBase(factsOf("刘荷晴", "female")).tier).toBe(16);
  });

  it("改了口径，缓存 key 跟着变", () => {
    expect(cacheKey("文", "娟", "female")).toContain(`${SCORING_REV}|`);
  });
});

describe("像上一辈的名字", () => {
  const rawWith = (scores: Record<string, unknown>, issueText: string): RawEvaluation => ({
    status: "options",
    scores,
    original: {
      pronunciation: "顺", meaning: "正", gender: "可", style: "稳",
      strengths: ["正"], charMeaning: "x", whole: "合起来 x", comment: "x",
      issues: issueText ? [{ text: issueText, importance: "major" }] : [],
      reminders: [],
    },
    options: [],
    note: "",
  });
  const run = async (fullName: string, raw: RawEvaluation) => {
    const frames: number[] = [];
    const provider: EvaluateProvider = {
      name: "age",
      evaluate: async (_f, onScores, onOriginal) => {
        const s = parseScores(raw.scores);
        if (s) onScores?.(s);
        onOriginal?.(raw.original!);
        return raw;
      },
    };
    const out = await evaluateName({ fullName, gender: "male" }, provider, { maxCandidates: 2 }, {
      onScores: (o) => frames.push(o.scores.total),
      onOriginal: (o) => frames.push(o.scores.total),
    });
    return { out, frames };
  };

  it("林建宏：规则查到建字、模型说像上一辈，原来被去重掉不降分；现在字义压到 12、流行压到 4，第一帧就是最终分", async () => {
    const { out, frames } = await run("林建宏", rawWith({ pronunciation: 20, meaning: 16, gender: 12, style: 6, old: true }, "建宏像上一辈名字"));
    expect(out.original?.scores.dimensions.meaning).toBe(12);
    expect(out.original?.scores.dimensions.popularity).toBe(4);
    expect(new Set(frames).size).toBe(1);
  });

  it("没写 old 时从模型原话认：「年代感重」算，「没有年代感」不算", async () => {
    const hit = await run("李志明", rawWith({ pronunciation: 20, meaning: 16, gender: 12, style: 6 }, "志明组合年代感重"));
    expect(hit.out.original?.scores.dimensions.meaning).toBe(12);
    expect(hit.out.original?.scores.dimensions.popularity).toBe(4);
    const miss = await run("李嘉明", rawWith({ pronunciation: 20, meaning: 16, gender: 12, style: 6 }, "嘉明没有年代感，读着顺"));
    expect(miss.out.original?.scores.dimensions.meaning).toBe(16);
  });

  it("old 写 false、原话却说像上一辈：按老派算（刘志豪一轮这样打到 94）", async () => {
    const { out } = await run("李嘉明", rawWith({ pronunciation: 20, meaning: 16, gender: 12, style: 6, old: false }, "嘉明像上一辈"));
    expect(out.original?.scores.dimensions.meaning).toBe(12);
    expect(out.original?.scores.total).toBeLessThan(90);
  });

  it("old 是 true 时第一帧就降分，后面不再变", async () => {
    const { frames } = await run("李嘉明", rawWith({ pronunciation: 20, meaning: 16, gender: 12, style: 6, old: true }, "嘉明像上一辈"));
    expect(new Set(frames).size).toBe(1);
  });

  it("parseScores 读 old", () => {
    expect(parseScores({ pronunciation: 16, meaning: 16, gender: 12, style: 6, old: true })?.old).toBe(true);
    expect(parseScores({ pronunciation: 16, meaning: 16, gender: 12, style: 6, old: "false" })?.old).toBe(false);
    expect(parseScores({ pronunciation: 16, meaning: 16, gender: 12, style: 6 })?.old).toBeUndefined();
  });
});

describe("非常优秀要过门", () => {
  const tiers = (meaning: number, gender = 12) => ({
    pronunciation: { tier: 20, reason: "" },
    meaning: { tier: meaning, reason: "" },
    gender: { tier: gender, reason: "" },
    style: { tier: 6, reason: "" },
  });

  it("规则没查到问题、字义 16、性别 12：照样非常优秀", () => {
    const s = scoreBreakdown(factsOf("陈思远", "male"), tiers(16), { styleBaseline: true });
    expect(s.total).toBeGreaterThanOrEqual(90);
    expect(s.bandLabel).toBe("非常优秀");
  });

  it("两个热门字：字义给满也封顶 89，理由写热门字", () => {
    const s = scoreBreakdown(factsOf("王梓萱", "female"), tiers(20), { styleBaseline: true });
    expect(s.total).toBe(89);
    expect(s.bandLabel).toBe("还能更好");
    expect(s.capReason).toContain("梓");
  });

  it("字义不到 16、性别不到 12、老派：都封顶 89", () => {
    // 20 + 12 + 18 + 15 + 10 + 15 = 90，差一点也不进非常优秀
    expect(scoreBreakdown(factsOf("陈思远", "male"), tiers(12), { styleBaseline: true }).total).toBe(89);
    expect(scoreBreakdown(factsOf("陈思远", "male"), tiers(20, 8), { styleBaseline: true }).total).toBeLessThan(90);
    expect(scoreBreakdown(factsOf("陈思远", "male"), tiers(20), { styleBaseline: true, old: true }).total).toBe(89);
  });

  it("没到 90、这轮没改法：不再说「原名已经很好」", async () => {
    const provider: EvaluateProvider = {
      name: "no-opt",
      evaluate: async (_f, onScores, onOriginal) => {
        const raw: RawEvaluation = {
          status: "no_better",
          scores: { pronunciation: 20, meaning: 16, gender: 12, style: 6, old: false },
          original: { pronunciation: "顺", meaning: "正", gender: "可", style: "稳", strengths: ["正"], issues: [], reminders: [] },
          options: [],
          note: "",
        };
        onScores?.(parseScores(raw.scores)!);
        onOriginal?.(raw.original!);
        return raw;
      },
    };
    const out = await evaluateName({ fullName: "王梓萱", gender: "female" }, provider);
    expect(out.original?.scores.total).toBeLessThan(90);
    expect(out.note ?? "").not.toContain("已经很好");
  });
});

describe("模型推理的短句", () => {
  it("去掉 JSON 字段名，开头带逗号的也去", () => {
    expect(cleanThought(',whole:合起来是洪亮又有锐气的样子')).toBe("合起来是洪亮又有锐气的样子");
    expect(cleanThought('"comment": "读着响，意思也正"')).toBe("读着响，意思也正");
    expect(cleanThought("就是锐字锋利感偏强")).toBe("就是锐字锋利感偏强");
  });
});

describe("敏感人物", () => {
  it("全名一致和同音同调都拦，普通名字不拦", () => {
    expect(isSensitiveName("习近平")).toBe(true);
    expect(isSensitiveName("习进平")).toBe(true);
    expect(isSensitiveName("文娟")).toBe(false);
    expect(isSensitiveName("李一诺")).toBe(false);
    // 声调不同不算
    expect(isSensitiveName("李枪")).toBe(false);
  });
});

/*
 * 评测名单里的名字不能写进提示词（2026-11-05）：模型会照抄例子里的答案，
 * 文海军每次都改成提示词里写的文海钧、文海峻，评测就量不出真实水平。
 * 名单在 data/eval/（不进 git），没有这个文件的机器跳过。
 */
const SAMPLE_NAMES = path.join(process.cwd(), "data", "eval", "sample-names.json");
describe.skipIf(!fs.existsSync(SAMPLE_NAMES))("打分提示词", () => {
  it("不出现评测名单里的名字", () => {
    const names = (JSON.parse(fs.readFileSync(SAMPLE_NAMES, "utf8")) as { name: string }[]).map((c) => c.name);
    const words = new Set<string>();
    for (const n of names) {
      words.add(n);
      // 双字名单独查（海军、志明）；单字名太容易误报，不查
      for (const sur of [1, 2]) if (n.length - sur >= 2) words.add(n.slice(sur));
    }
    // 只查系统提示词：用户消息里本来就是观众报的名字
    const system = [true, false]
      .flatMap((compact) => buildEvaluateMessages(factsOf("柯丽", "female"), compact))
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const leaks = [...words].filter((w) => system.includes(w));
    expect(leaks).toEqual([]);
  });
});

describe("同一个名字同一个分", () => {
  it("钉住原名评价时，模型这次给的档位不用，分数不变，改法照常核", async () => {
    let scoresSeen = 0;
    const out = await evaluateName({ fullName: "文娟", gender: "female" }, new FakeEvaluateProvider(), { pinnedOriginal: ORIGINAL }, {
      onScores: () => scoresSeen++,
      onOriginal: () => scoresSeen++,
    });
    expect(out.original).toBe(ORIGINAL);
    expect(scoresSeen).toBe(0);
    expect(out.candidates[0]?.fullName).toBe("文妍");
  });

  it("缓存只记完整评完的结果", () => {
    clearEvalCache();
    const key = cacheKey("文", "娟", "female");
    const base = { facts: factsOf("文娟", "female"), candidates: [], rejected: [], tookMs: 1 };
    setCached(key, { ...base, status: "error", original: ORIGINAL });
    setCached(key, { ...base, status: "options", original: null });
    expect(getCached(key)).toBeUndefined();
    setCached(key, { ...base, status: "no_better", original: ORIGINAL });
    expect(getCached(key)?.original?.scores.total).toBe(ORIGINAL.scores.total);
    clearEvalCache();
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

  it("字典初检会进提词页", () => {
    const round = prompterFromEvaluation({
      no: 1,
      facts: factsOf("刘华强", "male"),
      original: null,
      candidates: [],
      status: undefined,
      fixShown: false,
      dictionary: [
        { char: "华", pinyin: "huá", basicMeaning: "本意为花、荣华。" },
        { char: "强", pinyin: "qiáng", basicMeaning: "力量大。", missing: false },
      ],
    });
    if (round.state !== "score") throw new Error("应该是打分轮");
    expect(round.dictionary).toHaveLength(2);
    expect(round.dictionary?.[0]?.basicMeaning).toContain("荣华");
  });

  it("模型写的提醒会进提词页", async () => {    const raw: RawEvaluation = {
      status: "no_better",
      scores: { pronunciation: 16, meaning: 16, gender: 12, style: 6 },
      original: {
        pronunciation: "顺",
        meaning: "正",
        gender: "可",
        style: "稳",
        strengths: ["字义正"],
        charMeaning: "华是光华，强是刚强。",
        whole: "合起来是光华刚强的样子。",
        comment: "字义正面，但读着平。",
        issues: [],
        reminders: ["和电视剧角色刘华强重名，带黑帮联想"],
      },
      options: [],
      note: "",
    };
    const provider: EvaluateProvider = {
      name: "reminder",
      evaluate: async (_facts, onScores, onOriginal) => {
        onScores?.({ pronunciation: 16, meaning: 16, gender: 12, style: 6 });
        onOriginal?.(raw.original!);
        return raw;
      },
    };
    const out = await evaluateName({ fullName: "刘华强", gender: "male" }, provider);
    const round = prompterFromEvaluation({
      no: 1,
      facts: out.facts,
      original: out.original,
      candidates: [],
      status: out.status,
      note: out.note,
      fixShown: false,
    });
    if (round.state !== "score") throw new Error("应该是打分轮");
    expect(round.reminders).toContain("和电视剧角色刘华强重名，带黑帮联想");
    const parsed = parsePrompterRound(round);
    if (!parsed || parsed.state !== "score") throw new Error("提词页格式校验失败");
    expect(parsed.reminders).toContain("和电视剧角色刘华强重名，带黑帮联想");
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
