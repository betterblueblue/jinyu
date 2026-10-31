import type { NameSplit } from "@/domain/analysis/types";
import { sameSoundCandidates } from "./candidates";
import type { NameScore, NextStep } from "./types";

/**
 * 读音上的毛病扣到这么多分，才算换字解决不了、要推重新起名：
 * 谐音 15 / 30、娣 26 算；姓名同音 8、三字同调 5、三声连读 3 不算，这些不值得整个重起。
 */
export const RENAME_SOUND_POINTS = 15;

/**
 * 打分之后主播下一步推什么。要查同音候选（读字表），只能在服务端算。
 *
 * 90 分及以上（非常优秀）不推改字：分数高就是不需要改（用户 2026-10-31 定）。
 * 读音硬伤至少扣 15 分，所以 90 分以上不会走到「先问观众」那一支。
 */
export function nextStep(score: NameScore, split: NameSplit): NextStep {
  const fixable = score.fixable.filter((f) => sameSoundCandidates(split, score.gender, f.index, 1).length > 0);
  const soundIssues = score.deductions.filter((d) => d.soundBound && d.points >= RENAME_SOUND_POINTS);
  const kind =
    soundIssues.length > 0
      ? fixable.length > 0
        ? "ask"
        : "rename"
      : score.band === "great"
        ? "none"
        : fixable.length > 0
          ? "fix"
          : score.band === "change"
            ? "rename"
            : "none";
  return { kind, fixable, soundIssues };
}
