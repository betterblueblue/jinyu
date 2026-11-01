/**
 * 改字探针：用真模型给一批直播间常见的名字打分、改一个字，列成表给人看。
 * 直接调 src/domain/score，不走接口、不推提词页，直播台开着也不受影响。调改字提示词时用。
 *
 * 用法：pnpm tsx scripts/probe-fix.ts
 *       $env:NAMES="文红艳:female,王梓涵:female"; pnpm tsx scripts/probe-fix.ts
 * 结果写到 data/eval/fix-<时间>.md（data/ 不进 git），屏幕上打一份摘要。
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

/** 年代感、撞名、谐音、字的毛病各几个，再加两个本来就不错的 */
const DEFAULT: [string, Gender][] = [
  ["文红艳", "female"], ["王秀英", "female"], ["文娟", "female"], ["李淑芬", "female"], ["张建军", "male"], ["王伟", "male"],
  ["李婷婷", "female"], ["王梓涵", "female"], ["李梓轩", "male"], ["张子轩", "male"], ["陈欣怡", "female"], ["刘浩宇", "male"],
  ["李一诺", "female"], ["赵子涵", "female"], ["林沐辰", "male"], ["马梓宸", "male"], ["刘婵娟", "female"], ["杜子腾", "male"],
  ["吴驰", "male"], ["孙梓涵", "female"], ["王招娣", "female"], ["张仡卓", "male"], ["李清幽", "female"], ["张懿轩", "male"],
  ["李知微", "female"], ["黄锦汐", "female"],
];

const G: Record<Gender, string> = { male: "男", female: "女", unknown: "不填" };
const sec = (ms?: number) => (ms === undefined ? "—" : (ms / 1000).toFixed(1));
const cell = (s: string) => s.replace(/\|/g, "｜");

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  const { resolveSplit, scoreName } = await import("../src/domain/score/score");
  const { nextStep } = await import("../src/domain/score/next-step");
  const { suggestFixes } = await import("../src/domain/score/fix");
  const { createFixProvider } = await import("../src/providers");

  const list: [string, Gender][] = process.env.NAMES
    ? process.env.NAMES.split(",").map((x) => {
        const [n, g] = x.trim().split(":");
        return [n!, (g as Gender) || "unknown"];
      })
    : DEFAULT;
  const provider = createFixProvider();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const summary = ["| 名字 | 原分 | 下一步 | 改法（新分） | 第一条 | 全部 |", "|---|---|---|---|---|---|"];
  const detail: string[] = [];
  const firsts: number[] = [];
  const totals: number[] = [];
  let withOptions = 0;
  let unfixable = 0;
  let failed = 0;

  for (const [name, gender] of list) {
    const split = resolveSplit(name);
    if (!split) continue;
    const score = scoreName(split, gender);
    const next = nextStep(score);
    const head = `${name}（${G[gender]}）`;
    detail.push(`### ${head} ${score.score} 分 · ${score.bandLabel}`, "");
    for (const d of score.deductions) detail.push(`- −${d.points} ${d.line}`);
    if (next.kind === "none") {
      summary.push(`| ${head} | ${score.score} | 不用改 | — | — | — |`);
      detail.push("- 90 分以上，不用改", "");
      continue;
    }
    const out = await suggestFixes(score, split, provider);
    if (!out.ok) {
      failed++;
      summary.push(`| ${head} | ${score.score} | ${next.kind === "ask" ? "先问观众" : "改一个字"} | 失败：${cell(out.message)} | — | — |`);
      detail.push(`- 失败：${out.message}`, "");
      continue;
    }
    totals.push(out.tookMs);
    if (out.firstMs !== undefined) firsts.push(out.firstMs);
    if (out.options.length) withOptions++;
    if (out.unfixable) unfixable++;
    const picks = out.options.length
      ? out.options.map((o) => `${o.fullName}（${o.score}）`).join("、")
      : out.unfixable
        ? `改不了：${out.unfixable}`
        : (out.message ?? "没挑出来");
    summary.push(
      `| ${head} | ${score.score} | ${next.kind === "ask" ? "先问观众" : "改一个字"} | ${cell(picks)} | ${sec(out.firstMs)} | ${sec(out.tookMs)} |`,
    );
    detail.push("");
    for (const o of out.options) {
      detail.push(`- **${o.fullName}** ${o.score} 分 · ${o.from} → ${o.to} · ${o.soundLine} · ${o.why}`, `  - 寓意：${o.meaning}`);
    }
    if (!out.options.length) detail.push(`- ${picks}`);
    detail.push(`- 耗时：第一条 ${sec(out.firstMs)} 秒，全部 ${sec(out.tookMs)} 秒`, "");
    console.log(`${head} ${score.score} → ${picks}  [第一条 ${sec(out.firstMs)}s / 全部 ${sec(out.tookMs)}s]`);
  }

  const asked = totals.length + failed;
  const stats = [
    `调模型 ${asked} 个名字：给出改法 ${withOptions} 个，模型说改不了 ${unfixable} 个，失败 ${failed} 个。`,
    `第一条改法中位 ${sec(median(firsts))} 秒、最慢 ${sec(firsts.length ? Math.max(...firsts) : undefined)} 秒；全部写完中位 ${sec(median(totals))} 秒、最慢 ${sec(totals.length ? Math.max(...totals) : undefined)} 秒。`,
  ];
  const md = [`# 改字探针 ${stamp}`, "", `provider：${provider.name}`, "", ...stats, "", ...summary, "", "## 每个名字", "", ...detail].join("\n");
  const dir = resolve(process.cwd(), "data", "eval");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `fix-${stamp}.md`);
  writeFileSync(file, md, "utf8");
  console.log(["", ...stats, `结果：${file}`].join("\n"));
}

void main();
