import { describe, expect, it } from "vitest";
import { buildPillars, computeChart } from "@/fortune/chart";
import { validateFortuneInput } from "@/fortune/normalize";
import { findPlace, isPreciseEnough, listChildren } from "@/fortune/places";
import { buildReadingMessages } from "@/fortune/prompt";
import { FakeReadingProvider } from "@/fortune/provider";
import { natalRelations } from "@/fortune/relations";
import { chartFacts, findConflict } from "@/fortune/consistency";
import { cleanText, normalizeReading, runReading } from "@/fortune/reading";
import { chinaDstRange, equationOfTimeMinutes, formatLocal, toTrueSolarTime } from "@/fortune/solar-time";
import { computeStrength } from "@/fortune/strength";
import type { FortuneInput } from "@/fortune/types";

const NOW = new Date("2026-10-31T04:00:00Z");

function input(over: Partial<FortuneInput> = {}): FortuneInput {
  return {
    name: "林知远",
    gender: "male",
    date: { year: 1990, month: 5, day: 15 },
    hour: 14,
    minute: 30,
    placeCode: "5101", // 成都
    ...over,
  };
}

const ganzhi = (over: Partial<FortuneInput>) =>
  computeChart(input(over), NOW).pillars.map((p) => p.ganzhi).join(" ");

const strengthOf = (text: string) => {
  const [year, month, day, time] = text.split(" ");
  return computeStrength(buildPillars({ year, month, day, time }));
};

describe("真太阳时", () => {
  it("均时差与天文年历的典型值一致（误差半分钟内）", () => {
    const at = (m: number, d: number) => equationOfTimeMinutes(Date.UTC(2026, m - 1, d, 4));
    expect(at(2, 11)).toBeCloseTo(-14.2, 0);
    expect(at(7, 26)).toBeCloseTo(-6.5, 0);
    expect(at(11, 3)).toBeCloseTo(16.4, 0);
    expect(Math.abs(at(4, 15))).toBeLessThan(0.5);
  });

  it("1986–1991 夏令时按 tz 规则起止", () => {
    expect(chinaDstRange(1985)).toBeNull();
    expect(formatLocal(chinaDstRange(1986)!.start)).toBe("1986-05-04 02:00");
    expect(formatLocal(chinaDstRange(1986)!.end)).toBe("1986-09-14 02:00");
    expect(formatLocal(chinaDstRange(1988)!.start)).toBe("1988-04-17 02:00");
    expect(formatLocal(chinaDstRange(1991)!.end)).toBe("1991-09-15 02:00");
    expect(chinaDstRange(1992)).toBeNull();
  });

  it("成都 1990-05-15 14:30：先扣夏令时，再减经度时差，落在午时", () => {
    const r = toTrueSolarTime({ year: 1990, month: 5, day: 15, hour: 14, minute: 30 }, 104.06);
    expect(r.dst).toBe(true);
    expect(formatLocal(r.standard)).toBe("1990-05-15 13:30");
    expect(formatLocal(r.trueSolar)).toBe("1990-05-15 12:30");
  });
});

