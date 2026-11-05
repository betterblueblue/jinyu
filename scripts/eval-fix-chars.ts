/**
 * 改字用字扎堆评测（2026-11-05）：同一批名字、同一个顺序，在一个进程里连跑，模拟一场直播。
 * 看女孩改法里换上的字是不是老落在晴、悦、妍上，以及有改法的比例有没有掉。
 *
 * 用法（走本地网关）：
 *   LLM_BASE_URL=http://127.0.0.1:3425/v1 LLM_MODEL=opendesign/deepseek-v4.1-flash LLM_API_KEY=local \
 *     pnpm tsx scripts/eval-fix-chars.ts <标签> [遍数=2]
 * 结果写到 data/eval/fix-chars-<标签>.json；scripts/eval-fix-chars-report.ts 出对比。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

/** 女孩 26 个、男孩 10 个，男孩隔几个插一个：男女共用一张避开表时，男孩的字会把女孩的挤出去 */
const NAMES: [string, "male" | "female"][] = [
  ["文娟", "female"], ["王秀英", "female"], ["王建国", "male"], ["林玟书", "female"], ["王梓涵", "female"],
  ["张欣怡", "female"], ["李志明", "male"], ["李婷婷", "female"], ["邓玲", "female"], ["张爱存", "female"],
  ["陈俊杰", "male"], ["刘宁", "female"], ["文红梅", "female"], ["岳飞", "female"], ["刘志豪", "male"],
  ["王丽", "female"], ["李芳", "female"], ["张静", "female"], ["张伟", "male"], ["刘燕", "female"],
  ["陈红", "female"], ["杨敏", "female"], ["王伟", "male"], ["赵霞", "female"], ["黄丽娟", "female"],
  ["吴秀兰", "female"], ["刘华强", "male"], ["徐慧", "female"], ["林雅南", "female"], ["王刚", "male"],
  ["文清", "female"], ["王舜华", "female"], ["高兴", "male"], ["林易安", "female"], ["陈窈窕", "female"],
  ["杜子腾", "male"],
];

async function main() {
  const label = process.argv[2];
  const passes = Number(process.argv[3] ?? 2);
  /** cold：每个名字前清空避开表，看模型不受提醒时自己爱用哪些字（相当于每次都是开播第一位） */
  const cold = process.argv[4] === "cold";
  if (!label) throw new Error("要给一个标签，比如 old / new");
  const { evaluateName } = await import("../src/domain/evaluate/evaluate");
  const { resetRecentChars } = await import("../src/domain/evaluate/recent-chars");
  const { createEvaluateProvider } = await import("../src/domain/evaluate/provider");
  const provider = createEvaluateProvider();
  if (!provider) throw new Error("没有配模型钥匙");
  console.log(`模型：${provider.name}，${NAMES.length} 个名字 × ${passes} 遍`);

  const out = resolve("data", "eval", `fix-chars-${label}.json`);
  const rows: Record<string, unknown>[] = [];
  let n = 0;
  for (let p = 0; p < passes; p++) {
    for (const [fullName, gender] of NAMES) {
      n++;
      if (cold) resetRecentChars();
      const t0 = Date.now();
      try {
        const r = await evaluateName({ fullName, gender }, provider, { maxCandidates: 2 });
        rows.push({
          pass: p,
          fullName,
          gender,
          givenName: r.facts.givenName,
          status: r.status,
          score: r.original?.scores.total ?? null,
          candidates: r.candidates.map((c) => ({ fullName: c.fullName, givenName: c.givenName, score: c.scores.total })),
          rejected: r.rejected.length,
          tookMs: r.tookMs,
        });
        console.log(`[${n}] ${fullName}(${gender === "female" ? "女" : "男"}) ${r.original?.scores.total ?? r.status} → ${r.candidates.map((c) => c.fullName).join("、") || "无"}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (e) {
        rows.push({ pass: p, fullName, gender, status: "error", error: e instanceof Error ? e.message : String(e), tookMs: Date.now() - t0 });
        console.log(`[${n}] ${fullName} 出错：${e instanceof Error ? e.message : e}`);
      }
      writeFileSync(out, JSON.stringify(rows, null, 1));
    }
  }
  console.log(`写到 ${out}`);
}

void main();
