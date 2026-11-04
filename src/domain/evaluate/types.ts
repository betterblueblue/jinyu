import type { AnalysisGender } from "@/domain/analysis/types";
import type { NameSyllable } from "@/domain/pinyin-name";

/**
 * 综合评分（第一版，离线）。
 *
 * 和旧的打分规则（src/domain/score）是两套东西，互不替换：
 *   旧规则算「100 减扣分」，用来查事实和硬伤；这里算「六个维度打分相加」，
 *   并由程序按已确认的严重问题压一个上限。旧扣分值不叠加进来。
 *
 * 模型只给四类档位：读音、字义、性别辨识、风格。识读、流行、谐音由程序按字表和词表分档。
 * 模型不输出任何分数，总分和上限都由程序算（2026-11-04 定）。
 */

/** 模型能判断的四类档位，值是这一维的得分 */
export interface TierChoice {
  tier: number;
  reason: string;
}

/** 六维的分数，气质 = 性别辨识 + 风格 */
export interface DimensionScores {
  pronunciation: number;
  meaning: number;
  gender: number;
  style: number;
  /** 气质适配 = gender + style */
  temperament: number;
  literacy: number;
  popularity: number;
  homophone: number;
}

export type EvalBand = "great" | "ok" | "change";

export interface ScoreBreakdown {
  dimensions: DimensionScores;
  /** 六项相加，不封顶（最高 100） */
  base: number;
  /** 风险上限；null 表示没有触发 */
  cap: number | null;
  capReason: string | null;
  /** min(base, cap ?? 100) */
  total: number;
  band: EvalBand;
  bandLabel: string;
}

/** 一条规则确认的问题，编号给模型引用（R1、R2……） */
export interface FactIssue {
  id: string;
  /** 主播能念的一句 */
  line: string;
  /** 规则 id（同 src/domain/score 的 ScoreRuleId） */
  rule: string;
  /** 严重程度：severe 会把总分压到 69，minor 压到 79，plain 只进维度 */
  severity: "severe" | "minor" | "plain";
  /** 落在名里的哪几个字；整名规则为空 */
  chars: string[];
}

/** 一个字的事实，交给模型看 */
export interface CharFact {
  char: string;
  simplified: string;
  /** 1 常用、2 次常用、0 表外、null 查不到 */
  gbLevel: 0 | 1 | 2 | null;
  /** 全部读音（带声调，去重） */
  readings: string[];
  strokes: number | null;
  lean: "male" | "female" | "neutral";
  /** 民俗说法：swap 档里除娣以外只作参考，不计分 */
  folk?: { tier: string; line: string };
}

/** 程序能确认的材料，先给模型，也给页面打底 */
export interface NameFacts {
  fullName: string;
  surname: string;
  givenName: string;
  gender: AnalysisGender;
  pinyin: string;
  syllables: NameSyllable[];
  chars: CharFact[];
  lean: { overall: "male" | "female" | "neutral" | "mixed"; maleCount: number; femaleCount: number };
  /** 规则确认的问题（编号 R1、R2……） */
  issues: FactIssue[];
  /** 只作提醒、不计分：民俗说法、生僻但常见度还能接受的字等 */
  reminders: string[];
  /** 程序算的三维（识读、流行、谐音） */
  program: {
    literacy: { score: number; reason: string };
    popularity: { score: number; reason: string };
    homophone: { score: number; reason: string };
  };
  /** 风险事实，候选验收和上限都用它 */
  risk: {
    /** 已确认的严重问题（谐音 30、严重不宜字、反面人物同名） */
    severe: FactIssue[];
    /** 已确认的一般问题（谐音 15、轻度不宜字、整名偏另一个性别） */
    minor: FactIssue[];
    /** 原文里有没有谐音问题，含严重和一般 */
    hasHomophone: boolean;
    /** 原文里有没有严重谐音 */
    hasSevereHomophone: boolean;
    /** 原文里有没有反面人物同名 */
    hasInfamous: boolean;
    /** 整名偏另一个性别（扣 25 那档）；mixed 只算混用 */
    genderMismatch: "whole" | "mixed" | null;
  };
  /** 撞烂大街名、热门字、年代感、大姓单名，只进流行维度 */
  popularityFacts: {
    template: boolean;
    hotChars: string[];
    era: { kind: "name" | "pair" | "single" | "char"; chars: string[] } | null;
    singleNameBigSurname: boolean;
    /** 整名是年代口号、职业或军种词（海军、建军、卫国） */
    eraWord: boolean;
  };
}

