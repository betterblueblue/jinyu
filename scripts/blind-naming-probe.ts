// 盲测探针（总体方案 A13）：直播起名 vs 随手问同一个模型（盲测数据）、难姓一批、补写口播稿。
// 结果写到系统临时目录的 jinyu-naming-probe.json，再跑 blind-naming-build.ts 拼盲选页（它会把结果存进 data/eval/blind-2026-11-01/）
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      const i = t.indexOf("=");
      if (!t || t.startsWith("#") || i < 0) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
    }
  } catch {
    /* ignore */
  }
}
loadEnvLocal();

const OUT = path.join(os.tmpdir(), "jinyu-naming-probe.json");

type G = "male" | "female";
const A: [string, G][] = [
  ["王", "female"], ["李", "male"], ["张", "female"], ["刘", "male"], ["陈", "female"], ["杨", "male"],
  ["黄", "female"], ["赵", "male"], ["吴", "female"], ["周", "male"], ["徐", "female"], ["孙", "male"],
  ["马", "female"], ["朱", "male"], ["胡", "female"], ["郭", "male"], ["何", "female"], ["高", "male"],
  ["林", "female"], ["罗", "male"], ["郑", "female"], ["梁", "male"], ["谢", "female"], ["宋", "male"],
];
const B: [string, G][] = [
  ["单", "male"], ["曾", "female"], ["解", "male"], ["仇", "female"], ["查", "male"], ["区", "female"],
  ["朴", "male"], ["盖", "female"], ["欧阳", "male"], ["司马", "female"], ["诸葛", "male"], ["上官", "female"],
  ["杜", "male"], ["史", "female"], ["范", "male"], ["贾", "female"], ["苟", "male"], ["毕", "female"],
  ["秦", "male"], ["甄", "female"], ["魏", "male"], ["姬", "female"], ["庞", "male"], ["殷", "female"],
  ["费", "male"], ["屠", "female"],
];

async function main() {
  const { runFast } = await import("../src/fast/run");
  const { FAST_RECENT_MAX } = await import("../src/fast/types");
  const { writeTalks, talkClient } = await import("../src/fast/talk");
  const { checkFastCandidate } = await import("../src/fast/gate");
  const { tasteProblems } = await import("../src/fast/taste");
  const { streamChat } = await import("../src/providers/chat");
  const client = talkClient();
  if (!client) throw new Error("没有 LLM_API_KEY");

  type Fast = Awaited<ReturnType<typeof runFast>>;
  const remember = (recent: string[], fast: Fast) => {
    if (!fast.ok) return recent;
    const given = [fast.primary.givenName, ...fast.alternatives.map((a) => a.givenName)].filter((n) => /^[一-鿿]{2}$/.test(n));
    return [...recent.filter((n) => !given.includes(n)), ...given].slice(-FAST_RECENT_MAX);
  };
  const shown = (fast: Fast) =>
    fast.ok
      ? [fast.primary, ...fast.alternatives].map((c) => ({
          fullName: c.fullName,
          givenName: c.givenName,
          pinyin: c.pinyin,
          ...(c.pinyinHint ? { hint: c.pinyinHint } : {}),
          why: c.why,
          library: Boolean(c.library),
        }))
      : [];

  // 随手问：不加起手字、不过闸、不过滤，模型默认推理强度，温度用接口默认的 1.0
  const baseline = async (surname: string, gender: G) => {
    const t0 = Date.now();
    const who = gender === "male" ? "男孩" : "女孩";
    const prompt = `帮我给姓${surname}的${who}起几个好听、有文化的名字，每个名字说一句寓意。`;
    try {
      const r = await streamChat({ ...client, temperature: 1.0 }, { messages: [{ role: "user", content: prompt }], maxTokens: 6000, timeoutMs: 120_000 });
      const lines = r.content.split("\n").map((l) => l.replace(/[*#>`_]/g, "").replace(/^\|\s*/, "").trim());
      const names: { givenName: string; fullName: string; line: string; gate: string[] }[] = [];
      const re = new RegExp(`^(?:\\d+[.、)）]\\s*|[-•·]\\s*)?${surname}\\s*([\\u4e00-\\u9fff]{1,2})(?=[\\s:：（(，,、—–|\\-]|$)`);
      lines.forEach((l, i) => {
        const m = l.match(re);
        if (!m || names.some((n) => n.givenName === m[1])) return;
        const given = m[1]!;
        const rest = l.slice(m[0].length).replace(/^[\s:：—–\-]+/, "");
        const line = (rest.length > 4 ? rest : (lines.slice(i + 1).find((x) => x) ?? "")).slice(0, 140);
        const v = checkFastCandidate(given, surname, gender);
        const gate = v.keep ? tasteProblems(given) : v.reasons;
        names.push({ givenName: given, fullName: `${surname}${given}`, line, gate });
      });
      return { ms: Date.now() - t0, names, raw: r.content.slice(0, 3000) };
    } catch (e) {
      return { ms: Date.now() - t0, names: [], raw: "", error: e instanceof Error ? e.message : String(e) };
    }
  };

  const out: { a: unknown[]; b: unknown[] } = { a: [], b: [] };
  const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");

  let recentA: string[] = [];
  for (const [surname, gender] of A) {
    const ours = runFast({ surname, gender, recent: recentA }).then(async (fast) => {
      let talks: Record<string, unknown> = {};
      const t0 = Date.now();
      if (fast.ok) {
        const names = [fast.primary, ...fast.alternatives].filter((c) => !c.library?.talk).map((c) => ({ givenName: c.givenName, why: c.why }));
        if (names.length) talks = await writeTalks({ surname, gender, names }, client).catch(() => ({}));
      }
      return { fast, talks, talkMs: Date.now() - t0 };
    });
    const [{ fast, talks, talkMs }, base] = await Promise.all([ours, baseline(surname, gender)]);
    recentA = remember(recentA, fast);
    out.a.push({
      surname,
      gender,
      ok: fast.ok,
      ...(fast.ok ? {} : { error: fast.message }),
      ms: fast.ok ? fast.tookMs : undefined,
      shown: shown(fast),
      dropped: fast.debug?.dropped ?? [],
      talks,
      talkMs,
      base,
    });
    save();
    const p = fast.ok ? fast.primary.fullName : `失败:${fast.ok ? "" : fast.message}`;
    console.log(`A ${surname}${gender === "male" ? "男" : "女"} 直播台 ${p}（${fast.ok ? fast.tookMs : "-"}ms） 随手问 ${base.names.map((n) => n.fullName).join(" ") || "（没认出名字）"}（${base.ms}ms）`);
  }

  let recentB: string[] = [];
  for (const [surname, gender] of B) {
    const fast = await runFast({ surname, gender, recent: recentB });
    recentB = remember(recentB, fast);
    out.b.push({ surname, gender, ok: fast.ok, ...(fast.ok ? {} : { error: fast.message }), ms: fast.ok ? fast.tookMs : undefined, shown: shown(fast), dropped: fast.debug?.dropped ?? [] });
    save();
    console.log(`B ${surname}${gender === "male" ? "男" : "女"} ${shown(fast).map((s) => `${s.fullName}(${s.pinyin}${s.hint ? `；${s.hint}` : ""})`).join(" ") || `失败:${fast.ok ? "" : fast.message}`}`);
  }
  console.log(`\n写到 ${OUT}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
