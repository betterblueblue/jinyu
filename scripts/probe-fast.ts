/**
 * 临时探针：跑精简版 N 轮，打印名字 / why / 出处 / 耗时。
 * 用法：ROUNDS=4 SURNAME=沈 GENDER=female pnpm tsx scripts/probe-fast.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    /* ignore */
  }
}

loadEnvLocal();

async function main() {
  const { runFast } = await import("../src/fast/run");
  const rounds = Number(process.env.ROUNDS ?? 4);
  const surname = process.env.SURNAME ?? "沈";
  const gender = (process.env.GENDER ?? "female") as "male" | "female";
  // 模拟「这一场已经给过」：逗号分隔，如 RECENT=令仪,知微
  const recent = (process.env.RECENT ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = 1; i <= rounds; i++) {
    const t = Date.now();
    const r = await runFast({ surname, gender, ...(recent.length ? { recent } : {}) });
    const ms = Date.now() - t;
    if (!r.ok) {
      console.log(`#${i} FAIL(${r.code}) ${ms}ms ${r.message}`);
      continue;
    }
    const all = [r.primary, ...r.alternatives];
    const withCite = all.filter((c) => c.citation).length;
    console.log(`#${i} ${ms}ms cite ${withCite}/${all.length}`);
    for (const c of all) {
      const cite = c.citation ? `${c.citation.source}·${c.citation.piece}｜${c.citation.quote}` : "—";
      console.log(`   ${c.fullName} (${c.pinyin}) ${c.hotChar ? "[hot]" : ""}`);
      console.log(`     why: ${c.why}`);
      console.log(`     cite: ${cite}`);
    }
    if (r.notes.length) console.log(`   notes: ${r.notes.join(" / ")}`);
  }
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
