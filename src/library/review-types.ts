/**
 * 名字评审：起草（agent 写名字、出处、我的建议和原因）→ 核对生成评审批次 → 用户在 /review 逐个点「要 / 不要 / 拿不准」。
 * 起草和评审文件都在 data/name-library/v2/ 下，不进 git（data/ 整体忽略，沿用 10-30 的决定）。
 */

export type Suggestion = "要" | "不要" | "拿不准";
export type Verdict = "yes" | "no" | "unsure";
/**
 * 「要」的程度：很好 90 / 可以 80 / 一般 70。
 * 试评时用户自己在备注里写分（80、90、70），说明光有「要」不够分出好坏。进直播库按 80 分起算。
 */
export type Grade = 90 | 80 | 70;
export const GRADES: readonly Grade[] = [90, 80, 70];
export type ReviewGender = "male" | "female" | "neutral";

export interface ReviewCitation {
  /** 语料书名 id，如 shijing */
  s: string;
  /** 语料里的篇名（简体），用来定位那一篇 */
  t: string;
  /** 展示用出处，如「《诗经·邶风·静女》」「李白《行路难》」 */
  from: string;
  /** 原句 */
  line: string;
}

/** agent 起草的一条 */
export interface DraftItem {
  id: string;
  givenName: string;
  gender: ReviewGender;
  /** 这个名字从哪来：新起草 / 旧库定版里的 / 今天直播版出的 …… */
  origin: string;
  citation?: ReviewCitation;
  /** 一句口播寓意 */
  meaning: string;
  suggestion: Suggestion;
  pros: string[];
  cons: string[];
}

export interface DraftBatch {
  batch: string;
  title: string;
  note: string;
  items: DraftItem[];
}

/** 配上一个常见姓之后的样子：全名、拼音、按打分规则的分数和扣分理由 */
export interface ReviewSample {
  fullName: string;
  pinyin: string;
  score: number;
  deductions: { points: number; line: string }[];
}

export interface ReviewItem extends DraftItem {
  /** 名字的拼音（不带姓），带声调 */
  pinyin: string;
  /** 两个字在原句里的先后：same 同序，reversed 倒序 */
  order?: "same" | "reversed";
  samples: ReviewSample[];
}

export interface ReviewBatch {
  batch: string;
  title: string;
  note: string;
  builtAt: string;
  items: ReviewItem[];
}

export interface VerdictRecord {
  verdict: Verdict;
  /** 只有「要」才有；试评那一批没有这一项 */
  grade?: Grade;
  note?: string;
  at: string;
}

export type VerdictMap = Record<string, VerdictRecord>;
