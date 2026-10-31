import fs from "node:fs";
import path from "node:path";
import { corpusDir, foldText, toSimplified } from "@/domain/analysis/chars";
import type { FastCitation } from "./types";

/**
 * 篇名 → 原文。
 *
 * 模型只给「书名 + 篇名」，这里回 data/corpus/pieces.jsonl 找到那一篇，
 * 把含名字两个字的句子截出来当引文。引文天生是原文子串，不存在「抄错」。
 *
 * 性能有讲究（第一版踩过坑）：不能一上来就把 91,220 行全 JSON.parse 成索引，
 * 实测那一步在请求里吃掉 25 秒。现在的做法是——
 *   1. 整个文件只读一次，按行切成字符串数组（~200ms，之后常驻）
 *   2. 只对**用到的那个书名**做字符串过滤，再 parse 那几十~几千行
 *   3. 按书缓存，第二次起直接命中
 */

const SOURCE_ID: Record<string, string> = {
  诗经: "shijing",
  楚辞: "chuci",
  论语: "lunyu",
  大学: "daxue",
  中庸: "zhongyong",
  孟子: "mengzi",
  周易: "zhouyi",
  易经: "zhouyi",
  尚书: "shangshu",
  礼记: "liji",
  左传: "zuozhuan",
  文选: "wenxuan",
  古文观止: "guwenguanzhi",
  全唐诗: "quantangshi",
  唐诗: "quantangshi",
  宋词: "songci",
  千家诗: "qianjiashi",
  唐诗三百首: "tangshi300",
  纳兰词: "nalan",
  元曲: "yuanqu",
};

const SOURCE_LABEL: Record<string, string> = {
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
  nalan: "纳兰词",
  yuanqu: "元曲",
  qianjiashi: "千家诗",
  tangshi300: "唐诗三百首",
  qianziwen: "千字文",
  shenglvqimeng: "声律启蒙",
  sanzijing: "三字经",
  youxueqionglin: "幼学琼林",
  zengguang: "增广贤文",
};

interface Piece {
  s: string;
  title: string;
  foldedTitle: string;
  body: string;
}

let lines: string[] | null = null;
const perSource = new Map<string, Piece[]>();

function corpusLines(): string[] {
  if (lines) return lines;
  try {
    lines = fs.readFileSync(path.join(corpusDir(), "pieces.jsonl"), "utf8").split("\n");
  } catch {
    lines = [];
  }
  return lines;
}

export function resetPieceCache(): void {
  lines = null;
  perSource.clear();
}

function piecesOf(sourceId: string): Piece[] {
  const hit = perSource.get(sourceId);
  if (hit) return hit;
  const needle = `"s":"${sourceId}"`;
  const out: Piece[] = [];
  for (const line of corpusLines()) {
    if (!line || !line.includes(needle)) continue;
    try {
      const rec = JSON.parse(line) as { s?: string; t?: string; x?: string };
      if (!rec.s || !rec.t || !rec.x) continue;
      out.push({ s: rec.s, title: rec.t, foldedTitle: foldText(rec.t), body: rec.x });
    } catch {
      /* 坏行跳过 */
    }
  }
  perSource.set(sourceId, out);
  return out;
}

