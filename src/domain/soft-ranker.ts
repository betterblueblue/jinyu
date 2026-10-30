import type { GatedCandidate, NormalizedRequest } from "./types";

export interface RankResult {
  ranked: GatedCandidate[];
  /** 排序过程中需要让用户知道的说明（不再有风格贴合之类的措辞） */
  notes: string[];
  primaryIndex: number;
}

/**
 * 软排序。
 *
 * 没有「风格」之后，能用来排序的只剩可核实的信号：
 *   1. 出处是否通过原文核验（核过的名字，出处能拿给家人查）
 *   2. 组合依据写没写具体（能指到两个字的关系，而不是一句好话）
 *   3. 模型给的原始顺序（同名同分时保持稳定）
 *   4. 重名/性别倾向的扣分（规则层已经能查的部分）
 *
 * 永远不硬性淘汰，只调顺序。
 */
export function rankSoft(
  candidates: GatedCandidate[],
  req: NormalizedRequest,
  options?: { allowL2Primary?: boolean },
): RankResult {
  const notes: string[] = [];

  const scored = candidates.map((c, index) => {
    let score = 100 - index;

    // 有核验过的出处，可信度明显更高
    if (c.verifiedCitation) score += 15;

    // 组合依据够具体才加分，防止「寓意美好」这类空话蹭分
    const composition = (c.composition ?? "").trim();
    if (composition.length >= 12) score += 6;

    if (c.l2Hot) {
      if (req.avoidPopular && !options?.allowL2Primary) {
        score -= 40;
      } else {
        score -= 10;
      }
    }

    if (req.gender === "male" && c.genderLean === "female") score -= 15;
    if (req.gender === "female" && c.genderLean === "male") score -= 15;

    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const ranked = scored.map((s) => s.c);

  const withCitation = ranked.filter((c) => c.verifiedCitation).length;
  if (withCitation === 0 && ranked.length > 0) {
    notes.push("这批名字里没有能核到原文出处的，出处一栏留白，不做补写。");
  }

  if (req.requirements) {
    notes.push(`按要求：${req.requirements}`);
  }

  let primaryIndex = 0;
  if (req.avoidPopular && !options?.allowL2Primary) {
    const nonL2 = ranked.findIndex((r) => !r.l2Hot);
    if (nonL2 >= 0) primaryIndex = nonL2;
  }

  return { ranked, notes, primaryIndex };
}
