import fs from "node:fs";
import path from "node:path";

/**
 * 新华字典兜底（2026-11-05 用户定用）。
 *
 * 数据来自 GitHub 上的 pwxcoo/chinese-xinhua（data/word.json，16142 个字）。仓库是 MIT，
 * 但 README 写明数据是作者从各网站抓取整理的，释义本身的版权没说清楚；用户判断可以用。
 * 起名字典（qmz）没收的字才用它，只给提词页一句短释义，主播自己看，不对外发布。
 *
 * 原始文件是长篇古文引证，`scripts/dict/build-xinhua.ts` 离线抽成每字一句、存 data/xinhua/gloss.json；
 * 运行时只读这个小文件，不访问外站。
 */

export interface XinhuaGloss {
  /** 一句释义，以「。」结尾 */
  text: string;
  /** 本义（括号里「本义……」那一句）还是现代释义（「字＋拼音」后面那一句） */
  from: "本义" | "释义";
}

const TONE = "a-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜɡńňǹḿ";
/** 抽出来不能念的：查无此义、外国字、只说「见某词」「同某字」、残缺的引号括号 */
const JUNK = /字义未详|吏读|和字|韩国|日本|讹字|见["“「]|［|〔|同["“「]|古同|异体|人名用字|姓。|^姓$|[”“]|从.声|^\./;

function tidy(raw: string): string {
  let s = raw.replace(/^〈[^〉]*〉/, "").replace(/^[∶:：\s]+/, "");
  const cut = s.split(/～/);
  if (cut.length > 1) {
    s = cut[0]!;
    // ～ 前面紧挨着的一两个字常是例词的开头（「一～一莸」），退回到最后一个逗号
    const p = Math.max(s.lastIndexOf("，"), s.lastIndexOf("；"));
    if (!/[，。；]$/.test(s) && p > 0) s = s.slice(0, p);
  }
  return s.split(/⒉|\s2\.|诗曰|。/)[0]!.replace(/[，、；,\s]+$/, "").trim();
}

/** 从一条原始释义里抽一句能念的；抽不出来返回 null，不硬凑 */
export function xinhuaGlossOf(word: string, explanation: string): XinhuaGloss | null {
  const e = explanation.replace(/\r/g, "");
  const cands: XinhuaGloss[] = [];
  const ben = /本义([^)）]{2,24})[)）]/.exec(e);
  if (ben) cands.push({ from: "本义", text: ben[1]!.replace(/[，,]$/, "") });
  const i = e.indexOf("⒈");
  if (i >= 0) cands.push({ from: "释义", text: tidy(e.slice(i + 1).split("\n")[0]!) });
  const m = new RegExp(`${word}(?:（[^）]*）)?[${TONE}]+[1-5]?\\s*`, "u").exec(e);
  if (m) cands.push({ from: "释义", text: tidy(e.slice(m.index + m[0].length).replace(/^\s*(1\.|⒈)\s*/, "").split("\n")[0]!) });
  for (const c of cands) {
    const s = c.text.replace(/,/g, "，").trim();
    const n = [...s].length;
    if (n < 2 || n > 24 || JUNK.test(s) || /[a-z]/i.test(s)) continue;
    return { from: c.from, text: `${s}。` };
  }
  return null;
}

export function xinhuaGlossPath(): string {
  return path.join(process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data"), "xinhua", "gloss.json");
}

let cached: Record<string, XinhuaGloss> | null = null;
let loadedMtime: number | null = null;

/** 没跑过构建脚本时返回 null，提词页照旧等模型 */
export function getXinhuaGloss(ch: string): XinhuaGloss | null {
  let mtime: number;
  try {
    mtime = fs.statSync(xinhuaGlossPath()).mtimeMs;
  } catch {
    cached = null;
    loadedMtime = null;
    return null;
  }
  if (loadedMtime !== mtime) {
    try {
      cached = JSON.parse(fs.readFileSync(xinhuaGlossPath(), "utf8")) as Record<string, XinhuaGloss>;
      loadedMtime = mtime;
    } catch {
      if (!cached) loadedMtime = null;
    }
  }
  return cached?.[ch] ?? null;
}

/** 仅测试用 */
export function resetXinhuaCache(): void {
  cached = null;
  loadedMtime = null;
}