function segmentsOf(label: string): string[] {
  return label
    .replace(/[《》〈〉]/g, "")
    .split(/[·・.、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 只认「一个字一个句读」的分句：。！？；…，、：都算句读边界 */
const CLAUSE_SPLIT = /(?<=[。！？；…，、：])/;

/**
 * 截引文：只在**同一个分句**里找两字按顺序出现，挑最短的那句。
 *
 * 2026-10-31 改过：原来只按句号分句，逗号两边会被当成相邻（语宁 ←「不与华池语，宁将浴室论」），
 * 还留了一条「整行开窗」兜底，会截出跨句的碎片。两条都删了——找不到同一分句里的两字，
 * 就返回 null，让调用方留白。
 */
function extractQuote(body: string, chars: [string, string]): string | null {
  const [a, b] = chars;
  let best: string | null = null;

  for (const raw of body.split("\n")) {
    for (const seg of raw.split(CLAUSE_SPLIT)) {
      const foldedSeg = foldText(seg);
      const pa = foldedSeg.indexOf(a);
      const pb = foldedSeg.lastIndexOf(b);
      if (pa < 0 || pb <= pa) continue;
      const text = seg.trim();
      if (text && (!best || text.length < best.length)) best = text;
    }
  }

  return best;
}

/**
 * 篇名纠一处语料的错：周易的系辞被并进了「未济（卦六十四）」这一篇。
 *
 * 「君子知微知彰」出自系辞下，篇名却显示「未济（卦六十四）」——直播里报错篇名
 * 比没有出处更糟。模型指明是系辞时按模型说的标；其他情况不动。
 */
function relabelPiece(corpusTitle: string, pieceLabel?: string): string {
  if (!pieceLabel || !corpusTitle.includes("未济")) return corpusTitle;
  const label = toSimplified(pieceLabel);
  if (!label.includes("系辞")) return corpusTitle;
  if (label.includes("下")) return "系辞下";
  if (label.includes("上")) return "系辞上";
  return "系辞";
}

function citationOf(piece: Piece, chars: [string, string], pieceLabel?: string): FastCitation | null {
  const quote = extractQuote(piece.body, chars);
  if (!quote) return null;
  const text = toSimplified(quote);
  if (!displayableQuote(text)) return null;
  return {
    source: SOURCE_LABEL[piece.s] ?? "",
    piece: relabelPiece(toSimplified(piece.title), pieceLabel),
    quote: text,
    line: text,
  };
}

/**
 * 兜底截句不去的书。
 *
 * 实测（2026-10-31）这些书的 "句子" 里混着注文和残缺赋句，截出来不像引文：
 *   文选·卷二六 →「流温，言水玉温润也。」
 *   文选·卷四一 →「往前与我书，书宜应答，但有事，故不获答。」
 * 模型自己写了原句的（citeFromLine）不受此限——那一句是它指认、我们逐字核过的。
 */
const NO_FALLBACK_SOURCES = new Set(["wenxuan", "guwenguanzhi"]);

export function locateCitation(
  sourceLabel: string | undefined,
  pieceLabel: string | undefined,
  givenName: string,
): FastCitation | null {  if (!givenName || [...givenName].length !== 2) return null;
  const chars = [...givenName] as [string, string];
  const id = sourceLabel ? SOURCE_ID[sourceLabel.replace(/[《》\s]/g, "")] : undefined;
  if (id && NO_FALLBACK_SOURCES.has(id)) return null;
  const segs = pieceLabel ? segmentsOf(pieceLabel) : [];
  const foldedPiece = pieceLabel ? foldText(pieceLabel) : "";
  const tail = segs.length ? segs[segs.length - 1]! : "";

  if (id) {
    const pool = piecesOf(id);
    const tried = new Set<Piece>();
    const levels: Piece[][] = [
      pool.filter((p) => p.foldedTitle === foldedPiece || p.foldedTitle.endsWith(foldedPiece)),
      tail ? pool.filter((p) => p.foldedTitle.includes(tail)) : [],
      segs.length ? pool.filter((p) => segs.some((g) => g.length >= 2 && p.foldedTitle.includes(g))) : [],
    ];
    for (const hits of levels) {
      for (const piece of hits) {
        if (tried.has(piece)) continue;
        tried.add(piece);
        const hit = citationOf(piece, chars);
        if (hit) return hit;
      }
    }
  }

  // 跨书：书名认错、篇名对。只在已加载的书目里找（避免为兜底再读一遍语料）
  if (tail) {
    for (const [sid, list] of perSource) {
      if (NO_FALLBACK_SOURCES.has(sid)) continue;
      for (const piece of list) {
        if (!piece.foldedTitle.includes(tail)) continue;
        const hit = citationOf(piece, chars);
        if (hit && hit.source === SOURCE_LABEL[sid]) return hit;
      }
    }
  }

  return null;
}

/**
 * 引文展示闸门：出现这些字、或者出现方块/表外生僻字的那一句，不适合当着观众念出来。
 *
 * 2026-10-31 实测的漏网句：清和 →「声噭𫍥兮清和，音晏衍兮要婬」、
 *                      书宁 →「名位未霑身欲老，诗书宁救眼前贫」、
 *                      知夏 →「曾不知夏之为丘兮，孰两东门之可芜」。
 * 第二轮又抓到两条：书宁 →「□万卷诗书宁愤穷」（语料缺字方块）、
 *                 亦宁 →「郡带女𡡓名，民康境亦宁」（表外生僻字，直播念不出来）。
 *
 * 只挡明显不能念的（淫靡、丧亡、贫贱、病痛、鬼怪、方块字、表外字），**不判断用得对不对**——
 * 那句「桃之夭夭被理解成逃跑」核不出来。宁可留白，也不能让这种句子进直播。
 */
const QUOTE_BLOCK = /[婬淫丧亡死病痛哀哭泪冢墓鬼妖罪祸灾贫贱寡囚奴]/

function displayableQuote(text: string): boolean {
  if (!text) return false;
  if (QUOTE_BLOCK.test(text)) return false;
  // 语料缺口方块、替换符、扩展 A / 扩展 B 以后的生僻字（𡡓 这类），直播张不开口
  return ![...text].some((ch) => {
    const cp = ch.codePointAt(0)!;
    return ch === "□" || cp === 0xfffd || cp > 0xffff || (cp >= 0x3400 && cp <= 0x4dbf);
  });
}

/** 仅供测试：引文展示闸门 */
export const __displayableQuote = displayableQuote;

/**
 * 模型把自己想引的那一句也给了：核它确实在这篇原文里、名字两个字按顺序出现在句里。
 *
 * 为什么不直接信模型给的句子：它可能记得个大概，也可能是拼的。
 * 核法就是折合后子串比对（繁转简、去标点），和引文核验同一套，
 * 核不过一律返回 null，调用方退回 locateCitation 去截。
 *
 * 有这一条，「沈清和」就不至于被截成「音晏衍兮要婬」——那句话模型自己不会写。
 */
export function citeFromLine(
  sourceLabel: string | undefined,
  pieceLabel: string | undefined,
  givenName: string,
  line: string,
): FastCitation | null {
  if (!givenName || [...givenName].length !== 2) return null;
  const raw = line.trim();
  if (!raw) return null;
  const foldedLine = foldText(raw);
  const [first, second] = [...foldText(givenName)];
  if (foldedLine.length < 4 || foldedLine.length > 40) return null;
  // 两个字要按顺序出现在这一句里。不要求挨着——「静姝」取自「静女其姝」，
  // 中间有「女其」，挨着反而是常态之外的情况。
  const at = first ? foldedLine.indexOf(first) : -1;
  if (at < 0 || !second || foldedLine.lastIndexOf(second) <= at) return null;

  const id = sourceLabel ? SOURCE_ID[sourceLabel.replace(/[《》\s]/g, "")] : undefined;
  const segs = pieceLabel ? segmentsOf(pieceLabel) : [];
  const foldedPiece = pieceLabel ? foldText(pieceLabel) : "";
  const tail = segs.length ? segs[segs.length - 1]! : "";

  const tryPiece = (piece: Piece): FastCitation | null => {
    if (!foldText(piece.body).includes(foldedLine)) return null;
    const text = toSimplified(raw);
    if (!displayableQuote(text)) return null;
    return {
      source: SOURCE_LABEL[piece.s] ?? "",
      piece: relabelPiece(toSimplified(piece.title), pieceLabel),
      quote: text,
      line: text,
    };
  };

  if (id) {
    const pool = piecesOf(id);
    // 篇名留空时不要拿整部书去 fold 正文（全唐诗 5.7 万篇，会卡住请求）。
    // 这种情况直接交回 locateCitation，行为和原来一致。
    const levels: Piece[][] = foldedPiece
      ? [
          pool.filter((p) => p.foldedTitle === foldedPiece || p.foldedTitle.endsWith(foldedPiece)),
          tail ? pool.filter((p) => p.foldedTitle.includes(tail)) : [],
          segs.length ? pool.filter((p) => segs.some((g) => g.length >= 2 && p.foldedTitle.includes(g))) : [],
        ]
      : [];
    for (const hits of levels) {
      for (const piece of hits) {
        const hit = tryPiece(piece);
        if (hit) return hit;
      }
    }
  }

  // 书名给错、篇名对：只在已加载的书里找，找到就按真实篇名返回
  if (tail) {
    for (const [, list] of perSource) {
      for (const piece of list) {
        if (!piece.foldedTitle.includes(tail)) continue;
        const hit = tryPiece(piece);
        if (hit) return hit;
      }
    }
  }

  return null;
}

