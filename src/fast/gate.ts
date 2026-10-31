import l2Chars from "@/config/l2-chars.json";
import type { AnalysisGender } from "@/domain/analysis/types";
import { nameSyllables } from "@/domain/pinyin-name";
import { BAD_WORDS, SURNAME_TRAP } from "@/domain/score/lexicon";
import { checkRecommendable } from "@/domain/score/recommend";

/**
 * 精简版闸门。规则和打分榜是同一套（src/domain/score/recommend.ts）：
 * 有谐音、忌字、撞名、和姓同音这类硬伤，或者打分不到 90 的名字，直播不出。
 *
 * 这里只多管打分不管的一件事：必须是两个汉字。
 * 热门字只标记（hotChar），一个热门字扣 8 分还在 90 以上，排序时往后放；两个热门字会被打分拦下。
 */

const L2 = new Set(l2Chars as string[]);
const HAN2 = /^[\u4e00-\u9fff]{2}$/;

export interface FastGateVerdict {
  keep: boolean;
  reasons: string[];
  hotChar: boolean;
  /** 按打分规则配这个姓的分数；不是两个汉字时没有 */
  score?: number;
}

/**
 * 这个字放在名字第一个字时会不会和姓撞：连姓谐音、和姓同音、连读成常用词（沈默）。
 *
 * 抽起手字时用（seeds.ts）：模型可能把起手字放在名字第一个字，撞了姓这一轮就白给一个候选。
 * 判法和打分规则里对「姓 + 名首字」的三条一致，词表也是同一份（lexicon.ts）。
 */
export function firstCharConflict(ch: string, surname: string): boolean {
  const s = surname.trim();
  if (!s || !ch) return false;
  const n = [...s].length;
  const flat = nameSyllables(`${s}${ch}`).map((x) => x.py.toLowerCase());
  if (BAD_WORDS.has(flat.slice(0, n + 1).join(""))) return true;
  if (flat[n - 1] && flat[n - 1] === flat[n]) return true;
  return SURNAME_TRAP[s]?.chars.has(ch) ?? false;
}

export function checkFastCandidate(
  givenName: string,
  surname: string,
  gender: AnalysisGender = "unknown",
): FastGateVerdict {
  const name = givenName.trim();
  const hotChar = [...name].some((c) => L2.has(c));
  if (!HAN2.test(name)) {
    return { keep: false, reasons: ["不是两个汉字"], hotChar };
  }
  const check = checkRecommendable(surname.trim(), name, gender);
  return { keep: check.ok, reasons: check.reasons, hotChar, score: check.score };
}
