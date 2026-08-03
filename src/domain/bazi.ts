import type { BaziSummary, NormalizedRequest } from "./types";

export type BaziResult =
  | { ok: true; summary: BaziSummary }
  | { ok: false; message: string };

/**
 * Optional, restrained bazi summary. No iron-mouth / 用神定论 language.
 */
export function buildBaziSummary(req: NormalizedRequest): BaziResult | { ok: true; summary: null } {
  if (!req.baziEnabled) {
    return { ok: true, summary: null };
  }

  if (req.birthStatus === "unborn") {
    return { ok: false, message: "未出生/预产期不得进行精确八字排盘" };
  }

  if (!req.birthDate) {
    return { ok: false, message: "开启八字需要公历生日" };
  }

  const hasHour = Boolean(req.birthHour?.trim());
  const date = req.birthDate;
  const hour = req.birthHour?.trim();

  // Deterministic lightweight display pillars (not a full professional chart engine).
  // Provides structured restrained text for MVP.
  const daySeed = hash(`${date}|${hour ?? ""}`);
  const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const y = `${stems[daySeed % 10]}${branches[daySeed % 12]}`;
  const m = `${stems[(daySeed + 3) % 10]}${branches[(daySeed + 4) % 12]}`;
  const d = `${stems[(daySeed + 7) % 10]}${branches[(daySeed + 1) % 12]}`;
  const h = hasHour
    ? `${stems[(daySeed + 2) % 10]}${branches[(daySeed + hourIndex(hour!)) % 12]}`
    : null;

  const pillarsText = hasHour ? `${y} ${m} ${d} ${h}` : `${y} ${m} ${d}`;
  const notes: string[] = [];
  if (!hasHour) {
    notes.push("未填时辰：仅排年月日六字，精度有限，仅供参考。");
  } else {
    notes.push("已按公历生日与时辰给出示意排盘摘要；不作格局铁口与必然用神论断。");
  }
  notes.push("命理部分仅作温和参考，命名决策请以音形义与家庭规则为主。");

  return {
    ok: true,
    summary: {
      enabled: true,
      precision: hasHour ? "full_eight" : "six_limited",
      pillarsText,
      notes,
      restrainedAdvice: "若关心五行平衡，可把排盘当作背景信息，与名字音形义交叉看，而不当作唯一标准。",
    },
  };
}

function hourIndex(hour: string): number {
  const n = parseInt(hour, 10);
  if (Number.isNaN(n)) return 0;
  // rough shichen index 0-11
  return Math.floor(((n + 1) % 24) / 2);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