describe("排盘", () => {
  it("四柱：年月按北京时间、日时按真太阳时", () => {
    const chart = computeChart(input(), NOW);
    expect(chart.pillars.map((p) => p.ganzhi).join(" ")).toBe("庚午 辛巳 庚辰 壬午");
    expect(chart.time.shichen).toBe("午时");
    expect(chart.zodiac).toBe("马");
    expect(chart.lunarDate).toBe("一九九〇年四月廿一");
    expect(chart.notes.join("")).toContain("夏令时");
    // 不校正时是 14:30 → 13:30 北京时间的未时：放进对照，不当成出生时间不确定
    expect(chart.crossCheck.join("")).toContain("时柱癸未");
    expect(chart.uncertain).toHaveLength(0);
  });

  it("十神、藏干、纳音、星运、旬空", () => {
    const [year, month, day, time] = computeChart(input(), NOW).pillars;
    expect(year.tenGod).toBe("比肩");
    expect(month.tenGod).toBe("劫财");
    expect(day.tenGod).toBe("日主");
    expect(time.tenGod).toBe("食神");
    expect(month.hidden.map((h) => `${h.gan}${h.tenGod}${h.qi}`)).toEqual(["丙七杀本气", "庚比肩中气", "戊偏印余气"]);
    expect(year.naYin).toBe("路旁土");
    expect([year.diShi, month.diShi, day.diShi]).toEqual(["沐浴", "长生", "养"]);
    expect(day.xunKong).toBe("申酉");
  });

  it("乌鲁木齐 00:30 的真太阳时退回前一天亥时，日柱跟着变", () => {
    const chart = computeChart(input({ date: { year: 2000, month: 1, day: 1 }, hour: 0, minute: 30, placeCode: "6501" }), NOW);
    expect(chart.pillars.map((p) => p.ganzhi).join(" ")).toBe("己卯 丙子 丁巳 辛亥");
    expect(formatLocal(chart.time.trueSolar).slice(0, 10)).toBe("1999-12-31");
    expect(chart.crossCheck.join("")).toContain("日柱戊午");
    expect(chart.notes.join("")).toContain("新疆时间");
  });

  it("真太阳时过 23 点按次日日柱", () => {
    // 上海经度略东于 120°，10 月底均时差 +16 分钟：23:30 → 23:50 左右
    const chart = computeChart(input({ date: { year: 2026, month: 10, day: 30 }, hour: 23, minute: 30, placeCode: "310101" }), NOW);
    expect(chart.time.shichen).toBe("子时");
    expect(chart.pillars[2].ganzhi).toBe("戊寅");
    expect(chart.pillars[3].ganzhi).toBe("壬子");
  });

  it("只知道几点时，逐分钟查交界并写清哪段是哪柱（2024-04-04 清明 15:02）", () => {
    const chart = computeChart(
      input({ date: { year: 2024, month: 4, day: 4 }, hour: 15, minute: null, placeCode: "3301", gender: "female" }),
      NOW,
    );
    const text = chart.uncertain.join(" | ");
    expect(text).toContain("月柱丁卯");
    expect(text).toContain("月柱戊辰");
    expect(chart.time.minuteKnown).toBe(false);
    expect(chart.notes.join("")).toContain("按 15:30 排盘");
  });

  it("知道几分且离交界远时不报不确定", () => {
    const chart = computeChart(input({ placeCode: "110101", hour: 10, minute: 0 }), NOW);
    expect(chart.uncertain.filter((u) => u.includes("交界"))).toHaveLength(0);
  });

  it("大运：阳年男顺排、阳年女逆排，年龄为虚岁", () => {
    const male = computeChart(input(), NOW).luck;
    const female = computeChart(input({ gender: "female" }), NOW).luck;
    expect(male.forward).toBe(true);
    expect(male.steps[0].ganzhi).toBe("壬午");
    expect(female.forward).toBe(false);
    expect(female.steps[0].ganzhi).toBe("庚辰");
    expect(male.steps).toHaveLength(8);
    expect(male.steps[0].startAge).toBe(male.steps[0].startYear - 1990 + 1);
    expect(male.steps.filter((s) => s.current)).toHaveLength(1);
  });

  it("流年从今年起三年，带十神与所在大运", () => {
    const years = computeChart(input(), NOW).years;
    expect(years.map((y) => `${y.year}${y.ganzhi}`)).toEqual(["2026丙午", "2027丁未", "2028戊申"]);
    expect(years[0].age).toBe(37);
    expect(years[0].ganTenGod).toBe("七杀");
    expect(years[0].luckGanzhi).toBe("甲申");
  });
});

