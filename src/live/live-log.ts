/**
 * 直播日志（2026-11-01 加）：直播台每起一个名字、打分榜每打一个分、改字点了没、等了多久，各记一行。
 * 试播完拿 `pnpm tsx scripts/live-stats.ts` 出一场的统计，往后调分值、补字表、看速度都靠它。
 *
 * 只存在这台电脑的 data/live-log/<日期>.jsonl（data/ 不进 git），不发到任何地方。
 * 不记生日（只记填没填），观众报的名字照记：事后要对着名字看哪些分被质疑过。
 *
 * 这个文件不碰 node 模块：直播台（浏览器）、日志接口（服务端）、统计脚本都引它。写文件在 live-log-store.ts。
 */

export type LiveEvent =
  /** 直播台出了一轮名字 */
  | { kind: "naming"; surname: string; gender: "male" | "female"; birthday: boolean; primary: string; alternatives: string[]; library: boolean; waitMs: number; from?: "score" }
  /** 直播台这一轮没出名字 */
  | { kind: "nameError"; surname: string; message: string }
  /** 模型起的名字补写口播稿：要写几个、写出几个 */
  | { kind: "talk"; primary: string; needed: number; written: number }
  /** 打分榜打了一个分 */
  | { kind: "score"; fullName: string; gender: "male" | "female" | "unknown"; score: number; bandLabel: string; rules: string[]; next: "none" | "fix" | "ask"; genderAsk: boolean }
  /** 提词页上「名字好在哪」写没写出来 */
  | { kind: "merit"; fullName: string; ok: boolean; tip: boolean; ms: number }
  /** 主播点了「改一个字」，这次改完时记：点了到第一条改法出来等了多久（没出改法的算到出结果）、后台是不是已经改好了、出了哪些改法 */
  | { kind: "fix"; fullName: string; waitMs: number; prefetched: boolean; options: { fullName: string; score: number }[]; unfixable?: string; error?: string }
  /** 主播在改法里点了另一个 */
  | { kind: "choose"; fullName: string; chosen: string }
  /** 存了图 */
  | { kind: "card"; fullName: string };

export type LoggedEvent = LiveEvent & { at: string };

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && [...s].length <= max ? s : null;
};
const num = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null;
const names = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const x of v) {
    const t = text(x, 8);
    if (!t) return null;
    out.push(t);
  }
  return out;
};
const WAIT_MAX = 600_000;

