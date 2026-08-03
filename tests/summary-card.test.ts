import { describe, expect, it } from "vitest";
import {
  buildSummaryCardElement,
  detailRows,
} from "@/render/summary-card";
import type { NameDetail, ReportDocument } from "@/domain/types";

function makeName(over: Partial<NameDetail>): NameDetail {
  return {
    fullName: "王语晏",
    givenName: "语晏",
    isPrimary: false,
    phonology: "语为上声，晏为去声，抑扬有节",
    glyph: "语为讠吾，晏为日安，结构平稳",
    meaning: "言语晏晏，喻温和从容",
    origin: "《诗经·卫风·氓》",
    pitfalls: "晏字不常见但易认",
    styleFit: "端庄耐看",
    l2Hot: false,
    ...over,
  };
}

function makeReport(over: Partial<ReportDocument> = {}): ReportDocument {
  const names = [
    makeName({ fullName: "王语晏", givenName: "语晏", isPrimary: true, baziFit: "甲戌木火，语含言" }),
    makeName({ fullName: "王清和", givenName: "清和", baziFit: "木水相生" }),
  ];
  return {
    id: "test1",
    createdAt: "2026-08-03T10:00:00Z",
    request: {
      surname: "王",
      gender: "female",
      birthStatus: "born",
      nameLength: "two",
      baziEnabled: true,
      generationPosition: "first",
      tabooChars: [],
      stylePrototypeId: "default_dignified",
      avoidPopular: true,
      isPreparationName: false,
    },
    stages: [],
    relaxations: [],
    overview: {
      primaryName: "王语晏",
      names: ["王语晏", "王清和"],
      oneLiner: "言语晏晏，温和从容",
    },
    names,
    notRecommended: [],
    bazi: {
      enabled: true,
      precision: "full_eight",
      pillarsText: "甲戌 丙寅 壬寅 丁未",
      notes: [],
      restrainedAdvice: "仅作参考",
    },
    decisionAdvice: "",
    originDisclaimer: "",
    ...over,
  };
}

describe("detailRows", () => {
  it("包含六个基础字段且按序排列，空字段被过滤", () => {
    const n = makeName({ phonology: "   ", glyph: "结构平稳", styleFit: "" });
    const rows = detailRows(n, false);
    const terms = rows.map((r) => r.term);
    expect(terms).toEqual(["字形", "寓意", "出处", "避坑"]);
  });

  it("八字开启且有 baziFit 时保留八字契合，否则不保留", () => {
    const withBazi = detailRows(makeName({ baziFit: "甲戌木火，语含言" }), true);
    expect(withBazi.map((r) => r.term)).toContain("八字契合");

    const baziFitEmpty = detailRows(makeName({ baziFit: "" }), true);
    expect(baziFitEmpty.map((r) => r.term)).not.toContain("八字契合");

    const baziOff = detailRows(makeName({}), false);
    expect(baziOff.map((r) => r.term)).not.toContain("八字契合");
  });
});

describe("buildSummaryCardElement", () => {
  it("元素树包含首推名、备选名与详情 term", () => {
    const tree = JSON.stringify(buildSummaryCardElement(makeReport()));
    expect(tree).toContain("王语晏");
    expect(tree).toContain("王清和");
    expect(tree).toContain("音韵");
    expect(tree).toContain("字形");
    expect(tree).toContain("避坑");
    expect(tree).toContain("八字契合");
    expect(tree).toContain("首推");
  });

  it("未开启八字时不渲染八字契合", () => {
    const tree = JSON.stringify(
      buildSummaryCardElement(makeReport({ bazi: undefined })),
    );
    expect(tree).not.toContain("八字契合");
  });
});
