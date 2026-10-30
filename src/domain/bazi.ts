import { Solar } from "lunar-javascript";
import type { BaziSummary, NormalizedRequest } from "./types";

export type BaziResult =
  | { ok: true; summary: BaziSummary }
  | { ok: false; message: string };

/**
 * Optional, restrained bazi summary. No iron-mouth / 用神定论 language.
 *
 * 四柱由 lunar-javascript 按真实历法计算（年柱以立春、月柱以节气为界）。
 * 旧报告由哈希拼干支生成，没有 engine 字段，报告页据此区分，不能套用新标签。
 */

/** 十二时辰 → 代表时刻（取每段中点；子时取 00:30 属早子时）与起止小时 */
const SHICHEN: Record<string, { mid: [number, number]; start: number; end: number }> = {
  子: { mid: [0, 30], start: 23, end: 1 },
  丑: { mid: [2, 0], start: 1, end: 3 },
  寅: { mid: [4, 0], start: 3, end: 5 },
  卯: { mid: [6, 0], start: 5, end: 7 },
  辰: { mid: [8, 0], start: 7, end: 9 },
  巳: { mid: [10, 0], start: 9, end: 11 },
  午: { mid: [12, 0], start: 11, end: 13 },
  未: { mid: [14, 0], start: 13, end: 15 },
  申: { mid: [16, 0], start: 15, end: 17 },
  酉: { mid: [18, 0], start: 17, end: 19 },
  戌: { mid: [20, 0], start: 19, end: 21 },
  亥: { mid: [22, 0], start: 21, end: 23 },
};

const WUXING = ["木", "火", "土", "金", "水"] as const;

interface HourPoint {
  hour: number;
  minute: number;
  /** 只精确到时辰（直播台传「巳时 9–11」这类文本）时为 true */
  coarse: boolean;
  branch?: string;
  /** 该时辰覆盖的起止小时，用于查年月柱是否跨界 */
  range?: { from: number; to: number };
}

interface Chart {
  year: string;
  month: string;
  day: string;
  time: string;
  /** 各柱的干、支五行，顺序：年 月 日 时 */
  wuxing: string[];
}

function chartAt(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
): Chart {
  const eightChar = Solar.fromYmdHms(
    date.year,
    date.month,
    date.day,
    hour,
    minute,
    0,
  )
    .getLunar()
    .getEightChar();
  // 夜子时（23 点后）日柱归次日，与 baby-name-skill 时辰表的早晚子时约定一致
  eightChar.setSect(1);

  return {
    year: eightChar.getYear(),
    month: eightChar.getMonth(),
    day: eightChar.getDay(),
    time: eightChar.getTime(),
    wuxing: [
      eightChar.getYearWuXing(),
      eightChar.getMonthWuXing(),
      eightChar.getDayWuXing(),
      eightChar.getTimeWuXing(),
    ],
  };
}

