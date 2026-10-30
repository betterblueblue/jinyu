import { Solar } from "lunar-javascript";
import type { BaziSummary, NormalizedRequest } from "./types";

export type BaziResult =
  | { ok: true; summary: BaziSummary }
  | { ok: false; message: string };

/**
 * Optional, restrained bazi summary. No iron-mouth / 用神定论 language.
 *
 * 四柱由 lunar-javascript 按真实历法计算（年柱以立春、月柱以节气为界），
 * 不再用哈希拼示意干支；模型只负责对已算好的柱做克制解释。
 */

/** 十二时辰 → 代表时刻（取每段中点；子时取 00:30 属早子时） */
const SHICHEN_MID: Record<string, [number, number]> = {
  子: [0, 30],
  丑: [2, 0],
  寅: [4, 0],
  卯: [6, 0],
  辰: [8, 0],
  巳: [10, 0],
  午: [12, 0],
  未: [14, 0],
  申: [16, 0],
  酉: [18, 0],
  戌: [20, 0],
  亥: [22, 0],
};

const WUXING = ["木", "火", "土", "金", "水"] as const;

interface HourPoint {
  hour: number;
  minute: number;
  /** 用于提示的精度说明，例如「巳时 中点 10:00」 */
  note: string;
  /** 是否只精确到时辰 */
  coarse: boolean;
}

/** 直播台传的是「巳时 9–11」这类文本，正式页可能传 09:00 或 9，两者都要认。 */
function parseBirthHour(raw?: string): HourPoint | null {
  const value = raw?.trim();
  if (!value) return null;

  const branchChar = [...value].find((ch) => ch in SHICHEN_MID);
  if (branchChar) {
    const [hour, minute] = SHICHEN_MID[branchChar];
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    return {
      hour,
      minute,
      note: `${branchChar}时按中点 ${hh}:${mm} 估算，时柱精度受时辰粒度限制`,
      coarse: true,
    };
  }

  const match = value.match(/(\d{1,2})\s*(?:[:：]\s*(\d{1,2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  return {
    hour,
    minute,
    note: `时辰按 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} 计算`,
    coarse: false,
  };
}

function parseBirthDate(raw?: string): { year: number; month: number; day: number } | null {
  const match = raw?.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // lunar-javascript 的历法表覆盖范围
  if (year < 1900 || year > 2100) return null;
  return { year, month, day };
}

function countWuXing(parts: string[]): string {
  const joined = parts.join("");
  const tally = WUXING.map((w) => [w, [...joined].filter((ch) => ch === w).length] as const);
  return tally.filter(([, n]) => n > 0).map(([w, n]) => `${w}${n}`).join(" ");
}

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

  const date = parseBirthDate(req.birthDate);
  if (!date) {
    return { ok: false, message: "生日格式无法识别，请填写公历日期（YYYY-MM-DD，1900–2100）" };
  }

  const point = parseBirthHour(req.birthHour);

  const solar = Solar.fromYmdHms(
    date.year,
    date.month,
    date.day,
    point?.hour ?? 0,
    point?.minute ?? 0,
    0,
  );
  const eightChar = solar.getLunar().getEightChar();
  // 夜子时（23 点后）日柱归次日，与时辰表约定一致
  eightChar.setSect(1);

  const yearPillar = eightChar.getYear();
  const monthPillar = eightChar.getMonth();
  const dayPillar = eightChar.getDay();
  const hourPillar = point ? eightChar.getTime() : null;

  const pillarsText = hourPillar
    ? `${yearPillar} ${monthPillar} ${dayPillar} ${hourPillar}`
    : `${yearPillar} ${monthPillar} ${dayPillar}`;

  const notes: string[] = [];
  if (!point) {
    notes.push("未填时辰：仅排年月日六字，精度有限，仅供参考。");
  } else {
    notes.push(point.note + "。");
  }
  notes.push("年柱以立春为界、月柱以节气为界，按公历生日计算。");
  notes.push(
    `干支本气五行（不含藏干加权）：${countWuXing([
      eightChar.getYearWuXing(),
      eightChar.getMonthWuXing(),
      eightChar.getDayWuXing(),
      ...(hourPillar ? [eightChar.getTimeWuXing()] : []),
    ])}。`,
  );
  if (point && hourPillar?.endsWith("子")) {
    notes.push("时辰落在子时：按早子时（00:30）估算；若实际生于 23 点后，日柱应顺延一日。");
  }
  notes.push("命理部分仅作温和参考，命名决策请以音形义与家庭规则为主。");

  return {
    ok: true,
    summary: {
      enabled: true,
      precision: point ? "full_eight" : "six_limited",
      pillarsText,
      notes,
      restrainedAdvice: "若关心五行平衡，可把排盘当作背景信息，与名字音形义交叉看，而不当作唯一标准。",
    },
  };
}
