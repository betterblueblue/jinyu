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
  let recent = (process.env.RECENT ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // SESSION=1：像直播页一样，每轮把给出的名字记进 recent，模拟同一场连续出名
  const session = process.env.SESSION === "1";
  // BIRTHDAY=2026-03-15：带生日跑（出生时节进提示词）
  const birthday = process.env.BIRTHDAY?.trim();
  const shownAll: string[] = [];
  const msAll: number[] = [];
  let hedgedRounds = 0;
  let hedgeWonRounds = 0;
  let okRounds = 0;
  let primaryFromLibrary = 0;

  for (let i = 1; i <= rounds; i++) {
    const t = Date.now();
    const r = await runFast({ surname, gender, ...(birthday ? { birthday } : {}), ...(recent.length ? { recent } : {}) });
    const ms = Date.now() - t;
    msAll.push(ms);
    if (r.debug?.hedged) hedgedRounds++;
    if (r.debug?.hedgeWon) hedgeWonRounds++;
    if (!r.ok) {
      console.log(`#${i} FAIL(${r.code}) ${ms}ms ${r.message}`);
      if (r.debug) {
        console.log(
          `   gate: 给 ${r.debug.drafted} 过 ${r.debug.kept} 带句 ${r.debug.withLine}｜拦: ${
            r.debug.dropped.map((x) => `${x.name}(${x.reasons.join("/")})`).join("  ") || "—"
          }`,
        );
      }
      continue;
    }
    const all = [r.primary, ...r.alternatives];
    const withCite = all.filter((c) => c.citation).length;
    console.log(`#${i} ${ms}ms cite ${withCite}/${all.length}${r.baziLine ? ` 生辰:${r.baziLine}` : ""}`);
    okRounds++;
    if (r.primary.library) primaryFromLibrary++;
    for (const c of all) {
      const cite = c.citation ? `${c.citation.label ?? `${c.citation.source}·${c.citation.piece}`}｜${c.citation.quote}` : "—";
      console.log(`   ${c.fullName} (${c.pinyin}) ${c.library ? "[库]" : ""}${c.hotChar ? "[hot]" : ""}`);
      console.log(`     why: ${c.why}`);
      console.log(`     cite: ${cite}`);
    }
    if (r.notes.length) console.log(`   notes: ${r.notes.join(" / ")}`);
    if (session) {
      const justGiven = all.map((c) => c.givenName);
      shownAll.push(...justGiven);
      recent = [...recent.filter((n) => !justGiven.includes(n)), ...justGiven];
    }
    // gate 拦了什么、模型给了几条原句、推理吃了多少字：没有这几行，
    // 就看不出代码是在帮忙还是在误杀，也分不清慢是推理还是网关排队
    if (r.debug) {
      const d = r.debug;
      const reason = d.dropped.length
        ? d.dropped.map((x) => `${x.name}(${x.reasons.join("/")})`).join("  ")
        : "—";
      console.log(
        `   gate: 给 ${d.drafted} 过 ${d.kept} 带句 ${d.withLine}｜拦: ${reason}` +
          `\n   cost: 首字 ${d.firstTokenMs}ms 推理 ${d.reasoningChars} 字${d.retried ? " 重跑过一次" : ""}` +
          `${d.hedged ? (d.hedgeWon ? " 补发那一路先回" : " 补发过、原来那路先回") : ""}` +
          `\n   seed: ${d.seeds.join("")}${d.avoid.length ? `｜提醒别再出: ${d.avoid.join(" ")}` : ""}` +
          `${d.tired.length ? `｜配字别用: ${d.tired.join("")}` : ""}`,
      );
    }
  }

  if (session && shownAll.length) {
    const distinct = new Set(shownAll).size;
    const sorted = [...msAll].sort((a, b) => a - b);
    // 名字不重样以后，还要看用字扎不扎堆（「又是 X 宁」）
    const charCount = new Map<string, number>();
    for (const n of shownAll) for (const ch of n) charCount.set(ch, (charCount.get(ch) ?? 0) + 1);
    const topChars = [...charCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const { default: seedChars } = await import("../src/config/seed-chars.json");
    const table = new Set([...seedChars.female, ...seedChars.male]);
    const offTable = shownAll.filter((n) => [...n].some((ch) => !table.has(ch)));
    console.log(
      `\n同一场 ${rounds} 轮：给出 ${shownAll.length} 个名字，不同的 ${distinct} 个，重复 ${shownAll.length - distinct} 个；` +
        `耗时中位 ${sorted[Math.floor((sorted.length - 1) / 2)]}ms，最慢 ${sorted.at(-1)}ms，超 5 秒 ${msAll.filter((m) => m > 5000).length} 轮` +
        `\n用得最多的字：${topChars.map(([ch, n]) => `${ch}×${n}`).join(" ")}` +
        `\n用了字表外的字：${offTable.length} 个${offTable.length ? `（${offTable.join(" ")}）` : ""}` +
        `\n补发 ${hedgedRounds} 轮，其中补发那一路先回 ${hedgeWonRounds} 轮` +
        `\n首推来自名字库：${primaryFromLibrary}/${okRounds} 轮`,
    );
  }
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
