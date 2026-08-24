import { getStylePrototype } from "@/config/style-prototypes";
import type { GatedCandidate, NormalizedRequest } from "./types";

export interface RankResult {
  ranked: GatedCandidate[];
  styleNotes: string[];
  primaryIndex: number;
}

/**
 * Soft ranking: style keyword fit + L2 demotion when avoidPopular.
 * Never hard-fails; may leave style mismatch notes.
 */
export function rankSoft(
  candidates: GatedCandidate[],
  req: NormalizedRequest,
  options?: { allowL2Primary?: boolean },
): RankResult {
  const proto = getStylePrototype(req.stylePrototypeId);
  const keywords = proto.keywords;
  const styleNotes: string[] = [];

  const scored = candidates.map((c, index) => {
    let score = 100 - index;
    // 关键词匹配用 meaning/origin/givenName，不含 styleFit：
    // styleFit 是模型对风格的复述（几乎必含风格名），混入会让所有候选都命中、打分失去区分度
    const blob = `${c.meaning ?? ""}${c.origin ?? ""}${c.givenName}`;
    const hits = keywords.filter((k) => blob.includes(k));
    score += hits.length * 8;

    if (c.l2Hot) {
      if (req.avoidPopular && !options?.allowL2Primary) {
        score -= 40;
      } else {
        score -= 10;
      }
    }

    if (req.gender === "male" && c.genderLean === "female") score -= 15;
    if (req.gender === "female" && c.genderLean === "male") score -= 15;

    return { c, score, hits };
  });

  scored.sort((a, b) => b.score - a.score);

  const ranked = scored.map((s) => {
    // 保留模型原文 styleFit（更具体）；模型没给时才用风格原型兜底，避免全部套同一模板句
    const fit =
      s.c.styleFit && s.c.styleFit.trim()
        ? s.c.styleFit.trim()
        : s.hits.length > 0
          ? `与「${proto.name}」方向有呼应（${s.hits.join("、")}）`
          : `已尽量贴近「${proto.name}」；贴合有限时仍保留可用推荐。`;
    return { ...s.c, styleFit: fit };
  });

  const weak = scored.filter((s) => s.hits.length === 0).length;
  if (weak > 0 && candidates.length > 0) {
    styleNotes.push(`部分名字与「${proto.name}」贴合有限，仍保留完整推荐并在逐名中说明。`);
  }
  if (req.styleNotes) {
    styleNotes.push(`用户补充偏好：${req.styleNotes}`);
  }

  let primaryIndex = 0;
  if (req.avoidPopular && !options?.allowL2Primary) {
    const nonL2 = ranked.findIndex((r) => !r.l2Hot);
    if (nonL2 >= 0) primaryIndex = nonL2;
  }

  return { ranked, styleNotes, primaryIndex };
}
