/**
 * 两轮综合评价样例的对照：同一批名字、同一套规则，只换模型。
 *
 * 用法：pnpm tsx scripts/compare-evaluate.ts <A 的 results.json> <B 的 results.json>
 * 输出到 A 所在目录的上一级的 compare-<时间>/compare.md，同时打一份摘要。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

interface Row {
  fullName: string;
  gender: string;
  oldScore: number | null;
  status: string;
  tookMs: number;
  original: {
    scores: { total: number; base: number; cap: number | null; bandLabel: string; dimensions: Record<string, number> };
    tiers: Record<string, { tier: number; reason: string }>;
  } | null;
  candidates: { fullName: string; total: number }[];
  rejected: { givenName: string; reasons: string[] }[];
}

interface Run {
  stamp: string;
  provider: string;
  results: Row[];
}

const G: Record<string, string> = { male: "男", female: "女", unknown: "未填" };
const STATUS_CN: Record<string, string> = {
  options: "有候选",
  no_better: "没更好",
  all_rejected: "全拒",
  one_char_insufficient: "一个字难改",
  needs_gender: "待确认",
  error: "失败",
  timeout: "超时",
};

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function summary(run: Run) {
  const withO = run.results.filter((r) => r.original);
  const totals = withO.map((r) => r.original!.scores.total);
  const took = run.results.map((r) => r.tookMs).filter((n) => Number.isFinite(n));
  const buckets = [
    ["90+", (s: number) => s >= 90],
    ["85–89", (s: number) => s >= 85 && s < 90],
    ["80–84", (s: number) => s >= 80 && s < 85],
    ["75–79", (s: number) => s >= 75 && s < 80],
    ["70–74", (s: number) => s >= 70 && s < 75],
    ["60–69", (s: number) => s >= 60 && s < 70],
    ["<60", (s: number) => s < 60],
  ] as const;
  return {
    total: run.results.length,
    evaluated: withO.length,
    min: Math.min(...totals),
    median: median(totals),
    max: Math.max(...totals),
    buckets: buckets.map(([label, fn]) => [label, totals.filter(fn).length] as const),
    cap69: withO.filter((r) => r.original!.scores.cap === 69).length,
    cap79: withO.filter((r) => r.original!.scores.cap === 79).length,
    cap89: withO.filter((r) => r.original!.scores.cap === 89).length,
    accepted: run.results.reduce((n, r) => n + r.candidates.length, 0),
    rejected: run.results.reduce((n, r) => n + r.rejected.length, 0),
    tookMedian: median(took),
    tookMax: Math.max(...took),
  };
}

const cell = (s: string) => s.replace(/\|/g, "｜");
const sec = (n?: number) => (n === undefined ? "—" : (n / 1000).toFixed(1));

function main() {
  const [aFile, bFile] = process.argv.slice(2);
  if (!aFile || !bFile) throw new Error("用法：compare-evaluate.ts <A results.json> <B results.json>");
  const a = JSON.parse(readFileSync(resolve(aFile), "utf8")) as Run;
  const b = JSON.parse(readFileSync(resolve(bFile), "utf8")) as Run;
  const sa = summary(a);
  const sb = summary(b);

  const key = (r: Row) => `${r.fullName}:${r.gender}`;
  const bByKey = new Map(b.results.map((r) => [key(r), r]));
  const pairs = a.results
    .map((ra) => ({ a: ra, b: bByKey.get(key(ra)) }))
    .filter((p): p is { a: Row; b: Row } => Boolean(p.b));

  const deltas = pairs
    .filter((p) => p.a.original && p.b.original)
    .map((p) => ({
      name: p.a.fullName,
      gender: p.a.gender,
      old: p.a.oldScore,
      a: p.a.original!.scores.total,
      b: p.b.original!.scores.total,
      d: p.b.original!.scores.total - p.a.original!.scores.total,
      aCap: p.a.original!.scores.cap,
      bCap: p.b.original!.scores.cap,
    }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  const stats: [string, string, string][] = [
    ["样例数", String(sa.total), String(sb.total)],
    ["有原名评价", String(sa.evaluated), String(sb.evaluated)],
    ["中位分", String(sa.median), String(sb.median)],
    ["最低 / 最高", `${sa.min} / ${sa.max}`, `${sb.min} / ${sb.max}`],
    ...sa.buckets.map(
      ([label], i) =>
        [`${label} 分`, String(sa.buckets[i]![1]), String(sb.buckets[i]![1])] as [string, string, string],
    ),
    ["上限 69", String(sa.cap69), String(sb.cap69)],
    ["上限 79", String(sa.cap79), String(sb.cap79)],
    ["上限 89", String(sa.cap89), String(sb.cap89)],
    ["候选收下 / 拒", `${sa.accepted} / ${sa.rejected}`, `${sb.accepted} / ${sb.rejected}`],
    ["耗时中位 / 最慢", `${sec(sa.tookMedian)} / ${sec(sa.tookMax)} 秒`, `${sec(sb.tookMedian)} / ${sec(sb.tookMax)} 秒`],
  ];

  const md = [
    `# 两轮模型对照 ${a.stamp} vs ${b.stamp}`,
    "",
    `A：${a.stamp}（${a.provider}）｜B：${b.stamp}（${b.provider}）`,
    "",
    "## 统计",
    "",
    "| 指标 | A | B |",
    "|---|---|---|",
    ...stats.map(([k, x, y]) => `| ${k} | ${x} | ${y} |`),
    "",
    `## 同名分差（B − A），共 ${pairs.length} 对`,
    "",
    "| 名字 | 性别 | 旧分 | A 分 | B 分 | 差 | A 上限 | B 上限 |",
    "|---|---|---|---|---|---|---|---|",
    ...deltas.map((d) => `| ${cell(d.name)} | ${G[d.gender] ?? d.gender} | ${d.old ?? "—"} | ${d.a} | ${d.b} | ${d.d > 0 ? `+${d.d}` : d.d} | ${d.aCap ?? "—"} | ${d.bCap ?? "—"} |`),
    "",
    "## 用户对比的 7 个",
    "",
    "| 名字 | 性别 | A 分 | A 状态 | B 分 | B 状态 |",
    "|---|---|---|---|---|---|",
    ...pairs
      .filter((p) => p.a.fullName.startsWith("文"))
      .map((p) => `| ${p.a.fullName} | ${G[p.a.gender]} | ${p.a.original?.scores.total ?? "—"} | ${STATUS_CN[p.a.status]} | ${p.b.original?.scores.total ?? "—"} | ${STATUS_CN[p.b.status]} |`),
    "",
    "## 被 89 上限压住的名字",
    "",
    "| 名字 | 性别 | A 基础 | A 分 | B 基础 | B 分 |",
    "|---|---|---|---|---|---|",
    ...pairs
      .filter((p) => p.a.original?.scores.cap === 89 || p.b.original?.scores.cap === 89)
      .map((p) => `| ${p.a.fullName} | ${G[p.a.gender]} | ${p.a.original?.scores.base ?? "—"} | ${p.a.original?.scores.total ?? "—"} | ${p.b.original?.scores.base ?? "—"} | ${p.b.original?.scores.total ?? "—"} |`),
  ].join("\n");

  const dir = resolve(dirname(resolve(bFile)), `compare-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "compare.md"), md, "utf8");

  console.log(`A：${basename(dirname(resolve(aFile)))}｜B：${basename(dirname(resolve(bFile)))}`);
  for (const [k, x, y] of stats) console.log(`- ${k}：A ${x}｜B ${y}`);
  console.log(`偏差最大的 5 个：${deltas.slice(0, 5).map((d) => `${d.name} ${d.a}→${d.b}`).join("、")}`);
  console.log(`对照：${resolve(dir, "compare.md")}`);
}

main();
