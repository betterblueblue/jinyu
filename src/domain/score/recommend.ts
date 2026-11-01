import type { AnalysisGender } from "@/domain/analysis/types";
import { scoreName } from "./score";
import type { Deduction, ScoreRuleId } from "./types";

/**
 * 能不能推荐出去：系统自己给出的名字（直播起名、完整版起名、名字库）都用打分规则过一遍。
 *
 * 两条线，都过才放行：
 *   1. 没有下面 BLOCKING 里的硬伤（谐音、忌字、撞名……），哪一条都不看总分；
 *   2. 用同一套规则打分不低于 90。
 * 这样主播起完名，观众拿去打分榜一打，不会被自家规则扣到 90 以下（2026-10-31 定）。
 *
 * 以前直播闸门（src/fast/gate.ts）、完整版闸门（src/domain/gate.ts）、打分榜各写一套，
 * 宸、懿、两个热门字这类名字直播放行、打分却扣分；完整版连谐音都不查。现在三处都调这里。
 */
export const RECOMMEND_MIN_SCORE = 90;

/** 命中就不推荐；值是给主播和探针看的短理由 */
const BLOCKING: Partial<Record<ScoreRuleId, string>> = {
  homophone: "连姓读起来不雅",
  forbidden: "含不宜用字",
  swap: "用字太大或不讨喜",
  template: "撞热门名字",
  sameSound: "姓与名首字同音",
  trap: "姓与名首字连读成常用词",
  rare: "有不常用的字",
  misread: "有容易念错的字",
  eraName: "年代感重",
  infamous: "和反面人物同名",
};

/** 理由后面带上是哪几个字 */
const WITH_CHARS = new Set<ScoreRuleId>(["forbidden", "swap", "rare", "misread"]);

export interface RecommendOptions {
  /**
   * 这些位置上的字是用户指定的（辈分字），落在这些字上的扣分不算：
   * 用户要求名字里必须有「宸」，就不能因为「宸」把所有名字都拦掉。
   */
  exemptPositions?: readonly number[];
  /** 不算的规则。完整版关了「尽量避开热门名」时不算热门字 */
  ignoreRules?: readonly ScoreRuleId[];
}

export interface RecommendCheck {
  ok: boolean;
  /** 去掉豁免之后的分数 */
  score: number;
  reasons: string[];
  deductions: Deduction[];
}

export function checkRecommendable(
  surname: string,
  givenName: string,
  gender: AnalysisGender,
  options: RecommendOptions = {},
): RecommendCheck {
  const result = scoreName({ surname, givenName, alternatives: [] }, gender);
  const exempt = new Set(options.exemptPositions ?? []);
  const ignored = new Set(options.ignoreRules ?? []);
  const counted = result.deductions.filter((d) => {
    if (ignored.has(d.rule)) return false;
    return !(exempt.size > 0 && d.positions.length > 0 && d.positions.every((p) => exempt.has(p)));
  });
  const score = Math.max(0, 100 - counted.reduce((sum, d) => sum + d.points, 0));

  const reasons: string[] = [];
  for (const d of counted) {
    const label = BLOCKING[d.rule];
    if (!label) continue;
    const text = WITH_CHARS.has(d.rule) && d.chars.length ? `${label}（${d.chars.join("、")}）` : label;
    if (!reasons.includes(text)) reasons.push(text);
  }
  if (reasons.length === 0 && score < RECOMMEND_MIN_SCORE) {
    reasons.push(`打分不到 ${RECOMMEND_MIN_SCORE}（${score} 分）`);
  }
  return { ok: reasons.length === 0, score, reasons, deductions: counted };
}
