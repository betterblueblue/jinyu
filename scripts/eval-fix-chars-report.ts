/**
 * 对比 eval-fix-chars.ts 跑出来的两份结果。
 * 用法：pnpm tsx scripts/eval-fix-chars-report.ts old new
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Row {
  pass: number;
  fullName: string;
  gender: "male" | "female";
  givenName?: string;
  status: string;
  score: number | null;
  candidates?: { fullName: string; givenName: string; score: number }[];
  rejected?: number;
  tookMs: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

/** 标签可以写成 old:0，只看第几遍 */
function stats(spec: string, gender: "male" | "female") {
  const [label, pass] = spec.split(":");
  const rows = (JSON.parse(readFileSync(resolve("data", "eval", `fix-chars-${label}.json`), "utf8")) as Row[]).filter(
    (r) => r.gender === gender && (pass === undefined || r.pass === Number(pass)),
  );
  /** 每个候选换上的字，按时间顺序 */
  const swaps: string[][] = [];
  for (const r of rows) {
    for (const c of r.candidates ?? []) {
      swaps.push([...new Set([...c.givenName].filter((ch) => !(r.givenName ?? "").includes(ch)))]);
    }
  }
  const count = new Map<string, number>();
  for (const s of swaps) for (const c of s) count.set(c, (count.get(c) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = top.slice(0, 3).reduce((n, [, k]) => n + k, 0);
  // 任意连续 10 个候选里，同一个字最多出现几次
  let worst = { ch: "", n: 0 };
  for (let i = 0; i + 10 <= swaps.length; i++) {
    const w = new Map<string, number>();
    for (const s of swaps.slice(i, i + 10)) for (const c of s) w.set(c, (w.get(c) ?? 0) + 1);
    for (const [ch, n] of w) if (n > worst.n) worst = { ch, n };
  }
  let qingWorst = 0;
  for (let i = 0; i + 10 <= swaps.length; i++) {
    qingWorst = Math.max(qingWorst, swaps.slice(i, i + 10).filter((s) => s.includes("晴")).length);
  }
  const below = rows.filter((r) => typeof r.score === "number" && r.score < 90);
  const withFix = below.filter((r) => (r.candidates ?? []).length > 0).length;
  const errors = rows.filter((r) => r.status === "error" || r.status === "timeout").length;
  return {
    名字次数: rows.length,
    候选数: swaps.length,
    晴: `${count.get("晴") ?? 0}（${pct(count.get("晴") ?? 0, swaps.length)}）`,
    出现最多的: top.slice(0, 6).map(([c, n]) => `${c}${n}`).join(" "),
    前三个字占比: pct(top3, swaps.length),
    不同的字: count.size,
    连续10个里同一个字最多: `${worst.ch} ${worst.n} 次`,
    连续10个里晴最多: qingWorst,
    "89分以下有改法": `${withFix}/${below.length}（${pct(withFix, below.length)}）`,
    被拒候选: rows.reduce((n, r) => n + (r.rejected ?? 0), 0),
    出错超时: errors,
    耗时中位秒: (median(rows.map((r) => r.tookMs)) / 1000).toFixed(1),
    顺序: swaps.map((s) => s.join("") || "·").join(" "),
  };
}

const labels = process.argv.slice(2);
for (const gender of ["female", "male"] as const) {
  console.log(`\n## ${gender === "female" ? "女孩" : "男孩"}\n`);
  const all = labels.map((l) => [l, stats(l, gender)] as const);
  const keys = Object.keys(all[0]![1]) as (keyof ReturnType<typeof stats>)[];
  for (const k of keys) console.log(`${k}：${all.map(([l, s]) => `${l} ${s[k]}`).join("  |  ")}`);
}
