"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listChildren, listProvinces } from "@/fortune/places";
import { formatLocal } from "@/fortune/solar-time";
import type { Element, FortuneChart, FortuneReading, Pillar } from "@/fortune/types";
import "./bazi.css";

/* 这里只引 places / solar-time / 类型：chart.ts 会把 lunar-javascript（四百多 KB）带进浏览器 */

const ELEMENTS: Element[] = ["木", "火", "土", "金", "水"];
const WX: Record<Element, string> = { 木: "wood", 火: "fire", 土: "earth", 金: "metal", 水: "water" };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** 农历年月日的选项；换算和「这年有没有这个闰月、这个月有没有三十」由服务端查 */
const LUNAR_YEARS = Array.from({ length: new Date().getFullYear() - 1900 }, (_, i) => new Date().getFullYear() - i);
const LUNAR_MONTHS = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
const LUNAR_DAYS = [
  ...["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"].map((d) => `初${d}`),
  ...["一", "二", "三", "四", "五", "六", "七", "八", "九"].map((d) => `十${d}`),
  "二十",
  ...["一", "二", "三", "四", "五", "六", "七", "八", "九"].map((d) => `廿${d}`),
  "三十",
];

type Status = "idle" | "charting" | "reading" | "done";

interface Payload {
  name: string;
  gender: string;
  /** solar 用 birthDate；lunar 用 lunarYear / lunarMonth / lunarDay / lunarLeap，服务端换算成公历 */
  calendar: "solar" | "lunar";
  birthDate: string;
  lunarYear?: number;
  lunarMonth?: number;
  lunarDay?: number;
  lunarLeap?: boolean;
  birthHour: number;
  birthMinute: number | null;
  placeCode: string;
}

