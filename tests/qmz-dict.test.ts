import { describe, expect, it } from "vitest";
import { parseQmzCharHtml } from "@/dictionary/qmz";

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