/** 接口收到的东西按这里的形状收，多余字段丢掉；不对就整条不收 */
export function parseLiveEvent(input: unknown): LiveEvent | null {
  const x = input as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  switch (x.kind) {
    case "naming": {
      const surname = text(x.surname, 4);
      const primary = text(x.primary, 8);
      const alternatives = names(x.alternatives, 6);
      const waitMs = num(x.waitMs, WAIT_MAX);
      if (!surname || !primary || !alternatives || waitMs === null || (x.gender !== "male" && x.gender !== "female")) return null;
      return {
        kind: "naming",
        surname,
        gender: x.gender,
        birthday: x.birthday === true,
        primary,
        alternatives,
        library: x.library === true,
        waitMs,
        ...(x.from === "score" ? { from: "score" as const } : {}),
      };
    }
    case "nameError": {
      const surname = text(x.surname, 4);
      const message = text(x.message, 120);
      return surname && message ? { kind: "nameError", surname, message } : null;
    }
    case "talk": {
      const primary = text(x.primary, 8);
      const needed = num(x.needed, 10);
      const written = num(x.written, 10);
      return primary && needed !== null && written !== null ? { kind: "talk", primary, needed, written } : null;
    }
    case "score": {
      const fullName = text(x.fullName, 8);
      const score = num(x.score, 100);
      const bandLabel = text(x.bandLabel, 8);
      const rules = Array.isArray(x.rules) && x.rules.length <= 20 ? x.rules.map((r) => text(r, 20)) : null;
      const gender = x.gender === "male" || x.gender === "female" || x.gender === "unknown" ? x.gender : null;
      const next = x.next === "none" || x.next === "fix" || x.next === "ask" ? x.next : null;
      if (!fullName || score === null || !bandLabel || !rules || rules.some((r) => !r) || !gender || !next) return null;
      return { kind: "score", fullName, gender, score, bandLabel, rules: rules as string[], next, genderAsk: x.genderAsk === true };
    }
    case "merit": {
      const fullName = text(x.fullName, 8);
      const ms = num(x.ms, WAIT_MAX);
      return fullName && ms !== null ? { kind: "merit", fullName, ok: x.ok === true, tip: x.tip === true, ms } : null;
    }
    case "fix": {
      const fullName = text(x.fullName, 8);
      const waitMs = num(x.waitMs, WAIT_MAX);
      if (!fullName || waitMs === null || !Array.isArray(x.options) || x.options.length > 3) return null;
      const options: { fullName: string; score: number }[] = [];
      for (const o of x.options) {
        const r = o as Record<string, unknown> | null;
        const n = text(r?.fullName, 8);
        const s = num(r?.score, 100);
        if (!n || s === null) return null;
        options.push({ fullName: n, score: s });
      }
      const unfixable = x.unfixable === undefined ? undefined : text(x.unfixable, 120);
      const error = x.error === undefined ? undefined : text(x.error, 120);
      if (unfixable === null || error === null) return null;
      return { kind: "fix", fullName, waitMs, prefetched: x.prefetched === true, options, ...(unfixable ? { unfixable } : {}), ...(error ? { error } : {}) };
    }
    case "choose": {
      const fullName = text(x.fullName, 8);
      const chosen = text(x.chosen, 8);
      return fullName && chosen ? { kind: "choose", fullName, chosen } : null;
    }
    case "card": {
      const fullName = text(x.fullName, 8);
      return fullName ? { kind: "card", fullName } : null;
    }
    default:
      return null;
  }
}

/* ---------- 一场的统计（scripts/live-stats.ts 用） ---------- */

export interface ScoredRow {
  at: string;
  fullName: string;
  gender: "male" | "female" | "unknown";
  score: number;
  bandLabel: string;
  /** 点了「改一个字」 */
  fixed: boolean;
  /** 主播在改法里点的那个 */
  chosen?: string;
}

