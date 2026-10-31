import { Solar } from "lunar-javascript";
import {
  GAN_ELEMENT,
  ZHI_ELEMENT,
  ZODIAC,
  changSheng,
  hiddenStems,
  isYangGan,
  naYin,
  shichenOf,
  tenGod,
  xunKong,
} from "./ganzhi";
import { findPlace } from "./places";
import { incomingRelations, natalRelations } from "./relations";
import { addMinutes, formatLocal, toTrueSolarTime } from "./solar-time";
import { computeStrength } from "./strength";
import type {
  FortuneChart,
  FortuneInput,
  LocalTime,
  LuckStep,
  Pillar,
  PillarKey,
  YearLuck,
} from "./types";

/**
 * 排盘。
 *
 * 口径：
 * - 年柱以立春、月柱以节为界，按北京标准时判断——节气交接是天文上的同一瞬间，不随出生地变；
 * - 日柱、时柱按出生地真太阳时；真太阳时 23 点后按次日日柱（子时换日，setSect(1)）；
 * - 大运按北京标准时算到上一个 / 下一个节的时长折算起运，阳男阴女顺排、阴男阳女逆排。
 */

interface Four {
  year: string;
  month: string;
  day: string;
  time: string;
}

const KEYS: PillarKey[] = ["year", "month", "day", "time"];
const LABEL: Record<PillarKey, string> = { year: "年柱", month: "月柱", day: "日柱", time: "时柱" };
const QI = ["本气", "中气", "余气"];

function eightCharAt(t: LocalTime) {
  return Solar.fromYmdHms(t.year, t.month, t.day, t.hour, t.minute, 0).getLunar().getEightChar();
}

function fourPillars(standard: LocalTime, trueSolar: LocalTime): Four {
  const std = eightCharAt(standard);
  const local = eightCharAt(trueSolar);
  local.setSect(1);
  return { year: std.getYear(), month: std.getMonth(), day: local.getDay(), time: local.getTime() };
}

function buildPillar(key: PillarKey, ganzhi: string, dayGan: string): Pillar {
  const gan = ganzhi[0];
  const zhi = ganzhi[1];
  return {
    key,
    label: LABEL[key],
    gan,
    zhi,
    ganzhi,
    ganElement: GAN_ELEMENT[gan],
    zhiElement: ZHI_ELEMENT[zhi],
    tenGod: key === "day" ? "日主" : tenGod(dayGan, gan),
    hidden: hiddenStems(zhi).map((g, i) => ({
      gan: g,
      element: GAN_ELEMENT[g],
      tenGod: tenGod(dayGan, g),
      qi: QI[i] ?? "",
    })),
    naYin: naYin(ganzhi),
    diShi: changSheng(dayGan, zhi),
    xunKong: xunKong(ganzhi),
  };
}

/** 由四柱干支直接建柱（测试和对照命例用） */
export function buildPillars(four: Four): Pillar[] {
  return KEYS.map((k) => buildPillar(k, four[k], four.day[0]));
}

const hm = (t: LocalTime) => formatLocal(t).slice(11);
const sig = (f: Four) => `${f.year}|${f.month}|${f.day}|${f.time}`;

interface Segment {
  from: LocalTime;
  to: LocalTime;
  four: Four;
}

/** 从钟表时间 from 起逐分钟排，柱子相同的连成一段 */
function scan(from: LocalTime, minutes: number, lng: number): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < minutes; i++) {
    const clock = addMinutes(from, i);
    const t = toTrueSolarTime(clock, lng);
    const four = fourPillars(t.standard, t.trueSolar);
    const last = segments[segments.length - 1];
    if (last && sig(last.four) === sig(four)) last.to = clock;
    else segments.push({ from: clock, to: clock, four });
  }
  return segments;
}

/** 各段之间有哪些柱子不同 */
function changedKeys(segments: Segment[]): PillarKey[] {
  return KEYS.filter((k) => new Set(segments.map((s) => s.four[k])).size > 1);
}

function describe(four: Four, keys: PillarKey[]): string {
  return keys.map((k) => `${LABEL[k]}${four[k]}`).join("、");
}