describe("日主强弱与喜忌（规则粗算）", () => {
  it("丁火生子月、水旺无根：身弱，取印化杀", () => {
    const s = strengthOf("癸巳 甲子 丁酉 甲辰");
    expect(["身弱", "偏弱"]).toContain(s.level);
    expect(s.favorable.slice(0, 2)).toEqual(["木", "火"]);
    expect(s.season.deLing).toBe(false);
  });

  it("己土生戌月、火印生身：偏旺", () => {
    const s = strengthOf("丁亥 庚戌 己巳 庚午");
    expect(["偏强", "身强"]).toContain(s.level);
    expect(s.season.deLing).toBe(true);
    expect(s.unfavorable).toContain("土");
  });

  it("身旺时原局一个字都没有的五行不排第一喜用", () => {
    const s = strengthOf("甲寅 丙寅 甲寅 丙寅");
    expect(["偏强", "身强"]).toContain(s.level);
    expect(s.favorable[0]).toBe("火");
  });

  it("极端命局给出从格提醒", () => {
    expect(strengthOf("壬子 壬子 壬子 壬子").caution).toContain("专旺");
    // 丁火只有戌中余气一点根
    expect(strengthOf("丙戌 庚子 丁丑 庚子").caution).toContain("从格");
  });

  it("有本气或中气根就不往从格上提（丙火坐长生寅）", () => {
    const s = strengthOf("癸未 庚申 丙寅 戊子");
    expect(s.level).toBe("身弱");
    expect(s.caution).toBeUndefined();
  });

  it("冬生火弱给调候提示", () => {
    expect(strengthOf("癸巳 甲子 丁酉 甲辰").tiaoHou?.element).toBe("火");
  });
});

describe("干支关系", () => {
  it("冲、三合、三刑都能认出来，凑成三合后不重复报半合", () => {
    const he = natalRelations(buildPillars({ year: "庚申", month: "戊子", day: "壬辰", time: "丙午" }));
    const texts = he.map((r) => r.text);
    expect(texts.some((t) => t.includes("三合水局"))).toBe(true);
    expect(he.filter((r) => r.kind === "半合")).toHaveLength(0);
    expect(texts.some((t) => t.includes("月支子与时支午相冲"))).toBe(true);

    const xing = natalRelations(buildPillars({ year: "乙丑", month: "丙戌", day: "丁未", time: "庚子" }));
    expect(xing.some((r) => r.kind === "三刑")).toBe(true);
  });
});

describe("出生地", () => {
  it("按区划码查到三级路径与经度", () => {
    const p = findPlace("330106")!;
    expect(p.path).toEqual(["浙江省", "杭州市", "西湖区"]);
    expect(p.lng).toBeGreaterThan(120);
    expect(p.lng).toBeLessThan(120.3);
  });

  it("直辖市的区直接挂在市下；省级只有港澳台可以直接用", () => {
    expect(listChildren("11").some((c) => c.code === "110101")).toBe(true);
    expect(findPlace("110101")!.path).toEqual(["北京市", "东城区"]);
    expect(isPreciseEnough("33")).toBe(false);
    expect(isPreciseEnough("81")).toBe(true);
  });
});

