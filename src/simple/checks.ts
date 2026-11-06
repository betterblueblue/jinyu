import l1Templates from "@/config/l1-templates.json";
import l2Chars from "@/config/l2-chars.json";
import { verifyCitation } from "@/domain/analysis/corpus";
import type { VerifiedCitation } from "@/domain/types";
import { resolveSplit, scoreName } from "@/domain/score/score";
import type { ScoreRuleId } from "@/domain/score/types";

/**
 * 简化版的程序检查：只把有硬伤的名字去掉，不打分、不排名、不让模型重写（2026-11-06 用户定）。
 * 这些都是查表，几毫秒；现在的系统慢在验收不过就重试、候选不够就重起。
 *
 * 算硬伤的（和打分榜、完整版闸门同一套字表）：
 *   生僻字、次常用多音字、不宜用字、不好的谐音、和姓连读成词、和姓同音、反面人物同名、明显用错性别、烂大街的名字。
 * 不算的：热门字、年代字、笔画轻重、民俗说法——这些是偏好，盲选里用户不在意。
 */

const L1 = new Set(l1Templates as string[]);
const L2 = new Set(l2Chars as string[]);

const HARD: ReadonlySet<ScoreRuleId> = new Set<ScoreRuleId>(["rare", "misread", "forbidden", "homophone", "trap", "sameSound", "infamous"]);

export interface NameProblem {
  keep: boolean;
  reasons: string[];
  hotChar: boolean;
}

/**
 * @param exempt 用户指定的字（辈分字）在名里的位置：落在这些字上的毛病不算，那是家里定的
 */
export function hardProblems(
  surname: string,
  givenName: string,
  gender: "male" | "female" | "unknown",
  exempt: number[] = [],
): NameProblem {
  const hotChar = [...givenName].some((c) => L2.has(c));
  const reasons: string[] = [];
  if (!/^[一-鿿]{1,2}$/.test(givenName)) return { keep: false, reasons: ["名不是一到两个汉字"], hotChar };
  if (L1.has(givenName)) reasons.push("烂大街的名字");
  const split = resolveSplit(`${surname}${givenName}`, surname);
  if (!split || split.givenName !== givenName) return { keep: false, reasons: ["拆不开姓名"], hotChar };
  const score = scoreName(split, gender);
  for (const d of score.deductions) {
    const onExempt = d.positions.length > 0 && d.positions.every((p) => exempt.includes(p));
    if (onExempt) continue;
    if (HARD.has(d.rule)) reasons.push(d.line);
    // 明显用错性别（整个名字都是另一边的字）才算硬伤；只沾一点不算
    if (d.rule === "gender" && d.points >= 25) reasons.push(d.line);
  }
  return { keep: reasons.length === 0, reasons, hotChar };
}

/**
 * 模型给的出处回原文逐字核。写法先理一下：「《诗经·大雅·思齐》」拆成书名和篇名，原句后面带的括号解释去掉。
 * 核不过就当没有，不显示（和现在的系统一样，不拿编的出处充数）。
 */
export function checkCitation(raw: { source?: string; piece?: string; quote?: string }): VerifiedCitation | null {
  const quote = (raw.quote ?? "").replace(/[（(][^）)]*[）)]/g, "").trim();
  if (!quote) return null;
  const source = (raw.source ?? "").replace(/[《》〈〉]/g, "").trim();
  const [book, ...rest] = source.split(/[·・]/);
  const v = verifyCitation({ source: (book ?? "").trim(), piece: raw.piece || rest.join("·") || undefined, quote });
  return v.ok ? v.citation : null;
}
