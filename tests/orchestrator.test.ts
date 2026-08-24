import { describe, expect, it } from "vitest";
import { normalizeRequest } from "@/domain/normalizer";
import { runGeneration } from "@/domain/orchestrator";
import { FakeProvider } from "@/providers/fake-provider";
import type { CandidateProvider } from "@/providers/types";

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
