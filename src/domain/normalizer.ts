import { z } from "zod";
import type { NamingFormInput, NormalizedRequest, StylePrototypeId } from "./types";

const styleIds = [
  "classical_elegant",
  "warm_clear",
  "scholarly_restrained",
  "modern_clean",
  "neutral_restrained",
  "default_dignified",
  "",
] as const;

export const namingFormSchema = z.object({
  surname: z.string().trim().min(1, "请填写姓氏"),
  gender: z.enum(["male", "female", "unknown"], {
    errorMap: () => ({ message: "请选择性别状态（男/女/未知）" }),
  }),
  birthStatus: z.enum(["born", "unborn", "uncertain"]).optional(),
  dueDate: z.string().optional(),
  nameLength: z.enum(["two", "one"]).optional(),
  baziEnabled: z.boolean().optional(),
  birthDate: z.string().optional(),
  birthHour: z.string().optional(),
  generationChar: z.string().optional(),
  generationPosition: z.enum(["first", "second", "any"]).optional(),
  tabooChars: z.string().optional(),
  stylePrototypeId: z.enum(styleIds).optional(),
  styleNotes: z.string().optional(),
  avoidPopular: z.boolean().optional(),
});

export type NormalizeOk = { ok: true; value: NormalizedRequest };
export type NormalizeErr = { ok: false; message: string; fieldErrors?: Record<string, string> };
export type NormalizeResult = NormalizeOk | NormalizeErr;

function splitTaboo(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s.length > 1 ? [...s] : [s]));
}

export function normalizeRequest(input: NamingFormInput): NormalizeResult {
  const parsed = namingFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    const first = parsed.error.issues[0]?.message ?? "表单填写有误";
    return { ok: false, message: first, fieldErrors };
  }

  const data = parsed.data;
  const surname = data.surname.trim();
  if ([...surname].length < 1 || [...surname].length > 2) {
    return { ok: false, message: "姓氏请填写 1～2 个汉字", fieldErrors: { surname: "姓氏请填写 1～2 个汉字" } };
  }

  const birthStatus = data.birthStatus ?? "born";
  const baziEnabled = Boolean(data.baziEnabled);
  const nameLength = data.nameLength ?? "two";
  const avoidPopular = data.avoidPopular !== false;

  if (baziEnabled && birthStatus === "unborn") {
    return {
      ok: false,
      message: "未出生时不能开启精确八字排盘；可先关闭八字，或改为已出生/不确定",
      fieldErrors: { baziEnabled: "未出生时不能开启精确八字排盘" },
    };
  }

  if (baziEnabled && !data.birthDate?.trim()) {
    return {
      ok: false,
      message: "开启八字后请填写公历生日",
      fieldErrors: { birthDate: "开启八字后请填写公历生日" },
    };
  }

  const generationChar = data.generationChar?.trim() || undefined;
  if (generationChar && [...generationChar].length !== 1) {
    return {
      ok: false,
      message: "辈分字请填写单个汉字",
      fieldErrors: { generationChar: "辈分字请填写单个汉字" },
    };
  }

  const stylePrototypeId = (data.stylePrototypeId || "default_dignified") as StylePrototypeId;

  const value: NormalizedRequest = {
    surname,
    gender: data.gender,
    birthStatus,
    dueDate: data.dueDate?.trim() || undefined,
    nameLength,
    baziEnabled,
    birthDate: data.birthDate?.trim() || undefined,
    birthHour: data.birthHour?.trim() || undefined,
    generationChar,
    generationPosition: data.generationPosition ?? "first",
    tabooChars: splitTaboo(data.tabooChars),
    stylePrototypeId,
    styleNotes: data.styleNotes?.trim() || undefined,
    avoidPopular,
    isPreparationName: birthStatus === "unborn",
  };

  return { ok: true, value };
}
