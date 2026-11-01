import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// 字表指向打分专用夹具：测试用到的字 + chen / yi / zi 三个音节的全部候选字
process.env.JINYU_CORPUS_DIR = path.join(process.cwd(), "tests", "fixtures", "score-corpus");

import forbiddenChars from "@/config/forbidden-chars.json";
import forbiddenMild from "@/config/forbidden-mild.json";
import folkChars from "@/config/folk-chars.json";
import badHomophones from "@/config/bad-homophones.json";
import l2Chars from "@/config/l2-chars.json";
import { resetCharTableCache } from "@/domain/analysis/chars";
import { resetSoundIndex, sameSoundCandidates } from "@/domain/score/candidates";
import {
  buildFixMessages,
  completedOptions,
  parseFixOutput,
  type FixPromptInput,
  type RawFix,
  type RawFixOption,
} from "@/domain/score/fix-prompt";
import { buildFixInput, suggestFixes, verifyOption } from "@/domain/score/fix";
import { nextStep } from "@/domain/score/next-step";
import { checkFastCandidate } from "@/fast/gate";
import { ERA_CHARS, ERA_NAMES, FOLK } from "@/domain/score/lexicon";
import { heardIssue, resolveSplit, scoreName } from "@/domain/score/score";
import { leanOf } from "@/domain/analysis/gender-lean";
import type { AnalysisGender } from "@/domain/analysis/types";
import type { CharFixProvider } from "@/providers/fix-provider";
import { FakeFixProvider } from "@/providers/fix-provider";

function score(fullName: string, gender: AnalysisGender = "unknown", surnameOverride?: string) {
  const split = resolveSplit(fullName, surnameOverride);
  if (!split) throw new Error(`拆不开：${fullName}`);
  return { split, result: scoreName(split, gender) };
}

/** 假模型：像真模型那样把 options 一条条交出去，最后返回整份。stream: false 只在最后返回；failAfterStream 交完再报错 */
function stub(
  raw: RawFix | null | Error,
  opts: { stream?: boolean; failAfterStream?: Error } = {},
): CharFixProvider & { calls: FixPromptInput[] } {
  const calls: FixPromptInput[] = [];
  return {
    name: "stub",
    calls,
    pick: async (input, onItem) => {
      calls.push(input);
      if (raw instanceof Error) throw raw;
      if (opts.stream !== false) {
        for (const o of (Array.isArray(raw?.options) ? raw!.options : []) as RawFixOption[]) onItem?.(o);
      }
      if (opts.failAfterStream) throw opts.failAfterStream;
      return raw;
    },
  };
}

beforeEach(() => {
  resetCharTableCache();
  resetSoundIndex();
});

describe("打分词表", () => {
  it("消极档是不宜字的子集", () => {
    const all = new Set(forbiddenChars as string[]);
    expect((forbiddenMild as string[]).filter((c) => !all.has(c))).toEqual([]);
  });

  it("民俗字表每个字只出现一次，分值和档位对得上", () => {
    const seen = new Map<string, string>();
    for (const g of folkChars as { chars: string; tier: string; points?: number }[]) {
      for (const c of g.chars) {
        expect(seen.has(c), `${c} 重复：${seen.get(c)} / ${g.tier}`).toBe(false);
        seen.set(c, g.tier);
      }
      if (g.tier === "note") expect(g.points ?? 0).toBe(0);
      else expect(g.points ?? 0).toBeGreaterThan(0);
    }
  });

  it("民俗扣分的字不和不宜字重复扣", () => {
    const all = new Set(forbiddenChars as string[]);
    const dup = [...FOLK.entries()].filter(([c, f]) => f.points > 0 && all.has(c)).map(([c]) => c);
    expect(dup).toEqual([]);
  });

  it("主播念的话里不出现五格、五行这类术语，占位符都替换掉了", () => {
    for (const [c, f] of FOLK) {
      expect(f.line, c).not.toMatch(/五格|三才|数理|五行|磁场|能量|气场|\{c\}/);
    }
  });

  it("年代感的字不和热门字、不宜字、民俗扣分字重复扣", () => {
    const hot = new Set(l2Chars as string[]);
    const bad = new Set(forbiddenChars as string[]);
    const dup = [...ERA_CHARS.keys()].filter((c) => hot.has(c) || bad.has(c) || (FOLK.get(c)?.tier ?? "") !== "");
    expect(dup).toEqual([]);
    for (const [, e] of [...ERA_CHARS, ...ERA_NAMES]) expect(e.line).not.toMatch(/\{c\}|\{n\}/);
    for (const [, e] of ERA_CHARS) expect(e.single.line).not.toMatch(/\{c\}/);
  });

  it("谐音坏词表的键是去声调连写的拼音，不重复", () => {
    const keys = (badHomophones as { py: string; say: string }[]).map((b) => b.py);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of badHomophones as { py: string; say: string }[]) {
      expect(b.py).toMatch(/^[a-z]+$/);
      expect(b.say.length).toBeGreaterThan(0);
    }
  });
});

