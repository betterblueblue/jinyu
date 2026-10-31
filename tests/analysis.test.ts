import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// 语料指向测试夹具，不依赖 data/ 里那份 30MB 的真实语料
process.env.JINYU_CORPUS_DIR = path.join(process.cwd(), "tests", "fixtures", "corpus");

import { resetCharTableCache } from "@/domain/analysis/chars";
import { resetCorpusCache, verifyCitation } from "@/domain/analysis/corpus";
import { splitFullName } from "@/domain/analysis/split-name";
import { validateAnalysisInput } from "@/domain/analysis/analyze";

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
