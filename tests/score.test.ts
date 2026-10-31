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
import { buildFixMessages, parseFixOutput, type FixPromptInput, type RawFix } from "@/domain/score/fix-prompt";
import { buildFixTargets, suggestFixes } from "@/domain/score/fix";
import { nextStep } from "@/domain/score/next-step";
import { checkFastCandidate } from "@/fast/gate";
import { ERA_CHARS, ERA_NAMES, FOLK } from "@/domain/score/lexicon";
import { resolveSplit, scoreName } from "@/domain/score/score";
import type { AnalysisGender } from "@/domain/analysis/types";
import type { CharFixProvider } from "@/providers/fix-provider";
import { FakeFixProvider } from "@/providers/fix-provider";

function score(fullName: string, gender: AnalysisGender = "unknown", surnameOverride?: string) {
  const split = resolveSplit(fullName, surnameOverride);
  if (!split) throw new Error(`拆不开：${fullName}`);
  return { split, result: scoreName(split, gender) };
}

function stub(raw: RawFix | null | Error): CharFixProvider & { calls: FixPromptInput[] } {
  const calls: FixPromptInput[] = [];
  return {
    name: "stub",
    calls,
    pick: async (input) => {
      calls.push(input);
      if (raw instanceof Error) throw raw;
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
    ["李婷婷", "male", 65, ["gender", "eraName"]],
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

  it("档位：90 以上非常优秀，75 到 89 可以用，75 以下建议改", () => {
    expect(score("李知微", "female").result.bandLabel).toBe("非常优秀");
    expect(score("张仡卓").result.bandLabel).toBe("可以用");
    expect(score("王招娣", "female").result.bandLabel).toBe("建议改");
  });

  it("老一辈的常见名整名算一条，不再按单字重复扣", () => {
    const { result } = score("王秀英", "female");
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]!.line).toContain("216 万");
  });

  it("双名两个字都是年代字：整名算一条，两个字都能换", () => {
    const { result } = score("文红梅", "female");
    const era = result.deductions.filter((d) => d.rule === "eraName");
    expect(era).toHaveLength(1);
    expect(era[0]!.line).toContain("「红梅」");
    expect(result.fixable.map((f) => f.char)).toEqual(["红", "梅"]);
  });

  it("单名就是年代字，比放在双名里扣得重，扣到能换字", () => {
    const single = score("文娟", "female").result;
    const inDouble = score("李知娟", "female").result;
    expect(single.deductions[0]!.points).toBeGreaterThan(inDouble.deductions[0]!.points);
    expect(single.deductions[0]!.line).toContain("单名");
    expect(single.fixable.map((f) => f.char)).toEqual(["娟"]);
    expect(inDouble.fixable).toEqual([]);
  });

  it("大姓配单名扣重名；小姓、双名不扣；换同音字解决不了，不算进可换的字", () => {
    const wang = score("王军", "male").result;
    expect(wang.deductions.find((d) => d.rule === "singleName")!.line).toContain("张伟");
    expect(wang.fixable.map((f) => f.char)).toEqual(["军"]); // 只有年代感那一条能靠换字解决
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

  it("可以换的字按扣分从多到少排，扣得少的不给换", () => {
    expect(score("马梓宸", "male").result.fixable.map((f) => f.char)).toEqual(["宸", "梓"]);
    expect(score("张知微", "female").result.fixable).toEqual([]);
  });

  it("毛病出在读音上的不给换字：换了同音字，读音和毛病都还在", () => {
    expect(score("刘婵娟", "female").result.fixable).toEqual([]); // 谐音「流产」
    expect(score("王望舒", "female").result.fixable).toEqual([]); // 王望同音
    expect(score("王招娣", "female").result.fixable).toEqual([]); // 娣 = 弟
  });

  it("手动切拆法时按指定的姓算", () => {
    const { result } = score("欧阳明", "unknown", "欧");
    expect(result.surname).toBe("欧");
    expect(result.givenName).toBe("阳明");
  });
});

describe("打分之后推什么", () => {
  const plan = (name: string, gender: AnalysisGender = "unknown") => {
    const { split, result } = score(name, gender);
    return nextStep(result, split);
  };

  it("读音上的硬伤又没字可换：直接推重新起名", () => {
    for (const name of ["吴驰", "刘婵娟", "王招娣"]) {
      const next = plan(name, "female");
      expect(next.kind, name).toBe("rename");
      expect(next.soundIssues.length, name).toBeGreaterThan(0);
    }
  });

  it("可换的字一个同音候选都没有，也算没字可换（杨伟的伟换哪个都还是那个谐音）", () => {
    const { result } = score("杨伟", "male");
    expect(result.fixable.map((f) => f.char)).toEqual(["伟"]);
    const next = plan("杨伟", "male");
    expect(next.kind).toBe("rename");
    expect(next.fixable).toEqual([]);
  });

  it("有字可换但读音硬伤还在：先问能不能只改字", () => {
    const next = plan("马梓宸", "male");
    expect(next.kind).toBe("ask");
    expect(next.fixable.map((f) => f.char)).toEqual(["宸"]);
    expect(next.soundIssues[0]!.line).toContain("「马子」");
  });

  it("换同音字就能解决的推改字；读音小毛病（姓名同音 8 分）不推重新起名", () => {
    // 夹具字表只收了 chen / yi / zi 三个音节的候选，所以用仡（yì）
    expect(plan("张仡卓").kind).toBe("fix");
    expect(plan("王望舒", "female").kind).toBe("none");
    expect(plan("李知微", "female").kind).toBe("none");
  });

  it("75 分以下又没字可换，也推重新起名", () => {
    const { split, result } = score("李知微", "female");
    const low = { ...result, score: 70, band: "change" as const, fixable: [], deductions: [] };
    expect(nextStep(low, split).kind).toBe("rename");
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
  it("没有要换的字时不调模型", async () => {
    const { split, result } = score("李知微", "female");
    const p = stub({ fixes: [] });
    const out = await suggestFixes(result, split, p);
    expect(out.ok && out.options).toEqual([]);
    expect(p.calls).toHaveLength(0);
  });

  it("模型挑的字在候选里：重新打分后给出", async () => {
    const { split, result } = score("马梓宸", "male");
    const p = stub({ fixes: [{ from: "宸", picks: [{ char: "晨", why: "同音，清晨的晨，干净" }] }] });
    const out = await suggestFixes(result, split, p);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.options).toHaveLength(1);
    // 宸换掉了，马梓（马子）和热门字梓还在：62 → 77
    expect(out.options[0]).toMatchObject({ fullName: "马梓晨", from: "宸", to: "晨", index: 1, score: 77 });
    expect(out.options[0]!.why).toBe("同音，清晨的晨，干净");
    // 梓也该换，但它的同音字换上去还是「马子」，一个候选都没有，所以只问宸
    expect(p.calls[0]!.targets.map((t) => t.char)).toEqual(["宸"]);
  });

  it("候选以外的字一律丢掉，宁可说没挑出来", async () => {
    const { split, result } = score("马梓宸", "male");
    const out = await suggestFixes(result, split, stub({ fixes: [{ from: "宸", picks: [{ char: "安", why: "平安" }] }] }));
    expect(out.ok && out.options).toEqual([]);
    expect(out.ok && out.message).toContain("没挑出");
  });

  it("理由里带分数或命理词的换成固定说法", async () => {
    const { split, result } = score("马梓宸", "male");
    const out = await suggestFixes(result, split, stub({ fixes: [{ from: "宸", picks: [{ char: "晨", why: "五行补火，92分" }] }] }));
    expect(out.ok && out.options[0]!.why).toBe("同音字，「晨」比「宸」更合适");
  });

  it("模型返回空或报错时不崩", async () => {
    const { split, result } = score("马梓宸", "male");
    const empty = await suggestFixes(result, split, stub(null));
    expect(empty.ok && empty.options).toEqual([]);
    const failed = await suggestFixes(result, split, stub(new Error("LLM 生成超时，请重试")));
    expect(failed.ok).toBe(false);
  });

  it("示例模式也能走通：每个要换的字挑第一个候选", async () => {
    const { split, result } = score("张仡卓");
    const out = await suggestFixes(result, split, new FakeFixProvider());
    expect(out.ok && out.options.length).toBe(1);
    expect(out.ok && out.options[0]!.score).toBe(100);
  });

  it("提示词里带着原因、读音和候选，解析能剥掉代码块", () => {
    const { split, result } = score("马梓宸", "male");
    const targets = buildFixTargets(result, split);
    const [, user] = buildFixMessages({ fullName: result.fullName, gender: "male", targets });
    expect(user!.content).toContain("「宸」");
    expect(user!.content).toContain("chén");
    expect(user!.content).toContain("晨");
    expect(user!.content).toContain("宸本来是深宅大屋");
    expect(parseFixOutput('```json\n{"fixes":[]}\n```')).toEqual({ fixes: [] });
    expect(parseFixOutput("不是 JSON")).toBeNull();
  });
});