function uncertaintyNotes(input: FortuneInput, lng: number, main: Four): string[] {
  const notes: string[] = [];
  const date = { year: input.date.year, month: input.date.month, day: input.date.day };

  if (input.minute === null) {
    const segments = scan({ ...date, hour: input.hour, minute: 0 }, 60, lng);
    const keys = changedKeys(segments);
    if (keys.length) {
      const parts = segments.map((s) => `${hm(s.from)}–${hm(s.to)} 出生是${describe(s.four, keys)}`);
      notes.push(
        `只知道 ${input.hour} 点、不知道几分，这一小时里${keys.map((k) => LABEL[k]).join("、")}会变：${parts.join("；")}。下面按 ${String(input.hour).padStart(2, "0")}:30 排。`,
      );
    }
    return notes;
  }

  // 知道几分：前后 5 分钟内跨了交界就提醒，出生证上的时间常有几分钟出入
  const at = { ...date, hour: input.hour, minute: input.minute };
  const segments = scan(addMinutes(at, -5), 11, lng);
  const keys = changedKeys(segments);
  if (keys.length) {
    for (let i = 1; i < segments.length; i++) {
      const before = segments[i - 1];
      const after = segments[i];
      const ks = keys.filter((k) => before.four[k] !== after.four[k]);
      if (!ks.length) continue;
      notes.push(
        `出生时间离交界很近：钟表 ${hm(after.from)} 起，${ks
          .map((k) => `${LABEL[k]}由${before.four[k]}变为${after.four[k]}`)
          .join("、")}。出生时间若记早或记晚几分钟，这里会不同；当前按${describe(main, ks)}排。`,
      );
    }
  }
  return notes;
}

/** 起运时长：「出生后 7 年 2 个月 21 天起运」，零的部分不写 */
function startText(y: number, m: number, d: number): string {
  const parts = [y ? `${y} 年` : "", m ? `${m} 个月` : "", d ? `${d} 天` : ""].filter(Boolean);
  return parts.length ? `出生后 ${parts.join(" ")}起运` : "出生即起运";
}

function beijingYear(now: Date): number {
  return new Date(now.getTime() + 8 * 3_600_000).getUTCFullYear();
}

