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
  });
});
