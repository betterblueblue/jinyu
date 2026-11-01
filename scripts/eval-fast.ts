/**
 * 直播起名评测：按一场直播的样子连着起名，几个版本交替跑，在同一时段比较。
 *
 * 用法（PowerShell）：
 *   $env:ROUNDS=40; pnpm tsx scripts/eval-fast.ts base v2
 * 版本定义在 scripts/eval-fast-variants.ts，不写就只跑 base（线上现在这一版）。
 * 可选环境变量：
 *   SEED=7             观众顺序的随机种子：同一个种子每次是同一批观众（姓、性别、生日）
 *   BIRTHDAY_RATE=0.5  多大比例的观众填了生日
 *   OUT=目录           输出目录，默认 data/eval/<时间>
 *
 * 为什么交替跑：同一份提示词不同时段跑，耗时中位能差一倍（网关忙闲），分开跑比不出快慢。
 * 每个版本各记一场（各自的「本场给过的名字」），首推一律用模型的，不从名字库挑：要看的是模型本身。
 *
 * 输出：每版一个 <版本>.jsonl（每轮一行）；summary.md 是汇总和每轮名单，给人逐个看名字用。
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* 没有 .env.local 就用环境里的 */
  }
}

/** 可复现的随机数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 常见姓按大致人口排，越靠前越常抽到；末尾几个是多音姓、复姓、少见姓 */
const SURNAMES = [
  "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "吴", "周", "徐", "孙", "马", "朱", "胡", "郭", "何", "林",
  "高", "罗", "郑", "梁", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹", "彭", "曾", "肖", "田", "董", "潘",
  "袁", "蔡", "蒋", "余", "叶", "程", "苏", "沈", "单", "欧阳", "问",
];

interface Viewer {
  surname: string;
  gender: "male" | "female";
  birthday?: string;
}

function viewers(n: number, seed: number, birthdayRate: number): Viewer[] {
  const r = rng(seed);
  const out: Viewer[] = [];
  const start = Date.UTC(2024, 5, 1);
  const end = Date.UTC(2027, 2, 31);
  for (let i = 0; i < n; i++) {
    // 前面的姓权重大：取两个随机数的较小值，偏向表头
    const idx = Math.floor(Math.min(r(), r()) * SURNAMES.length);
    const gender = r() < 0.5 ? "male" : "female";
    const withBirthday = r() < birthdayRate;
    const day = new Date(start + Math.floor(r() * (end - start)));
    const birthday = withBirthday ? day.toISOString().slice(0, 10) : undefined;
    out.push({ surname: SURNAMES[idx]!, gender, ...(birthday ? { birthday } : {}) });
  }
  return out;
}

const pct = (list: number[], p: number) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]!;
};
const sec = (ms: number) => (ms / 1000).toFixed(1);

interface RoundRecord {
  round: number;
  surname: string;
  gender: string;
  birthday?: string;
  season?: string;
  ok: boolean;
  ms: number;
  message?: string;
  primary?: { name: string; why: string };
  alternatives?: { name: string; why: string }[];
  fallback?: boolean;
  debug?: unknown;
}

