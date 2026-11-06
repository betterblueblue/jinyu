/**
 * 简化版对比 Demo 的质量检查（2026-11-06）：两版输出的每个名字都过同一套规则，按八个维度数问题，不出总分。
 * 只用查表、查语料能确定的东西；字义好不好、气质对不对交给盲选。
 *
 * 维度和来源：
 *   音律  和姓同音、三字同调、变调（scoreName 的 sameSound / flatTone / sandhi）
 *   字义  不宜用字（forbidden）；民俗说法（swap / remind / style）只记「提一句」，不算硬伤
 *   气质  男女用字倾向（gender）
 *   识读  生僻（rare）、次常用多音（misread）；新增：单字超过 20 画
 *   流行  烂大街名（template）、热门字（hot）、大姓单名（singleName）、年代感（era / eraName）
 *   谐音  不好的谐音（homophone）、和姓连读成词（trap）、反面人物同名（infamous）
 *   国学  新增：名里两个字在古籍同一句里出现过（加分项，不扣分）；模型给的出处核不核得过原文
 *   字形  笔画轻重差太多（strokes）；新增：名里两个字同部首、三个字都很轻或都很重
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strokesOf } from "../../src/domain/analysis/chars";
import { verifyCitation } from "../../src/domain/analysis/corpus";
import { resolveSplit, scoreName } from "../../src/domain/score/score";

export type Dim = "音律" | "字义" | "气质" | "识读" | "流行" | "谐音" | "国学" | "字形";
export const DIMS: Dim[] = ["音律", "字义", "气质", "识读", "流行", "谐音", "国学", "字形"];

export interface Finding {
  dim: Dim;
  /** hard：硬伤；soft：提一句；plus：加分项 */
  level: "hard" | "soft" | "plus";
  text: string;
}

const RULE_DIM: Record<string, { dim: Dim; level: Finding["level"] }> = {
  sameSound: { dim: "音律", level: "hard" },
  flatTone: { dim: "音律", level: "soft" },
  sandhi: { dim: "音律", level: "soft" },
  forbidden: { dim: "字义", level: "hard" },
  swap: { dim: "字义", level: "soft" },
  remind: { dim: "字义", level: "soft" },
  style: { dim: "字义", level: "soft" },
  gender: { dim: "气质", level: "hard" },
  rare: { dim: "识读", level: "hard" },
  misread: { dim: "识读", level: "hard" },
  template: { dim: "流行", level: "hard" },
  hot: { dim: "流行", level: "soft" },
  singleName: { dim: "流行", level: "soft" },
  era: { dim: "流行", level: "hard" },
  eraName: { dim: "流行", level: "hard" },
  homophone: { dim: "谐音", level: "hard" },
  trap: { dim: "谐音", level: "hard" },
  infamous: { dim: "谐音", level: "hard" },
  strokes: { dim: "字形", level: "soft" },
};

/* ---------- 部首（Unihan kRSUnicode，所有汉字都有） ---------- */
let radicals: Map<string, string> | null = null;
function radicalOf(ch: string): string | null {
  if (!radicals) {
    radicals = new Map();
    const raw = readFileSync(resolve("data", "corpus", "raw", "_unihan", "Unihan_IRGSources.txt"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.includes("\tkRSUnicode\t")) continue;
      const [cp, , v] = line.split("\t");
      const rad = (v ?? "").split(/\s+/)[0]?.split(".")[0]?.replace(/'+$/, "");
      if (cp && rad) radicals.set(String.fromCodePoint(parseInt(cp.slice(2), 16)), rad);
    }
  }
  return radicals.get(ch) ?? null;
}

/* ---------- 古籍里同一句出现过两个字（按字建倒排，一次建好） ---------- */
interface Sentence {
  text: string;
  where: string;
}
let sentences: Sentence[] | null = null;
let byChar: Map<string, number[]> | null = null;
/** 照抄 src/domain/analysis/corpus.ts 的 SOURCE_NAMES（那边没导出，Demo 不改产品代码） */
const SOURCE_NAME: Record<string, string> = {
  shijing: "诗经", chuci: "楚辞", lunyu: "论语", daxue: "大学", zhongyong: "中庸", mengzi: "孟子", zhouyi: "周易",
  shangshu: "尚书", liji: "礼记", zuozhuan: "左传", wenxuan: "文选", guwenguanzhi: "古文观止", quantangshi: "全唐诗",
  songci: "宋词", yuanqu: "元曲", nalan: "纳兰词", qianziwen: "千字文", shenglvqimeng: "声律启蒙", sanzijing: "三字经",
  youxueqionglin: "幼学琼林", qianjiashi: "千家诗", tangshi300: "唐诗三百首", zengguang: "增广贤文",
};
function loadSentences() {
  if (sentences) return;
  sentences = [];
  byChar = new Map();
  const raw = readFileSync(resolve("data", "corpus", "pieces.jsonl"), "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as { s: string; t?: string; x: string };
    for (const sen of p.x.split(/[，。；！？、：\n]/)) {
      const t = sen.trim();
      if (t.length < 4) continue;
      const id = sentences.push({ text: t, where: `${SOURCE_NAME[p.s] ?? p.s}${p.t ? `·${p.t}` : ""}` }) - 1;
      for (const ch of new Set(t)) {
        const list = byChar.get(ch);
        if (list) list.push(id);
        else byChar.set(ch, [id]);
      }
    }
  }
}
/**
 * 同一句里只是都有这两个字不算（「十一月丁卯朔」「曹腾养子嵩」都是碰上的）：
 * 要按名字的顺序挨着，或者中间只隔一个字（「采三秀之华英」）；倒过来的只认紧挨着（「之子照清襟」不算，「清照」才算）。
 */
function near(text: string, a: string, b: string): boolean {
  const s = [...text];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== a) continue;
    if (s[i + 1] === b || s[i + 2] === b) return true;
  }
  return false;
}
export function coOccur(a: string, b: string): Sentence | null {
  loadSentences();
  const la = byChar!.get(a);
  const lb = byChar!.get(b);
  if (!la || !lb) return null;
  const sb = new Set(lb);
  const hit = la.find((id) => sb.has(id) && near(sentences![id]!.text, a, b));
  return hit === undefined ? null : sentences![hit]!;
}

