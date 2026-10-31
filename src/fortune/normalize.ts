import { findPlace, isPreciseEnough } from "./places";
import type { FortuneInput } from "./types";

export type ValidateResult = { ok: true; input: FortuneInput } | { ok: false; message: string };

/** 姓名只用来称呼：允许汉字、字母和少数民族姓名里的间隔号 */
const NAME_PATTERN = /^[\p{Script=Han}A-Za-z·•]{1,20}$/u;

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{1,2}$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** 北京时间的「现在」，用来挡未来的出生时间 */
function beijingNow(now: Date) {
  const d = new Date(now.getTime() + 8 * 3_600_000);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function validateFortuneInput(raw: Record<string, unknown>, now: Date = new Date()): ValidateResult {
  const name = String(raw.name ?? "").replace(/\s+/g, "");
  if (!name) return { ok: false, message: "请填写姓名" };
  if (!NAME_PATTERN.test(name)) return { ok: false, message: "姓名请填汉字或字母，最多 20 个字" };

  const gender = raw.gender;
  if (gender !== "male" && gender !== "female") return { ok: false, message: "请选择性别" };

  const dateText = typeof raw.birthDate === "string" ? raw.birthDate.trim() : "";
  const m = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, message: "请填写公历出生日期" };
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return { ok: false, message: "出生日期不存在，请检查" };
  }
  if (year < 1901) return { ok: false, message: "出生日期请在 1901 年以后" };

  const hour = toInt(raw.birthHour);
  if (hour === null || hour < 0 || hour > 23) return { ok: false, message: "请选择出生时间（几点）" };

  let minute: number | null = null;
  if (raw.birthMinute !== undefined && raw.birthMinute !== null && raw.birthMinute !== "") {
    minute = toInt(raw.birthMinute);
    if (minute === null || minute < 0 || minute > 59) return { ok: false, message: "分钟请填 0–59，不知道就留空" };
  }

  const today = beijingNow(now);
  if (dateText > today.date || (dateText === today.date && hour * 60 + (minute ?? 0) > today.minutes)) {
    return { ok: false, message: "出生时间不能晚于现在" };
  }

  const placeCode = typeof raw.placeCode === "string" ? raw.placeCode.trim() : "";
  if (!placeCode || !findPlace(placeCode)) return { ok: false, message: "请选择出生地" };
  if (!isPreciseEnough(placeCode)) return { ok: false, message: "出生地请至少选到城市，区县可以不选" };

  return { ok: true, input: { name, gender, date: { year, month, day }, hour, minute, placeCode } };
}
