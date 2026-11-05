import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { logMissingChars, resetMissingLog } from "@/dictionary/missing-log";
import { getQmzChar, parseQmzCharHtml, resetQmzDictionaryCache, spokenBasicMeaning } from "@/dictionary/qmz";
import { parsePrompterRound } from "@/live/prompter";

const HTML = `
<article class="main-container">
  <div class="char-hero"><h1 class="char-main">华</h1></div>
  <div class="quick-info">
    <div class="info-item"><div class="info-label">拼音</div><div class="info-value">huá</div></div>
    <div class="info-item"><div class="info-label">简体笔画</div><div class="info-value">6</div></div>
    <div class="info-item"><div class="info-label">康熙笔画</div><div class="info-value">14</div></div>
    <div class="info-item"><div class="info-label">五行</div><div class="info-value">水</div></div>
    <div class="info-item"><div class="info-label">部首</div><div class="info-value">十</div></div>
  </div>
  <section class="section"><h2 class="section-title">基本含义</h2><div class="desc-text">本意为花、荣华和光耀。</div></section>
  <section class="section"><h2 class="section-title">起名寓意</h2><div class="desc-text">光彩、美丽、繁荣。</div></section>
  <section class="section"><h2 class="section-title">相关成语</h2><div class="tags"><span class="tag">春华秋实</span><span class="tag">风华正茂</span></div></section>
  <section class="section"><h2 class="section-title">拆字方案</h2><div class="tags"><span class="tag">化 + 十</span></div></section>
</article>`;

describe("起名字典解析", () => {
  it("抽出拼音、笔画、五行、释义、拆字和成语", () => {
    const out = parseQmzCharHtml("华", HTML, "https://zd.qmz.in/%E5%8D%8E", "2026-11-05T00:00:00.000Z");
    expect(out).toMatchObject({
      char: "华",
      pinyin: "huá",
      simplifiedStrokes: 6,
      kangxiStrokes: 14,
      wuxing: "水",
      radical: "十",
      basicMeaning: "本意为花、荣华和光耀。",
      nameMeaning: "光彩、美丽、繁荣。",
      decomposition: "化 + 十",
      idioms: ["春华秋实", "风华正茂"],
    });
  });

  it("页面不对时返回 null", () => {
    expect(parseQmzCharHtml("华", "<html></html>", "x", "now")).toBeNull();
  });
});

describe("字典文件和查不到的字", () => {
  const before = process.env.JINYU_DATA_DIR;
  let dir = "";
  const useTempDir = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jinyu-qmz-"));
    process.env.JINYU_DATA_DIR = dir;
    fs.mkdirSync(path.join(dir, "qmz-dict"), { recursive: true });
    resetQmzDictionaryCache();
    resetMissingLog();
  };
  const writeDict = (chars: string[], mtime: Date) => {
    const file = path.join(dir, "qmz-dict", "chars.json");
    const body = { generatedAt: "", source: "", chars: Object.fromEntries(chars.map((c) => [c, { char: c, sourceUrl: "", fetchedAt: "" }])) };
    fs.writeFileSync(file, JSON.stringify(body), "utf8");
    fs.utimesSync(file, mtime, mtime);
  };
  afterEach(() => {
    if (before === undefined) delete process.env.JINYU_DATA_DIR;
    else process.env.JINYU_DATA_DIR = before;
    resetQmzDictionaryCache();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("补抓后字典文件变了，不用重启就能查到新字", () => {
    useTempDir();
    writeDict(["华"], new Date("2026-11-05T01:00:00Z"));
    expect(getQmzChar("梓")).toBeNull();
    writeDict(["华", "梓"], new Date("2026-11-05T02:00:00Z"));
    expect(getQmzChar("梓")?.char).toBe("梓");
  });

  it("查不到的字记一行，同一个字只记一次，只记字和时间", async () => {
    useTempDir();
    await logMissingChars(["梓", "涵"]);
    await logMissingChars(["梓"]);
    const lines = fs.readFileSync(path.join(dir, "qmz-dict", "missing.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.char)).toEqual(["梓", "涵"]);
    expect(Object.keys(lines[0]).sort()).toEqual(["at", "char"]);
  });
});

describe("提词页字典初检", () => {
  it("字典条目能通过提词页格式校验", () => {
    const parsed = parsePrompterRound({
      state: "score",
      no: 1,
      full: "刘华强",
      pinyin: "liú huá qiáng",
      score: 0,
      bandLabel: "评价中",
      dictionary: [
        { char: "华", pinyin: "huá", basicMeaning: "本意为花、荣华。", nameMeaning: "光彩、繁荣。" },
        { char: "强", pinyin: "qiáng", basicMeaning: "力量大。", decomposition: "弓 + 虽", missing: false },
      ],
      deductions: [],
      folk: [],
    });
    if (!parsed || parsed.state !== "score") throw new Error("提词页格式校验失败");
    expect(parsed.dictionary).toHaveLength(2);
    expect(parsed.dictionary?.[0]?.basicMeaning).toContain("荣华");
    // 站点的起名寓意不上提词页（11-05 抽查有写错、编造、财运官运）
    expect(parsed.dictionary?.[0]).not.toHaveProperty("nameMeaning");
  });
});

describe("基本含义去掉五行", () => {
  it.each([
    ["是金五行很强的姓名用字", "锐本意为锋利，尖。用在人名中主要有感觉灵敏、犀利等含义，是金五行很强的姓名用字。", "锐本意为锋利，尖。用在人名中主要有感觉灵敏、犀利等含义。"],
    ["五生克", "雷厉风行，补水生木。意为响亮、声大。", "意为响亮、声大。"],
    ["剩半截话就整句去掉", "本意为系在衣带上的装饰品。另外，在名字中用做连字时则没有五行属性。", "本意为系在衣带上的装饰品。"],
    ["繁体两个火、火旺", "意为繁荣茂盛。荣字繁体字为“榮”，头上有两个“火”字，结合字义，荣字整体来说火旺。", "意为繁荣茂盛。荣字繁体字为“榮”。"],
  ])("%s", (_label, input, expected) => {
    expect(spokenBasicMeaning(input)).toBe(expected);
  });

  it("没有五行的照原样，去完没剩东西返回空", () => {
    expect(spokenBasicMeaning("本意为水泽众多。在人名中引申为涵养、包容等含义。")).toBe("本意为水泽众多。在人名中引申为涵养、包容等含义。");
    expect(spokenBasicMeaning("是水五行的字。")).toBeUndefined();
    expect(spokenBasicMeaning(undefined)).toBeUndefined();
  });
});