/** 一个名字（姓已知）过一遍：返回按维度的问题 */
export function checkName(
  surname: string,
  givenName: string,
  gender: "male" | "female" | "unknown",
  citation?: { source?: string; piece?: string; quote?: string },
): Finding[] {
  const out: Finding[] = [];
  const split = resolveSplit(`${surname}${givenName}`, surname);
  if (!split || split.givenName !== givenName) {
    out.push({ dim: "识读", level: "hard", text: "拆不开姓名" });
    return out;
  }
  const score = scoreName(split, gender);
  for (const d of score.deductions) {
    const m = RULE_DIM[d.rule];
    if (m) out.push({ dim: m.dim, level: m.level, text: d.line });
  }
  const giv = [...givenName];
  // 识读：单字笔画太多，小孩写名字吃力
  for (const c of giv) {
    const n = strokesOf(c);
    if (n !== null && n > 20) out.push({ dim: "识读", level: "soft", text: `「${c}」${n} 画，写起来吃力` });
  }
  // 字形：名里两个字同部首；三个字都很轻或都很重
  if (giv.length === 2) {
    const [r1, r2] = giv.map(radicalOf);
    if (r1 && r1 === r2) out.push({ dim: "字形", level: "soft", text: `「${giv[0]}」「${giv[1]}」同一个部首，写出来偏旁重复` });
  }
  const all = [...surname, ...giv].map((c) => strokesOf(c)).filter((n): n is number => n !== null);
  if (all.length >= 2 && all.every((n) => n <= 5)) out.push({ dim: "字形", level: "soft", text: "每个字都 5 画以内，写出来单薄" });
  if (all.length >= 2 && all.every((n) => n >= 15)) out.push({ dim: "字形", level: "soft", text: "每个字都 15 画以上，写出来拥挤" });
  // 国学：两个字在古籍同一句里出现过（加分项）
  if (giv.length === 2) {
    const hit = coOccur(giv[0]!, giv[1]!);
    if (hit) out.push({ dim: "国学", level: "plus", text: `${hit.where}「${hit.text}」` });
  }
  // 国学：模型自己给的出处，回原文逐字核。
  // 先理一下写法（两版一样处理）：「《诗经·大雅·思齐》」拆成书名和篇名；原句后面带的括号解释去掉。
  // 语料里没有的书只能算「核不了」，不算编的；书在、原句对不上才算编的。
  if (citation?.quote) {
    const rawSource = (citation.source ?? "").replace(/[《》〈〉]/g, "").trim();
    const [book, ...rest] = rawSource.split(/[·・]/);
    const claim = {
      source: (book ?? "").replace(/^.*?[《]/, "").trim(),
      piece: citation.piece || rest.join("·") || undefined,
      quote: citation.quote.replace(/[（(][^）)]*[）)]/g, "").trim(),
    };
    const v = verifyCitation(claim);
    const shown = `${rawSource}「${claim.quote}」`;
    if (v.ok) out.push({ dim: "国学", level: "plus", text: `出处核过：${shown}` });
    else if (/没有这本书/.test(v.rejected.reason)) out.push({ dim: "国学", level: "soft", text: `出处核不了（语料里没有这本书）：${shown}` });
    else out.push({ dim: "国学", level: "hard", text: `出处核不过：${shown}（${v.rejected.reason}）` });
  }
  return out;
}

/** 起名要求有没有做到：字数、辈分字、避讳字、名里不带姓 */
export function checkRequest(
  givenName: string,
  req: { surname: string; nameLength?: 1 | 2; generationChar?: string; generationPosition?: "first" | "second" | "any"; tabooChars?: string[] },
): string[] {
  const bad: string[] = [];
  const giv = [...givenName];
  const len = req.nameLength ?? 2;
  if (giv.length !== len) bad.push(`字数不对（要 ${len} 个字，给了 ${giv.length} 个）`);
  if (req.surname && givenName.startsWith(req.surname)) bad.push("名里带了姓");
  if (req.generationChar) {
    const pos = req.generationPosition ?? "any";
    const ok =
      pos === "first" ? giv[0] === req.generationChar : pos === "second" ? giv[1] === req.generationChar : giv.includes(req.generationChar);
    if (!ok) bad.push(`辈分字「${req.generationChar}」没放对（要${pos === "first" ? "第一个字" : pos === "second" ? "第二个字" : "名里有"}）`);
  }
  for (const t of req.tabooChars ?? []) if (givenName.includes(t)) bad.push(`用了避讳字「${t}」`);
  return bad;
}
