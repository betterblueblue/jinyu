import { pinyin } from "pinyin-pro";
import list from "@/config/sensitive-names.json";

/**
 * 直播打分榜不打分的名字（2026-11-05）。
 *
 * 全名一字不差，或者带声调的读音一样（习进平），都算命中（用户定）。
 * 只用 pinyin-pro 和一份 JSON，不读文件：打分榜在浏览器里加行之前就要先查，接口那边再查一次。
 * 代价是和名单同名同调的普通观众也不打分，主播跳过就行。
 */

function reading(name: string): string {
  return pinyin(name, { toneType: "num", type: "array", surname: "head" }).join(" ");
}

const NAMES = new Set(list.names);
const READINGS = new Set(list.names.map(reading));

export function isSensitiveName(fullName: string): boolean {
  const name = fullName.replace(/\s/g, "");
  if (!name) return false;
  return NAMES.has(name) || READINGS.has(reading(name));
}

/** 屏幕上只说这一句，不解释为什么 */
export const SENSITIVE_NOTE = "这个名字不打分";