function todayText(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BaziClient() {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [calendar, setCalendar] = useState<"solar" | "lunar">("solar");
  const [birthDate, setBirthDate] = useState("");
  const [lunarYear, setLunarYear] = useState("");
  const [lunarMonth, setLunarMonth] = useState("");
  const [lunarDay, setLunarDay] = useState("");
  const [lunarLeap, setLunarLeap] = useState(false);
  const [birthHour, setBirthHour] = useState("");
  const [birthMinute, setBirthMinute] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [chart, setChart] = useState<FortuneChart | null>(null);
  const [reading, setReading] = useState<FortuneReading | null>(null);
  const [formError, setFormError] = useState("");
  const [readingError, setReadingError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const lastPayload = useRef<Payload | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const provinces = useMemo(() => listProvinces(), []);
  const cities = useMemo(() => (province ? listChildren(province) : []), [province]);
  const cityOption = cities.find((c) => c.code === city);
  const counties = useMemo(() => (cityOption?.hasChildren ? listChildren(city) : []), [city, cityOption]);
  const provinceOption = provinces.find((p) => p.code === province);
  const placeCode = county || city || (provinceOption && !provinceOption.hasChildren ? province : "");
  // 直辖市、省直辖县级市直接挂在省下，第二级就是区县
  const secondLabel = cities.length && cities.every((c) => c.code.length === 6) ? "区县" : "城市";
  const busy = status === "charting" || status === "reading";

  useEffect(() => {
    if (status !== "reading") return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  async function run(payload: Payload, keepChart: boolean) {
    setFormError("");
    setReadingError("");
    setReading(null);
    if (!keepChart) setChart(null);
    setStatus(keepChart ? "reading" : "charting");

    let gotChart = keepChart;
    let finished = false;
    const fail = (message: string) => {
      finished = true;
      if (gotChart) {
        setReadingError(message);
        setStatus("done");
      } else {
        setFormError(message);
        setStatus("idle");
      }
    };

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 300_000);
    try {
      const res = await fetch("/api/bazi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // 开流前的错误（400 / 401）是普通 JSON
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        fail(data.message || `请求失败（HTTP ${res.status}），请重试`);
        return;
      }

      const handle = (event: string, data: Record<string, unknown>) => {
        if (event === "chart" && data.chart) {
          gotChart = true;
          setChart(data.chart as FortuneChart);
          setStatus("reading");
          if (!keepChart) {
            requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }
        } else if (event === "done" && data.reading) {
          finished = true;
          setReading(data.reading as FortuneReading);
          setStatus("done");
        } else if (event === "error") {
          fail(typeof data.message === "string" ? data.message : "解读失败，请重试");
        }
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "";
          const lines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) lines.push(line.slice(5).trim());
          }
          if (!event) continue;
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(lines.join("\n")) as Record<string, unknown>;
          } catch {
            /* 坏帧跳过 */
          }
          handle(event, data);
        }
      }
      if (!finished) fail("连接中断，请重试");
    } catch (err) {
      fail(err instanceof DOMException && err.name === "AbortError" ? "等待超时，请重试" : "网络异常，请重试");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!placeCode) {
      setFormError(`出生地请至少选到${secondLabel === "区县" ? "区县" : "城市"}`);
      return;
    }
    const payload: Payload = {
      name,
      gender,
      calendar,
      ...(calendar === "lunar"
        ? {
            birthDate: "",
            lunarYear: Number(lunarYear),
            lunarMonth: Number(lunarMonth),
            lunarDay: Number(lunarDay),
            lunarLeap,
          }
        : { birthDate }),
      birthHour: Number(birthHour),
      birthMinute: birthMinute.trim() === "" ? null : Number(birthMinute),
      placeCode,
    };
    lastPayload.current = payload;
    void run(payload, false);
  }

  function retryReading() {
    if (lastPayload.current && !busy) void run(lastPayload.current, true);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="bazi-form">
        <section className="rounded-sm border border-outline-variant/50 bg-surface/40 p-4 sm:p-5">
          <h2 className="text-sm font-semibold tracking-[0.16em] text-paper">出生信息</h2>
          <p className="mb-4 mt-1 text-sm text-outline">
            按出生证上的时间填（北京时间）。出生地用来换算真太阳时，时柱常常因此变一格。
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="姓名">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input"
                placeholder="如：林知远"
                maxLength={20}
                data-testid="bazi-name"
              />
            </Field>
            <Field label="性别">
              <select
                required
                value={gender}
                onChange={(e) => setGender(e.target.value as typeof gender)}
                className="field-input"
                data-testid="bazi-gender"
              >
                <option value="" disabled>
                  请选择
                </option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </Field>
            <div className="flex flex-col gap-2 text-xs tracking-[0.12em] text-outline">
              <div className="flex items-center justify-between gap-3">
                <span>出生日期</span>
                <span className="flex gap-4 tracking-normal" role="radiogroup" aria-label="历法">
                  {(["solar", "lunar"] as const).map((c) => (
                    <label key={c} className="flex cursor-pointer items-center gap-1.5 text-sm text-on-surface-variant">
                      <input
                        type="radio"
                        name="calendar"
                        value={c}
                        checked={calendar === c}
                        onChange={() => setCalendar(c)}
                        className="accent-gold"
                        data-testid={`bazi-calendar-${c}`}
                      />
                      {c === "solar" ? "公历" : "农历"}
                    </label>
                  ))}
                </span>
              </div>
              {calendar === "solar" ? (
                <input
                  required
                  type="date"
                  min="1901-01-01"
                  max={todayText()}
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="field-input"
                  aria-label="公历出生日期"
                  data-testid="bazi-date"
                />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      required
                      value={lunarYear}
                      onChange={(e) => setLunarYear(e.target.value)}
                      className="field-input"
                      aria-label="农历年"
                      data-testid="bazi-lunar-year"
                    >
                      <option value="" disabled>
                        年
                      </option>
                      {LUNAR_YEARS.map((y) => (
                        <option key={y} value={y}>
                          {y} 年
                        </option>
                      ))}
                    </select>
                    <select
                      required
                      value={lunarMonth}
                      onChange={(e) => setLunarMonth(e.target.value)}
                      className="field-input"
                      aria-label="农历月"
                      data-testid="bazi-lunar-month"
                    >
                      <option value="" disabled>
                        月
                      </option>
                      {LUNAR_MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}月
                        </option>
                      ))}
                    </select>
                    <select
                      required
                      value={lunarDay}
                      onChange={(e) => setLunarDay(e.target.value)}
                      className="field-input"
                      aria-label="农历日"
                      data-testid="bazi-lunar-day"
                    >
                      <option value="" disabled>
                        日
                      </option>
                      {LUNAR_DAYS.map((d, i) => (
                        <option key={d} value={i + 1}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm tracking-normal text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={lunarLeap}
                      onChange={(e) => setLunarLeap(e.target.checked)}
                      className="accent-gold"
                      data-testid="bazi-lunar-leap"
                    />
                    生在闰月（比如闰五月）才勾
                  </label>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="几点">
                <select
                  required
                  value={birthHour}
                  onChange={(e) => setBirthHour(e.target.value)}
                  className="field-input"
                  data-testid="bazi-hour"
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")} 点
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="几分（可不填）">
                <input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={birthMinute}
                  onChange={(e) => setBirthMinute(e.target.value)}
                  className="field-input"
                  placeholder="不确定就空着"
                  data-testid="bazi-minute"
                />
              </Field>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Field label="出生地 · 省份">
              <select
                required
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setCity("");
                  setCounty("");
                }}
                className="field-input"
                data-testid="bazi-province"
              >
                <option value="" disabled>
                  请选择
                </option>
                {provinces.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {cities.length ? (
              <Field label={secondLabel}>
                <select
                  required
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    setCounty("");
                  }}
                  className="field-input"
                  data-testid="bazi-city"
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {cities.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {counties.length ? (
              <Field label="区县（可不选）">
                <select
                  value={county}
                  onChange={(e) => setCounty(e.target.value)}
                  className="field-input"
                  data-testid="bazi-county"
                >
                  <option value="">不选，按市区算</option>
                  {counties.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        </section>

        {formError ? (
          <p className="mt-4 border border-cinnabar/40 bg-cinnabar/5 px-3 py-2 text-sm text-cinnabar" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="mt-6">
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:cursor-not-allowed" data-testid="bazi-submit">
            {status === "charting" ? "正在排盘…" : status === "reading" ? "正在解读，请稍候…" : "排盘并解读"}
          </button>
        </div>
      </form>

      <div ref={resultRef} className="scroll-mt-24">
        {chart ? (
          <ChartView
            chart={chart}
            reading={reading}
            status={status}
            elapsed={elapsed}
            readingError={readingError}
            onRetry={retryReading}
          />
        ) : null}
      </div>
    </div>
  );
}

function ChartView({
  chart,
  reading,
  status,
  elapsed,
  readingError,
  onRetry,
}: {
  chart: FortuneChart;
  reading: FortuneReading | null;
  status: Status;
  elapsed: number;
  readingError: string;
  onRetry: () => void;
}) {
  const s = chart.strength;
  const t = chart.time;
  const luckText = new Map((reading?.luck ?? []).map((x) => [x.ganzhi, x.text]));
  const yearText = new Map((reading?.years ?? []).map((x) => [x.year, x.text]));

  return (
    <article className="mt-10" data-testid="bazi-result">
      <div className="ink-divider mb-8" />

      <header>
        <p className="text-xs font-medium tracking-[0.22em] text-gold">命盘</p>
        <h2 className="mt-2 text-2xl font-bold tracking-[0.14em] text-paper sm:text-3xl">
          {chart.name}
          <span className="ml-3 text-base font-medium tracking-[0.12em] text-outline">
            {chart.genderLabel} · 属{chart.zodiac}
          </span>
        </h2>
        <dl className="mt-4 grid gap-2 text-sm leading-relaxed text-on-surface-variant sm:grid-cols-2">
          <Line term="公历" def={`${formatLocal(t.clock)}${t.minuteKnown ? "" : "（只知几点）"}${t.dst ? " · 夏令时" : ""}`} />
          <Line term="农历" def={chart.lunarDate} />
          <Line term="出生地" def={`${chart.place.path.join(" ")} · 东经 ${chart.place.lng.toFixed(2)}°`} />
          <Line
            term="真太阳时"
            def={`${formatLocal(t.trueSolar)} · ${t.shichen}`}
            testId="bazi-true-solar"
          />
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-outline">
          北京时间 {formatLocal(t.standard).slice(11)}
          {t.dst ? "（已扣夏令时 1 小时）" : ""}，经度时差 {signed(t.longitudeMinutes)}，均时差 {signed(t.equationMinutes)}。
          节令：{chart.jie.prev.name}（{chart.jie.prev.time}）之后，{chart.jie.next.name}（{chart.jie.next.time}）之前。
        </p>
      </header>

      {chart.uncertain.length ? (
        <div className="mt-5 border-l-2 border-cinnabar/60 pl-4 text-sm leading-relaxed text-on-surface-variant" data-testid="bazi-uncertain">
          {chart.uncertain.map((u) => (
            <p key={u} className="mt-1 first:mt-0">
              {u}
            </p>
          ))}
        </div>
      ) : null}
      {chart.crossCheck.length ? (
        <div className="mt-4 border-l-2 border-outline-variant/60 pl-4 text-xs leading-relaxed text-outline" data-testid="bazi-crosscheck">
          {chart.crossCheck.map((u) => (
            <p key={u} className="mt-1 first:mt-0">
              {u}
            </p>
          ))}
        </div>
      ) : null}

      <section className="mt-8" data-testid="bazi-pillars">
        <h3 className="text-xs font-medium tracking-[0.22em] text-outline">四柱</h3>
        <div className="mt-3 overflow-x-auto">
          <PillarTable pillars={chart.pillars} />
        </div>
      </section>

      <section className="mt-8" data-testid="bazi-strength">
        <h3 className="text-xs font-medium tracking-[0.22em] text-outline">五行与日主</h3>
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.15fr]">
          <div className="space-y-2.5">
            {ELEMENTS.map((e) => (
              <div key={e} className="flex items-center gap-3 text-sm">
                <span className={`w-5 font-semibold wx-${WX[e]}`}>{e}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface-low">
                  <div className={`h-full wx-bar-${WX[e]}`} style={{ width: `${Math.max(s.shares[e], 1)}%`, opacity: 0.75 }} />
                </div>
                <span className="w-24 text-right text-xs text-outline">
                  {s.shares[e]}% · {s.counts[e]} 个字
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs leading-relaxed text-faint">
              占比含藏干，并按月令旺衰加权；「几个字」只数八个字明面上的五行。
            </p>
          </div>
          <div className="text-sm leading-relaxed text-on-surface-variant">
            <p className="text-base text-paper">
              日主 <span className={`font-semibold wx-${WX[s.dayMaster.element]}`}>{s.dayMaster.gan}</span>
              {s.dayMaster.element}（{s.dayMaster.yinYang}
              {s.dayMaster.element}）· <span className="font-semibold">{s.level}</span>
            </p>
            <p className="mt-2">
              生在{s.season.monthZhi}月，{s.dayMaster.element}在这个月为「{s.season.state}」，{s.season.deLing ? "得令" : "不得令"}。
              通根：{s.roots.length ? s.roots.join("、") : "无"}。天干帮扶：{s.helpers.length ? s.helpers.join("、") : "无"}。
            </p>
            <p className="mt-3">
              <span className="text-outline">喜用 </span>
              <ElementChips list={s.favorable} />
              <span className="ml-4 text-outline">忌 </span>
              <ElementChips list={s.unfavorable} />
            </p>
            <p className="mt-2">{s.method}</p>
            {s.tiaoHou ? <p className="mt-1">{s.tiaoHou.text}</p> : null}
            {s.caution ? <p className="mt-1 text-cinnabar">{s.caution}</p> : null}
            <p className="mt-2 text-xs text-faint">强弱与喜忌是扶抑法的规则粗算，没把格局、合化算进去。</p>
          </div>
        </div>
        {chart.relations.length ? (
          <div className="mt-5 text-sm text-on-surface-variant">
            <span className="text-xs tracking-[0.14em] text-outline">干支关系 </span>
            {chart.relations.map((r) => r.text).join("；")}
          </div>
        ) : null}
      </section>

      <div className="ink-divider my-10" />

      <section data-testid="bazi-reading" aria-live="polite">
        <h3 className="text-xs font-medium tracking-[0.22em] text-outline">命局解读</h3>
        {status === "reading" && !reading ? (
          <p className="mt-4 text-sm text-gold" data-testid="bazi-reading-wait">
            正在解读……已等 {elapsed} 秒，一般要半分钟到一分钟。
          </p>
        ) : null}
        {readingError ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="border border-cinnabar/40 bg-cinnabar/5 px-3 py-2 text-sm text-cinnabar" role="alert">
              {readingError}
            </p>
            <button type="button" className="btn-ghost" onClick={onRetry} disabled={status === "reading"}>
              重新解读
            </button>
          </div>
        ) : null}
        {reading ? (
          <div className="mt-4">
            {reading.provider === "fake" ? (
              <p className="mb-3 text-xs text-outline">当前是示例模式（没有接入模型），下面只摆出盘面事实。</p>
            ) : null}
            {reading.overview ? (
              <p className="max-w-[44ch] text-base leading-8 text-paper" data-testid="bazi-overview">
                {reading.overview}
              </p>
            ) : null}
            <div className="mt-6 space-y-6">
              {reading.sections.map((sec) => (
                <div key={sec.key} className="border-l-2 border-outline-variant/60 pl-4">
                  <h4 className="text-base font-semibold tracking-[0.16em] text-paper">{sec.title}</h4>
                  {sec.basis ? <p className="mt-1 text-xs leading-relaxed text-outline">依据：{sec.basis}</p> : null}
                  <p className="mt-2 text-sm leading-7 text-on-surface-variant">{sec.text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="ink-divider my-10" />

      <section data-testid="bazi-luck">
        <h3 className="text-xs font-medium tracking-[0.22em] text-outline">大运</h3>
        <p className="mt-3 text-sm text-on-surface-variant">
          {chart.luck.startText}，{chart.luck.startDate} 交运，{chart.luck.forward ? "顺排" : "逆排"}。
          {chart.luck.pre ? `${chart.luck.pre.startYear}–${chart.luck.pre.endYear} 年为起运前（童限）。` : ""}
        </p>
        <ol className="mt-4 space-y-3">
          {chart.luck.steps.map((x) => (
            <li
              key={x.index}
              className={
                x.current
                  ? "grid gap-1 border-l-[3px] border-gold bg-gradient-to-r from-gold/[0.07] to-transparent py-1 pl-4 sm:grid-cols-[8.5rem_1fr] sm:gap-4"
                  : "grid gap-1 border-l-2 border-outline-variant/50 py-1 pl-4 sm:grid-cols-[8.5rem_1fr] sm:gap-4"
              }
            >
              <div>
                <p className="text-lg font-semibold tracking-[0.2em] text-paper">
                  {x.ganzhi}
                  {x.current ? <span className="ml-2 text-xs font-medium tracking-normal text-gold">当前</span> : null}
                </p>
                <p className="text-xs text-outline">
                  {x.startYear}–{x.endYear} · {x.startAge}–{x.endAge} 岁
                </p>
                <p className="text-xs text-outline">
                  {x.ganTenGod} / {x.zhiTenGod}
                </p>
              </div>
              <p className="text-sm leading-7 text-on-surface-variant">{luckText.get(x.ganzhi) ?? ""}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" data-testid="bazi-years">
        <h3 className="text-xs font-medium tracking-[0.22em] text-outline">流年</h3>
        <ol className="mt-4 space-y-4">
          {chart.years.map((y) => (
            <li key={y.year} className="border-l-2 border-outline-variant/50 pl-4">
              <p className="text-base font-semibold tracking-[0.12em] text-paper">
                {y.year} {y.ganzhi}年
                <span className="ml-2 text-xs font-normal tracking-normal text-outline">
                  {y.age} 岁 · {y.ganTenGod} / {y.zhiTenGod}
                  {y.luckGanzhi ? ` · 行${y.luckGanzhi}运` : " · 起运前"}
                </span>
              </p>
              {y.relations.length ? (
                <p className="mt-1 text-xs leading-relaxed text-outline">{y.relations.map((r) => r.text).join("；")}</p>
              ) : null}
              {yearText.get(y.year) ? (
                <p className="mt-2 text-sm leading-7 text-on-surface-variant">{yearText.get(y.year)}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {reading?.advice.length ? (
        <section className="mt-10" data-testid="bazi-advice">
          <h3 className="text-xs font-medium tracking-[0.22em] text-outline">建议</h3>
          <ul className="mt-3 space-y-2 text-sm leading-7 text-on-surface-variant">
            {reading.advice.map((a) => (
              <li key={a} className="border-l-2 border-outline-variant/50 pl-3">
                {a}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="ink-divider my-10" />

      <section className="text-xs leading-relaxed text-outline" data-testid="bazi-notes">
        <h3 className="tracking-[0.22em]">排盘说明</h3>
        <ul className="mt-3 space-y-1.5">
          {chart.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p className="mt-4">
          解读由模型依据上面的排盘生成，是传统命理的参考说法，不作为医疗、投资、婚恋等决定的依据。
        </p>
      </section>
    </article>
  );
}

function PillarTable({ pillars }: { pillars: Pillar[] }) {
  const dayCol = (p: Pillar) => (p.key === "day" ? "day-col" : "");
  return (
    <table className="bazi-table min-w-[20rem]">
      <thead>
        <tr>
          <th />
          {pillars.map((p) => (
            <th key={p.key} className={dayCol(p)}>
              {p.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>十神</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              {p.tenGod}
            </td>
          ))}
        </tr>
        <tr>
          <th>天干</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              <span className={`glyph wx-${WX[p.ganElement]}`}>{p.gan}</span>
              <span className="glyph-note">{p.ganElement}</span>
            </td>
          ))}
        </tr>
        <tr>
          <th>地支</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              <span className={`glyph wx-${WX[p.zhiElement]}`}>{p.zhi}</span>
              <span className="glyph-note">{p.zhiElement}</span>
            </td>
          ))}
        </tr>
        <tr>
          <th>藏干</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              {p.hidden.map((h) => (
                <span key={h.gan} className="hidden-stem">
                  <span className={`wx-${WX[h.element]}`}>{h.gan}</span> {h.tenGod}
                </span>
              ))}
            </td>
          ))}
        </tr>
        <tr>
          <th>星运</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              {p.diShi}
            </td>
          ))}
        </tr>
        <tr>
          <th>纳音</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              {p.naYin}
            </td>
          ))}
        </tr>
        <tr>
          <th>旬空</th>
          {pillars.map((p) => (
            <td key={p.key} className={dayCol(p)}>
              {p.xunKong}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function ElementChips({ list }: { list: Element[] }) {
  if (!list.length) return <span className="text-outline">不明显</span>;
  return (
    <>
      {list.map((e) => (
        <span key={e} className={`mr-1.5 font-semibold wx-${WX[e]}`}>
          {e}
        </span>
      ))}
    </>
  );
}

function Line({ term, def, testId }: { term: string; def: string; testId?: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2">
      <dt className="text-xs tracking-[0.14em] text-outline">{term}</dt>
      <dd data-testid={testId}>{def}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-xs tracking-[0.12em] text-outline">
      {label}
      {children}
    </label>
  );
}

function signed(n: number): string {
  const v = Math.round(n);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v)} 分钟`;
}