describe("打分规则", () => {
  const cases: [string, AnalysisGender, number, string[]][] = [
    ["马梓宸", "male", 62, ["swap", "hot", "homophone"]], // 马梓 = 马子
    ["张子轩", "male", 80, ["template"]],
    ["杜子腾", "male", 65, ["homophone", "strokes"]],
    ["王招娣", "female", 74, ["swap"]],
    ["李知微", "female", 100, []],
    ["张知微", "female", 95, ["flatTone"]],
    ["沈默然", "male", 85, ["trap", "strokes"]],
    ["刘婵娟", "female", 67, ["homophone", "era"]],
    ["王望舒", "female", 92, ["sameSound"]],
    ["张仡卓", "unknown", 88, ["misread"]],
    ["欧阳娜娜", "female", 80, ["eraName"]], // 两个字都是父母辈字
    ["皇甫明", "unknown", 100, []],
    ["李清幽", "female", 85, ["forbidden"]],
    ["王死", "unknown", 60, ["forbidden", "singleName"]],
    ["李婷婷", "male", 55, ["gender", "eraName"]], // 两个字都偏女孩：男女用字扣 25（11-01 前是 15）
    ["张伟丽", "female", 75, ["gender", "eraName"]],
    ["李一诺", "unknown", 75, ["template", "strokes"]], // 一 1 画、诺 10 画
    ["王秀英", "female", 70, ["eraName"]],
    ["张建军", "male", 70, ["eraName"]],
    ["文娟", "female", 88, ["era"]], // 单名就是年代字
    ["文红梅", "female", 70, ["eraName", "flatTone"]],
    ["文红艳", "female", 75, ["eraName"]],
    ["王秀娟", "female", 75, ["eraName"]], // 祖辈字配父母辈字
    ["李知娟", "female", 97, ["era"]], // 双名里只有一个父母辈字
    ["王军", "male", 75, ["era", "singleName"]],
    ["孙梓涵", "female", 65, ["template", "homophone"]], // 孙梓 = 孙子
    ["吴驰", "male", 60, ["homophone", "singleName"]], // 吴驰 = 无耻
    ["李雅", "unknown", 87, ["sandhi", "singleName"]],
    ["李予安", "unknown", 97, ["sandhi"]],
  ];

  for (const [name, gender, expected, rules] of cases) {
    it(`${name}（${gender}）${expected} 分`, () => {
      const { result } = score(name, gender);
      expect(result.score).toBe(expected);
      expect(result.deductions.map((d) => d.rule).sort()).toEqual([...rules].sort());
    });
  }

  it("档位：90 以上非常优秀，80 到 89 可以用，80 以下建议改", () => {
    expect(score("李知微", "female").result.bandLabel).toBe("非常优秀");
    expect(score("张仡卓").result.bandLabel).toBe("可以用"); // 88
    expect(score("王招娣", "female").result.bandLabel).toBe("建议改"); // 74
    expect(score("文红艳", "female").result.bandLabel).toBe("建议改"); // 75：整名年代感
  });

  it("整个名字都偏另一个性别扣 25，单这一条就是建议改；一个字偏、一个字中性只扣 8", () => {
    const hai = score("文海军", "female").result;
    expect(hai.deductions.find((d) => d.rule === "gender")).toMatchObject({ points: 25, positions: [0, 1] });
    expect(hai.deductions.find((d) => d.rule === "gender")!.line).toContain("一听就是男孩名");
    expect(hai.score).toBe(65); // 还有「军」的年代感 10
    expect(hai.bandLabel).toBe("建议改");
    expect(score("文海军", "male").result.deductions.some((d) => d.rule === "gender")).toBe(false);
    const single = score("文军", "female").result.deductions.find((d) => d.rule === "gender")!;
    expect(single).toMatchObject({ points: 25, positions: [0] }); // 单名那一个字偏，也是整个名字偏
  });

  it("性别倾向表补了漏的字（俊、飞、雅、梦……）；男女都常用的字照旧算中性", () => {
    for (const c of "俊飞豪轩") expect(leanOf(c), c).toBe("male");
    for (const c of "雅梦彤菲") expect(leanOf(c), c).toBe("female");
    for (const c of "宇辰涵欣诺子晴") expect(leanOf(c), c).toBe("neutral"); // 晴：名字库里男孩的晴川、女孩的晴光都有
    // 李雅给男孩：雅偏女孩，单名那一个字偏就是整个名字偏
    expect(score("李雅", "male").result.deductions.find((d) => d.rule === "gender")).toMatchObject({ points: 25 });
  });

  it("老一辈的常见名整名算一条，不再按单字重复扣", () => {
    const { result } = score("王秀英", "female");
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]!.line).toContain("216 万");
  });

  it("双名两个字都是年代字：整名算一条", () => {
    const { result } = score("文红梅", "female");
    const era = result.deductions.filter((d) => d.rule === "eraName");
    expect(era).toHaveLength(1);
    expect(era[0]!.line).toContain("「红梅」");
    expect(era[0]!.positions).toEqual([0, 1]);
  });

  it("单名就是年代字，比放在双名里扣得重", () => {
    const single = score("文娟", "female").result;
    const inDouble = score("李知娟", "female").result;
    expect(single.deductions[0]!.points).toBeGreaterThan(inDouble.deductions[0]!.points);
    expect(single.deductions[0]!.line).toContain("单名");
  });

  it("大姓配单名扣重名；小姓、双名不扣", () => {
    const wang = score("王军", "male").result;
    expect(wang.deductions.find((d) => d.rule === "singleName")!.line).toContain("张伟");
    expect(score("文娟", "female").result.deductions.some((d) => d.rule === "singleName")).toBe(false);
    expect(score("张建军", "male").result.deductions.some((d) => d.rule === "singleName")).toBe(false);
  });

  it("开玩笑类谐音扣 15，骂人类扣 30", () => {
    expect(score("孙梓涵", "female").result.deductions.find((d) => d.rule === "homophone")!.points).toBe(15);
    expect(score("吴驰", "male").result.deductions.find((d) => d.rule === "homophone")!.points).toBe(30);
  });

  it("三声姓接三声字，只在姓会听成另一个常见姓时扣", () => {
    expect(score("李雅").result.deductions.find((d) => d.rule === "sandhi")!.line).toContain("听着像「黎雅」");
    // 沈变成二声撞不上常见姓；予雅两个三声都在名里，是普通的连读
    for (const name of ["沈予安", "王予雅"]) {
      expect(score(name).result.deductions.some((d) => d.rule === "sandhi")).toBe(false);
    }
    // 武永已经算成「无用」谐音，不再加一条
    expect(score("武永").result.deductions.map((d) => d.rule)).toEqual(["homophone"]);
  });

  it("烂大街名不再按热门字重复扣（轩是热门字）", () => {
    const { result } = score("张子轩", "male");
    expect(result.deductions.some((d) => d.rule === "hot")).toBe(false);
  });

  it("姓里的字不按名的规则扣：皇甫的皇不算", () => {
    const { result } = score("皇甫明");
    expect(result.surname).toBe("皇甫");
    expect(result.deductions).toEqual([]);
  });

  it("繁体输入和简体同分，展示保留原字", () => {
    const trad = score("陳梓宸", "male").result;
    const simp = score("陈梓宸", "male").result;
    expect(trad.score).toBe(simp.score);
    expect(trad.fullName).toBe("陳梓宸");
    expect(trad.syllables[0]!.ch).toBe("陳");
  });

  it("不填性别时不判性别", () => {
    expect(score("李婷婷", "unknown").result.deductions.some((d) => d.rule === "gender")).toBe(false);
  });

  it("谐音不雅的词换成能当众说的说法", () => {
    const line = score("刘婵娟", "female").result.deductions[0]!.line;
    expect(line).toContain("刘婵");
    expect(line).toContain("「流产」");
  });

  it("容易念错的字把两个读音都说出来", () => {
    const line = score("张仡卓").result.deductions[0]!.line;
    expect(line).toContain("yì");
    expect(line).toContain("gē");
  });

  it("只念不扣的民间说法单独列出，不影响分数", () => {
    const { result } = score("赵予安");
    expect(result.score).toBe(100);
    expect(result.folk.map((f) => f.char)).toEqual(["予"]);
    expect(result.folk[0]!.line).toContain("金鸡独立");
  });

  it("听出来的毛病和看出来的毛病分开：谐音、年代感、撞名换同音字改不掉", () => {
    const heard = (name: string, gender: AnalysisGender) =>
      Object.fromEntries(score(name, gender).result.deductions.map((d) => [d.rule, heardIssue(d)]));
    expect(heard("刘婵娟", "female")).toEqual({ homophone: true, era: true }); // 流产；娟是年代字
    expect(heard("王招娣", "female")).toEqual({ swap: true }); // 娣 = 弟
    expect(heard("王望舒", "female")).toEqual({ sameSound: true });
    expect(heard("张子轩", "male")).toEqual({ template: true });
    expect(heard("马梓宸", "male")).toEqual({ homophone: true, hot: true, swap: false }); // 宸是字太大，看出来的
    expect(heard("张仡卓", "unknown")).toEqual({ misread: false });
    expect(heard("李清幽", "female")).toEqual({ forbidden: false });
  });

  it("全名带声调的拼音给提词页用", () => {
    expect(score("文红艳", "female").result.pinyin).toBe("wén hóng yàn");
  });

  it("手动切拆法时按指定的姓算", () => {
    const { result } = score("欧阳明", "unknown", "欧");
    expect(result.surname).toBe("欧");
    expect(result.givenName).toBe("阳明");
  });
});

