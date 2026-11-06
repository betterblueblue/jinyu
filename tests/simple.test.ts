import { describe, expect, it } from "vitest";
import { normalizeRequest } from "@/domain/normalizer";
import { buildFacts } from "@/domain/evaluate/facts";
import { resolveSplit, scoreName } from "@/domain/score/score";
import { parsePrompterRound } from "@/live/prompter";
import { checkCitation, hardProblems } from "@/simple/checks";
import { DIMS, evalPrompt } from "@/simple/evaluate";
import { fastPrompt } from "@/simple/fast";
import { fullPrompt } from "@/simple/full";
import { arrayItemReader, parseObject, thoughtSplitter } from "@/simple/llm";
import { prompterFromSimple } from "../app/simple/live/simple-client";

describe("简化版：边写边拆名字", () => {
  it("names 数组里每写完一个对象就交出来，切在哪里都行", () => {
    const text = '{"names":[{"givenName":"清和","why":"有\\"引号\\"和}括号"},{"givenName":"临风"}],"note":"x"}';
    for (const size of [1, 3, 7, text.length]) {
      const got: string[] = [];
      const feed = arrayItemReader("names", (o) => got.push(String(o.givenName)));
      for (let i = 0; i < text.length; i += size) feed(text.slice(i, i + size));
      expect(got).toEqual(["清和", "临风"]);
    }
  });

  it("正文前后带了别的字也能拆出 JSON", () => {
    expect(parseObject('好的：{"a":1} 完')).toEqual({ a: 1 });
    expect(parseObject("没有")).toBeNull();
  });

  it("推理拆成一句一句，太短的、讲格式的不要", () => {
    const lines: string[] = [];
    const feed = thoughtSplitter((l) => lines.push(l));
    feed("娟是上一辈常用字，年代感重。好。输出 JSON 格式要注意。");
    feed("换成蔚，意思更具体一些。");
    expect(lines).toEqual(["娟是上一辈常用字，年代感重。", "换成蔚，意思更具体一些。"]);
  });
});

describe("简化版：程序检查只去掉硬伤", () => {
  it("谐音、生僻字算硬伤；热门字不算", () => {
    expect(hardProblems("杜", "子腾", "male").keep).toBe(false);
    expect(hardProblems("王", "梓晴", "female")).toMatchObject({ keep: true, hotChar: true });
  });

  it("辈分字上的毛病不算（那是家里定的）", () => {
    const plain = hardProblems("王", "承泽", "male");
    expect(plain.keep).toBe(true);
    expect(hardProblems("王", "承泽", "male", [0]).keep).toBe(true);
  });

  it("出处：书名篇名写在一起、原句后面带括号解释，都先理干净再核；编的核不过", () => {
    expect(checkCitation({ source: "《诗经·大雅·思齐》", quote: "大姒嗣徽音，则百斯男。" })).not.toBeNull();
    expect(checkCitation({ source: "诗经", quote: "岂弟君子，民之父母。（岂弟即恺悌）" })).not.toBeNull();
    expect(checkCitation({ source: "诗经", quote: "编造的一句不存在的诗" })).toBeNull();
  });
});

describe("简化版：提示词把要求写清楚", () => {
  it("完整起名：辈分字位置、避讳字、字数都写进去", () => {
    const two = normalizeRequest({ surname: "王", gender: "male", nameLength: "two", birthStatus: "born", generationChar: "承", generationPosition: "first", tabooChars: "明,强" });
    if (!two.ok) throw new Error(two.message);
    const p = fullPrompt(two.value);
    expect(p).toContain("辈分字「承」，必须放在名的第一个字");
    expect(p).toContain("避讳字：明、强");
    expect(p).toContain("名要两个字（全名三个字）");
    const one = normalizeRequest({ surname: "林", gender: "female", nameLength: "one", birthStatus: "born" });
    if (!one.ok) throw new Error(one.message);
    expect(fullPrompt(one.value)).toContain("名只要一个字（全名两个字）");
  });

  it("直播起名：说清楚名是两个字、连姓三个字（评测里模型把「两个字的名」写成过单名）；这一场给过的列出来", () => {
    const p = fastPrompt("沈", "female", "生在春天", ["清和", "临风"]);
    expect(p).toContain("名是两个字，连姓一共三个字");
    expect(p).toContain("不要重复：清和、临风");
    expect(p).toContain("生在春天");
  });

  it("打分改字：八个维度加起来是 100，和观众屏幕副标题一样", () => {
    expect(DIMS.reduce((n, d) => n + d.max, 0)).toBe(100);
    expect(DIMS.map((d) => d.label)).toEqual(["音律", "字义", "气质", "识读", "流行", "谐音", "国学", "字形"]);
    const s = resolveSplit("王旭")!;
    expect(evalPrompt(buildFacts(s, scoreName(s, "male")), "male")).toContain("单名也可以加一个字变双名");
  });
});

describe("简化版：打分结果画到现在的提词页上", () => {
  const s = resolveSplit("文娟")!;
  const facts = buildFacts(s, scoreName(s, "female"));
  const analysis = {
    total: 74, band: "change", bandLabel: "建议改",
    dims: DIMS.map((d) => ({ label: d.label, max: d.max, score: Math.round(d.max * 0.74), reason: "一句" })),
    comment: "点评", strengths: ["好认"], issues: [{ text: "年代感重", importance: "major" as const, kind: "流行" }],
    reminders: [], charMeaning: "文是文采，娟是秀美。",
  };

  it("八个维度都画出来；改法一到就显示；提词页同步接口收得下", () => {
    const round = prompterFromSimple({
      no: 1, facts, analysis, status: "options", thoughts: [],
      fixes: [{ fullName: "文蔚", givenName: "蔚", pinyin: "wén wèi", kind: "swap", from: "娟", to: "蔚", score: 86, why: "去掉年代感", meaning: "蔚是草木茂盛。" }],
    });
    expect(round.dimensions).toHaveLength(8);
    expect(round.fix?.options[0]).toMatchObject({ full: "文蔚", change: "娟 → 蔚 · 去掉年代感", score: 86 });
    expect(round.merit?.lines).toEqual(["点评", "文是文采，娟是秀美。"]);
    expect(parsePrompterRound(round)).not.toBeNull();
  });

  it("只先到了八维分（点评还没写完）：字义寓意标「还在写」，推理照常给主播念", () => {
    const round = prompterFromSimple({ no: 1, facts, analysis: { ...analysis, comment: "", charMeaning: "" }, fixes: [], thoughts: ["娟是上一辈常用字。"] });
    expect(round.merit).toEqual({ writing: true, lines: [] });
    expect(round.thinking).toEqual(["娟是上一辈常用字。"]);
    expect(round.fix?.running).toBe(true);
  });

  it("性别没填：提醒先问男宝女宝，没有分", () => {
    const round = prompterFromSimple({ no: 1, facts, analysis: null, fixes: [], thoughts: [], status: "needs_gender" });
    expect(round.score).toBe(0);
    expect(round.genderAsk).toContain("男宝还是女宝");
  });
});
