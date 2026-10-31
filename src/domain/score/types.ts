import type { AnalysisGender } from "@/domain/analysis/types";
import type { NameSyllable } from "@/domain/pinyin-name";

/** 90 分以上 great，75–89 ok，75 以下 change */
export type ScoreBand = "great" | "ok" | "change";

export type ScoreRuleId =
  | "homophone"
  | "forbidden"
  | "swap"
  | "template"
  | "gender"
  | "misread"
  | "trap"
  | "rare"
  | "hot"
  | "singleName"
  | "sameSound"
  | "eraName"
  | "era"
  | "remind"
  | "flatTone"
  | "sandhi"
  | "strokes"
  | "style";

export interface Deduction {
  rule: ScoreRuleId;
  /** 扣分落在名里的哪几个字上（只算名，不算姓）；整名规则为空 */
  chars: string[];
  /** 同上，换成在名里的位置（0 起）。叠字时靠它分清是哪一个 */
  positions: number[];
  points: number;
  /** 主播能直接念的一句话 */
  line: string;
  /** 毛病出在读音上（谐音、同音、娣），换同音字解决不了，不算进「值得换的字」 */
  soundBound?: true;
}

/** 只念不扣的民间说法 */
export interface FolkNote {
  char: string;
  line: string;
}

export interface FixableChar {
  char: string;
  /** 在名里的位置，0 起 */
  index: number;
  /** 这个字身上的扣分合计，只用来排谁先换 */
  points: number;
}

export interface NameScore {
  fullName: string;
  surname: string;
  givenName: string;
  alternatives: { surname: string; givenName: string }[];
  gender: AnalysisGender;
  score: number;
  band: ScoreBand;
  bandLabel: string;
  /** 全名逐字拼音和声调，展示用 */
  syllables: NameSyllable[];
  deductions: Deduction[];
  folk: FolkNote[];
  /** 名里值得换的字（身上扣 8 分及以上），按扣分从多到少 */
  fixable: FixableChar[];
}

/**
 * 打分之后主播下一步推什么：
 *   fix    有字可换，换同音字就能解决 → 改字
 *   ask    有字可换，但还有读音上的硬伤，换同音字去不掉 → 先问观众能不能接受只改字
 *   rename 读音上的硬伤又没字可换，或者 75 分以下没字可换 → 直接推重新起名
 *   none   不用推
 */
export interface NextStep {
  kind: "none" | "fix" | "ask" | "rename";
  /** 真能换出同音字的字：fixable 里去掉一个候选都没有的（杨伟的伟，换哪个同音字都还是那个谐音） */
  fixable: FixableChar[];
  /** 换同音字去不掉的读音硬伤（谐音、娣），主播拿来解释为什么要重新起 */
  soundIssues: Deduction[];
}

export interface FixOption {
  fullName: string;
  givenName: string;
  /** 换掉的字 */
  from: string;
  /** 换上的字 */
  to: string;
  /** 在名里的位置，0 起 */
  index: number;
  score: number;
  band: ScoreBand;
  bandLabel: string;
  /** 主播念的一句理由 */
  why: string;
}

export type FixOutcome =
  | { ok: true; options: FixOption[]; message?: string; tookMs: number }
  | { ok: false; message: string };
