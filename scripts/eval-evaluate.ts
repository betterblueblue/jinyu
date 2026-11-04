/**
 * 综合评分的样例校准：拿一批名字跑真模型，看分档落在哪里、上限压了谁、候选通过多少。
 *
 * 不碰线上接口、不推提词页、不改旧打分。只调 src/domain/evaluate。
 *
 * 用法：
 *   pnpm tsx scripts/eval-evaluate.ts                 # 全部（用户对比 7 个 + 改字探针 26 个 + 名字库 79 个）
 *   $env:LIMIT=20; pnpm tsx scripts/eval-evaluate.ts  # 只跑前 20 个
 *   $env:FAKE=1; pnpm tsx scripts/eval-evaluate.ts    # 不联网，只验流程
 *   $env:CONCURRENCY=1; pnpm tsx scripts/eval-evaluate.ts
 *
 * 结果写到 data/eval/evaluate-<时间>/：summary.md 给人看，results.json 留原始。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Gender = "male" | "female" | "unknown";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnvLocal();

interface Case {
  fullName: string;
  gender: Gender;
  source: string;
}

const COMPARE: Case[] = [
  { fullName: "文娟", gender: "female", source: "对比" },
  { fullName: "文安", gender: "female", source: "对比" },
  { fullName: "文清", gender: "female", source: "对比" },
  { fullName: "文宁", gender: "female", source: "对比" },
  { fullName: "文妍", gender: "female", source: "对比" },
  { fullName: "文海军", gender: "female", source: "对比" },
  { fullName: "文海军", gender: "unknown", source: "对比" },
];

const PROBE: Case[] = [
  ["文红艳", "female"], ["王秀英", "female"], ["李淑芬", "female"], ["张建军", "male"], ["王伟", "male"],
  ["李婷婷", "female"], ["王梓涵", "female"], ["李梓轩", "male"], ["张子轩", "male"], ["陈欣怡", "female"],
  ["刘浩宇", "male"], ["李一诺", "female"], ["赵子涵", "female"], ["林沐辰", "male"], ["马梓宸", "male"],
  ["刘婵娟", "female"], ["杜子腾", "male"], ["吴驰", "male"], ["孙梓涵", "female"], ["王招娣", "female"],
  ["张仡卓", "male"], ["李清幽", "female"], ["张懿轩", "male"], ["李知微", "female"], ["黄锦汐", "female"],
].map(([fullName, gender]) => ({ fullName: fullName!, gender: gender as Gender, source: "探针" }));

function libraryCases(): Case[] {
  try {
    const raw = readFileSync(resolve(process.cwd(), "data", "name-library", "v2", "library.json"), "utf8");
    const lib = JSON.parse(raw) as { entries?: { givenName?: string; gender?: string }[] };
    const surnames = ["王", "李", "陈", "林"];
    return (lib.entries ?? [])
      .filter((e) => e.givenName && (e.gender === "male" || e.gender === "female"))
      .map((e, i) => ({
        fullName: `${surnames[i % surnames.length]}${e.givenName}`,
        gender: e.gender as Gender,
        source: "名字库",
      }));
  } catch {
    return [];
  }
}

function dedupe(cases: Case[]): Case[] {
  const seen = new Set<string>();
  return cases.filter((c) => {
    const k = `${c.fullName}:${c.gender}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const G: Record<Gender, string> = { male: "男", female: "女", unknown: "未填" };
const sec = (ms?: number) => (ms === undefined ? "—" : (ms / 1000).toFixed(1));
const cell = (s: string) => s.replace(/\|/g, "｜").replace(/\n/g, " ");
const cut = (s: string, n = 60) => ([...s].length > n ? `${[...s].slice(0, n).join("")}…` : s);

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const STATUS_CN: Record<string, string> = {
  options: "有合格候选",
  no_better: "本轮没找到更好候选",
  all_rejected: "候选全部未通过核验",
  one_char_insufficient: "模型认为一个字难改",
  needs_gender: "待确认性别",
  error: "调用失败",
  timeout: "超时",
};

async function main() {
  const { evaluateName } = await import("../src/domain/evaluate/evaluate");
  const { FakeEvaluateProvider, LlmEvaluateProvider } = await import("../src/domain/evaluate/provider");
  const { resolveSplit, scoreName } = await import("../src/domain/score/score");
  const { BAND_CUTS } = await import("../src/domain/evaluate/scoring");

  const fake = process.env.FAKE === "1" || !process.env.LLM_API_KEY;
  // 默认精简（直播口径）；要跑完整版对照时设 COMPACT=0
  const compact = process.env.COMPACT !== "0";
  const provider = fake
    ? new FakeEvaluateProvider()
    : new LlmEvaluateProvider(
        {
          baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
          apiKey: process.env.LLM_API_KEY!,
          model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
          reasoningEffort: process.env.EFFORT ?? "low",
        },
        35_000,
        compact,
      );

  const all = dedupe([...COMPARE, ...PROBE, ...libraryCases()]);
  const limit = Number(process.env.LIMIT ?? 0);
  const cases = limit > 0 ? all.slice(0, limit) : all;
  const concurrency = Math.max(1, Math.min(4, Number(process.env.CONCURRENCY ?? 2)));

  // 留一份模型的原始输出，单看被拒的候选时能分清是模型写错还是核验太严
  const raws = new Map<string, unknown>();
  const spy = {
    name: provider.name,
    evaluate: async (
      facts: Parameters<typeof provider.evaluate>[0],
      onScores?: Parameters<typeof provider.evaluate>[1],
      onOriginal?: Parameters<typeof provider.evaluate>[2],
      onOption?: Parameters<typeof provider.evaluate>[3],
    ) => {
      const r = await provider.evaluate(facts, onScores, onOriginal, onOption);
      raws.set(`${facts.fullName}:${facts.gender}`, r);
      return r;
    },
  };

  const stamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/[ :]/g, "-");
  const dir = resolve("data", "eval", `evaluate-${stamp}`);
  mkdirSync(dir, { recursive: true });

  console.log(`开始：${cases.length} 个名字，并发 ${concurrency}，provider ${provider.name}。结果目录：${dir}`);

  const results: Array<Record<string, unknown>> = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= cases.length) return;
      const c = cases[i]!;
      const split = resolveSplit(c.fullName);
      const old = split ? scoreName(split, c.gender) : null;
      let out;
      try {
        out = await evaluateName({ fullName: c.fullName, gender: c.gender }, spy, { maxCandidates: 2 });
      } catch (e) {
        results.push({ ...c, error: e instanceof Error ? e.message : String(e) });
        done++;
        console.log(`[${done}/${cases.length}] ${c.fullName} 失败：${e instanceof Error ? e.message : e}`);
        continue;
      }
      results.push({
        ...c,
        oldScore: old?.score ?? null,
        oldBand: old?.bandLabel ?? null,
        status: out.status,
        note: out.note ?? null,
        tookMs: out.tookMs,
        facts: {
          issues: out.facts.issues.map((it) => ({ id: it.id, rule: it.rule, severity: it.severity, line: it.line })),
          reminders: out.facts.reminders,
          program: out.facts.program,
          lean: out.facts.lean,
          risk: out.facts.risk,
          popularity: out.facts.popularityFacts,
        },
        original: out.original
          ? {
              scores: out.original.scores,
              tiers: out.original.tiers,
              strengths: out.original.strengths,
              issues: out.original.issues,
              reminders: out.original.reminders,
            }
          : null,
        candidates: out.candidates.map((x) => ({
          fullName: x.fullName,
          total: x.scores.total,
          base: x.scores.base,
          cap: x.scores.cap,
          gain: x.gain,
          tiers: x.tiers,
          solves: x.solves,
          keeps: x.keeps,
          loss: x.loss,
          why: x.why,
          spoken: x.spoken,
        })),
        rejected: out.rejected,
        raw: raws.get(`${c.fullName}:${c.gender}`) ?? null,
      });
      done++;
      const o = out.original;
      console.log(
        `[${done}/${cases.length}] ${c.fullName}（${G[c.gender]}）${o ? `${o.scores.total} 分` : STATUS_CN[out.status]}｜旧 ${old?.score ?? "—"}｜${STATUS_CN[out.status]}｜${sec(out.tookMs)}s`,
      );
    }
  }

  const jobs = Array.from({ length: Math.min(concurrency, cases.length) }, () => worker());
  await Promise.all(jobs);

  // ---- 统计 ----
  const withOriginal = results.filter((r) => r.original);
  const totals = withOriginal.map((r) => (r.original as { scores: { total: number } }).scores.total);
  const oldScores = results.filter((r) => typeof r.oldScore === "number").map((r) => r.oldScore as number);
  const took = results.filter((r) => typeof r.tookMs === "number").map((r) => r.tookMs as number);
  const buckets = [
    ["90+", (s: number) => s >= 90],
    ["85–89", (s: number) => s >= 85 && s < 90],
    ["80–84", (s: number) => s >= 80 && s < 85],
    ["75–79", (s: number) => s >= 75 && s < 80],
    ["70–74", (s: number) => s >= 70 && s < 75],
    ["60–69", (s: number) => s >= 60 && s < 70],
    ["<60", (s: number) => s < 60],
  ] as const;
  const capCount = (cap: number) => withOriginal.filter((r) => (r.original as { scores: { cap: number | null } }).scores.cap === cap).length;
  const statusCount = (status: string) => results.filter((r) => r.status === status).length;
  const accepted = results.reduce((n, r) => n + (Array.isArray(r.candidates) ? r.candidates.length : 0), 0);
  const rejected = results.reduce((n, r) => n + (Array.isArray(r.rejected) ? r.rejected.length : 0), 0);

  const stats = [
    `样例 ${results.length} 个：有原名评价 ${withOriginal.length} 个，待确认性别 ${statusCount("needs_gender")} 个，失败 ${statusCount("error") + statusCount("timeout")} 个。`,
    `新总分：最低 ${Math.min(...totals)}、中位 ${median(totals)}、最高 ${Math.max(...totals)}。旧分中位 ${median(oldScores) ?? "—"}。`,
    `分档：${buckets.map(([label, fn]) => `${label} ${totals.filter(fn).length}`).join("、")}。`,
    `上限：69 压了 ${capCount(69)} 个，79 压了 ${capCount(79)} 个，89 压了 ${capCount(89)} 个，没压 ${withOriginal.filter((r) => (r.original as { scores: { cap: number | null } }).scores.cap === null).length} 个。`,
    `候选：收下 ${accepted} 条，拒 ${rejected} 条；状态 ${Object.keys(STATUS_CN).map((k) => `${STATUS_CN[k]} ${statusCount(k)}`).filter((x) => !x.endsWith(" 0")).join("、")}。`,
    `耗时：中位 ${sec(median(took))} 秒，最慢 ${sec(took.length ? Math.max(...took) : undefined)} 秒。`,
    `分界（初值）：${BAND_CUTS.great} / ${BAND_CUTS.ok}。`,
  ];

  const rows = results.map((r) => {
    const o = r.original as { scores: { total: number; base: number; cap: number | null; bandLabel: string } } | null;
    return `| ${cell(String(r.fullName))} | ${G[r.gender as Gender]} | ${r.oldScore ?? "—"} | ${o ? o.scores.total : "—"} | ${o ? o.scores.base : "—"} | ${o?.scores.cap ?? "—"} | ${o ? o.scores.bandLabel : STATUS_CN[String(r.status)]} | ${String(r.source)} |`;
  });

  const details: string[] = [];
  for (const r of results) {
    const o = r.original as {
      scores: { total: number; base: number; cap: number | null; capReason: string | null; bandLabel: string; dimensions: Record<string, number> };
      tiers: Record<string, { tier: number; reason: string }>;
      strengths: string[];
      issues: { id: string; text: string; importance: string; source: string }[];
      reminders: string[];
    } | null;
    details.push(`### ${r.fullName}（${G[r.gender as Gender]}，${r.source}） 新 ${o?.scores.total ?? "—"} ／ 旧 ${r.oldScore ?? "—"}`, "");
    if (!o) {
      details.push(`- 状态：${STATUS_CN[String(r.status)]}${r.note ? `：${r.note}` : ""}`, "");
      continue;
    }
    details.push(`- 读音 ${o.tiers.pronunciation.tier}：${o.tiers.pronunciation.reason}`);
    details.push(`- 字义 ${o.tiers.meaning.tier}：${o.tiers.meaning.reason}`);
    details.push(`- 性别辨识 ${o.tiers.gender.tier}：${o.tiers.gender.reason}`);
    details.push(`- 风格 ${o.tiers.style.tier}：${o.tiers.style.reason}`);
    details.push(`- 识读 ${o.scores.dimensions.literacy}／流行 ${o.scores.dimensions.popularity}／谐音 ${o.scores.dimensions.homophone}`);
    details.push(`- 基础 ${o.scores.base}${o.scores.cap === null ? "，没压上限" : `，上限 ${o.scores.cap}：${o.scores.capReason}`}，最终 ${o.scores.total}（${o.scores.bandLabel}）`);
    if (o.strengths.length) details.push(`- 优点：${o.strengths.join("／")}`);
    if (o.issues.length) for (const it of o.issues) details.push(`- 问题 ${it.id}（${it.importance}）：${it.text}`);
    if (o.reminders.length) details.push(`- 提醒：${o.reminders.join("；")}`);
    const cands = r.candidates as { fullName: string; total: number; gain: number; why: string; loss: string; solves: string[] }[];
    if (cands?.length) {
      details.push("- 候选：");
      for (const c of cands) details.push(`  - **${c.fullName}** ${c.total} 分（${c.gain > 0 ? `+${c.gain}` : c.gain}）· ${c.why} · 解决 ${c.solves.join("、") || "未标"} · 取舍：${c.loss || "未说"}`);
    }
    const rej = r.rejected as { givenName: string; reasons: string[]; total?: number }[];
    if (rej?.length) {
      details.push("- 被拒：");
      for (const x of rej) details.push(`  - ${x.givenName}${x.total === undefined ? "" : `（${x.total} 分）`}：${x.reasons.join("；")}`);
    }
    details.push(`- 耗时 ${sec(r.tookMs as number)} 秒`, "");
  }

  const compareRows = results
    .filter((r) => r.source === "对比")
    .map((r) => {
      const o = r.original as { scores: { total: number; base: number; cap: number | null } } | null;
      return `| ${r.fullName} | ${G[r.gender as Gender]} | ${r.oldScore ?? "—"} | ${o?.scores.total ?? "—"} | ${o?.scores.base ?? "—"} | ${o?.scores.cap ?? "—"} | ${STATUS_CN[String(r.status)]} |`;
    });

  const md = [
    `# 综合评分样例 ${stamp}`,
    "",
    `provider：${provider.name}${fake ? "（示例模式，不是真模型）" : ""}。样例 ${results.length} 个。`,
    "",
    "## 统计",
    "",
    ...stats.map((s) => `- ${s}`),
    "",
    "## 全部名字",
    "",
    "| 名字 | 性别 | 旧分 | 新分 | 基础 | 上限 | 新档 | 来源 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## 用户对比的 7 个",
    "",
    "| 名字 | 性别 | 旧分 | 新分 | 基础 | 上限 | 状态 |",
    "|---|---|---|---|---|---|---|",
    ...compareRows,
    "",
    "## 每个名字",
    "",
    ...details,
  ].join("\n");

  writeFileSync(resolve(dir, "results.json"), JSON.stringify({ stamp, provider: provider.name, fake, cases, results }, null, 2), "utf8");
  writeFileSync(resolve(dir, "summary.md"), md, "utf8");

  console.log("");
  console.log(stats.map((s) => `- ${s}`).join("\n"));
  console.log(`结果：${dir}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