describe("打分之后推什么", () => {
  const plan = (name: string, gender: AnalysisGender = "unknown") => nextStep(score(name, gender).result);

  it("90 分以上已经很好，不推改字", () => {
    expect(plan("李知微", "female").kind).toBe("none");
    expect(plan("王望舒", "female").kind).toBe("none"); // 92 分，姓名同音只扣 8
  });

  it("有读音硬伤（谐音、娣）：先问观众能不能接受改一个字（读音会变），不接受就重新起名", () => {
    for (const [name, gender] of [["吴驰", "male"], ["刘婵娟", "female"], ["王招娣", "female"], ["马梓宸", "male"]] as const) {
      const next = plan(name, gender);
      expect(next.kind, name).toBe("ask");
      expect(next.soundIssues.length, name).toBeGreaterThan(0);
    }
    expect(plan("马梓宸", "male").soundIssues[0]!.line).toContain("「马子」");
  });

  it("其余低于 90 的直接给改一个字：改哪个字、改一个字够不够，交给模型判断", () => {
    expect(plan("张仡卓").kind).toBe("fix");
    expect(plan("文红艳", "female").kind).toBe("fix");
    expect(plan("张子轩", "male").kind).toBe("fix");
  });

  it("精简版闸门和打分榜用同一份谐音表：重新起名不会又起出同一个谐音", () => {
    expect(checkFastCandidate("婵娟", "刘").keep).toBe(false); // 流产
    expect(checkFastCandidate("梓晨", "马").keep).toBe(false); // 马子
    expect(checkFastCandidate("子腾", "杜").keep).toBe(false); // 肚子疼
    expect(checkFastCandidate("驰远", "吴").keep).toBe(false); // 无耻
  });
});

