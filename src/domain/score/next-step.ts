import type { NameScore, NextStep } from "./types";

/**
 * 读音上的毛病扣到这么多分，算硬伤：谐音 15 / 30、娣 26 算；姓名同音 8、三字同调 5、三声连读 3 不算。
 * 有硬伤时改一个字读音也得跟着变，先问观众能不能接受。
 */
export const HARD_SOUND_POINTS = 15;

/**
 * 打分之后主播下一步推什么（2026-11-01 用户定）：
 *   - 90 分及以上：已经很好，不用改；
 *   - 有读音硬伤：先问观众，只改一个字能接受就改字，不能接受就重新起名；
 *   - 其余低于 90 的：给「改一个字」。改哪个字、改一个字够不够，交给模型看着扣分理由判断，
 *     代码不再预先列「哪个字能换」——那样穷举不完，播着播着总有对不上的名字。
 * 读音硬伤至少扣 15 分，所以 90 分以上不会走到「先问观众」那一支。
 */
export function nextStep(score: NameScore): NextStep {
  const soundIssues = score.deductions.filter((d) => d.soundBound && d.points >= HARD_SOUND_POINTS);
  const kind = score.band === "great" ? "none" : soundIssues.length > 0 ? "ask" : "fix";
  return { kind, soundIssues };
}
