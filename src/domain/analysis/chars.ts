import fs from "node:fs";
import path from "node:path";

/**
 * 字表：笔画、简繁折合、GB2312 分级。
 *
 * 数据由 scripts/corpus/build-chars.mjs 从 Unihan 生成，不进 git。
 * 文件缺失时全部退化：笔画/分级返回 null，折合退化为原样，核验仍能跑
 * （只是繁体语料会匹配不上），不会抛错打断分析。
 */

interface CharTable {
  strokes: Record<string, number>;
  t2s: Record<string, string>;
  gb: Record<string, 1 | 2>;
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

let cached: CharTable | null = null;
let loaded = false;

export function corpusDir(): string {
  return process.env.JINYU_CORPUS_DIR ?? path.join(process.cwd(), "data", "corpus");
}

export function getCharTable(): CharTable {
  if (loaded) return cached!;
  loaded = true;
  const file = path.join(corpusDir(), "chars.json");
  try {
    cached = JSON.parse(fs.readFileSync(file, "utf8")) as CharTable;
  } catch {
    cached = { strokes: {}, t2s: {}, gb: {} };
  }
  return cached!;
}

/** 仅供测试重置缓存 */
export function resetCharTableCache(): void {
  cached = null;
  loaded = false;
}

export function strokesOf(ch: string): number | null {
  const n = getCharTable().strokes[ch];
  return typeof n === "number" ? n : null;
}

/**
 * 1=GB2312 一级（最常用 3755） 2=二级 0=表外 null=字表里查不到（数据没装或字不认识）
 *
 * 区分 0 和 null 很重要：0 是「确实不在最常用字里」，可以据此说他生僻；
 * null 是「我们不知道」，这时候宁可不说话，也不能给一个假的生僻结论。
 */
export function gbLevel(ch: string): 0 | 1 | 2 | null {
  const table = getCharTable();
  const hit = table.gb[ch];
  if (hit) return hit;
  if (ch in table.strokes) return 0;
  return null;
}

export function isCjk(ch: string): boolean {
  return CJK.test(ch);
}

export function simplifyChar(ch: string): string {
  return getCharTable().t2s[ch] ?? ch;
}

/**
 * 展示用简化：保留标点原样，只替换繁体字。
 *
 * 有一小撮字的繁简是「一繁对多简」，硬折会折错——「乾坤」会变「干坤」、
 * 「著作」会变「着作」。这些字原样留着，宁可偶尔混一个繁体，也不改错原意。
 */
const KEEP_AS_IS = new Set("乾幹藉徵著覆瞭");

export function toSimplified(text: string): string {
  const table = getCharTable();
  let out = "";
  for (const ch of text) {
    if (KEEP_AS_IS.has(ch)) {
      out += ch;
      continue;
    }
    out += table.t2s[ch] ?? ch;
  }
  return out;
}

/**
 * 折合成用于比对的形式：先去繁体，再只留汉字（去掉标点、空白、异体符号）。
 * 两侧都折，才能让繁体的语料对上简体的引文。
 */
export function foldText(text: string): string {
  const table = getCharTable();
  let out = "";
  for (const ch of text) {
    const simp = table.t2s[ch] ?? ch;
    if (CJK.test(simp)) out += simp;
  }
  return out;
}