export interface LiveSummary {
  naming: { count: number; errors: number; waitMedianMs?: number; waitMaxMs?: number; library: number; fromScore: number; talkNeeded: number; talkWritten: number };
  score: { count: number; bands: Record<string, number>; genderAsk: number };
  merit: { count: number; ok: number; tip: number; msMedian?: number };
  /** unfixable：模型说改一个字解决不了；empty：没说原因、也没出错，就是一条都没核过 */
  fix: { count: number; prefetched: number; waitMedianMs?: number; unfixable: number; empty: number; errors: number };
  choose: number;
  card: number;
  scored: ScoredRow[];
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function summarizeLiveLog(events: readonly LoggedEvent[]): LiveSummary {
  const out: LiveSummary = {
    naming: { count: 0, errors: 0, library: 0, fromScore: 0, talkNeeded: 0, talkWritten: 0 },
    score: { count: 0, bands: {}, genderAsk: 0 },
    merit: { count: 0, ok: 0, tip: 0 },
    fix: { count: 0, prefetched: 0, unfixable: 0, empty: 0, errors: 0 },
    choose: 0,
    card: 0,
    scored: [],
  };
  const nameWaits: number[] = [];
  const fixWaits: number[] = [];
  const meritMs: number[] = [];
  /** 同一个名字打过几次分，改字算到最近那一次头上 */
  const latest = (fullName: string) => [...out.scored].reverse().find((r) => r.fullName === fullName);
  for (const e of events) {
    switch (e.kind) {
      case "naming":
        out.naming.count++;
        nameWaits.push(e.waitMs);
        if (e.library) out.naming.library++;
        if (e.from === "score") out.naming.fromScore++;
        break;
      case "nameError":
        out.naming.errors++;
        break;
      case "talk":
        out.naming.talkNeeded += e.needed;
        out.naming.talkWritten += e.written;
        break;
      case "score":
        out.score.count++;
        out.score.bands[e.bandLabel] = (out.score.bands[e.bandLabel] ?? 0) + 1;
        if (e.genderAsk) out.score.genderAsk++;
        out.scored.push({ at: e.at, fullName: e.fullName, gender: e.gender, score: e.score, bandLabel: e.bandLabel, fixed: false });
        break;
      case "merit":
        out.merit.count++;
        if (e.ok) out.merit.ok++;
        if (e.tip) out.merit.tip++;
        meritMs.push(e.ms);
        break;
      case "fix": {
        out.fix.count++;
        // 「点了到出第一条改法」只算出了改法的；改不出来的单独数
        if (e.options.length) fixWaits.push(e.waitMs);
        if (e.prefetched) out.fix.prefetched++;
        if (e.options.length === 0 && e.unfixable) out.fix.unfixable++;
        if (e.options.length === 0 && !e.unfixable && !e.error) out.fix.empty++;
        if (e.error) out.fix.errors++;
        const row = latest(e.fullName);
        if (row) row.fixed = true;
        break;
      }
      case "choose": {
        out.choose++;
        const row = latest(e.fullName);
        if (row) row.chosen = e.chosen;
        break;
      }
      case "card":
        out.card++;
        break;
    }
  }
  const nw = median(nameWaits);
  const fw = median(fixWaits);
  const mm = median(meritMs);
  if (nw !== undefined) {
    out.naming.waitMedianMs = nw;
    out.naming.waitMaxMs = Math.max(...nameWaits);
  }
  if (fw !== undefined) out.fix.waitMedianMs = fw;
  if (mm !== undefined) out.merit.msMedian = mm;
  return out;
}

const sec = (ms?: number) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} 秒`);
const hm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const G: Record<ScoredRow["gender"], string> = { male: "男", female: "女", unknown: "不填" };

/** 统计写成主播看得懂的几行字 */
export function formatLiveSummary(s: LiveSummary): string[] {
  const bands = Object.entries(s.score.bands).map(([k, v]) => `${k} ${v}`).join("、") || "—";
  const lines = [
    `起名 ${s.naming.count} 次（没出名字 ${s.naming.errors} 次）；揭晓前等了中位 ${sec(s.naming.waitMedianMs)}、最久 ${sec(s.naming.waitMaxMs)}；首推是名字库里的 ${s.naming.library} 次；从打分榜「重新起名」过来的 ${s.naming.fromScore} 次。`,
    `补写口播稿：要写 ${s.naming.talkNeeded} 个名字，写出 ${s.naming.talkWritten} 个。`,
    `打分 ${s.score.count} 个：${bands}；没填性别、提醒了先问男宝女宝的 ${s.score.genderAsk} 个。`,
    `「名字好在哪」请了 ${s.merit.count} 次，写出 ${s.merit.ok} 次（带给主播的提醒 ${s.merit.tip} 次），中位 ${sec(s.merit.msMedian)}。`,
    `点「改一个字」${s.fix.count} 次：后台已经改好的 ${s.fix.prefetched} 次；点了到出第一条改法中位 ${sec(s.fix.waitMedianMs)}；改一个字解决不了 ${s.fix.unfixable} 次；没出改法 ${s.fix.empty} 次；出错 ${s.fix.errors} 次。主播换选改法 ${s.choose} 次，存图 ${s.card} 次。`,
  ];
  if (s.scored.length) {
    lines.push("", "打过分的名字：");
    for (const r of s.scored) {
      lines.push(`${hm(r.at)} ${r.fullName}（${G[r.gender]}）${r.score} 分 ${r.bandLabel}${r.fixed ? "，点了改字" : ""}${r.chosen ? `，选了 ${r.chosen}` : ""}`);
    }
  }
  return lines;
}
