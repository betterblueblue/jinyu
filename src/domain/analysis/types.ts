export type AnalysisGender = "male" | "female" | "unknown";

export interface AnalysisInput {
  /** 完整姓名，含姓 */
  fullName: string;
  gender: AnalysisGender;
  birthDate?: string;
  birthHour?: string;
  /** 用户在界面上改过的拆法（姓），不填则用自动拆分 */
  surnameOverride?: string;
}

export interface NameSplit {
  surname: string;
  givenName: string;
  /** 其他可行拆法（三字名的复姓歧义），前端可切换 */
  alternatives: { surname: string; givenName: string }[];
}

export type IssueKind = "phonology" | "glyph" | "meaning" | "gender" | "era" | "popularity";

/** hard=真麻烦，建议改；cost=每次要付的一点小亏 */
export type IssueSeverity = "hard" | "cost";

export interface NameIssue {
  kind: IssueKind;
  severity: IssueSeverity;
  /** 一句说清是什么问题 */
  text: string;
  /** 可以往哪走，不写「必须改」 */
  hint?: string;
}

export interface VerifiedCitation {
  source: string;
  piece: string;
  quote: string;
  /** 原文里包含这句的整行 */
  line: string;
  /** 模型给的用法说明，可选 */
  gloss?: string;
  /** 模型给的篇名与原文实际位置不一致时，这里记原文位置 */
  corrected?: boolean;
}

export interface RejectedCitation {
  source: string;
  piece?: string;
  quote: string;
  reason: string;
}

/** hard=有硬伤 cost=无硬伤但有代价 fit=没有问题，只是还能更贴合 */
export type Verdict = "hard" | "cost" | "fit";

export interface GenderLeanFact {
  char: string;
  lean: "male" | "female" | "neutral";
}

export interface CharFact {
  char: string;
  strokes: number | null;
  /** 1=GB2312 一级 2=二级 0=表外 null=查不到（数据缺失或非汉字） */
  gb: 0 | 1 | 2 | null;
}

export interface AnalysisFacts {
  chars: CharFact[];
  lean: GenderLeanFact[];
  /** 姓名整体的性别倾向 */
  overallLean: "male" | "female" | "neutral" | "mixed";
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  input: AnalysisInput;
  split: NameSplit;
  verdict: Verdict;
  /** 开场一句的总评 */
  headline: string;
  /** 站得住的地方 */
  goodPoints: string[];
  issues: NameIssue[];
  citations: VerifiedCitation[];
  rejectedCitations: RejectedCitation[];
  /** 结尾一句 */
  closing: string;
  /** verdict=fit 时说明还能贴合哪里 */
  fitAngle?: string;
  regenBrief: {
    tabooChars: string[];
    requirements: string;
    avoidPopular: boolean;
  };
  facts: AnalysisFacts;
  providerName?: string;
}

export interface AnalysisFailure {
  ok: false;
  errorCode: string;
  message: string;
}

export type AnalysisOutcome = { ok: true; result: AnalysisResult } | AnalysisFailure;