describe("同音候选", () => {
  it("宸的候选同音、不含热门字和自己，换上以后分数都更高", () => {
    const { split, result } = score("马梓宸", "male");
    const list = sameSoundCandidates(split, "male", 1);
    const chars = list.map((c) => c.char);
    expect(chars).toContain("晨");
    expect(chars).not.toContain("辰"); // 热门字
    expect(chars).not.toContain("宸");
    expect(list.every((c) => c.score > result.score)).toBe(true);
    expect(list.find((c) => c.char === "晨")!.sameTone).toBe(true);
    // 同声调的排在前面
    const firstOther = list.findIndex((c) => !c.sameTone);
    if (firstOther >= 0) expect(list.slice(firstOther).every((c) => !c.sameTone)).toBe(true);
  });

  it("梓的同音候选里不给子：换成子，马子的谐音就写在脸上了", () => {
    const { split } = score("马梓宸", "male");
    const chars = sameSoundCandidates(split, "male", 0, 50).map((c) => c.char);
    expect(chars).not.toContain("子");
  });

  it("候选里没有多音字和古人字号字", () => {
    const { split } = score("张仡卓");
    const chars = sameSoundCandidates(split, "unknown", 0, 50).map((c) => c.char);
    expect(chars).toContain("益");
    expect(chars).not.toContain("义"); // 古人字号
    expect(chars).not.toContain("一"); // 热门字
  });

  it("填了性别时不给另一个性别的倾向字", () => {
    const { split } = score("张仡卓", "female");
    const chars = sameSoundCandidates(split, "female", 0, 50).map((c) => c.char);
    expect(chars).not.toContain("益"); // 人名里偏男
  });
});

