/**
 * 八字排盘与解读（独立功能，入口 /bazi）。
 *
 * 和取名里的 src/domain/bazi.ts 是两回事：那边只给取名做克制的背景摘要，
 * 这里按出生地做真太阳时校正，排完整命盘、大运流年，再交给模型解读。
 */

export type Gender = "male" | "female";
export type Element = "木" | "火" | "土" | "金" | "水";
export type PillarKey = "year" | "month" | "day" | "time";

/** 校验过的表单 */
export interface FortuneInput {
  name: string;
  gender: Gender;
  /** 公历，按出生证上的钟表时间（北京时间）填 */
  date: { year: number; month: number; day: number };
  hour: number;
  /** null = 只知道几点，不知道几分 */
  minute: number | null;
  placeCode: string;
}

export interface Place {
  code: string;
  /** 如 ["浙江省", "杭州市", "西湖区"] */
  path: string[];
  lng: number;
  lat: number;
  /** 区划已撤并（仍可选，方便按出生时的地名找） */
  old: boolean;
  /** 原始数据缺坐标，用的是上一级的坐标 */
  approx: boolean;
}

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface TimeInfo {
  /** 用户填的钟表时间 */
  clock: LocalTime;
  minuteKnown: boolean;
  /** 1986–1991 夏令时期间出生，已减 1 小时 */
  dst: boolean;
  /** 北京时间（标准时） */
  standard: LocalTime;
  /** 经度时差，分钟，东正西负 */
  longitudeMinutes: number;
  /** 均时差，分钟 */
  equationMinutes: number;
  trueSolar: LocalTime;
  /** 真太阳时所在时辰，如「未时」 */
  shichen: string;
}

export interface HiddenStem {
  gan: string;
  element: Element;
  tenGod: string;
  /** 本气 / 中气 / 余气 */
  qi: string;
}

export interface Pillar {
  key: PillarKey;
  label: string;
  gan: string;
  zhi: string;
  ganzhi: string;
  ganElement: Element;
  zhiElement: Element;
  /** 天干十神；日柱为「日主」 */
  tenGod: string;
  hidden: HiddenStem[];
  naYin: string;
  /** 星运：日干在这一支的十二长生状态 */
  diShi: string;
  xunKong: string;
}

export type StrengthLevel = "极弱" | "身弱" | "偏弱" | "中和" | "偏强" | "身强" | "极旺";

export interface Strength {
  dayMaster: { gan: string; element: Element; yinYang: "阳" | "阴" };
  /** 加权力量占比（%，合计约 100） */
  shares: Record<Element, number>;
  /** 八个字明面上的五行个数（地支按本气） */
  counts: Record<Element, number>;
  /** 生扶日主（比劫 + 印）的占比，0–1 */
  supportRatio: number;
  level: StrengthLevel;
  /** 日主五行在月令的旺相休囚死 */
  season: { monthZhi: string; state: "旺" | "相" | "休" | "囚" | "死"; deLing: boolean };
  /** 通根：地支藏干里与日主同五行的 */
  roots: string[];
  /** 天干里的比劫、印 */
  helpers: string[];
  favorable: Element[];
  unfavorable: Element[];
  /** 为什么这样定喜忌，一两句 */
  method: string;
  tiaoHou?: { element: Element; text: string };
  /** 太弱或太旺时提醒：扶抑法未必适用 */
  caution?: string;
}

export interface Relation {
  kind: string;
  text: string;
}

export interface LuckStep {
  index: number;
  ganzhi: string;
  startYear: number;
  endYear: number;
  /** 虚岁 */
  startAge: number;
  endAge: number;
  ganTenGod: string;
  zhiTenGod: string;
  current: boolean;
}

export interface YearLuck {
  year: number;
  ganzhi: string;
  /** 虚岁 */
  age: number;
  ganTenGod: string;
  zhiTenGod: string;
  /** 所在大运干支；起运前为空 */
  luckGanzhi: string;
  relations: Relation[];
}

export interface FortuneChart {
  name: string;
  gender: Gender;
  /** 男为乾造，女为坤造 */
  genderLabel: "乾造" | "坤造";
  place: Place;
  time: TimeInfo;
  /** 农历（按北京时间的日期），如「一九九〇年四月廿一」 */
  lunarDate: string;
  zodiac: string;
  pillars: Pillar[];
  strength: Strength;
  relations: Relation[];
  luck: {
    forward: boolean;
    /** 如「出生后 7 年 2 个月 21 天起运」 */
    startText: string;
    /** 交运日期 YYYY-MM-DD */
    startDate: string;
    /** 起运前那几年（童限），可能为空 */
    pre: { startYear: number; endYear: number } | null;
    steps: LuckStep[];
  };
  years: YearLuck[];
  /** 出生前后的两个「节」，月柱据此划分 */
  jie: { prev: { name: string; time: string }; next: { name: string; time: string } };
  /** 出生时间有误差时可能变的柱子，没有就为空 */
  uncertain: string[];
  /** 换一种排法（不校正真太阳时、年月柱也用真太阳时）会得到的不同柱子，供和别的软件对照，不进解读 */
  crossCheck: string[];
  /** 排盘口径 */
  notes: string[];
}

export interface ReadingSection {
  key: "personality" | "career" | "wealth" | "relationship" | "health";
  title: string;
  basis: string;
  text: string;
}

export interface FortuneReading {
  overview: string;
  sections: ReadingSection[];
  luck: { ganzhi: string; text: string }[];
  years: { year: number; text: string }[];
  advice: string[];
  provider: string;
  /** 被措辞闸门删掉的句子数（寿命、血光、克夫这类） */
  removed: number;
}