async function main() {
  loadEnvLocal();
  const { runFast } = await import("../src/fast/run");
  const { buildBaziSummary } = await import("../src/domain/bazi");
  const { VARIANTS } = await import("./eval-fast-variants");
  const seedChars = (await import("../src/config/seed-chars.json")).default as Record<"male" | "female", string[]>;

  const names = process.argv.slice(2).length ? process.argv.slice(2) : ["base"];
  for (const n of names) if (!VARIANTS[n]) throw new Error(`没有这个版本：${n}（见 scripts/eval-fast-variants.ts）`);
  const rounds = Number(process.env.ROUNDS ?? 40);
  const seed = Number(process.env.SEED ?? 7);
  const birthdayRate = Number(process.env.BIRTHDAY_RATE ?? 0.5);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = process.env.OUT ?? join("data", "eval", stamp);
  mkdirSync(outDir, { recursive: true });

  const people = viewers(rounds, seed, birthdayRate);
  const seasonOf = (birthday?: string) => {
    if (!birthday) return undefined;
    const b = buildBaziSummary({ baziEnabled: true, birthStatus: "born", birthDate: birthday, birthHour: undefined });
    return b.ok && b.summary ? b.summary.readable?.season : undefined;
  };

  const state = new Map(names.map((n) => [n, { recent: [] as string[], records: [] as RoundRecord[] }]));
  console.log(`评测 ${names.join(" / ")}：${rounds} 轮，种子 ${seed}，输出 ${outDir}`);

  for (let i = 0; i < rounds; i++) {
    const v = people[i]!;
    // 交替先后：偶数轮按原顺序，奇数轮倒过来，抵消网关忙闲
    const order = i % 2 === 0 ? names : [...names].reverse();
    for (const name of order) {
      const s = state.get(name)!;
      const t0 = Date.now();
      let rec: RoundRecord;
      try {
        const r = await runFast(
          { surname: v.surname, gender: v.gender, ...(v.birthday ? { birthday: v.birthday } : {}), recent: s.recent },
          undefined,
          { primary: "model", variant: VARIANTS[name] },
        );
        const ms = Date.now() - t0;
        if (r.ok) {
          const shown = [r.primary, ...r.alternatives];
          const justGiven = shown.map((c) => c.givenName);
          s.recent = [...s.recent.filter((x) => !justGiven.includes(x)), ...justGiven].slice(-500);
          rec = {
            round: i + 1,
            ...v,
            season: seasonOf(v.birthday),
            ok: true,
            ms,
            primary: { name: r.primary.givenName, why: r.primary.why },
            alternatives: r.alternatives.map((c) => ({ name: c.givenName, why: c.why })),
            fallback: r.notes.some((x) => x.includes("名字库")),
            debug: r.debug,
          };
        } else {
          rec = { round: i + 1, ...v, season: seasonOf(v.birthday), ok: false, ms, message: r.message, debug: r.debug };
        }
      } catch (err) {
        rec = { round: i + 1, ...v, ok: false, ms: Date.now() - t0, message: err instanceof Error ? err.message : String(err) };
      }
      s.records.push(rec);
      appendFileSync(join(outDir, `${name}.jsonl`), `${JSON.stringify(rec)}\n`);
      const line = rec.ok
        ? `${rec.primary!.name} | ${rec.alternatives!.map((a) => a.name).join(" ")}`
        : `失败：${rec.message}`;
      console.log(`[${name}] #${i + 1} ${v.surname}${v.gender === "male" ? "男" : "女"}${v.birthday ? ` ${v.birthday}` : ""} ${sec(rec.ms)}s ${line}`);
    }
  }

  // ---------- 汇总 ----------
  const md: string[] = [`# 直播起名评测 ${stamp}`, "", `${rounds} 轮，种子 ${seed}，生日比例 ${birthdayRate}。首推一律用模型的。`, ""];
  for (const name of names) {
    const { records } = state.get(name)!;
    const okRecs = records.filter((r) => r.ok);
    const ms = okRecs.map((r) => r.ms);
    const over5 = ms.filter((x) => x > 5000).length;
    const reasoning = okRecs.map((r) => (r.debug as { reasoningChars?: number } | undefined)?.reasoningChars ?? 0);

    // 重复：这一场出现过不止一次的名字
    const seen = new Map<string, number[]>();
    for (const r of okRecs) for (const n of [r.primary!.name, ...r.alternatives!.map((a) => a.name)]) seen.set(n, [...(seen.get(n) ?? []), r.round]);
    const dups = [...seen.entries()].filter(([, rs]) => rs.length > 1);

    // 相邻 5 轮的首推共用字
    const near: string[] = [];
    okRecs.forEach((r, k) => {
      const prev = okRecs.slice(Math.max(0, k - 4), k);
      const shared = prev.filter((p) => [...p.primary!.name].some((ch) => r.primary!.name.includes(ch)));
      if (shared.length) near.push(`#${r.round} ${r.primary!.name}（和 ${shared.map((p) => `#${p.round} ${p.primary!.name}`).join("、")}）`);
    });

    // 用字频次
    const freq = new Map<string, number>();
    for (const n of seen.keys()) for (const ch of n) freq.set(ch, (freq.get(ch) ?? 0) + (seen.get(n)?.length ?? 0));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    // 表外字
    const table = VARIANTS[name]!.seedTable ?? seedChars;
    const nameChars = new Set([...table.female, ...table.male]);
    const offTable = [...seen.keys()].filter((n) => [...n].some((ch) => !nameChars.has(ch)));

    // 生日：呼应出生时节。填了生日时第一个起手字是按季节抽的（src/fast/birth.ts），看名字里有没有它
    const bRecs = okRecs.filter((r) => r.birthday);
    const timelyOf = (r: RoundRecord) => (r.debug as { seeds?: string[] } | undefined)?.seeds?.[0] ?? "";
    const echoAny = bRecs.filter((r) => [r.primary!, ...r.alternatives!].some((c) => c.name.includes(timelyOf(r)))).length;
    const echoPrimary = bRecs.filter((r) => r.primary!.name.includes(timelyOf(r))).length;

    // 闸门拦掉的原因
    const reasons = new Map<string, number>();
    for (const r of okRecs) {
      const dropped = (r.debug as { dropped?: { reasons: string[] }[] } | undefined)?.dropped ?? [];
      for (const d of dropped) for (const x of d.reasons) reasons.set(x, (reasons.get(x) ?? 0) + 1);
    }
    const drafted = okRecs.reduce((s, r) => s + ((r.debug as { drafted?: number } | undefined)?.drafted ?? 0), 0);
    const kept = okRecs.reduce((s, r) => s + ((r.debug as { kept?: number } | undefined)?.kept ?? 0), 0);

    md.push(
      `## ${name}：${VARIANTS[name]!.note}`,
      "",
      `- 成功 ${okRecs.length}/${records.length}；从名字库补位 ${okRecs.filter((r) => r.fallback).length} 轮`,
      `- 耗时：中位 ${sec(pct(ms, 0.5))}s，P75 ${sec(pct(ms, 0.75))}s，P90 ${sec(pct(ms, 0.9))}s，最慢 ${sec(Math.max(0, ...ms))}s；超 5 秒 ${over5}/${ms.length}`,
      `- 推理字数：中位 ${pct(reasoning, 0.5)}，最多 ${Math.max(0, ...reasoning)}`,
      `- 模型给了 ${drafted} 个，过闸 ${kept} 个（${drafted ? Math.round((kept / drafted) * 100) : 0}%）；拦掉的原因：${[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join("，") || "无"}`,
      `- 重复的名字：${dups.length ? dups.map(([n, rs]) => `${n}（第 ${rs.join("、")} 轮）`).join("，") : "没有"}`,
      `- 相邻 5 轮首推共用字：${near.length} 轮${near.length ? `：${near.join("；")}` : ""}`,
      `- 用得最多的字：${top.map(([ch, n]) => `${ch}${n}`).join(" ")}`,
      `- 用了起手字表以外的字：${offTable.length} 个${offTable.length ? `（${offTable.join("、")}）` : ""}`,
      `- 填了生日的 ${bRecs.length} 轮：四个名字里有按季节抽的那个字的 ${echoAny} 轮，首推带它的 ${echoPrimary} 轮`,
      "",
      "| 轮 | 观众 | 耗时 | 首推 | 备选 |",
      "|---|---|---|---|---|",
      ...records.map((r) => {
        const who = `${r.surname}${r.gender === "male" ? "男" : "女"}${r.birthday ? ` ${r.birthday.slice(0, 7)}${r.season ? ` ${r.season}` : ""}` : ""}`;
        if (!r.ok) return `| ${r.round} | ${who} | ${sec(r.ms)} | 失败：${r.message} | |`;
        return `| ${r.round} | ${who} | ${sec(r.ms)} | ${r.surname}${r.primary!.name}：${r.primary!.why} | ${r.alternatives!.map((a) => `${a.name}：${a.why}`).join("；")} |`;
      }),
      "",
    );
  }
  writeFileSync(join(outDir, "summary.md"), md.join("\n"));
  console.log(`\n汇总：${join(outDir, "summary.md")}`);
  console.log("DONE");
}

void main();
