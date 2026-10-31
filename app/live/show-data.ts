import type { FastCandidate, FastCitation, FastSuccess } from "@/fast/types";
import { nameSyllables, type NameSyllable } from "@/domain/pinyin-name";
import { checkTag } from "@/library/talk";

/**
 * 直播台一张卡的数据：精简版结果先变成这一份，屏幕（reveal-view.tsx）和存图（card-export.ts）都只读它。
 */

export type Skin = "paper" | "celadon" | "silver" | "bamboo";
export type Gender = "male" | "female" | "unknown";
export type Phase = "input" | "generating" | "reveal";

/** 引文证据：原文、篇名、两字在原文里是连着还是分取（后者是核验算出来的，不是文案） */
export interface ShowCite {
  quote: string;
  piece: string;
  kind: "连出" | "分取";
}

export interface ShowAlt {
  n: string;
  py: string;
  syl: NameSyllable[];
  one: string;
  cite?: ShowCite;
}

export interface ShowData {
  /** 本场第几个：屏幕和存图都要有，否则截图对不上是哪一轮 */
  no: number;
  /** 这一轮出场时，本场已经给过几个名字 */
  sessionGiven: number;
  surname: string;
  full: string;
  /** 全名拼音（含姓氏） */
  py: string;
  /** 多音姓氏或未收录字的核对提示 */
  pyHint?: string;
  /** 逐字音节 + 声调，直播大字下面那行用 */
  syl: NameSyllable[];
  one: string;
  tags: string[];
  /** 首推的引文证据；没有就是没有，不拿单个字凑 */
  cite?: ShowCite;
  /** 体检一行：「按王姓查过：没查到不好的谐音和生僻字」。精简版的名字都过了闸门才有这一行 */
  check?: string;
  alts: ShowAlt[];
  /** 开了生辰时带上属相和季节，直播页和存图都要显示 */
  bazi?: string;
}

const HAN_ONLY = /[\u4e00-\u9fa5]/g;

/** 两字在核过的原文里是连着的，还是同句分取——由引文算，不由文案写 */
function citeKind(givenName: string, quote: string): "连出" | "分取" {
  const folded = quote.match(HAN_ONLY)?.join("") ?? "";
  const [a, b] = [...givenName];
  if (!a || !b) return "分取";
  const i = folded.indexOf(a);
  return i >= 0 && folded[i + 1] === b ? "连出" : "分取";
}

/** 出处的写法：名字库的条目带现成的（「崔颢《黄鹤楼》」），模型核出来的拼书名和篇名 */
export function citeFrom(c: FastCitation): string {
  return c.label ?? `${c.source}·${c.piece}`;
}

function toCite(givenName: string, c?: FastCitation): ShowCite | undefined {
  if (!c?.quote) return undefined;
  // 引文按片段处理：结尾句号不放引号里，其余一字不改
  return { quote: `「${c.quote.replace(/[。！？；，、]\s*$/, "")}」`, piece: citeFrom(c), kind: citeKind(givenName, c.quote) };
}

/**
 * 精简版结果 → 这张卡的数据规格。
 *
 * 屏幕和存图都只吃这一份，不再各挑各的字段（以前 DOM 和 canvas 各读一套详解行，
 * 备选在屏幕上只有名字、在图里却带 why 和出处，两边对不上）。
 * 规矩：要加字段，两个渲染器一起加，否则一致性就破了。
 */
export function fastToShow(data: FastSuccess, no: number, sessionGiven: number): ShowData {
  const toAlt = (c: FastCandidate): ShowAlt => ({
    n: c.fullName,
    py: c.pinyin,
    syl: nameSyllables(c.fullName),
    one: c.why,
    cite: toCite(c.givenName, c.citation),
  });

  const primary = data.primary;
  const tags = [
    "双字名",
    primary.hotChar ? "偏热门" : "避开网红名",
    data.gender === "male" ? "男向" : "女向",
  ];
  const cite = toCite(primary.givenName, primary.citation);

  return {
    no,
    sessionGiven,
    surname: data.surname,
    full: primary.fullName,
    py: primary.pinyin,
    ...(primary.pinyinHint ? { pyHint: primary.pinyinHint } : {}),
    syl: nameSyllables(primary.fullName),
    // 名字库的名字这一句是库里写好的一句话寓意；模型起的是模型那句
    one: primary.why,
    tags,
    cite,
    // 精简版的名字都过了闸门（谐音、生僻字……），这一行总是成立
    check: checkTag(data.surname),
    alts: data.alternatives.map(toAlt),
    ...(data.baziLine ? { bazi: data.baziLine } : {}),
  };
}
