import l2Chars from "@/config/l2-chars.json";
import type { AnalysisGender } from "@/domain/analysis/types";
import { factsOf } from "@/domain/evaluate/facts";
import { clampTier, scoreBreakdown, STYLE_BASE } from "@/domain/evaluate/scoring";
import { nameSyllables } from "@/domain/pinyin-name";
import { BAD_WORDS, SURNAME_TRAP } from "@/domain/score/lexicon";
import { checkRecommendable } from "@/domain/score/recommend";
import type { FastTierScores } from "./types";

/**
 * 精简版闸门。
 *
 * 2026-11-05 起：模型给了三个档位数字时，按六维分（与打分榜同一套 scoreBreakdown）判断；
 * 没给就回退旧的 recommend.ts，保证老模型/旧测试不炸。
 * 结构硬伤（不是两个汉字）仍然先拦；严重问题会通过六维分的风险上限变成低分。
 */

const L2 = new Set(l2Chars as string[]);
const HAN2 = /^[\u4e00-\u9fff]{2}$/;
/** 直播推荐要求六维总分至少 90，和打分榜“非常优秀”同线；先跑 eval-fast 看通过率再调 */
export const FAST_SIX_MIN = 90;

export interface FastGateVerdict {
  keep: boolean;
  reasons: string[];
  hotChar: boolean;
  /** 给这个姓算出的六维总分；不是两个汉字时没有 */
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
  modelScores?: FastTierScores,
): FastGateVerdict {
  const name = givenName.trim();
  const hotChar = [...name].some((c) => L2.has(c));
  if (!HAN2.test(name)) {
    return { keep: false, reasons: ["不是两个汉字"], hotChar };
  }
  if (modelScores) {
    const facts = factsOf(surname.trim(), name, gender);
    const tiers = {
      pronunciation: { tier: clampTier("pronunciation", modelScores.pronunciation), reason: "" },
      meaning: { tier: clampTier("meaning", modelScores.meaning), reason: "" },
      gender: { tier: clampTier("gender", modelScores.gender), reason: "" },
      // 2026-11-05 定：风格是偏好，不进总分；给 baseline 保证和打分榜同一把尺子
      style: { tier: STYLE_BASE, reason: "" },
    };
    const score = scoreBreakdown(facts, tiers, { styleBaseline: true });
    const reasons: string[] = [];
    if (score.total < FAST_SIX_MIN) {
      reasons.push(
        score.capReason
          ? `六维分被「${score.capReason}」压到 ${score.total} 分`
          : `六维分不到 ${FAST_SIX_MIN}（${score.total} 分）`,
      );
    }
    return { keep: reasons.length === 0, reasons, hotChar, score: score.total };
  }
  const check = checkRecommendable(surname.trim(), name, gender);
  return { keep: check.ok, reasons: check.reasons, hotChar, score: check.score };
}
