/**
 * 生成字表：笔画、繁简映射、GB2312 分级。
 *
 *   node scripts/corpus/build-chars.mjs
 *
 * 输入（均已下载到 data/corpus/raw/_unihan/）：
 *   Unihan_IRGSources.txt  → kTotalStrokes 笔画
 *   Unihan_Variants.txt    → kSimplifiedVariant 繁体→简体
 * 另有本地推导：
 *   GB2312 一级（3755 最常用）/ 二级（3008）—— 由编码区反查，不需要外部数据
 *
 * 产物：data/corpus/chars.json
 *   { strokes: {字: 笔画}, t2s: {繁体: 简体}, gb: {字: 1|2} }
 *
 * 说明：笔画取 kTotalStrokes 的第一个值。它不是康熙笔画，本功能也不算五格，
 * 只用来判断名字字形是否繁简失衡，所以用现代笔画即可。
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RAW = path.join(ROOT, "data/corpus/raw/_unihan");
const OUT = path.join(ROOT, "data/corpus/chars.json");

function readLines(file) {
  return fs.readFileSync(path.join(RAW, file), "utf8").split("\n");
}

function codePoint(token) {
  const m = /^U\+([0-9A-Fa-f]+)$/.exec(token.trim());
  return m ? String.fromCodePoint(parseInt(m[1], 16)) : null;
}

/** GB2312：一级 0xB0-0xD7，二级 0xD8-0xF7，均为 0xA1-0xFE 位 */
function buildGbLevels() {
  const decoder = new TextDecoder("gbk");
  const gb = {};
  for (let row = 0xb0; row <= 0xf7; row++) {
    for (let cell = 0xa1; cell <= 0xfe; cell++) {
      const ch = decoder.decode(Uint8Array.from([row, cell]));
      if (ch && ch.length === 1 && ch !== "\ufffd") {
        gb[ch] = row <= 0xd7 ? 1 : 2;
      }
    }
  }
  return gb;
}

function buildStrokes() {
  const strokes = {};
  for (const line of readLines("Unihan_IRGSources.txt")) {
    if (!line || line.startsWith("#")) continue;
    const [cp, field, ...rest] = line.split("\t");
    if (field !== "kTotalStrokes") continue;
    const ch = codePoint(cp);
    const n = parseInt(rest.join("").trim().split(/\s+/)[0], 10);
    if (ch && Number.isFinite(n)) strokes[ch] = n;
  }
  return strokes;
}

function buildT2S() {
  const t2s = {};
  for (const line of readLines("Unihan_Variants.txt")) {
    if (!line || line.startsWith("#")) continue;
    const [cp, field, value] = line.split("\t");
    if (field !== "kSimplifiedVariant") continue;
    const from = codePoint(cp);
    const to = codePoint((value || "").trim().split(/\s+/)[0] || "");
    if (from && to && from !== to) t2s[from] = to;
  }
  return t2s;
}

const strokes = buildStrokes();
const t2s = buildT2S();
const gb = buildGbLevels();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ strokes, t2s, gb }));

const gb1 = Object.values(gb).filter((v) => v === 1).length;
const gb2 = Object.values(gb).filter((v) => v === 2).length;
console.log(`笔画 ${Object.keys(strokes).length} 字`);
console.log(`繁简映射 ${Object.keys(t2s).length} 条`);
console.log(`GB2312 一级 ${gb1} / 二级 ${gb2}`);
console.log(`→ ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
