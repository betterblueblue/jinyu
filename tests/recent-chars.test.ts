import { beforeEach, describe, expect, it } from "vitest";
import { evaluateName } from "@/domain/evaluate/evaluate";
import { FakeEvaluateProvider, type EvaluateProvider } from "@/domain/evaluate/provider";
import { AVOID_MAX, avoidChars, RECENT_CHARS, resetRecentChars, startRound } from "@/domain/evaluate/recent-chars";

/** 记一位：每个候选换上的字 */
function round(gender: "male" | "female", ...cands: string[]) {
  const rec = startRound(gender);
  for (const c of cands) rec([...c]);
}

describe("改字避开最近换上的字", () => {
  beforeEach(() => resetRecentChars());

  it(`同一个性别最近换上的 ${RECENT_CHARS} 个字全避开，新的在前；更早的不再列（除非用多了）`, () => {
    round("female", "晴");
    for (let i = 0; i < RECENT_CHARS; i++) round("female", String.fromCodePoint(0x4e00 + i));
    const list = avoidChars("female", "娟");
    expect(list[0]).toBe(String.fromCodePoint(0x4e00 + RECENT_CHARS - 1));
    expect(list).toHaveLength(RECENT_CHARS);
    expect(list).not.toContain("晴");
  });

  it("男女分开记：男孩换上的字不挤掉女孩的", () => {
    round("female", "晴");
    for (let i = 0; i < 10; i++) round("male", String.fromCodePoint(0x4e00 + i));
    expect(avoidChars("female", "娟")).toEqual(["晴"]);
    expect(avoidChars("male", "军")).not.toContain("晴");
  });

  it("原名里本来有的字不列：给刘晴改字时不叫它别用晴", () => {
    round("female", "晴");
    expect(avoidChars("female", "晴")).toEqual([]);
  });

  it(`最近 20 个候选里出现在 2 位以上的字，挤出最近 ${RECENT_CHARS} 个字以后也照样避开`, () => {
    round("female", "晴");
    round("female", "晴");
    for (let i = 0; i < RECENT_CHARS; i++) round("female", String.fromCodePoint(0x4e00 + i));
    expect(avoidChars("female", "娟")).toContain("晴");
  });

  it("同一位的两个候选都用了同一个字只算一位", () => {
    round("female", "晴", "晴");
    for (let i = 0; i < RECENT_CHARS; i++) round("female", String.fromCodePoint(0x4e00 + i));
    expect(avoidChars("female", "娟")).not.toContain("晴");
  });

  it(`最多列 ${AVOID_MAX} 个字`, () => {
    round("female", "晴");
    round("female", "晴");
    round("female", "悦");
    round("female", "悦");
    // 10 位、每位一个两字候选：最近 18 个字装满，晴、悦挤出去但还在最近 20 个候选里，算用多了
    for (let i = 0; i < 10; i++) round("female", String.fromCodePoint(0x4e00 + 2 * i, 0x4e01 + 2 * i));
    const list = avoidChars("female", "娟");
    expect(list).toHaveLength(AVOID_MAX);
    expect(list.slice(-2).sort()).toEqual(["悦", "晴"].sort());
  });

  it("evaluateName 把上一位换上的字传给模型，性别没填的不记也不传", async () => {
    const seen: string[][] = [];
    const fake = new FakeEvaluateProvider();
    const spy: EvaluateProvider = {
      name: "spy",
      evaluate: (facts, onScores, onOriginal, onOption, onThought, banned, signal) => {
        seen.push([...(banned ?? [])]);
        return fake.evaluate(facts, onScores, onOriginal, onOption);
      },
    };
    // 假模型把最后一个字换掉：男孩换「宁」（核得过），女孩换「妍」（识读比原名低，核不过）
    const first = await evaluateName({ fullName: "王建国", gender: "male" }, spy, { maxCandidates: 2 });
    expect(first.candidates.map((c) => c.fullName)).toEqual(["王建宁"]);
    await evaluateName({ fullName: "文海军", gender: "male" }, spy, { maxCandidates: 2 });
    await evaluateName({ fullName: "文娟", gender: "female" }, spy, { maxCandidates: 2 });
    await evaluateName({ fullName: "王秀英", gender: "female" }, spy, { maxCandidates: 2 });
    await evaluateName({ fullName: "李芳", gender: "unknown" }, spy, { maxCandidates: 2 });
    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual(["宁"]);
    // 男孩换上的「宁」不传给女孩
    expect(seen[2]).toEqual([]);
    // 被拒的「妍」不记
    expect(seen[3]).toEqual([]);
    // 性别没填不调模型
    expect(seen).toHaveLength(4);
  });
});
