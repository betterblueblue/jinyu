import { describe, expect, it } from "vitest";
import { applyHardGate } from "@/domain/gate";
import { checkRecommendable, RECOMMEND_MIN_SCORE } from "@/domain/score/recommend";
import { scoreName } from "@/domain/score/score";
import type { NormalizedRequest } from "@/domain/types";

const req = (over: Partial<NormalizedRequest> = {}): NormalizedRequest => ({
  surname: "王",
  gender: "male",
  birthStatus: "born",
  nameLength: "two",
  baziEnabled: false,
  generationPosition: "first",
  tabooChars: [],
  avoidPopular: true,
  isPreparationName: false,
  ...over,
});

describe("能不能推荐：直播、完整版、打分榜同一套规则", () => {
  it("放行的名字，拿打分榜去打也不低于 90", () => {
    for (const [surname, given, gender] of [
      ["王", "思齐", "male"],
      ["李", "静姝", "female"],
      ["陈", "景明", "unknown"],
      ["林", "清瑶", "female"],
    ] as const) {
      const check = checkRecommendable(surname, given, gender);
      expect(check.ok, `${surname}${given}`).toBe(true);
      expect(scoreName({ surname, givenName: given, alternatives: [] }, gender).score).toBeGreaterThanOrEqual(
        RECOMMEND_MIN_SCORE,
      );
    }
  });

  it("硬伤不看总分：和姓同音只扣 8 分，照样不推荐", () => {
    const check = checkRecommendable("王", "望舒", "female");
    expect(check.score).toBe(92);
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("姓与名首字同音");
  });

  it("理由带上是哪个字", () => {
    expect(checkRecommendable("张", "宸熙", "male").reasons[0]).toBe("用字太大或不讨喜（宸）");
  });

  it("辈分字落下的扣分不算：用户指定了「宸」，不能因为它把名字全拦掉", () => {
    expect(checkRecommendable("张", "宸远", "male").ok).toBe(false);
    expect(checkRecommendable("张", "宸远", "male", { exemptPositions: [0] }).ok).toBe(true);
  });
});

describe("完整版闸门接上统一规则", () => {
  it("谐音和不宜字以前不查，现在拦", () => {
    const r = applyHardGate([{ givenName: "德明" }, { givenName: "冥远" }, { givenName: "思齐" }], req({ surname: "吴" }));
    expect(r.passed.map((p) => p.givenName)).toEqual(["思齐"]);
    expect(r.eliminated.find((e) => e.givenName === "德明")?.reasons).toContain("连姓读起来不雅");
    expect(r.eliminated.find((e) => e.givenName === "冥远")?.reasons[0]).toContain("含不宜用字");
  });

  it("辈分字是换字档的字也照常出名字", () => {
    const r = applyHardGate([{ givenName: "宸远" }], req({ surname: "张", generationChar: "宸" }));
    expect(r.passed.map((p) => p.givenName)).toEqual(["宸远"]);
  });

  it("关了「尽量避开热门名」，两个热门字不因热门被拦", () => {
    const on = applyHardGate([{ givenName: "梓萱" }], req({ surname: "陈", gender: "female" }));
    const off = applyHardGate([{ givenName: "梓萱" }], req({ surname: "陈", gender: "female", avoidPopular: false }));
    expect(on.passed).toHaveLength(0);
    expect(off.passed.map((p) => p.givenName)).toEqual(["梓萱"]);
  });

  it("性别未知时按模型标的倾向判", () => {
    const r = applyHardGate(
      [
        { givenName: "婉婷", genderLean: "male" },
        { givenName: "婉清", genderLean: "female" },
      ],
      req({ gender: "unknown", surname: "李" }),
    );
    expect(r.passed.map((p) => p.givenName)).toEqual(["婉清"]);
  });
});
