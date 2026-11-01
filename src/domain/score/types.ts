import type { AnalysisGender } from "@/domain/analysis/types";
import type { NameSyllable } from "@/domain/pinyin-name";

/** 90 分以上 great，80–89 ok，80 以下 change（11-01 起；原来 75 起算 ok） */
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
  /** 毛病出在读音上（谐音、同音、娣、同调、连读），换同音字解决不了 */
  soundBound?: true;
}

/** 只念不扣的民间说法 */
export interface FolkNote {
  char: string;
  line: string;
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
  /** 全名带声调的拼音，如 wén hóng yàn，提词页用 */
  pinyin: string;
  deductions: Deduction[];
  folk: FolkNote[];
}

/**
 * 打分之后主播下一步推什么（2026-11-01 起改字交给模型判断，代码不再预先列「哪个字能换」）：
 *   none 90 分以上，已经很好，不用改
 *   ask  有读音上的硬伤（谐音、娣）：改一个字读音也会变，先问观众能不能接受，不接受就重新起名
 *   fix  其余低于 90 的：直接给「改一个字」，改哪个字、改一个字够不够，由模型看扣分理由判断
 */
export interface NextStep {
  kind: "none" | "fix" | "ask";
  /** 读音上的硬伤，「先问观众」时主播拿来解释 */
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
  /** 新名字带声调的全名拼音 */
  pinyin: string;
  /** 读音变没变：「读音不变」或「hóng → hōng」，主播跟观众说明用 */
  soundLine: string;
  score: number;
  band: ScoreBand;
  bandLabel: string;
  /** 一句理由，15 字上下，打分榜上显示 */
  why: string;
  /** 寓意：拆字、合起来的画面和祝福，主播在提词页上照着念 */
  meaning: string;
}

export type FixOutcome =
  | {
      ok: true;
      options: FixOption[];
      /** 模型判断改一个字解决不了时的原因，面板据此推重新起名 */
      unfixable?: string;
      message?: string;
      tookMs: number;
      /** 第一条改法核验通过的毫秒数；一条都没有就不给 */
      firstMs?: number;
    }
  | { ok: false; message: string };