export function computeChart(input: FortuneInput, now: Date = new Date()): FortuneChart {
  const place = findPlace(input.placeCode);
  if (!place) throw new Error(`未知出生地：${input.placeCode}`);

  const minuteKnown = input.minute !== null;
  const clock: LocalTime = { ...input.date, hour: input.hour, minute: input.minute ?? 30 };
  const t = toTrueSolarTime(clock, place.lng);
  const four = fourPillars(t.standard, t.trueSolar);
  const dayGan = four.day[0];
  const pillars = KEYS.map((k) => buildPillar(k, four[k], dayGan));
  const strength = computeStrength(pillars);

  const stdLunar = Solar.fromYmdHms(
    t.standard.year,
    t.standard.month,
    t.standard.day,
    t.standard.hour,
    t.standard.minute,
    0,
  ).getLunar();
  const nowYear = beijingYear(now);

  // 大运
  const yun = stdLunar.getEightChar().getYun(input.gender === "male" ? 1 : 0, 2);
  const daYun = yun.getDaYun(9);
  const pre = daYun[0];
  const steps: LuckStep[] = daYun.slice(1).map((d) => {
    const gz = d.getGanZhi();
    return {
      index: d.getIndex(),
      ganzhi: gz,
      startYear: d.getStartYear(),
      endYear: d.getEndYear(),
      startAge: d.getStartAge(),
      endAge: d.getEndAge(),
      ganTenGod: tenGod(dayGan, gz[0]),
      zhiTenGod: tenGod(dayGan, hiddenStems(gz[1])[0] ?? ""),
      current: d.getStartYear() <= nowYear && nowYear <= d.getEndYear(),
    };
  });

  // 流年：今年起三年
  const birthYear = t.standard.year;
  const years: YearLuck[] = [0, 1, 2].map((offset) => {
    const year = nowYear + offset;
    const gz = Solar.fromYmd(year, 7, 1).getLunar().getYearInGanZhiExact();
    return {
      year,
      ganzhi: gz,
      age: year - birthYear + 1,
      ganTenGod: tenGod(dayGan, gz[0]),
      zhiTenGod: tenGod(dayGan, hiddenStems(gz[1])[0] ?? ""),
      luckGanzhi: steps.find((s) => s.startYear <= year && year <= s.endYear)?.ganzhi ?? "",
      relations: incomingRelations("流年", gz[0], gz[1], pillars),
    };
  });

  const prevJie = stdLunar.getPrevJie();
  const nextJie = stdLunar.getNextJie();

  // 不确定与对照
  const uncertain = uncertaintyNotes(input, place.lng, four);
  const crossCheck: string[] = [];
  const naive = fourPillars(t.standard, t.standard);
  const naiveDiff = (["day", "time"] as PillarKey[]).filter((k) => naive[k] !== four[k]);
  if (naiveDiff.length) {
    crossCheck.push(
      `如果不做真太阳时校正、直接按北京时间排，${describe(naive, naiveDiff)}。不少排盘软件默认这样排，对照时请留意。`,
    );
  }
  const allLocal = eightCharAt(t.trueSolar);
  const localYM = { year: allLocal.getYear(), month: allLocal.getMonth() };
  const ymDiff = (["year", "month"] as PillarKey[]).filter((k) => localYM[k as "year" | "month"] !== four[k]);
  if (ymDiff.length) {
    crossCheck.push(
      `出生时刻离节气交接很近：按北京时间（节气交接的绝对时刻）是${describe(four, ymDiff)}；有的流派把年月柱也按真太阳时排，会是${ymDiff
        .map((k) => `${LABEL[k]}${localYM[k as "year" | "month"]}`)
        .join("、")}。`,
    );
  }

  const lngText = `东经 ${place.lng.toFixed(2)}°`;
  const signed = (n: number) => `${n >= 0 ? "+" : "−"} ${Math.abs(Math.round(n))} 分钟`;
  const notes: string[] = [
    `真太阳时 = 北京时间 ${formatLocal(t.standard)} ${signed(t.longitudeMinutes)}（${place.path.join("")}，${lngText}，每差 1° 差 4 分钟）${signed(
      t.equationMinutes,
    )}（当天的均时差）= ${formatLocal(t.trueSolar)}。`,
  ];
  if (t.dst) {
    notes.push(
      `你填的 ${formatLocal(clock)} 在 ${clock.year} 年夏令时期间，那时钟表比北京标准时快 1 小时，已先减去 1 小时。`,
    );
  }
  if (!minuteKnown) notes.push(`只填了几点，没填几分，按 ${String(input.hour).padStart(2, "0")}:30 排盘。`);
  notes.push(
    "年柱以立春为界、月柱以节为界，按北京时间判断（节气交接是同一时刻，不随地点变）；日柱、时柱按出生地真太阳时，真太阳时 23 点以后算次日。",
  );
  const yangYear = isYangGan(four.year[0]);
  notes.push(
    `大运${yun.isForward() ? "顺" : "逆"}排（${yangYear ? "阳" : "阴"}年生${input.gender === "male" ? "男" : "女"}命），按出生到${
      yun.isForward() ? "下一个" : "上一个"
    }节的时长折算起运（三天折一年），大运和流年里的年龄都是虚岁。`,
  );
  if (t.standard.year < 1949) {
    notes.push("1949 年以前各地计时不统一，出生时间如果不是按北京时间记的，真太阳时会有偏差。");
  }
  if (place.code.startsWith("65")) {
    notes.push("新疆日常多用新疆时间（比北京时间晚 2 小时）。这里按北京时间算；如果填的是新疆时间，请加 2 小时再排。");
  }
  if (place.approx) notes.push("这个出生地缺坐标，暂用上一级行政区的坐标，真太阳时可能差几分钟。");

  return {
    name: input.name,
    gender: input.gender,
    genderLabel: input.gender === "male" ? "乾造" : "坤造",
    place,
    time: {
      clock,
      minuteKnown,
      dst: t.dst,
      standard: t.standard,
      longitudeMinutes: Math.round(t.longitudeMinutes * 10) / 10,
      equationMinutes: Math.round(t.equationMinutes * 10) / 10,
      trueSolar: t.trueSolar,
      shichen: shichenOf(t.trueSolar.hour),
    },
    lunarDate: `${stdLunar.getYearInChinese()}年${stdLunar.getMonthInChinese()}月${stdLunar.getDayInChinese()}`,
    zodiac: ZODIAC[four.year[1]] ?? "",
    pillars,
    strength,
    relations: natalRelations(pillars),
    luck: {
      forward: yun.isForward(),
      startText: startText(yun.getStartYear(), yun.getStartMonth(), yun.getStartDay()),
      startDate: yun.getStartSolar().toYmdHms().slice(0, 10),
      pre: pre && pre.getEndYear() >= pre.getStartYear() ? { startYear: pre.getStartYear(), endYear: pre.getEndYear() } : null,
      steps,
    },
    years,
    jie: {
      prev: { name: prevJie.getName(), time: prevJie.getSolar().toYmdHms().slice(0, 16) },
      next: { name: nextJie.getName(), time: nextJie.getSolar().toYmdHms().slice(0, 16) },
    },
    uncertain,
    crossCheck,
    notes,
  };
}
