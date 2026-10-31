import { describe, expect, it } from "vitest";
import { normalizeFastInput } from "@/fast/normalize";
import { checkFastCandidate } from "@/fast/gate";
import { __displayableQuote, citeFromLine, locateCitation } from "@/fast/cite";

describe("精简版输入校验", () => {
  it("只填姓和性别就能过，不补任何默认值", () => {
    const r = normalizeFastInput({ surname: "苏", gender: "female" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ surname: "苏", gender: "female" });
  });

  it("生日可选，填了必须是真日期", () => {
    expect(normalizeFastInput({ surname: "苏", gender: "male", birthday: "2026-03-15" }).ok).toBe(true);
    const bad = normalizeFastInput({ surname: "苏", gender: "male", birthday: "2026-02-31" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("生日");
  });

  it("姓氏必填、性别必选、复姓允许", () => {
    expect(normalizeFastInput({ surname: "", gender: "male" }).ok).toBe(false);
    expect(normalizeFastInput({ surname: "苏", gender: "unknown" }).ok).toBe(false);
    expect(normalizeFastInput({ surname: "欧阳", gender: "female" }).ok).toBe(true);
    expect(normalizeFastInput({ surname: "欧阳锋", gender: "female" }).ok).toBe(false);
  });
});

describe("精简版闸门", () => {
  it("撞名、忌字、非双字都拦", () => {
    expect(checkFastCandidate("子涵", "苏").keep).toBe(false);
    expect(checkFastCandidate("冥鸿", "高").keep).toBe(false);
    expect(checkFastCandidate("苏清禾", "苏").keep).toBe(false);
  });

  it("干净的名字放行，热门字只标记不拦", () => {
    const ok = checkFastCandidate("静姝", "林");
    expect(ok.keep).toBe(true);
    expect(ok.hotChar).toBe(false);

    const hot = checkFastCandidate("书瑶", "林");
    expect(hot.keep).toBe(true);
    expect(hot.hotChar).toBe(true);
  });

  it("连姓谐音按「姓 + 名首字」拦，正常词不误伤", () => {
    // 吴德明 → wu de… 念作「无德」
    expect(checkFastCandidate("德明", "吴").keep).toBe(false);
    // 沈静姝 → shen jing… 念作「神经」
    expect(checkFastCandidate("静姝", "沈").keep).toBe(false);
    // 雷云帆 → lei yun… 「雷雨」不算坏词，不能误伤
    expect(checkFastCandidate("云帆", "雷").keep).toBe(true);
  });
});

describe("篇名 → 原文", () => {
  it("圣俞单篇能截出含两字的句子", () => {
    const hit = locateCitation("诗经", "邶风·静女", "静姝");
    expect(hit).not.toBeNull();
    expect(hit!.quote).toContain("静女其姝");
    expect(hit!.source).toBe("诗经");
  });

  it("篇名对不上就返回 null，让调用方留白", () => {
    expect(locateCitation("诗经", "不存在的篇名", "静姝")).toBeNull();
    expect(locateCitation("宋词", "山园小梅", "疏影")).toBeNull();
  });
});

describe("模型给的原句核验", () => {
  it("原句逐字在原文里、名字挨着 → 直接用模型这一句", () => {
    const hit = citeFromLine("诗经", "邶风·静女", "静姝", "静女其姝");
    expect(hit).not.toBeNull();
    expect(hit!.quote).toBe("静女其姝");
    expect(hit!.piece).toContain("静女");
  });

  it("编出来的句子驳回：同篇但没有这一句", () => {
    expect(citeFromLine("诗经", "邶风·静女", "静姝", "静女其姝，美人在侧")).toBeNull();
  });

  it("句子真在原文里，但名字两个字没按顺序出现 → 驳回", () => {
    // 「静女其娈」是原文，但这句里没有「姝」
    expect(citeFromLine("诗经", "邶风·静女", "静姝", "静女其娈")).toBeNull();
  });

  it("篇名留空时不下场，交回原截句逻辑", () => {
    expect(citeFromLine("诗经", "", "静姝", "静女其姝")).toBeNull();
  });
});

describe("引文展示闸门", () => {
  it("淫靡、贫贱、丧亡这类句子不给观众看", () => {
    expect(__displayableQuote("声噭兮清和，音晏衍兮要婬")).toBe(false);
    expect(__displayableQuote("名位未霑身欲老，诗书宁救眼前贫")).toBe(false);
    expect(__displayableQuote("孰两东门之可芜")).toBe(true); // 不含禁字，靠人判
  });

  it("正常句子照常放行", () => {
    expect(__displayableQuote("岂弟君子，莫不令仪")).toBe(true);
    expect(__displayableQuote("白露未晞")).toBe(true);
  });
});
