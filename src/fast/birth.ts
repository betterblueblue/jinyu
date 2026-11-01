import { Solar } from "lunar-javascript";

/**
 * 直播起名用到的生日信息：只到出生时节（季节、节气）。
 *
 * 直播只能讲属相和季节（总体方案 A5，《网络主播行为规范》第十四条第二十一项），
 * 所以给模型的也只到这一层：让名字呼应出生的时节，主播讲得出口（「春天出生，……」）。
 * 不给四柱，不按属相挑字：那是八字、生肖起名的路子，直播讲不了。
 *
 * 季节和观众屏幕上「生在春天」那一行同一个口径：按节气分月（立春到惊蛰是春天，清明那个月是春末……）。
 */

const SEASON_BY_JIE: Record<string, string> = {
  立春: "春天",
  惊蛰: "春天",
  清明: "春末",
  立夏: "夏天",
  芒种: "夏天",
  小暑: "夏末",
  立秋: "秋天",
  白露: "秋天",
  寒露: "秋末",
  立冬: "冬天",
  大雪: "冬天",
  小寒: "冬末",
};

export interface BirthTime {
  /** 春天、春末、夏天……，和屏幕上那行一样 */
  season: string;
  /** 出生前最近的一个节气（节和中气都算），如「惊蛰」 */
  jieqi: string;
}

/**
 * 呼应出生时节的起手字：每个季节几个，都在起手字表（config/seed-chars.json）里，按男女分。
 * 填了生日时，这一轮的第一个起手字从这里抽（seeds.ts），首推优先用带这个字的名字（run.ts），
 * 提词页的稿子顺着讲一句时节（talk.ts）。
 *
 * 为什么不在提示词里让模型「呼应时节」：2026-11-01 交替评测，有生日的轮次加了这一句，
 * 推理中位从 226 字涨到 550 字、中位耗时 3.4 → 5.6 秒。换成起手字，提示词一个字不加。
 */
const SEASON_SEEDS: Record<"春" | "夏" | "秋" | "冬", Record<"male" | "female", readonly string[]>> = {
  春: { female: [..."晴煦青景熙棠"], male: [..."晴煦青景熙启"] },
  夏: { female: [..."荷槿朗光竹"], male: [..."朗光澈皓"] },
  秋: { female: [..."澄月皓清"], male: [..."澄皓清穆"] },
  冬: { female: [..."雪冰暖煦"], male: [..."松柏煦"] },
};

export function seasonSeeds(time: BirthTime, gender: "male" | "female"): readonly string[] {
  const key = time.season[0] as keyof typeof SEASON_SEEDS;
  return SEASON_SEEDS[key]?.[gender] ?? [];
}

/** birthday 是 YYYY-MM-DD；格式不对或算不出来返回 null */
export function birthTimeOf(birthday: string): BirthTime | null {
  const m = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  try {
    const lunar = Solar.fromYmd(Number(m[1]), Number(m[2]), Number(m[3])).getLunar();
    const season = SEASON_BY_JIE[lunar.getPrevJie().getName()];
    const jieqi = lunar.getPrevJieQi(true).getName();
    return season && jieqi ? { season, jieqi } : null;
  } catch {
    return null;
  }
}
