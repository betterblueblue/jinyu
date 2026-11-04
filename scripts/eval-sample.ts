/**
 * 一批真实姓名的评价报告：分数、评价、问题、改字、耗时、失败率。
 *
 * 用法：pnpm tsx scripts/eval-sample.ts
 * 名单在 data/eval/sample-names.json（名字、性别、来源）。
 * 结果写到 data/eval/sample-report-<时间>/report.md。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Gender = "male" | "female" | "unknown";

interface Case {
  name: string;
  gender: Gender;
  source: string;
}

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnv();

const G: Record<Gender, string> = { male: "男", female: "女", unknown: "未填" };
const sec = (ms?: number) => (ms === undefined ? "—" : (ms / 1000).toFixed(1));
const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function main() {
  const { evaluateName } = await import("../src/domain/evaluate/evaluate");
  const { createEvaluateProvider } = await import("../src/domain/evaluate/provider");

  const provider = createEvaluateProvider();
  if (!provider) throw new Error("没有配模型钥匙");
  const cases = JSON.parse(readFileSync(resolve("data", "eval", "sample-names.json"), "utf8")) as Case[];

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
  const dir = resolve("data", "eval", `sample-report-${stamp}`);
  mkdirSync(dir, { recursive: true });

  const rows: Record<string, unknown>[] = [];
  let done = 0;
  for (const c of cases) {
    const t0 = Date.now();
    let firstMs: number | undefined;
    try {
      const out = await evaluateName({ fullName: c.name, gender: c.gender }, provider, { maxCandidates: 2 }, {
        onScores: () => {
          firstMs ??= Date.now() - t0;
        },
      });
      rows.push({
        name: c.name,
        gender: c.gender,
        source: c.source,
        status: out.status,
        score: out.original?.scores.total ?? null,
        base: out.original?.scores.base ?? null,
        cap: out.original?.scores.cap ?? null,
        comment: out.original?.comment ?? "",
        strengths: out.original?.strengths ?? [],
        issues: out.original?.issues.map((it) => `${it.id}:${it.text}`) ?? [],
        candidates: out.candidates.map((x) => ({
          fullName: x.fullName,
          score: x.scores.total,
          why: x.why,
          solves: x.solves,
          loss: x.loss,
        })),
        rejected: out.rejected.map((x) => ({ givenName: x.givenName, reasons: x.reasons })),
        note: out.note ?? "",
        firstMs,
        tookMs: out.tookMs,
      });
    } catch (e) {
      rows.push({ name: c.name, gender: c.gender, source: c.source, status: "error", error: e instanceof Error ? e.message : String(e), tookMs: Date.now() - t0 });
    }
    done++;
    const r = rows[rows.length - 1]!;
    console.log(`[${done}/${cases.length}] ${c.name}: ${r.score ?? r.status} 分，${r.candidates ? (r.candidates as unknown[]).length : 0} 个候选，${sec(r.tookMs as number)}s`);
  }

  const scored = rows.filter((r) => typeof r.score === "number");
  const totals = scored.map((r) => r.score as number);
  const firsts = rows.map((r) => r.firstMs).filter((x): x is number => typeof x === "number");
  const tooks = rows.map((r) => r.tookMs as number);
  const withOptions = rows.filter((r) => Array.isArray(r.candidates) && (r.candidates as unknown[]).length > 0).length;
  const rejectedCount = rows.reduce((n, r) => n + (Array.isArray(r.rejected) ? (r.rejected as unknown[]).length : 0), 0);
  const failed = rows.filter((r) => r.status === "error" || r.status === "timeout").length;
  const buckets = [
    ["90+", (s: number) => s >= 90],
    ["85–89", (s: number) => s >= 85 && s < 90],
    ["80–84", (s: number) => s >= 80 && s < 85],
    ["70–79", (s: number) => s >= 70 && s < 80],
    ["60–69", (s: number) => s >= 60 && s < 70],
    ["<60", (s: number) => s < 60],
  ] as const;

  const md = [
    `# 真实姓名评价报告 ${stamp}`,
    "",
    `模型：${provider.name}。样例 ${rows.length} 个，来源见每行。`,
    "",
    "## 统计",
    "",
    `- 有分数：${scored.length}；失败/超时：${failed}。`,
    `- 分数：最低 ${Math.min(...totals)}、中位 ${median(totals)}、最高 ${Math.max(...totals)}。`,
    `- 分布：${buckets.map(([label, fn]) => `${label} ${totals.filter(fn).length}`).join("、")}。`,
    `- 有改法：${withOptions} 个；被拒候选：${rejectedCount} 条。`,
    `- 首分：中位 ${sec(median(firsts))} 秒；总耗时中位 ${sec(median(tooks))} 秒、最慢 ${sec(Math.max(...tooks))} 秒。`,
    "",
    "## 逐个名字",
    "",
    "| 名字 | 性别 | 来源 | 分数 | 上限 | 状态 | 首分 | 总耗时 | 候选 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const cands = (r.candidates as { fullName: string; score: number }[] | undefined)?.map((c) => `${c.fullName}(${c.score})`).join("、") ?? "—";
      return `| ${r.name} | ${G[r.gender as Gender]} | ${r.source} | ${r.score ?? "—"} | ${r.cap ?? "—"} | ${r.status} | ${sec(r.firstMs as number)} | ${sec(r.tookMs as number)} | ${cands} |`;
    }),
    "",
    "## 明细",
    "",
    ...rows.flatMap((r) => {
      const lines = [`### ${r.name}（${G[r.gender as Gender]}，${r.source}） ${r.score ?? "—"} 分`, ""];
      if (r.comment) lines.push(`> ${r.comment}`, "");
      if (Array.isArray(r.issues) && r.issues.length) {
        lines.push("问题：");
        for (const it of r.issues as string[]) lines.push(`- ${it}`);
        lines.push("");
      }
      if (Array.isArray(r.candidates) && r.candidates.length) {
        lines.push("改法：");
        for (const c of r.candidates as { fullName: string; score: number; why: string; solves: string[]; loss: string }[]) {
          lines.push(`- **${c.fullName}** ${c.score} 分：${c.why}；解决 ${c.solves.join("、") || "未标"}；取舍：${c.loss || "未说"}`);
        }
        lines.push("");
      }
      if (Array.isArray(r.rejected) && r.rejected.length) {
        lines.push("被拒：");
        for (const x of r.rejected as { givenName: string; reasons: string[] }[]) lines.push(`- ${x.givenName}：${x.reasons.join("；")}`);
        lines.push("");
      }
      if (r.error) lines.push(`失败：${r.error}`, "");
      if (r.note) lines.push(`说明：${r.note}`, "");
      return lines;
    }),
  ].join("\n");

  writeFileSync(resolve(dir, "results.json"), JSON.stringify({ stamp, provider: provider.name, rows }, null, 2), "utf8");
  writeFileSync(resolve(dir, "report.md"), md, "utf8");
  console.log(`\n报告：${resolve(dir, "report.md")}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
