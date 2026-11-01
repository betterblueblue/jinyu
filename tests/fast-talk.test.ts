import { describe, expect, it } from "vitest";
import { birthTimeOf } from "@/fast/birth";
import { buildTalkUser, parseTalks } from "@/fast/talk";
import { tasteProblems } from "@/fast/taste";
import type { FastCandidate, FastSuccess } from "@/fast/types";
import { parsePrompterRound } from "@/live/prompter";
import { namesNeedingTalk, prompterFromFast } from "../app/live/prompter-sync";

const cand = (givenName: string, why: string, extra: Partial<FastCandidate> = {}): FastCandidate => ({
  givenName,
  fullName: `高${givenName}`,
  pinyin: "gāo",
  why,
  hotChar: false,
  ...extra,
});

const result = (primary: FastCandidate, alternatives: FastCandidate[]): FastSuccess => ({
  ok: true,
  surname: "高",
  gender: "male",
  primary,
  alternatives,
  tookMs: 1,
  notes: [],
});

describe("模型起的名字再过一道口味检查", () => {
  it("叠字、否定字、迟暮冷清的字、两个字都带三点水的不要", () => {
    expect(tasteProblems("昭昭")).toContain("叠字像小名");
    expect(tasteProblems("未晞")).toContain("有否定的字");
    expect(tasteProblems("晚晴")).toContain("有迟暮、冷清的字");
    expect(tasteProblems("清源")).toContain("两个字都带三点水");
  });

  it("用户给过高分的名字不误伤", () => {
    for (const n of ["晴川", "煦宁", "怀瑾", "济川", "徽音", "锦心", "星远", "舒晴"]) expect(tasteProblems(n), n).toEqual([]);
  });
});

describe("出生时节", () => {
  it("按节气分季节，和观众屏幕上那行同一个口径", () => {
    expect(birthTimeOf("2026-02-03")).toEqual({ season: "冬末", jieqi: "大寒" });
    expect(birthTimeOf("2026-02-05")).toEqual({ season: "春天", jieqi: "立春" });
    expect(birthTimeOf("2026-03-15")).toEqual({ season: "春天", jieqi: "惊蛰" });
    expect(birthTimeOf("2026-04-10")).toEqual({ season: "春末", jieqi: "清明" });
    expect(birthTimeOf("2026-07-10")).toEqual({ season: "夏末", jieqi: "小暑" });
  });

  it("格式不对返回空", () => {
    expect(birthTimeOf("2026/03/15")).toBeNull();
  });
});

describe("模型写的口播稿", () => {
  it("写稿的提示里只给季节，不给四柱", () => {
    const user = buildTalkUser({ surname: "高", gender: "male", birthday: "2026-03-15", names: [{ givenName: "晴川", why: "前途一片光明" }] });
    expect(user).toContain("生在春天");
    expect(user).not.toMatch(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/);
    // 晴是春天的起手字：稿子顺着讲一句时节
    expect(user).toContain("高晴川：前途一片光明（「晴」字是照着春天出生挑的）");
    expect(user).toContain("合起来那句先顺着说一句时节");
  });

  it("只收要的名字，补句号；命理词、大段引文、补五行的整份不要", () => {
    const content = JSON.stringify({
      talks: [
        { givenName: "晴川", chars: "晴是晴天，川是河流", whole: "合起来是晴天下的大河，希望孩子前路开阔。", tip: "" },
        { givenName: "松朗", chars: "松是松树，朗是明朗。", whole: "合起来是松林里透亮，命里缺木正好补木。" },
        { givenName: "岳宁", chars: "岳是高山，宁是安宁。", whole: "合起来出自「山高月小水落石出」，希望孩子稳重。" },
        { givenName: "夏禾", chars: "夏是夏天，禾是禾苗。", whole: "合起来能旺一家人。" },
        { givenName: "别人", chars: "不是这一轮的。", whole: "合起来不要。" },
      ],
    });
    const talks = parseTalks(content, ["晴川", "松朗", "岳宁", "夏禾"]);
    expect(Object.keys(talks)).toEqual(["晴川"]);
    expect(talks.晴川!.chars).toBe("晴是晴天，川是河流。");
    expect(talks.晴川!.tip).toBeUndefined();
  });

  it("返回的不是 JSON 就当没写出来", () => {
    expect(parseTalks("写不出来", ["晴川"])).toEqual({});
  });
});

describe("提词页：模型起的名字也有整段稿子", () => {
  const data = result(cand("晴川", "前途一片光明"), [cand("松朗", "人开朗"), cand("岳宁", "日子安宁")]);

  it("刚出结果：首推只有一句话和体检句，标「还在写」；备选也标", () => {
    const round = prompterFromFast(data, 3);
    if (round.state !== "ready") throw new Error("应该是 ready");
    expect(round.primary!.lines).toEqual(["高晴川，前途一片光明。", "系统按高姓查过，没查到不好的谐音和生僻字。"]);
    expect(round.primary!.writing).toBe(true);
    expect(round.sections[0]!.names.every((n) => n.writing)).toBe(true);
    expect(namesNeedingTalk(data).map((n) => n.givenName)).toEqual(["晴川", "松朗", "岳宁"]);
  });

  it("稿子写好了：首推补上拆字和合起来，备选也有；写不出来的那个不再标「还在写」", () => {
    const round = prompterFromFast(data, 3, {
      晴川: { chars: "晴是晴天，川是河流。", whole: "合起来是晴天下的大河。", tip: "川读 chuān。" },
      松朗: { chars: "松是松树，朗是明朗。", whole: "合起来是松林透亮。" },
    });
    if (round.state !== "ready") throw new Error("应该是 ready");
    expect(round.primary!.lines).toEqual([
      "高晴川，前途一片光明。",
      "晴是晴天，川是河流。",
      "合起来是晴天下的大河。",
      "系统按高姓查过，没查到不好的谐音和生僻字。",
    ]);
    expect(round.primary!.tip).toBe("川读 chuān。");
    expect(round.primary!.writing).toBeUndefined();
    const [song, yue] = round.sections[0]!.names;
    expect(song!.lines).toEqual(["松是松树，朗是明朗。", "合起来是松林透亮。"]);
    expect(yue!.lines).toBeUndefined();
    expect(yue!.writing).toBeUndefined();
  });

  it("名字库补位的名字用库里的稿子，不再请模型写", () => {
    const lib = cand("煦宁", "温暖明亮，心里安宁", {
      library: { id: "x", talk: { one: "温暖明亮，心里安宁", chars: "煦是温暖，宁是安宁。", whole: "合起来是暖暖的安宁。" } },
    });
    const withLib = result(lib, [cand("松朗", "人开朗")]);
    expect(namesNeedingTalk(withLib).map((n) => n.givenName)).toEqual(["松朗"]);
    const round = prompterFromFast(withLib, 1);
    if (round.state !== "ready") throw new Error("应该是 ready");
    expect(round.primary!.source).toBe("library");
    expect(round.primary!.writing).toBeUndefined();
  });

  it("同步接口收得下备选的稿子，格式不对的整份不收", () => {
    const round = prompterFromFast(data, 3, { 松朗: { chars: "松是松树，朗是明朗。", whole: "合起来是松林透亮。" } });
    const parsed = parsePrompterRound(JSON.parse(JSON.stringify(round)));
    expect(parsed).toEqual(round);
    const bad = JSON.parse(JSON.stringify(round)) as { sections: { names: { lines: unknown }[] }[] };
    bad.sections[0]!.names[0]!.lines = "不是数组";
    expect(parsePrompterRound(bad)).toBeNull();
  });
});
