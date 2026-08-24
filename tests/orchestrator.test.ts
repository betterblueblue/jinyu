import { describe, expect, it } from "vitest";
import { normalizeRequest } from "@/domain/normalizer";
import { runGeneration } from "@/domain/orchestrator";
import { rankSoft } from "@/domain/soft-ranker";
import { FakeProvider } from "@/providers/fake-provider";
import type { CandidateProvider } from "@/providers/types";
import type { GatedCandidate, NormalizedRequest } from "@/domain/types";

describe("rankSoft", () => {
  it("保留模型原文 styleFit，不覆盖成模板句", () => {
    const n = normalizeRequest({ surname: "王", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const req: NormalizedRequest = n.value;

    const cands: GatedCandidate[] = [
      {
        givenName: "清让",
        fullName: "王清让",
        genderLean: "male",
        styleFit: "温润端方，谦和有礼",
        meaning: "清正谦逊",
        origin: "",
      },
      {
        givenName: "知夏",
        fullName: "王知夏",
        genderLean: "male",
        styleFit: "", // 模型没给 styleFit
        meaning: "明朗温暖",
        origin: "",
      },
    ];

    const ranked = rankSoft(cands, req).ranked;
    const byName = Object.fromEntries(ranked.map((c) => [c.givenName, c.styleFit]));
    // 有原文 → 保留原文
    expect(byName["清让"]).toBe("温润端方，谦和有礼");
    // 无原文且命中关键词（meaning 含「端」不命中，但「端庄」关键词需字面）→ 走模板兜底
    expect(byName["知夏"]).toMatch(/端庄耐看|贴近/);
  });

  it("无模型原文且未命中关键词时用贴近兜底", () => {
    const n = normalizeRequest({ surname: "王", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const cands: GatedCandidate[] = [
      {
        givenName: "云帆",
        fullName: "王云帆",
        genderLean: "male",
        styleFit: "",
        meaning: "开阔远大",
        origin: "",
      },
    ];
    const ranked = rankSoft(cands, n.value).ranked;
    expect(ranked[0]!.styleFit).toMatch(/贴近|端庄耐看/);
  });

  it("关键词打分不含 styleFit（避免模型复述风格名导致全部命中）", () => {
    const n = normalizeRequest({ surname: "王", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const cands: GatedCandidate[] = [
      {
        givenName: "甲",
        fullName: "王甲",
        genderLean: "male",
        styleFit: "契合端庄耐看的风格要求", // styleFit 含关键词，但 meaning 不含
        meaning: "开阔远大",
        origin: "",
      },
      {
        givenName: "乙",
        fullName: "王乙",
        genderLean: "male",
        styleFit: "清朗利落",
        meaning: "温润端庄，稳重有礼", // meaning 真含关键词
        origin: "",
      },
    ];
    const ranked = rankSoft(cands, n.value).ranked;
    // 乙的 meaning 真含「端庄」→ 命中关键词加分，应排前
    // 甲的 styleFit 含「端庄」但 meaning 不含 → 不得分，应排后
    expect(ranked[0]!.givenName).toBe("乙");
  });
});

describe("runGeneration", () => {
  it("happy path produces report with overview", async () => {
    const n = normalizeRequest({ surname: "王", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const result = await runGeneration(n.value, new FakeProvider("default"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.overview.primaryName).toBeTruthy();
    expect(result.report.names.length).toBeGreaterThanOrEqual(3);
    expect(result.report.overview.names.every((x) => x.startsWith("王"))).toBe(true);
    expect(result.report.names.some((x) => x.givenName === "子轩")).toBe(false);
  });

  it("insufficient after hard rules fails with message", async () => {
    const n = normalizeRequest({ surname: "王", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const result = await runGeneration(n.value, new FakeProvider("all_l1"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/不足|硬规则|L1/);
  });

  it("gender unknown groups", async () => {
    const n = normalizeRequest({ surname: "李", gender: "unknown" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const result = await runGeneration(n.value, new FakeProvider("default"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.decisionAdvice).toMatch(/性别未知|收窄/);
  });

  it("bazi optional when enabled", async () => {
    const n = normalizeRequest({
      surname: "陈",
      gender: "female",
      birthStatus: "born",
      baziEnabled: true,
      birthDate: "2020-05-01",
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const result = await runGeneration(n.value, new FakeProvider("default"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.bazi?.enabled).toBe(true);
    expect(result.report.bazi?.restrainedAdvice).not.toMatch(/必然用神|铁口/);
  });

  it("forwards thinking and stage events via onProgress", async () => {
    const n = normalizeRequest({ surname: "王", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const progress: string[] = [];
    const stages: string[] = [];
    const result = await runGeneration(n.value, new FakeProvider("default"), (evt) => {
      if (evt.type === "thinking") progress.push(evt.text);
      else if (evt.type === "stage") stages.push(evt.stage);
    });
    expect(result.ok).toBe(true);
    expect(progress.some((t) => t.includes("思考"))).toBe(true);
    expect(stages).toContain("filter");
    expect(stages).toContain("assemble");
  });

  it("unknown gender: 全 neutral 候选不产生重复推荐", async () => {
    const n = normalizeRequest({ surname: "林", gender: "unknown" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;

    const neutralProvider: CandidateProvider = {
      name: "all-neutral",
      async generateCandidates() {
        return ["子衿", "清和", "知微", "云帆", "望舒", "既明"].map((givenName) => ({
          givenName,
          genderLean: "neutral",
          phonology: "p",
          glyph: "g",
          meaning: "m",
          origin: "o",
          pitfalls: "p",
          styleFit: "s",
        }));
      },
    };

    const result = await runGeneration(n.value, neutralProvider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gs = result.report.names.map((x) => x.givenName);
    const dupes = gs.filter((x, i, arr) => arr.indexOf(x) !== i);
    expect(dupes).toEqual([]);
    expect(gs.length).toBeGreaterThanOrEqual(2);
    // 男向/女向必须零重叠（回归：全 neutral 时曾完全重合）
    const male = result.report.overview.maleNames ?? [];
    const female = result.report.overview.femaleNames ?? [];
    expect(male).not.toEqual([]);
    expect(female).not.toEqual([]);
    expect(male.filter((x) => female.includes(x))).toEqual([]);
  });

  it("unknown gender: 重复候选只保留一个，不产生重复名、男向女向零重叠", async () => {
    const n = normalizeRequest({ surname: "林", gender: "unknown" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;

    const dupProvider: CandidateProvider = {
      name: "dup-neutral",
      async generateCandidates() {
        // 模型可能重复输出同一 givenName（历史报告曾出现），应按 givenName 去重
        const mk = (givenName: string, genderLean: "male" | "female" | "neutral") => ({
          givenName,
          genderLean,
          phonology: "p",
          glyph: "g",
          meaning: "m",
          origin: "o",
          pitfalls: "p",
          styleFit: "s",
        });
        return [
          mk("清和", "neutral"),
          mk("知微", "neutral"),
          mk("知微", "neutral"),
          mk("子衿", "neutral"),
          mk("云帆", "neutral"),
        ];
      },
    };

    const result = await runGeneration(n.value, dupProvider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gs = result.report.names.map((x) => x.givenName);
    expect(new Set(gs).size).toBe(gs.length); // report.names 无重复
    expect(result.report.overview.names.length).toBe(
      new Set(result.report.overview.names).size,
    ); // overview 无重复
    const male = result.report.overview.maleNames ?? [];
    const female = result.report.overview.femaleNames ?? [];
    expect(new Set(male).size).toBe(male.length); // 男向组内无重复
    expect(new Set(female).size).toBe(female.length); // 女向组内无重复
    expect(male.filter((x) => female.includes(x))).toEqual([]); // 男向女向零重叠
  });

  it("unknown gender: 男向/女向按倾向分拣，neutral 补齐且不跨组重复", async () => {
    const n = normalizeRequest({ surname: "周", gender: "unknown" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;

    const mixedProvider: CandidateProvider = {
      name: "mixed-lean",
      async generateCandidates() {
        const mk = (givenName: string, genderLean: "male" | "female" | "neutral") => ({
          givenName,
          genderLean,
          phonology: "p",
          glyph: "g",
          meaning: "m",
          origin: "o",
          pitfalls: "p",
          styleFit: "s",
        });
        return [
          mk("景行", "male"),
          mk("怀瑾", "female"),
          mk("书白", "neutral"),
          mk("明澈", "male"),
          mk("清和", "female"),
          mk("安然", "neutral"),
        ];
      },
    };

    const result = await runGeneration(n.value, mixedProvider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const male = result.report.overview.maleNames ?? [];
    const female = result.report.overview.femaleNames ?? [];
    expect(male).toHaveLength(2);
    expect(female).toHaveLength(2);
    expect(male).toContain("周景行"); // 男倾向进男向
    expect(female).toContain("周怀瑾"); // 女倾向进女向
    expect(male.filter((x) => female.includes(x))).toEqual([]); // 不跨组重复
    expect(result.report.overview.names).toHaveLength(4);
  });
});
