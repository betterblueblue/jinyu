import { describe, expect, it } from "vitest";
import { buildBaziSummary } from "@/domain/bazi";
import type { NormalizedRequest } from "@/domain/types";

function req(over: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    surname: "李",
    gender: "female",
    birthStatus: "born",
    nameLength: "two",
    baziEnabled: true,
    birthDate: "2026-04-13",
    birthHour: undefined,
    generationPosition: "first",
    tabooChars: [],
    stylePrototypeId: "default_dignified",
    avoidPopular: true,
    isPreparationName: false,
    ...over,
  };
}

function pillars(over: Partial<NormalizedRequest>): string[] {
  const result = buildBaziSummary(req(over));
  if (!result.ok || !result.summary) throw new Error("expected bazi summary");
  return result.summary.pillarsText.split(" ");
}

describe("bazi 四柱", () => {
  it("日柱对齐万年历校验点", () => {
    // 校验点来自 baby-name-skill/references/wanni-calendar.md
    expect(pillars({ birthDate: "2000-01-01", birthHour: "12" })[2]).toBe("戊午");
    expect(pillars({ birthDate: "2024-01-01", birthHour: "12" })[2]).toBe("甲子");
    expect(pillars({ birthDate: "2026-04-13", birthHour: "12" })[2]).toBe("丁巳");
  });

  it("年柱、月柱按立春切换（2025 立春 02-03 22:10）", () => {
    const before = pillars({ birthDate: "2025-02-03", birthHour: "21" });
    const after = pillars({ birthDate: "2025-02-03", birthHour: "23" });
    expect(before[0]).toBe("甲辰");
    expect(before[1]).toBe("丁丑");
    expect(after[0]).toBe("乙巳");
    expect(after[1]).toBe("戊寅");
  });

  it("夜子时（23 点后）日柱归次日", () => {
    const late = pillars({ birthDate: "2026-10-30", birthHour: "23:30" });
    const early = pillars({ birthDate: "2026-10-30", birthHour: "22:30" });
    expect(late[2]).toBe("戊寅");
    expect(early[2]).toBe("丁丑");
  });

  it("认直播台的「巳时 9–11」文本，结果与 10 点一致", () => {
    const fromLabel = pillars({ birthDate: "2026-10-30", birthHour: "巳时 9–11" });
    const fromNumber = pillars({ birthDate: "2026-10-30", birthHour: "10" });
    expect(fromLabel[3]).toBe(fromNumber[3]);
    expect(fromLabel[3].endsWith("巳")).toBe(true);
  });

  it("无时辰只排六字并标精度有限", () => {
    const result = buildBaziSummary(req({ birthDate: "2026-04-13", birthHour: undefined }));
    if (!result.ok || !result.summary) throw new Error("expected bazi summary");
    expect(result.summary.precision).toBe("six_limited");
    expect(result.summary.pillarsText.split(" ")).toHaveLength(3);
    expect(result.summary.notes.join("")).toContain("仅排年月日");
  });

  it("有五行本气统计，且不再随时辰改动年月日柱", () => {
    const noHour = pillars({ birthDate: "2026-04-13" });
    const withHour = pillars({ birthDate: "2026-04-13", birthHour: "10" });
    expect(withHour.slice(0, 3)).toEqual(noHour);
    const result = buildBaziSummary(req({ birthDate: "2026-04-13", birthHour: "10" }));
    if (!result.ok || !result.summary) throw new Error("expected bazi summary");
    expect(result.summary.notes.join("")).toMatch(/五行/);
  });

  it("未出生或日期非法时拒绝排盘", () => {
    const unborn = buildBaziSummary(req({ birthStatus: "unborn", isPreparationName: true }));
    expect(unborn.ok).toBe(false);
    const bad = buildBaziSummary(req({ birthDate: "2026-13-40" }));
    expect(bad.ok).toBe(false);
  });
});
