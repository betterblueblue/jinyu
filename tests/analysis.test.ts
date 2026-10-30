import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// 语料指向测试夹具，不依赖 data/ 里那份 30MB 的真实语料
process.env.JINYU_CORPUS_DIR = path.join(process.cwd(), "tests", "fixtures", "corpus");

import { resetCharTableCache } from "@/domain/analysis/chars";
import { resetCorpusCache, verifyCitation } from "@/domain/analysis/corpus";
import { splitFullName } from "@/domain/analysis/split-name";
import { buildLocalChecks } from "@/domain/analysis/rules";
import { runAnalysis, validateAnalysisInput } from "@/domain/analysis/analyze";
import type { AnalysisProvider } from "@/providers/analysis-provider";
import type { RawAnalysis } from "@/domain/analysis/prompt";

function providerReturning(raw: RawAnalysis | null): AnalysisProvider {
  return { name: "stub", analyze: async () => raw };
}

beforeEach(() => {
  resetCharTableCache();
  resetCorpusCache();
});

describe("引文核验", () => {
  it("原文里有的句子通过，并带出原文整行", () => {
    const r = verifyCitation({ source: "诗经", piece: "周南·桃夭", quote: "桃之夭夭，灼灼其华" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.citation.piece).toBe("国风·周南·桃夭");
      expect(r.citation.line).toContain("之子于归");
    }
  });

  it("繁体语料能被简体引文匹配上", () => {
    const r = verifyCitation({ source: "诗经", piece: "关雎", quote: "关关雎鸠，在河之洲" });
    expect(r.ok).toBe(true);
  });

  it("篇名说错但原文有的，自动校正篇名", () => {
    const r = verifyCitation({ source: "诗经", piece: "小雅·鹿鸣", quote: "桃之夭夭，灼灼其华" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.citation.corrected).toBe(true);
  });

  it("编造的句子被驳回", () => {
    const r = verifyCitation({ source: "诗经", piece: "周南", quote: "这句话是编的根本没有" });
    expect(r.ok).toBe(false);
  });

  it("没收录的书被驳回，不会当成通过", () => {
    const r = verifyCitation({ source: "菜根谭", quote: "宠辱不惊，闲看庭前花开花落" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected.reason).toContain("没有这本书");
  });

  it("太短的引文不核", () => {
    const r = verifyCitation({ source: "诗经", quote: "桃之" });
    expect(r.ok).toBe(false);
  });
});

describe("姓名拆分", () => {
  it("单姓双名", () => {
    const r = splitFullName("高登科");
    expect(r.split).toMatchObject({ surname: "高", givenName: "登科" });
    expect(r.split?.alternatives).toEqual([]);
  });

  it("复姓双名", () => {
    const r = splitFullName("欧阳修文");
    expect(r.split).toMatchObject({ surname: "欧阳", givenName: "修文" });
  });

  it("三字名撞上复姓时把另一种拆法摆出来", () => {
    const r = splitFullName("欧阳明");
    expect(r.split?.surname).toBe("欧阳");
    expect(r.split?.alternatives[0]).toEqual({ surname: "欧", givenName: "阳明" });
  });

  it("两字名单姓单名", () => {
    const r = splitFullName("张伟");
    expect(r.split).toMatchObject({ surname: "张", givenName: "伟" });
  });
});

describe("本地查表", () => {
  it("笔画悬殊报代价", () => {
    const split = splitFullName("龘一")!;
    const { issues } = buildLocalChecks(split.split!, "male");
    expect(issues.some((i) => i.text.includes("笔画差"))).toBe(true);
  });

  it("字集外的字报代价，并给出改名时该避开的字", async () => {
    const out = await runAnalysis({ fullName: "王龘", gender: "male" }, providerReturning({}));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.issues.some((i) => i.kind === "glyph")).toBe(true);
      expect(out.result.regenBrief.tabooChars).toContain("龘");
    }
  });

  it("男生用女性化字算硬伤", () => {
    const split = splitFullName("王婉婷")!;
    const { issues } = buildLocalChecks(split.split!, "male");
    const genderIssue = issues.find((i) => i.kind === "gender");
    expect(genderIssue?.severity).toBe("hard");
    expect(genderIssue?.text).toContain("女性");
  });

  it("性别对得上就不报", () => {
    const split = splitFullName("王婉婷")!;
    const { issues } = buildLocalChecks(split.split!, "female");
    expect(issues.some((i) => i.kind === "gender")).toBe(false);
  });

  it("没填性别就不判性别", () => {
    const split = splitFullName("王婉婷")!;
    const { issues } = buildLocalChecks(split.split!, "unknown");
    expect(issues.some((i) => i.kind === "gender")).toBe(false);
  });
});

