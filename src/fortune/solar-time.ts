import type { LocalTime } from "./types";

/**
 * 钟表时间 → 北京标准时 → 出生地真太阳时。
 *
 * 真太阳时 = 北京时间 + 经度时差（(经度 − 120°) × 4 分钟）+ 均时差。
 * 均时差是地球公转轨道偏心和黄赤交角造成的，一年里在 −14 到 +16 分钟之间摆动。
 *
 * 全部按「不带时区的年月日时分」做加减，借 Date.UTC 只为进位，不受服务器时区影响。
 */

const MINUTE = 60_000;

export function toMs(t: LocalTime): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
}

export function fromMs(ms: number): LocalTime {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function addMinutes(t: LocalTime, minutes: number): LocalTime {
  return fromMs(toMs(t) + Math.round(minutes) * MINUTE);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLocal(t: LocalTime, withTime = true): string {
  const date = `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  return withTime ? `${date} ${pad(t.hour)}:${pad(t.minute)}` : date;
}

/** 某月第一个「几号及以后」的星期日 */
function sundayOnOrAfter(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return day + ((7 - weekday) % 7);
}

/**
 * 中国 1986–1991 年夏令时（IANA tz「PRC」规则，国务院公告核对过）：
 * 1986 年 5 月 4 日起；1987–1991 年四月中旬第一个星期日起；都到九月中旬第一个星期日止，
 * 起止都在凌晨 2 点。期间钟表比北京标准时快 1 小时。
 */
export function chinaDstRange(year: number): { start: LocalTime; end: LocalTime } | null {
  if (year < 1986 || year > 1991) return null;
  const startDay = year === 1986 ? 4 : sundayOnOrAfter(year, 4, 11);
  const startMonth = year === 1986 ? 5 : 4;
  return {
    start: { year, month: startMonth, day: startDay, hour: 2, minute: 0 },
    // 结束时钟表从夏令时的 2 点拨回 1 点，所以按钟表读数比到 2 点为止
    end: { year, month: 9, day: sundayOnOrAfter(year, 9, 11), hour: 2, minute: 0 },
  };
}

export function isChinaDst(clock: LocalTime): boolean {
  const range = chinaDstRange(clock.year);
  if (!range) return false;
  const ms = toMs(clock);
  return ms >= toMs(range.start) && ms < toMs(range.end);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * 均时差（分钟），NOAA 太阳位置算法（Meeus 第 28 章的近似式），误差在半分钟以内。
 * utcMs 为世界时的毫秒数。
 */
export function equationOfTimeMinutes(utcMs: number): number {
  const jd = utcMs / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525;
  const l0 = ((280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
  const y = Math.tan(rad(obliquity / 2)) ** 2;
  const eq =
    y * Math.sin(2 * rad(l0)) -
    2 * e * Math.sin(rad(m)) +
    4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) -
    0.5 * y * y * Math.sin(4 * rad(l0)) -
    1.25 * e * e * Math.sin(2 * rad(m));
  return (4 * eq * 180) / Math.PI;
}

export interface SolarTimeResult {
  dst: boolean;
  standard: LocalTime;
  longitudeMinutes: number;
  equationMinutes: number;
  trueSolar: LocalTime;
}

export function toTrueSolarTime(clock: LocalTime, longitude: number): SolarTimeResult {
  const dst = isChinaDst(clock);
  const standard = dst ? addMinutes(clock, -60) : clock;
  const utcMs = toMs(standard) - 8 * 60 * MINUTE;
  const longitudeMinutes = (longitude - 120) * 4;
  const equationMinutes = equationOfTimeMinutes(utcMs);
  return {
    dst,
    standard,
    longitudeMinutes,
    equationMinutes,
    trueSolar: addMinutes(standard, longitudeMinutes + equationMinutes),
  };
}
