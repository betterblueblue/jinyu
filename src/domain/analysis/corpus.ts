import fs from "node:fs";
import path from "node:path";
import { corpusDir, foldText, toSimplified } from "./chars";
import type { RejectedCitation, VerifiedCitation } from "./types";

/**
 * 语料核验。
 *
 * 底本是 data/corpus/pieces.jsonl（由 scripts/corpus/fetch.mjs 生成），
 * 每行一条 {s:来源id, t:篇名, a?:作者, x:正文}。
 *
 * 核验只回答一个问题：这句话是不是原封不动地写在这一篇里。
 * 不判断用得对不对——那查不出来，只能靠提示词约束。
 */

interface Piece {
  s: string;
  t: string;
  a?: string;
  x: string;
}

interface FoldedPiece {
  t: string;
  folded: string;
  lines: string[];
  foldedLines: string[];
}

const SOURCE_NAMES: Record<string, string> = {
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

/** 模型可能写的别名 → 来源 id */
const ALIASES: Record<string, string> = {
  诗经: "shijing",
  诗三百: "shijing",
  三百篇: "shijing",
  楚辞: "chuci",
  楚词: "chuci",
  离骚: "chuci",
  论语: "lunyu",
  大学: "daxue",
  中庸: "zhongyong",
  孟子: "mengzi",
  周易: "zhouyi",
  易经: "zhouyi",
  易: "zhouyi",
  尚书: "shangshu",
  书经: "shangshu",
  礼记: "liji",
  左传: "zuozhuan",
  春秋左传: "zuozhuan",
  左氏春秋: "zuozhuan",
  左传春秋: "zuozhuan",
  文选: "wenxuan",
  昭明文选: "wenxuan",
  古文观止: "guwenguanzhi",
  全唐诗: "quantangshi",
  唐诗: "quantangshi",
  宋词: "songci",
  全宋词: "songci",
  元曲: "yuanqu",
  纳兰词: "nalan",
  纳兰性德: "nalan",
  千字文: "qianziwen",
  声律启蒙: "shenglvqimeng",
  三字经: "sanzijing",
  幼学琼林: "youxueqionglin",
  千家诗: "qianjiashi",
  唐诗三百首: "tangshi300",
  增广贤文: "zengguang",
  昔时贤文: "zengguang",
};

let allPieces: Map<string, Piece[]> | null = null;
const foldedCache = new Map<string, FoldedPiece[]>();

function loadCorpus(): Map<string, Piece[]> {
  if (allPieces) return allPieces;
  const file = path.join(corpusDir(), "pieces.jsonl");
  const map = new Map<string, Piece[]>();
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    allPieces = map;
    return map;
  }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let rec: Piece;
    try {
      rec = JSON.parse(line) as Piece;
    } catch {
      continue;
    }
    if (!rec.s || !rec.x) continue;
    const list = map.get(rec.s);
    if (list) list.push(rec);
    else map.set(rec.s, [rec]);
  }
  allPieces = map;
  return map;
}

function foldedFor(sourceId: string): FoldedPiece[] {
  const hit = foldedCache.get(sourceId);
  if (hit) return hit;
  const pieces = loadCorpus().get(sourceId) ?? [];
  const out = pieces.map((p) => {
    const lines = p.x.split("\n");
    return {
      t: p.t,
      folded: foldText(p.x),
      lines,
      foldedLines: lines.map(foldText),
    };
  });
  foldedCache.set(sourceId, out);
  return out;
}

export function resetCorpusCache(): void {
  allPieces = null;
  foldedCache.clear();
}

export function corpusStats(): { sources: number; pieces: number } {
  const map = loadCorpus();
  let pieces = 0;
  for (const list of map.values()) pieces += list.length;
  return { sources: map.size, pieces };
}

export function knownSourceNames(): string[] {
  return [...new Set(Object.values(SOURCE_NAMES))];
}

/** 篇名比对：模型写「周南·桃夭」，语料里是「国风·周南·桃夭」，取末段比 */
function pieceMatches(claimed: string | undefined, actual: string): boolean {
  if (!claimed) return false;
  const norm = (s: string) => s.replace(/[《》〈〉·\s·]/g, "");
  const a = norm(claimed);
  const b = norm(actual);
  if (!a) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const tail = a.split(/[·・.]/).filter(Boolean).pop() ?? a;
  return tail.length >= 2 && b.includes(tail);
}

function locateLine(piece: FoldedPiece, foldedQuote: string): string | null {
  const idx = piece.foldedLines.findIndex((l) => l.includes(foldedQuote));
  if (idx >= 0) return piece.lines[idx]!.trim();
  return null;
}

export type VerifyOutcome =
  | { ok: true; citation: VerifiedCitation }
  | { ok: false; rejected: RejectedCitation };

export function verifyCitation(claim: {
  source?: string;
  piece?: string;
  quote?: string;
  gloss?: string;
}): VerifyOutcome {
  const rawSource = (claim.source ?? "").replace(/[《》\s]/g, "");
  const quote = (claim.quote ?? "").trim();
  const sourceId = ALIASES[rawSource];

  if (!quote) {
    return {
      ok: false,
      rejected: { source: rawSource, piece: claim.piece, quote, reason: "没有给出引文原文" },
    };
  }
  if (!sourceId) {
    return {
      ok: false,
      rejected: {
        source: rawSource || "未注明",
        piece: claim.piece,
        quote,
        reason: "语料里没有这本书",
      },
    };
  }

  const foldedQuote = foldText(quote);
  if (foldedQuote.length < 4) {
    return {
      ok: false,
      rejected: { source: SOURCE_NAMES[sourceId]!, piece: claim.piece, quote, reason: "引文太短，不足四个字" },
    };
  }

  const pieces = foldedFor(sourceId);
  if (!pieces.length) {
    return {
      ok: false,
      rejected: {
        source: SOURCE_NAMES[sourceId]!,
        piece: claim.piece,
        quote,
        reason: "语料未下载这一部",
      },
    };
  }

  let hitPiece: FoldedPiece | null = null;
  let hitLine: string | null = null;
  for (const p of pieces) {
    if (!p.folded.includes(foldedQuote)) continue;
    hitPiece = p;
    hitLine = locateLine(p, foldedQuote);
    break;
  }

  if (!hitPiece) {
    return {
      ok: false,
      rejected: {
        source: SOURCE_NAMES[sourceId]!,
        piece: claim.piece,
        quote,
        reason: `《${SOURCE_NAMES[sourceId]}》全文里没有这句原文`,
      },
    };
  }

  const matched = pieceMatches(claim.piece, hitPiece.t);
  return {
    ok: true,
    citation: {
      source: SOURCE_NAMES[sourceId]!,
      // 全唐诗、千字文这些语料本身是繁体，直接照搬会和界面上其它文字打架
      piece: toSimplified(hitPiece.t),
      quote: toSimplified(quote),
      line: toSimplified(hitLine ?? hitPiece.lines[0]?.trim() ?? quote),
      ...(claim.gloss ? { gloss: claim.gloss } : {}),
      ...(claim.piece && !matched ? { corrected: true } : {}),
    },
  };
}

/** 给提示词用的语料清单，让模型只在能核验的范围里找出处 */
export function corpusCatalog(): { name: string; available: boolean }[] {
  const map = loadCorpus();
  return Object.entries(SOURCE_NAMES).map(([id, name]) => ({
    name,
    available: (map.get(id)?.length ?? 0) > 0,
  }));
}
