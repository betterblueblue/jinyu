import { LunarUtil } from "lunar-javascript";
import type { Element } from "./types";

/** 干支基础表。十神、藏干、纳音、旬空直接用 lunar-javascript 的表，这里只放它没有直接给的。 */

export const GAN = "甲乙丙丁戊己庚辛壬癸";
export const ZHI = "子丑寅卯辰巳午未申酉戌亥";

export const GAN_ELEMENT: Record<string, Element> = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土",
  己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水",
};

/** 地支本气五行 */
export const ZHI_ELEMENT: Record<string, Element> = {
  子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火",
  午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水",
};

export const ELEMENTS: Element[] = ["木", "火", "土", "金", "水"];

const PRODUCES: Record<Element, Element> = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const CONTROLS: Record<Element, Element> = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

/** a 生 b */
export const produces = (a: Element): Element => PRODUCES[a];
/** a 克 b */
export const controls = (a: Element): Element => CONTROLS[a];
/** 生 e 的那一行（印） */
export const producerOf = (e: Element): Element => ELEMENTS.find((x) => PRODUCES[x] === e)!;
/** 克 e 的那一行（官杀） */
export const controllerOf = (e: Element): Element => ELEMENTS.find((x) => CONTROLS[x] === e)!;

export const isYangGan = (gan: string): boolean => GAN.indexOf(gan) % 2 === 0;

export function tenGod(dayGan: string, other: string): string {
  return LunarUtil.SHI_SHEN[dayGan + other] ?? "";
}

export function hiddenStems(zhi: string): string[] {
  return LunarUtil.ZHI_HIDE_GAN[zhi] ?? [];
}

export function naYin(ganzhi: string): string {
  return LunarUtil.NAYIN[ganzhi] ?? "";
}

export function xunKong(ganzhi: string): string {
  return LunarUtil.getXunKong(ganzhi) ?? "";
}

/** 十神按五行关系归成五类，强弱、喜忌都按类说 */
export type GodGroup = "比劫" | "印" | "食伤" | "财" | "官杀";

export function groupOf(dayElement: Element, e: Element): GodGroup {
  if (e === dayElement) return "比劫";
  if (e === producerOf(dayElement)) return "印";
  if (e === produces(dayElement)) return "食伤";
  if (e === controls(dayElement)) return "财";
  return "官杀";
}

export function elementOfGroup(dayElement: Element, group: GodGroup): Element {
  switch (group) {
    case "比劫":
      return dayElement;
    case "印":
      return producerOf(dayElement);
    case "食伤":
      return produces(dayElement);
    case "财":
      return controls(dayElement);
    case "官杀":
      return controllerOf(dayElement);
  }
}

/**
 * 十二长生。阳干从长生位顺行，阴干逆行。
 * 甲长生在亥、丙戊在寅、庚在巳、壬在申；乙在午、丁己在酉、辛在子、癸在卯。
 */
const CHANG_SHENG = ["长生", "沐浴", "冠带", "临官", "帝旺", "衰", "病", "死", "墓", "绝", "胎", "养"];
const CHANG_SHENG_START: Record<string, string> = {
  甲: "亥", 丙: "寅", 戊: "寅", 庚: "巳", 壬: "申",
  乙: "午", 丁: "酉", 己: "酉", 辛: "子", 癸: "卯",
};

export function changSheng(dayGan: string, zhi: string): string {
  const start = ZHI.indexOf(CHANG_SHENG_START[dayGan]);
  const at = ZHI.indexOf(zhi);
  if (start < 0 || at < 0) return "";
  const step = isYangGan(dayGan) ? at - start : start - at;
  return CHANG_SHENG[((step % 12) + 12) % 12];
}

/** 时辰：23–1 子、1–3 丑……按真太阳时的小时算 */
export function shichenOf(hour: number): string {
  return `${ZHI[Math.floor(((hour + 1) % 24) / 2)]}时`;
}

/** 年支 → 生肖 */
export const ZODIAC: Record<string, string> = {
  子: "鼠", 丑: "牛", 寅: "虎", 卯: "兔", 辰: "龙", 巳: "蛇",
  午: "马", 未: "羊", 申: "猴", 酉: "鸡", 戌: "狗", 亥: "猪",
};

/** 月支 → 当令五行（辰戌丑未四季月土旺） */
export const SEASON_ELEMENT: Record<string, Element> = {
  寅: "木", 卯: "木", 巳: "火", 午: "火", 申: "金", 酉: "金", 亥: "水", 子: "水",
  辰: "土", 戌: "土", 丑: "土", 未: "土",
};

/** e 在当令五行 season 下的旺相休囚死 */
export function seasonState(season: Element, e: Element): "旺" | "相" | "休" | "囚" | "死" {
  if (e === season) return "旺";
  if (produces(season) === e) return "相";
  if (produces(e) === season) return "休";
  if (controls(e) === season) return "囚";
  return "死";
}
