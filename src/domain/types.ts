export type Gender = "male" | "female" | "unknown";
export type BirthStatus = "born" | "unborn";
export type NameLengthMode = "two" | "one";
export type GenerationCharPosition = "first" | "second" | "any";

export type StylePrototypeId =
  | "classical_elegant"
  | "warm_clear"
  | "scholarly_restrained"
  | "modern_clean"
  | "neutral_restrained"
  | "default_dignified";

export interface NamingFormInput {
  surname: string;
  gender: Gender;
  birthStatus?: BirthStatus;
  dueDate?: string;
  nameLength?: NameLengthMode;
  baziEnabled?: boolean;
  birthDate?: string;
  birthHour?: string;
  generationChar?: string;
  generationPosition?: GenerationCharPosition;
  tabooChars?: string;
  stylePrototypeId?: StylePrototypeId | "";
  styleNotes?: string;
  avoidPopular?: boolean;
}

export interface NormalizedRequest {
  surname: string;
  gender: Gender;
  birthStatus: BirthStatus;
  dueDate?: string;
  nameLength: NameLengthMode;
  baziEnabled: boolean;
  birthDate?: string;
  birthHour?: string;
  generationChar?: string;
  generationPosition: GenerationCharPosition;
  tabooChars: string[];
  stylePrototypeId: StylePrototypeId;
  styleNotes?: string;
  avoidPopular: boolean;
  isPreparationName: boolean;
}

export interface RawCandidate {
  givenName: string;
  genderLean?: "male" | "female" | "neutral";
  /** 标准拼音（如「舒窈」→ shū yǎo），生僻字也能读 */
  pinyin?: string;
  phonology?: string;
  glyph?: string;
  meaning?: string;
  origin?: string;
  pitfalls?: string;
  styleFit?: string;
  /** 开启八字时模型输出的与生辰气质的呼应（克制表述），未开启时为 undefined */
  baziFit?: string;
}

export interface GatedCandidate extends RawCandidate {
  fullName: string;
  l2Hot?: boolean;
  eliminated?: boolean;
  eliminateReasons?: string[];
}

export interface EliminationNote {
  givenName: string;
  reasons: string[];
}

export interface BaziSummary {
  enabled: true;
  precision: "full_eight" | "six_limited";
  pillarsText: string;
  notes: string[];
  restrainedAdvice: string;
}

export interface NameDetail {
  fullName: string;
  givenName: string;
  isPrimary: boolean;
  genderLean?: "male" | "female" | "neutral";
  /** 标准拼音（如「舒窈」→ shū yǎo） */
  pinyin?: string;
  phonology: string;
  glyph: string;
  meaning: string;
  origin: string;
  pitfalls: string;
  styleFit: string;
  baziFit?: string;
  l2Hot: boolean;
}

export interface ReportDocument {
  id: string;
  createdAt: string;
  request: NormalizedRequest;
  stages: string[];
  relaxations: string[];
  overview: {
    primaryName: string;
    names: string[];
    oneLiner: string;
    maleNames?: string[];
    femaleNames?: string[];
  };
  names: NameDetail[];
  notRecommended: EliminationNote[];
  bazi?: BaziSummary;
  decisionAdvice: string;
  preparationNote?: string;
  originDisclaimer: string;
  /** 生成来源 provider（"fake"=示例模式 / "stepfun" 等真实 provider），用于历史标注 */
  providerName?: string;
}

export interface ReportListItem {
  id: string;
  createdAt: string;
  surname: string;
  gender: Gender;
  nameSummary: string;
  providerName?: string;
}

export type GenerationStage = "candidates" | "filter" | "assemble";

export interface GenerationSuccess {
  ok: true;
  stage: GenerationStage;
  report: ReportDocument;
}

export interface GenerationFailure {
  ok: false;
  stage: GenerationStage;
  errorCode: string;
  message: string;
  relaxations?: string[];
}

export type GenerationResult = GenerationSuccess | GenerationFailure;
