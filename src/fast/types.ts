/**
 * 精简快速版（直播）专用类型。
 *
 * 与完整版彻底分开：这里只有「姓 + 性别 + 生日」三个输入，
 * 没有 NormalizedRequest、没有辈分/避讳/字数/具体要求。
 */

export type FastGender = "male" | "female";

/** 前端提交的原始输入，字段都可能缺 */
export interface FastFormInput {
  surname?: string;
  gender?: string;
  birthday?: string;
  /** 这一场已经给过的名字，取名时避开（最多取前 12 个） */
  recent?: string[];
}

/** 校验通过后的输入 */
export interface FastRequest {
  surname: string;
  gender: FastGender;
  /** 公历生日 YYYY-MM-DD，可选；有才排盘 */
  birthday?: string;
}

/** 出处：quote 一律从语料原文里截，不是模型抄的 */
export interface FastCitation {
  source: string;
  piece: string;
  quote: string;
  line: string;
}

export interface FastCandidate {
  givenName: string;
  fullName: string;
  pinyin: string;
  /** 需要主播核对读音时的提示，如「姓「曾」读 zēng」 */
  pinyinHint?: string;
  /** 一句「为什么好」，20 字内 */
  why: string;
  /** 没有可核出处时整个字段缺省，页面留白 */
  citation?: FastCitation;
  /** 命中当前热门字，排序时压低 */
  hotChar: boolean;
}

export interface FastSuccess {
  ok: true;
  surname: string;
  gender: FastGender;
  primary: FastCandidate;
  alternatives: FastCandidate[];
  /** 开生日时给一行「属相·季节」的温和提示，不影响取名 */
  baziLine?: string;
  tookMs: number;
  notes: string[];
}

export interface FastFailure {
  ok: false;
  code: "BAD_INPUT" | "NO_CANDIDATE" | "UPSTREAM";
  message: string;
}

export type FastResult = FastSuccess | FastFailure;
