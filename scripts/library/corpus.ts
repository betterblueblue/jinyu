/**
 * 建库用的语料工具：按书读 data/corpus/pieces.jsonl，查原句在哪一篇，核对引文。
 *
 * 只做确定性的比对（繁简、标点折合后逐字比），不调模型。
 * 名字和寓意由人（agent）起草，这里只负责证明「这句原文确实在这一篇里，名字两个字确实在这句里」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldText, toSimplified } from "../../src/domain/analysis/chars";
import { __displayableQuote as displayableQuote } from "../../src/fast/cite";

export interface Rec {
  s: string;
  t: string;
  a?: string;
  x: string;
}

/** 书名 id → 展示用书名 */
export const BOOK_LABEL: Record<string, string> = {
  shijing: "诗经",
  chuci: "楚辞",
  lunyu: "论语",
  daxue: "大学",
  zhongyong: "中庸",
  mengzi: "孟子",
  zhouyi: "周易",
  shangshu: "尚书",
  liji: "礼记",
  zuozhuan: "左传",
  wenxuan: "文选",
  guwenguanzhi: "古文观止",
  quantangshi: "全唐诗",
  songci: "宋词",
  yuanqu: "元曲",
  nalan: "纳兰词",
  qianziwen: "千字文",
  shenglvqimeng: "声律启蒙",
  sanzijing: "三字经",
  youxueqionglin: "幼学琼林",
  qianjiashi: "千家诗",
  tangshi300: "唐诗三百首",
  zengguang: "增广贤文",
};

/** 引文最长多少字：直播结果页和存图两行放得下 */
export const MAX_LINE = 32;

let all: Rec[] | null = null;
const folded = new Map<Rec, string>();

export function corpus(): Rec[] {
  if (all) return all;
  all = [];
  const file = join(process.cwd(), "data", "corpus", "pieces.jsonl");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line) as Rec;
      if (rec.s && rec.t && rec.x) all.push(rec);
    } catch {
      /* 坏行跳过 */
    }
  }
  return all;
}

export function foldedBody(rec: Rec): string {
  let hit = folded.get(rec);
  if (hit === undefined) {
    hit = foldText(rec.x);
    folded.set(rec, hit);
  }
  return hit;
}

export interface Located {
  s: string;
  t: string;
  a?: string;
}

/** 原句出现在哪几篇（books 不给就全库找，全唐诗很慢） */
export function locate(line: string, books?: string[]): Located[] {
  const needle = foldText(line);
  if (needle.length < 2) return [];
  const out: Located[] = [];
  for (const rec of corpus()) {
    if (books && !books.includes(rec.s)) continue;
    if (!foldedBody(rec).includes(needle)) continue;
    out.push({ s: rec.s, t: toSimplified(rec.t), ...(rec.a ? { a: toSimplified(rec.a) } : {}) });
  }
  return out;
}

export interface Citation {
  /** 语料里的书名 id，如 shijing */
  s: string;
  /** 语料里的篇名（简体），用来定位那一篇 */
  t: string;
  /** 展示用出处，如「《诗经·邶风·静女》」「李白《行路难》」 */
  from: string;
  /** 原句，简体，带标点 */
  line: string;
}

/**
 * 核对一条出处，返回不通过的原因（空数组 = 通过）。
 *
 * 规矩：那一篇在语料里；原句逐字在那一篇里；名字两个字都在原句里；原句念得出口；不太长。
 * 字的顺序不强求（「清扬婉兮」取「婉清」是常见取法），顺序倒过来时在 order 里记一笔。
 */
export function checkCitation(givenName: string, c: Citation): { errors: string[]; order: "same" | "reversed" | null } {
  const errors: string[] = [];
  const pieces = corpus().filter((r) => r.s === c.s && toSimplified(r.t) === c.t);
  if (!pieces.length) {
    const where = locate(c.line, [c.s]);
    errors.push(
      `语料里没有 ${c.s}「${c.t}」这一篇${where.length ? `；这句在：${where.map((w) => w.t).join(" / ")}` : ""}`,
    );
  } else {
    const needle = foldText(c.line);
    if (!pieces.some((p) => foldedBody(p).includes(needle))) {
      const where = locate(c.line, [c.s]);
      errors.push(
        `原句在 ${c.s}「${c.t}」里核不到${where.length ? `；这句在：${where.map((w) => w.t).join(" / ")}` : "（这部书里也没有，检查字形）"}`,
      );
    }
  }
  const lineChars = foldText(c.line);
  const [a, b] = [...foldText(givenName)];
  let order: "same" | "reversed" | null = null;
  if (!a || !b || !lineChars.includes(a) || !lineChars.includes(b)) {
    errors.push(`名字「${givenName}」的两个字不全在原句里`);
  } else {
    order = lineChars.indexOf(a) <= lineChars.lastIndexOf(b) ? "same" : "reversed";
  }
  if (!displayableQuote(c.line)) errors.push("原句过不了展示闸门（晦气字、方块字或生僻字）");
  if ([...foldText(c.line)].length > MAX_LINE) errors.push(`原句超过 ${MAX_LINE} 字`);
  if (!c.from.includes("《")) errors.push(`出处写法不对：${c.from}`);
  return { errors, order };
}
