import { describe, expect, it } from "vitest";
import { buildBaziSummary } from "@/domain/bazi";
import type { BaziSummary, NormalizedRequest } from "@/domain/types";

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
    avoidPopular: true,
    isPreparationName: false,
    ...over,
  };
}

function summary(over: Partial<NormalizedRequest>): BaziSummary {
  const result = buildBaziSummary(req(over));
  if (!result.ok || !result.summary) throw new Error("expected bazi summary");
  return result.summary;
}

function pillars(over: Partial<NormalizedRequest>): string[] {
  return summary(over).pillarsText.split(" ");
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

  it("精确 23:30 按夜子时换日柱，且提示不说早子时", () => {
    const late = summary({ birthDate: "2026-10-30", birthHour: "23:30" });
    const early = summary({ birthDate: "2026-10-30", birthHour: "22:30" });
    expect(late.pillarsText.split(" ")[2]).toBe("戊寅");
    expect(early.pillarsText.split(" ")[2]).toBe("丁丑");
    expect(late.notes.join("")).toContain("夜子时");
    expect(late.notes.join("")).not.toContain("早子时");
  });

  it("认直播台的「巳时 9–11」文本，结果与 10 点一致", () => {
    const fromLabel = summary({ birthDate: "2026-10-30", birthHour: "巳时 9–11" });
    const fromNumber = summary({ birthDate: "2026-10-30", birthHour: "10" });
    expect(fromLabel.pillarsText.split(" ")[3]).toBe(fromNumber.pillarsText.split(" ")[3]);
    expect(fromLabel.pillarsText.endsWith("巳")).toBe(true);
    expect(fromLabel.notes.join("")).toContain("估算");
  });

  it("无时辰只排六字并标精度有限", () => {
    const result = summary({ birthDate: "2026-04-13", birthHour: undefined });
    expect(result.precision).toBe("six_limited");
    expect(result.pillarsText.split(" ")).toHaveLength(3);
    expect(result.notes.join("")).toContain("只排年月日");
  });

  it("未填时辰且当天跨立春时，提示年月柱可能跨界", () => {
    // 2025-02-03 立春 22:10：当日 00:00 与 23:59 分属不同年柱、月柱
    const notes = summary({ birthDate: "2025-02-03" }).notes.join(" | ");
    expect(notes).toContain("年柱可能为");
    expect(notes).toContain("甲辰");
    expect(notes).toContain("乙巳");
    expect(notes).toContain("月柱可能为");
  });

  it("时辰标签覆盖立春时刻时同样提示跨界", () => {
    // 亥时 21–23 包含 22:10 的立春
    const notes = summary({ birthDate: "2025-02-03", birthHour: "亥时 21–23" }).notes.join(" | ");
    expect(notes).toContain("年柱可能为");
    expect(notes).toContain("立春");
  });

  it("节气落在时辰前半段也要报（2024-04-04 清明 15:02，申时 15–17）", () => {
    // 15:00 月柱 丁卯，15:02 清明后变 戊辰；只比中点和终点会漏
    const result = summary({ birthDate: "2024-04-04", birthHour: "申时 15–17" });
    const notes = result.notes.join(" | ");
    expect(notes).toContain("月柱可能为");
    expect(notes).toContain("丁卯");
    expect(notes).toContain("戊辰");
    expect(result.pillarOptions?.month).toEqual(["丁卯", "戊辰"]);
  });

  it("时辰整体落在节气之后时不报跨界", () => {
    // 2024-04-04 申时以外的时段：辰时 07–09 在清明前，月柱只有丁卯
    const notes = summary({ birthDate: "2024-04-04", birthHour: "辰时 7–9" }).notes.join(" | ");
    expect(notes).not.toContain("月柱可能为");
  });

  it("时辰标签为子时，提示早子/夜子不确定", () => {
    const notes = summary({ birthDate: "2026-10-30", birthHour: "子时 23–1" }).notes.join(" | ");
    expect(notes).toContain("早子时");
    expect(notes).toContain("日柱可能为");
  });

  it("五行统计存在，且年月日柱不随时辰变化", () => {
    const noHour = pillars({ birthDate: "2026-04-13" });
    const withHour = pillars({ birthDate: "2026-04-13", birthHour: "10" });
    expect(withHour.slice(0, 3)).toEqual(noHour);
    expect(summary({ birthDate: "2026-04-13", birthHour: "10" }).notes.join("")).toMatch(/五行/);
  });

  it("新排盘带 engine 标记（旧报告没有）", () => {
    expect(summary({ birthHour: "10" }).engine).toBe("lunar-javascript");
  });

  it("未出生或日期非法时拒绝排盘", () => {
    expect(buildBaziSummary(req({ birthStatus: "unborn", isPreparationName: true })).ok).toBe(false);
    expect(buildBaziSummary(req({ birthDate: "2026-13-40" })).ok).toBe(false);
  });
});
