/**
 * 精简快速版（直播）专用类型。
 *
 * 与完整版彻底分开：这里只有「姓 + 性别 + 生日」三个输入，
 * 没有 NormalizedRequest、没有辈分/避讳/字数/具体要求。
 */

export type FastGender = "male" | "female";

/**
 * 一场直播记多少个「已经给过」的名字。一场约 130 轮 × 4 个名字（需求稿 §11.2.1），
 * 留 500 个就是整场都记得：不重复出名、抽起手字都靠它。前端和服务端共用这一个数。
 */
export const FAST_RECENT_MAX = 500;

/** 前端提交的原始输入，字段都可能缺 */
export interface FastFormInput {
  surname?: string;
  gender?: string;
  birthday?: string;
  /** 这一场已经给过的名字，旧 → 新（服务端最多留最近 FAST_RECENT_MAX 个） */
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

/**
 * 「字出」：名字里某一个字在经典里的一句原文，如「婉」字见《诗经·郑风·野有蔓草》：有美一人，婉如清扬。
 * 只说这一个字出自哪里，不说整个名字出自哪里。句子来自事先逐字核过的表 src/config/seed-lines.json，
 * 运行时只是查表，不花模型时间。
 */
export interface FastCharSource {
  char: string;
  /** 展示用出处，如「《诗经·郑风·野有蔓草》」「王维《山居秋暝》」 */
  from: string;
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
  /** 字出：名字里有字在原句表里才有；起手字优先 */
  charSource?: FastCharSource;
  /** 命中当前热门字，排序时压低 */
  hotChar: boolean;
}

/** 排查用：模型给了几个、过闸几个、每个被拦的原因。页面不展示，探针打出来看 */
export interface FastDebug {
  /** 模型返回的候选数 */
  drafted: number;
  /** 过闸且没重名的 */
  kept: number;
  /** 带原句的候选数（line 非空），这个数决定出处够不够 */
  withLine: number;
  /** 推理字数：3–5 秒的预算主要花在这上面 */
  reasoningChars: number;
  /** 首字到达毫秒数：网关排队的地板 */
  firstTokenMs: number;
  /** 是否因为截断/解析失败重跑过一次 */
  retried: boolean;
  /** 第一路 5 秒没回，补发过第二路 */
  hedged: boolean;
  /** 最后用的是补发的那一路 */
  hedgeWon: boolean;
  dropped: { name: string; reasons: string[] }[];
  /** 这一轮给模型的起手字 */
  seeds: string[];
  /** 起手字轮回时提醒模型别再出的名字 */
  avoid: string[];
  /** 最近配得太多、这一轮提醒别用的字 */
  tired: string[];
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
  debug?: FastDebug;
}

export interface FastFailure {
  ok: false;
  code: "BAD_INPUT" | "NO_CANDIDATE" | "UPSTREAM";
  message: string;
  /** NO_CANDIDATE 时带上，看是模型给少了还是全被闸门拦了 */
  debug?: FastDebug;
}

/** 精简直播：真实发生过的阶段。加载页只许显示这些，不许演 */
export type FastStageEvent =
  | { stage: "draft"; drafted: number }
  | { stage: "gate"; drafted: number; kept: number; dropped: { name: string; reasons: string[] }[] }
  | { stage: "cite"; withLine: number; missing: number };

export type FastResult = FastSuccess | FastFailure;
