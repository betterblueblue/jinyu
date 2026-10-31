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

export interface GenderLeanFact {
  char: string;
  lean: "male" | "female" | "neutral";
}
