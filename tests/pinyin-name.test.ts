import { describe, expect, it } from "vitest";
import { fullNamePinyin } from "@/domain/pinyin-name";

describe("全名拼音", () => {
  it("普通姓氏：整名逐字给音，姓氏也带上", () => {
    const r = fullNamePinyin("高", "承岳");
    expect(r.text).toBe("gāo chéng yuè");
    expect(r.hint).toBeUndefined();
  });

  it("多音姓氏按姓的读法，并提示主播核对", () => {
    // 「一」在二声前读 yì（变调），姓氏读 zēng
    expect(fullNamePinyin("曾", "一鸣").text).toBe("zēng yì míng");
    expect(fullNamePinyin("单", "田").text).toBe("shàn tián");
    expect(fullNamePinyin("仇", "英").text).toBe("qiú yīng");
    expect(fullNamePinyin("曾", "一鸣").hint).toContain("zēng");
  });

  it("名字里的多音字按名字朗读，不套姓氏读音", () => {
    // 回归：surname:"all" 会把姓氏读音表套到每个字上，乐→yuè、宁→nìng
    expect(fullNamePinyin("陈", "乐言").text).toBe("chén lè yán");
    expect(fullNamePinyin("周", "乐然").text).toBe("zhōu lè rán");
    expect(fullNamePinyin("解", "宁").text).toBe("xiè níng");
    expect(fullNamePinyin("欧阳", "子涵").text).toBe("ōu yáng zǐ hán");
  });

  it("读音没收录的字给出核对提示，不硬编一个音", () => {
    const r = fullNamePinyin("𠮷", "田");
    expect(r.text.split(" ")[0]).toBe("𠮷");
    expect(r.hint).toContain("核对");
  });
});