describe("分析拼装", () => {
  const base = {
    headline: "张伟有一处真麻烦。",
    goodPoints: ["「伟」取盛大、担当之义，意思指向明确。"],
    issues: [
      { kind: "meaning", severity: "hard", text: "名字里挂着「伟」这个大字，一辈子都得撑住它。", hint: "换个不喊口号的字。" },
    ],
    citations: [],
    closing: "这处不改会一直跟着。",
    regenBrief: { tabooChars: ["伟"], requirements: "收一点，别喊口号", avoidPopular: true },
  };

  it("有硬伤就判 hard，并据约束给改名清单", async () => {
    const out = await runAnalysis({ fullName: "张伟", gender: "male" }, providerReturning(base));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.verdict).toBe("hard");
      expect(out.result.regenBrief.tabooChars).toContain("伟");
    }
  });

  it("模型编的出处一律删掉，进不了结果", async () => {
    const out = await runAnalysis(
      { fullName: "张伟", gender: "male" },
      providerReturning({
        ...base,
        citations: [{ source: "诗经", piece: "小雅", quote: "这句诗经里根本没有" }],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.citations).toHaveLength(0);
      expect(out.result.rejectedCitations).toHaveLength(1);
    }
  });

  it("核得过的出处留下，并带着原文整行", async () => {
    const out = await runAnalysis(
      { fullName: "张伟", gender: "male" },
      providerReturning({
        ...base,
        citations: [{ source: "诗经", piece: "周南·桃夭", quote: "桃之夭夭，灼灼其华", gloss: "取花木繁盛" }],
      }),
    );
    if (out.ok) {
      expect(out.result.citations).toHaveLength(1);
      expect(out.result.citations[0]!.line).toContain("之子于归");
    }
  });

  it("圆场话被换掉，不许出现在结论里", async () => {
    const out = await runAnalysis(
      { fullName: "张伟", gender: "male" },
      providerReturning({ ...base, closing: "总体来说还不错，能用。" }),
    );
    if (out.ok) {
      expect(out.result.closing).not.toContain("能用");
      expect(out.result.closing).not.toContain("总体来说");
    }
  });

  it("没问题时走更贴合，且贴合角度必须落到姓上", async () => {
    const out = await runAnalysis(
      { fullName: "林知远", gender: "male" },
      providerReturning({
        headline: "林知远挑不出毛病。",
        goodPoints: ["名字里的字面意思连起来是清楚的。"],
        issues: [],
        citations: [],
        closing: "要往前走一步是在贴合上。",
        fitAngle: "还能更独特一点。",
        regenBrief: { tabooChars: [], requirements: "贴姓", avoidPopular: false },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.verdict).toBe("fit");
      expect(out.result.fitAngle).toContain("林");
    }
  });
  it("只有一条优点时照常保留，不补位凑数", async () => {
    const out = await runAnalysis(
      { fullName: "高登科", gender: "male" },
      providerReturning({
        ...base,
        goodPoints: ["「登科」是旧时科举中第的说法，指向很明确。"],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.goodPoints).toHaveLength(1);
      expect(out.result.goodPoints[0]).toContain("登科");
    }
  });

  it("没有优点时保持空数组，不造占位内容", async () => {
    const out = await runAnalysis(
      { fullName: "高登科", gender: "male" },
      providerReturning({ ...base, goodPoints: [] }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.goodPoints).toEqual([]);
  });

  it("确有误读/书写问题时，仍留在值得看看的地方", async () => {
    const out = await runAnalysis(
      { fullName: "高登科", gender: "male" },
      providerReturning({
        ...base,
        goodPoints: [],
        issues: [
          {
            kind: "glyph",
            severity: "cost",
            text: "「科」在口语里常被听成「课」，报名字时要补一句写法。",
            hint: "换成不容易听混的字会省事一点。",
          },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.verdict).toBe("cost");
      expect(out.result.issues.some((i) => i.text.includes("科"))).toBe(true);
    }
  });

  it("兜底结论的数量跟问题条数一致：一条就说一处", async () => {
    const out = await runAnalysis(
      { fullName: "张伟", gender: "male" },
      providerReturning({
        ...base,
        headline: "综合来看，这个名字还不错。", // 含禁词，必被换掉
        issues: [
          {
            kind: "meaning",
            severity: "cost",
            text: "「伟」是用得最多的字之一，同班同届都容易撞上。",
            hint: "换一个没那么挤的字。",
          },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.verdict).toBe("cost");
      expect(out.result.headline).toContain("一处代价");
      expect(out.result.headline).not.toContain("两处");
    }
  });

  it("本地已查实的笔画问题，模型重复说时只留本地那条", async () => {
    const out = await runAnalysis(
      { fullName: "张若曦", gender: "female" },
      providerReturning({
        headline: "张若曦没有硬伤。",
        goodPoints: ["名字里的字面意思连起来是清楚的。"],
        issues: [
          { kind: "glyph", severity: "cost", text: "「曦」20 画，整个名字 36 画，写起来费劲。" },
        ],
        citations: [],
        closing: "想改的话动一个字就够。",
        regenBrief: { tabooChars: ["曦"], requirements: "笔画收一点", avoidPopular: true },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const strokeIssues = out.result.issues.filter((i) => i.text.includes("画"));
      expect(strokeIssues).toHaveLength(1);
      expect(strokeIssues[0]!.text).toContain("笔画差得有点远");
    }
  });

  it("结论句里汉字之间多出来的空格会被清掉", async () => {
    const out = await runAnalysis(
      { fullName: "张伟", gender: "male" },
      providerReturning({ ...base, headline: "张伟 没有硬伤，但这个名字人人都用。" }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.headline).not.toMatch(/[\u4e00-\u9fa5] [\u4e00-\u9fa5]/);
  });
});

describe("输入校验", () => {
  it("非汉字拒绝", () => {
    expect(validateAnalysisInput({ fullName: "Abc", gender: "male" }).ok).toBe(false);
  });

  it("生日格式错拒绝", () => {
    expect(validateAnalysisInput({ fullName: "高登科", gender: "male", birthDate: "1995/6/12" }).ok).toBe(
      false,
    );
  });

  it("生日可不填", () => {
    const r = validateAnalysisInput({ fullName: "高登科", gender: "female" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.birthDate).toBeUndefined();
  });
});