describe("改字", () => {
  const M = "益是增益、长进，卓是高而直立。合起来是一天比一天长进，愿孩子越学越有出息。";
  const verify = (name: string, gender: AnalysisGender, givenName: string, extra: Partial<RawFixOption> = {}) => {
    const { split, result } = score(name, gender);
    return verifyOption({ givenName, why: "好", meaning: M, ...extra }, result, split);
  };

  it("只差一个字、分数变高、换上的字不扣分的才收", () => {
    expect(verify("张仡卓", "unknown", "益卓")).toMatchObject({
      fullName: "张益卓",
      from: "仡",
      to: "益",
      index: 0,
      score: 100,
      soundLine: "读音不变",
      pinyin: "zhāng yì zhuó",
    });
    expect(verify("张仡卓", "unknown", "张益卓")!.givenName).toBe("益卓"); // 模型连姓一起写也认
    expect(verify("张仡卓", "unknown", "益明")).toBeNull(); // 改了两个字
    expect(verify("张仡卓", "unknown", "益")).toBeNull(); // 字数变了
    expect(verify("张仡卓", "unknown", "仡卓")).toBeNull(); // 没改
    expect(verify("张仡卓", "unknown", "一卓")).toBeNull(); // 92 分，可换上的「一」是热门字：拿一个毛病换另一个
  });

  it("听出来的毛病读音必须变：文红艳换成文红雁那种同音改法不收", () => {
    // 梓涵是烂大街名：紫涵按字查不撞名、分数还高（80 → 92），可念出来还是 zǐ hán
    expect(score("王紫涵", "female").result.score).toBe(92);
    expect(verify("王梓涵", "female", "紫涵")).toBeNull();
    expect(verify("王梓涵", "female", "知涵")).toMatchObject({ score: 92, soundLine: "zǐ → zhī" });
    // 年代名换成读音不同的字收
    expect(verify("文红艳", "female", "红安")).toMatchObject({ score: 90, soundLine: "yàn → ān" });
  });

  it("有读音硬伤的，改完不能还带着：马梓宸只换宸，马子还在", () => {
    expect(verify("马梓宸", "male", "梓晨")).toBeNull();
    expect(verify("马梓宸", "male", "知宸")).toMatchObject({ score: 85 });
    expect(verify("刘婵娟", "female", "婵安")).toBeNull(); // 流产还在
    expect(verify("刘婵娟", "female", "明娟")).toMatchObject({ score: 97, soundLine: "chán → míng" });
  });

  it("寓意念不了的不收：命理词、太短、大段引文", () => {
    expect(verify("张仡卓", "unknown", "益卓", { meaning: "益卓五行属土，八字喜土，所以选它最合适。" })).toBeNull();
    expect(verify("张仡卓", "unknown", "益卓", { meaning: "很好的名字" })).toBeNull();
    expect(verify("张仡卓", "unknown", "益卓", { meaning: "出自「君子以自强不息之意」，寓意孩子自强。" })).toBeNull();
  });

  it("理由带分数或命理词换成固定说法，太长的截短", () => {
    expect(verify("张仡卓", "unknown", "益卓", { why: "五行补土，100分" })!.why).toBe("「益」换下「仡」");
    const long = verify("张仡卓", "unknown", "益卓", { why: "益是增益，一看就懂，念起来也顺口，比原来的仡好认多了" })!.why;
    expect([...long].length).toBeLessThanOrEqual(20);
    expect(long.startsWith("益是增益")).toBe(true);
  });

  it("90 分以上不调模型", async () => {
    const { split, result } = score("李知微", "female");
    const p = stub({ options: [] });
    const out = await suggestFixes(result, split, p);
    expect(out.ok && out.options).toEqual([]);
    expect(p.calls).toHaveLength(0);
  });

  it("边写边核：一条一条核，核过的马上交出去，最多 3 条", async () => {
    const { split, result } = score("张仡卓");
    const seen: string[] = [];
    const options = ["一卓", "益卓", "益卓", "仡明", "安卓", "逸卓", "毅卓"].map((givenName) => ({ givenName, why: "好", meaning: M }));
    const out = await suggestFixes(result, split, stub({ options }), (o) => seen.push(o.fullName));
    expect(seen).toEqual(["张益卓", "张安卓", "张逸卓"]); // 一卓（热门字）、重复的、仡明（分数没变）丢掉，第 4 条不要
    expect(out.ok && out.options.map((o) => o.fullName)).toEqual(seen);
    expect(out.ok && typeof out.firstMs).toBe("number");
  });

  it("模型说改一个字解决不了：不给改法，带上原因，面板推重新起名", async () => {
    const { split, result } = score("文红艳", "female");
    const out = await suggestFixes(result, split, stub({ options: [], none: "红艳两个字合在一起才是那个年代的名字。" }));
    expect(out.ok && out.options).toEqual([]);
    expect(out.ok && out.unfixable).toBe("红艳两个字合在一起才是那个年代的名字");
    // 模型自己写了「建议重新起名」的去掉：面板后面会接这一句
    const dup = await suggestFixes(result, split, stub({ options: [], none: "只换一个字仍会留下旧意味，建议重新起名。" }));
    expect(dup.ok && dup.unfixable).toBe("只换一个字仍会留下旧意味");
  });

  it("一条都没核过：提示再点一次", async () => {
    const { split, result } = score("张仡卓");
    const out = await suggestFixes(result, split, stub({ options: [{ givenName: "仡明", why: "好", meaning: M }] }));
    expect(out.ok && out.options).toEqual([]);
    expect(out.ok && out.message).toContain("再点一次");
  });

  it("模型报错不崩；写到一半断了，已经核过的改法照样算", async () => {
    const { split, result } = score("张仡卓");
    const failed = await suggestFixes(result, split, stub(new Error("LLM 生成超时，请重试")));
    expect(failed.ok).toBe(false);
    const half = await suggestFixes(
      result,
      split,
      stub({ options: [{ givenName: "益卓", why: "好", meaning: M }] }, { failAfterStream: new Error("LLM 生成超时，请重试") }),
    );
    expect(half.ok && half.options.map((o) => o.fullName)).toEqual(["张益卓"]);
    const empty = await suggestFixes(result, split, stub(null));
    expect(empty.ok && empty.options).toEqual([]);
  });

  it("边写边核没赶上的，收尾时补上", async () => {
    const { split, result } = score("张仡卓");
    const raw = { options: [{ givenName: "益卓", why: "好", meaning: M }] };
    const out = await suggestFixes(result, split, stub(raw, { stream: false }));
    expect(out.ok && out.options.map((o) => o.fullName)).toEqual(["张益卓"]);
  });

  it("示例模式也能走通", async () => {
    const { split, result } = score("张仡卓");
    const out = await suggestFixes(result, split, new FakeFixProvider());
    expect(out.ok && out.options.length).toBeGreaterThan(0);
    expect(out.ok && out.options[0]).toMatchObject({ fullName: "张逸卓", score: 100 });
  });

  it("给模型的扣分理由标明听出来的还是看出来的；只有看出来的毛病的字给同音候选", () => {
    const { split, result } = score("马梓宸", "male");
    const input = buildFixInput(result, split);
    expect(input.sameSound.map((s) => s.char)).toEqual(["宸"]); // 梓身上是谐音和热门字，同音字改不掉
    expect(input.sameSound[0]!.candidates).toContain("晨");
    const [, user] = buildFixMessages(input);
    expect(user!.content).toContain("【看出来的】「宸」");
    expect(user!.content).toContain("【听出来的】「梓」");
    expect(user!.content).toContain("宸本来是深宅大屋");
    const era = score("文红艳", "female");
    expect(buildFixInput(era.result, era.split).sameSound).toEqual([]); // 红艳是年代名，听出来的
  });

  it("边写边取：只取 options 里写完的对象，字符串里的括号不算", () => {
    const partial = '{"options":[{"givenName":"益卓","why":"括号}不算","meaning":"x"},{"givenName":"安';
    expect(completedOptions(partial)).toEqual([{ givenName: "益卓", why: "括号}不算", meaning: "x" }]);
    expect(completedOptions('{"options":[{"givenName":"a\\"b","why":"","meaning":""}]')[0]!.givenName).toBe('a"b');
    expect(completedOptions('{"options":[],"none":"改不了"}')).toEqual([]);
    expect(completedOptions('{"opt')).toEqual([]);
    expect(parseFixOutput('```json\n{"options":[]}\n```')).toEqual({ options: [] });
    expect(parseFixOutput("不是 JSON")).toBeNull();
  });
});