/** 模型写的原名评价，没核过 */
export interface RawOriginal {
  pronunciation?: unknown;
  meaning?: unknown;
  gender?: unknown;
  style?: unknown;
  strengths?: unknown;
  issues?: unknown;
  reminders?: unknown;
  /** 拆字：每个字在名字里的意思 */
  charMeaning?: unknown;
  /** 合起来：画面或说法，加一句爸妈的心意 */
  whole?: unknown;
  /** 像跟家长聊天一样的整段评价：好在哪、问题在哪、像哪类名字 */
  comment?: unknown;
}

/** 模型写的候选，没核过 */
export interface RawCandidate {
  givenName?: unknown;
  pronunciation?: unknown;
  meaning?: unknown;
  gender?: unknown;
  style?: unknown;
  solves?: unknown;
  keeps?: unknown;
  loss?: unknown;
  verdict?: unknown;
  why?: unknown;
  spoken?: unknown;
}

export interface RawEvaluation {
  status?: unknown;
  /** 顶层四个档位数字，模型先写这个，程序立刻算分上屏 */
  scores?: unknown;
  original?: RawOriginal;
  options?: unknown;
  note?: unknown;
}

/** 核过、算过分的原名评价 */
export interface OriginalEvaluation {
  scores: ScoreBreakdown;
  tiers: {
    pronunciation: TierChoice;
    meaning: TierChoice;
    gender: TierChoice;
    style: TierChoice;
  };
  /** 主要优点，主播先念这个 */
  strengths: string[];
  /** 问题和重要程度；规则确认的带 R 编号 */
  issues: EvalIssue[];
  /** 只提醒不计分的谐音和联想 */
  reminders: string[];
  /** 拆字：每个字在名字里的意思，提词页念 */
  charMeaning?: string;
  /** 合起来：画面或说法，提词页念 */
  whole?: string;
  /** 像跟家长聊天一样的整段评价，提词页先念这一段 */
  comment?: string;
}

export interface EvalIssue {
  id: string;
  text: string;
  importance: "major" | "minor";
  source: "rule" | "model";
}

/** 核过、算过分的候选 */
export interface EvalCandidate {
  fullName: string;
  givenName: string;
  /** 换掉的字 */
  from: string;
  /** 换上的字 */
  to: string;
  /** 在名里的位置，0 起 */
  index: number;
  pinyin: string;
  /** 读音变没变：「读音不变」或「hóng → hōng」 */
  soundLine: string;
  scores: ScoreBreakdown;
  tiers: {
    pronunciation: TierChoice;
    meaning: TierChoice;
    gender: TierChoice;
    style: TierChoice;
  };
  /** 解决了哪几个问题（R 编号） */
  solves: string[];
  /** 保住了原名哪几个优点 */
  keeps: string[];
  /** 损失与取舍 */
  loss: string;
  /** 一句理由，主播在榜上念 */
  why: string;
  /** 寓意，提词页照着念 */
  spoken: string;
  /** 模型原始的比较结论 */
  verdict: "better" | "similar" | "worse";
  /** 程序算出的提升分 */
  gain: number;
}

export interface RejectedCandidate {
  givenName: string;
  /** 哪几条没通过 */
  reasons: string[];
  /** 算出来的分，方便看差多少 */
  total?: number;
}

export type EvalStatus =
  | "options"
  | "no_better"
  | "all_rejected"
  | "one_char_insufficient"
  | "needs_gender"
  | "error"
  | "timeout";

export interface EvaluateResult {
  facts: NameFacts;
  status: EvalStatus;
  /** 模型评价成功才有；失败时为 null，页面只显示事实 */
  original: OriginalEvaluation | null;
  /** 通过验收的候选，按综合分降序 */
  candidates: EvalCandidate[];
  rejected: RejectedCandidate[];
  /** 模型说的情况说明，或者失败原因 */
  note?: string;
  tookMs: number;
}