describe("表单校验", () => {
  const base = { name: "林知远", gender: "male", birthDate: "1990-05-15", birthHour: 14, birthMinute: "", placeCode: "5101" };

  it("合法输入：分钟留空记为 null", () => {
    const r = validateFortuneInput(base, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.minute).toBeNull();
  });

  it("农历生日换算成公历，闰月单独算，跨年的腊月落到下一年", () => {
    const lunar = (y: number, m: number, d: number, leap = false) =>
      validateFortuneInput(
        { ...base, birthDate: "", calendar: "lunar", lunarYear: y, lunarMonth: m, lunarDay: d, lunarLeap: leap },
        NOW,
      );
    const plain = lunar(1990, 5, 15);
    expect(plain.ok && plain.input.date).toEqual({ year: 1990, month: 6, day: 7 });
    expect(plain.ok && plain.input.lunar?.text).toBe("1990 年五月十五");
    const leap = lunar(1990, 5, 15, true);
    expect(leap.ok && leap.input.date).toEqual({ year: 1990, month: 7, day: 7 });
    expect(leap.ok && leap.input.lunar?.text).toBe("1990 年闰五月十五");
    const lastMonth = lunar(1990, 12, 20);
    expect(lastMonth.ok && lastMonth.input.date).toEqual({ year: 1991, month: 2, day: 4 });
  });

  it("农历日期不存在时说清楚哪里不对", () => {
    const lunar = (over: Record<string, unknown>) =>
      validateFortuneInput({ ...base, birthDate: "", calendar: "lunar", lunarYear: 1990, lunarMonth: 5, lunarDay: 15, ...over }, NOW);
    const noLeap = lunar({ lunarYear: 1991, lunarLeap: true });
    expect(!noLeap.ok && noLeap.message).toContain("农历 1991 年没有闰五月");
    const shortMonth = lunar({ lunarMonth: 4, lunarDay: 30 });
    expect(!shortMonth.ok && shortMonth.message).toContain("农历 1990 年四月只有 29 天");
    const missing = lunar({ lunarDay: "" });
    expect(!missing.ok && missing.message).toContain("请选择农历出生日期");
    // 农历 2026 年腊月初一是公历 2027 年 1 月，晚于「现在」
    const future = lunar({ lunarYear: 2026, lunarMonth: 12, lunarDay: 1 });
    expect(!future.ok && future.message).toBe("出生时间不能晚于现在");
  });

  it("填农历时，排盘说明第一条写明换算出的公历", () => {
    const r = validateFortuneInput(
      { ...base, birthDate: "", calendar: "lunar", lunarYear: 1990, lunarMonth: 5, lunarDay: 15, lunarLeap: true },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chart = computeChart(r.input, NOW);
    expect(chart.notes[0]).toBe("你填的是农历 1990 年闰五月十五，换算成公历是 1990 年 7 月 7 日。");
    expect(chart.lunarDate).toBe("一九九〇年闰五月十五");
  });

  it("缺性别、日期不存在、未来时间、只选到省都拒绝", () => {
    expect(validateFortuneInput({ ...base, gender: "unknown" }, NOW).ok).toBe(false);
    expect(validateFortuneInput({ ...base, birthDate: "1990-02-30" }, NOW).ok).toBe(false);
    expect(validateFortuneInput({ ...base, birthDate: "2026-11-01" }, NOW).ok).toBe(false);
    expect(validateFortuneInput({ ...base, birthHour: 24 }, NOW).ok).toBe(false);
    expect(validateFortuneInput({ ...base, placeCode: "33" }, NOW).ok).toBe(false);
    expect(validateFortuneInput({ ...base, placeCode: "999999" }, NOW).ok).toBe(false);
  });
});

describe("解读落地", () => {
  const chart = computeChart(input(), NOW);

  it("谈寿命、克夫这类整句删掉，断语软化", () => {
    const c = cleanText("你注定要漂泊在外。四十岁后寿命无忧。克夫之说不可信。财运必然起伏。", 200);
    expect(c.text).toBe("你多半要漂泊在外。财运往往起伏。");
    expect(c.removed).toBe(2);
  });

  it("大运、流年只收与命盘对得上的条目，顺序按命盘", () => {
    const reading = normalizeReading(
      {
        overview: "庚金生巳月，火旺金弱。",
        personality: { basis: "月干劫财", text: "做事直接。" },
        luck: [
          { ganzhi: "癸未", text: "第二步运。" },
          { ganzhi: "甲子", text: "编出来的运。" },
          { ganzhi: "壬午", text: "第一步运。" },
        ],
        years: [{ year: "2027", text: "明年。" }, { year: 2031, text: "不在范围。" }],
        advice: ["多运动。", "", 3],
      },
      chart,
      "test",
    )!;
    expect(reading.luck.map((x) => x.ganzhi)).toEqual(["壬午", "癸未"]);
    expect(reading.years.map((x) => x.year)).toEqual([2027]);
    expect(reading.advice).toEqual(["多运动。"]);
    expect(reading.sections.map((s) => s.title)).toEqual(["性格"]);
  });

  it("和排盘对不上的句子删掉并计数：日主、强弱、喜忌、柱子、十神、生肖、神煞", () => {
    const f = chartFacts(chart);
    const s = chart.strength;
    const [year, month, day] = chart.pillars;
    const wrongGan = "甲乙丙丁戊己庚辛壬癸".split("").find((g) => g !== f.dayGan)!;
    const weak = ["极弱", "身弱", "偏弱"].includes(s.level);
    const wrongStrength = weak ? "你身强，扛得住事。" : "你身弱，要多靠人帮。";
    const rightStrength = weak ? "你身弱，要多靠人帮。" : "你身强，扛得住事。";
    const wrongGod = month.tenGod === "正印" ? "偏印" : "正印";
    const wrong = [
      `${wrongGan}木日主，性子直。`,
      wrongStrength,
      s.unfavorable[0] ? `命中喜${s.unfavorable[0]}。` : "",
      s.favorable[0] ? `${s.favorable[0]}为忌神。` : "",
      "日柱甲子，坐下子水。",
      `月干为${wrongGod}，得长辈照顾。`,
      chart.zodiac === "鼠" ? "你属牛。" : "你属鼠。",
      "命带桃花，人缘好。",
    ].filter(Boolean);
    const right = [
      `日主${f.dayGan}${s.dayMaster.element}，做事有主见。`,
      rightStrength,
      s.favorable[0] ? `喜用${s.favorable[0]}。` : "",
      `年柱${year.ganzhi}，日支${day.zhi}。`,
      `月干${month.gan}为${month.tenGod}。`,
      `你属${chart.zodiac}。`,
      "若论格局，也有人看作另一种。",
      "判断日主旺衰要看月令。",
      "提升自身强项，比补短板更有效。",
    ].filter(Boolean);
    for (const t of wrong) expect(findConflict(t, f, true), t).not.toBeNull();
    for (const t of right) expect(findConflict(t, f, true), t).toBeNull();

    const reading = normalizeReading(
      { overview: [...right.slice(0, 2), ...wrong.slice(0, 3)].join(""), personality: { basis: "", text: wrong.slice(3).join("") } },
      chart,
      "test",
    )!;
    expect(reading.conflicts).toBe(wrong.length);
    expect(reading.overview).toBe(right.slice(0, 2).join(""));
    expect(reading.sections).toHaveLength(0);
  });

  it("「日支丑未又冲」这种讲两支关系的写法不当成日支写错（真模型出过）", () => {
    const f = chartFacts(chart);
    const dayZhi = chart.pillars[2].zhi;
    const other = "子丑寅卯辰巳午未申酉戌亥".split("").find((z) => z !== dayZhi)!;
    expect(findConflict(`地支巳酉丑三合金局，日支${other}${dayZhi}又冲。`, f, true)).toBeNull();
    expect(findConflict(`日支${other}土，坐下根气足。`, f, true)).not.toBeNull();
  });

  it("大运、流年里的「流年干」「年干」不当年柱查，喜忌照样查", () => {
    const f = chartFacts(chart);
    expect(findConflict("流年干丙火透出，年支午火。", f, false)).toBeNull();
    const fav = chart.strength.favorable[0];
    if (fav) expect(findConflict(`这十年${fav}为忌，要收着点。`, f, false)).not.toBeNull();
  });

  it("模型什么都没给时算失败，不拿空壳充数", () => {
    expect(normalizeReading({}, chart, "test")).toBeNull();
  });

  it("提示词不带出生地；对照排法不进提示词，真正的不确定才进", () => {
    const user = buildReadingMessages(chart)[1].content;
    expect(user).toContain("庚午");
    expect(user).not.toContain("成都");
    expect(user).not.toContain("不确定");

    const unsure = computeChart(input({ hour: 15, minute: null, date: { year: 2024, month: 4, day: 4 }, placeCode: "3301" }), NOW);
    expect(buildReadingMessages(unsure)[1].content).toContain("不确定");
  });

  it("示例模式走通整条解读链路", async () => {
    const outcome = await runReading(chart, new FakeReadingProvider());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.reading.provider).toBe("fake");
      expect(outcome.reading.sections).toHaveLength(5);
      expect(outcome.reading.luck).toHaveLength(8);
      expect(outcome.reading.overview).toContain("示例模式");
    }
  });
});