/** 直播台传的是「巳时 9–11」这类文本，正式页可能传 09:00 或 9，两者都要认。 */
function parseBirthHour(raw?: string): HourPoint | null {
  const value = raw?.trim();
  if (!value) return null;

  const branchChar = [...value].find((ch) => ch in SHICHEN);
  if (branchChar) {
    const { mid, start, end } = SHICHEN[branchChar];
    return {
      hour: mid[0],
      minute: mid[1],
      coarse: true,
      branch: branchChar,
      range: { from: start, to: end },
    };
  }

  const match = value.match(/(\d{1,2})\s*(?:[:：]\s*(\d{1,2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  return { hour, minute, coarse: false };
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
  return tally
    .filter(([, n]) => n > 0)
    .map(([w, n]) => `${w}${n}`)
    .join(" ");
}

/** 出生时刻不确定时，年月柱可能跨立春/节气，日柱可能跨两日，都要显式说出来 */
function crossBoundaryNotes(charts: Chart[], where: string): string[] {
  const { years, months, days } = distinctPillars(charts);
  const notes: string[] = [];
  if (years.length > 1) {
    notes.push(
      `年柱可能为 ${years.join(" 或 ")}（${where}，跨立春），建议用精确出生时间确认。`,
    );
  }
  if (months.length > 1) {
    notes.push(
      `月柱可能为 ${months.join(" 或 ")}（${where}，跨节气交接），建议用精确出生时间确认。`,
    );
  }
  if (days.length > 1) {
    notes.push(`日柱可能为 ${days.join(" 或 ")}（${where}），建议用精确出生时间确认。`);
  }
  return notes;
}

function distinctPillars(charts: Chart[]): {
  years: string[];
  months: string[];
  days: string[];
} {
  const uniq = (pick: (c: Chart) => string) => [...new Set(charts.map(pick))];
  return { years: uniq((c) => c.year), months: uniq((c) => c.month), days: uniq((c) => c.day) };
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
  const main = chartAt(date, point?.hour ?? 0, point?.minute ?? 0);

  const notes: string[] = [];

  // 1. 精度说明
  if (!point) {
    notes.push("未填时辰：只排年月日六字，时柱空缺，日柱也可能因出生时段未知而偏差。");
  } else if (point.coarse) {
    const hh = String(point.hour).padStart(2, "0");
    const mm = String(point.minute).padStart(2, "0");
    notes.push(
      `时辰按「${point.branch}时」中点 ${hh}:${mm} 估算，时柱精度受时辰粒度限制。`,
    );
  } else {
    notes.push(
      `出生时间按 ${String(point.hour).padStart(2, "0")}:${String(point.minute).padStart(2, "0")} 计算。`,
    );
  }

  // 2. 跨界检查：出生时刻不确定时年月柱/日柱都可能换。
  //    必须同时看时段起点、中点、终点——节气可能落在时段前半段。
  let charts: Chart[] = [main];
  if (!point) {
    const open = chartAt(date, 0, 0);
    const close = chartAt(date, 23, 59);
    charts = [open, main, close];
    notes.push(...crossBoundaryNotes(charts, "出生时刻未填"));
  } else if (point.coarse) {
    if (point.branch === "子") {
      // 子时横跨两日：早子（当日 00:30）与夜子（当日 23:30，日柱已归次日）
      const late = chartAt(date, 23, 30);
      charts = [main, late];
      notes.push(...crossBoundaryNotes(charts, "子时横跨两日"));
      notes.push("子时按早子时（00:30）估算；若实际生于 23 点后，日柱应顺延一日。");
    } else {
      const start = chartAt(date, point.range!.from % 24, 0);
      // 该时辰时段的最后一分钟（不跨入下一个时辰）
      const end = chartAt(date, point.range!.to - 1, 59);
      charts = [start, main, end];
      notes.push(...crossBoundaryNotes(charts, `「${point.branch}时」时段内`));
    }
  } else if (point.hour >= 23) {
    notes.push("出生时间在 23 点后，按夜子时处理：日柱已归次日。");
  }

  // 3. 排盘规则
  notes.push("年柱以立春为界、月柱以节气为界，按公历生日计算。");

  // 4. 五行本气
  notes.push(
    `干支本气五行（不含藏干加权）：${countWuXing(point ? main.wuxing : main.wuxing.slice(0, 3))}。`,
  );

  notes.push("命理部分仅作温和参考，命名决策请以音形义与家庭规则为主。");

  const pillarsText = point
    ? `${main.year} ${main.month} ${main.day} ${main.time}`
    : `${main.year} ${main.month} ${main.day}`;

  // 柱子不止一种时，把备选留给调用方（兜底文案、提示词）用，避免把其中一组写成确定结果
  const { years, months, days } = distinctPillars(charts);
  const pillarOptions =
    years.length > 1 || months.length > 1 || days.length > 1
      ? { year: years, month: months, day: days }
      : undefined;

  return {
    ok: true,
    summary: {
      enabled: true,
      engine: "lunar-javascript",
      precision: point ? "full_eight" : "six_limited",
      pillarsText,
      ...(pillarOptions ? { pillarOptions } : {}),
      notes,
      restrainedAdvice: "若关心五行平衡，可把排盘当作背景信息，与名字音形义交叉看，而不当作唯一标准。",
    },
  };
}
