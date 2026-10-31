import { isCjk } from "./chars";
import type { AnalysisGender, AnalysisInput } from "./types";

/**
 * 名字打分和改字共用的输入校验（/api/analyze/score、/api/analyze/fix）。
 *
 * 以前这里还有「详细解读」的模型分析编排，2026-10-31 随功能一起删了（用户定）：
 * 解读和规则打分对不上，当着观众很尴尬。
 */

export function validateAnalysisInput(raw: {
  fullName?: unknown;
  gender?: unknown;
  birthDate?: unknown;
  birthHour?: unknown;
  splitSurname?: unknown;
}): { ok: true; input: AnalysisInput } | { ok: false; message: string } {
  const fullName = String(raw.fullName ?? "").replace(/\s/g, "");
  if (!fullName) return { ok: false, message: "请填写姓名" };
  if (fullName.length < 2 || fullName.length > 4) return { ok: false, message: "姓名请填两到四个字" };
  for (const ch of fullName) {
    if (!isCjk(ch)) return { ok: false, message: "姓名里只能有汉字" };
  }
  const gender: AnalysisGender =
    raw.gender === "male" || raw.gender === "female" ? raw.gender : "unknown";

  const birthDate = typeof raw.birthDate === "string" && raw.birthDate ? raw.birthDate : undefined;
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { ok: false, message: "生日请填公历，格式 1998-03-05" };
  }

  // 界面上的拆法切换：只接受姓的前缀，避免把整名拆成不合法的形状
  const rawSurname = typeof raw.splitSurname === "string" ? raw.splitSurname.replace(/\s/g, "") : "";
  const surnameOverride =
    rawSurname && rawSurname.length <= 2 && fullName.startsWith(rawSurname) && fullName.length > rawSurname.length
      ? rawSurname
      : undefined;

  return {
    ok: true,
    input: {
      fullName,
      gender,
      ...(birthDate ? { birthDate } : {}),
      ...(typeof raw.birthHour === "string" && raw.birthHour ? { birthHour: raw.birthHour } : {}),
      ...(surnameOverride ? { surnameOverride } : {}),
    },
  };
}
