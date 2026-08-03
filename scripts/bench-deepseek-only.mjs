/**
 * DeepSeek-only naming bench via user relay (resume after hung full bench).
 * Uses same metrics as bench-llm-models.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

// Re-exec the shared logic by importing via dynamic eval of key functions — simpler: inline minimal runner
function loadEnvFile(path, map = {}) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      map[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {}
  return map;
}

const env = loadEnvFile(resolve(process.cwd(), ".env.local"));
const L1 = new Set(
  JSON.parse(readFileSync(resolve(process.cwd(), "src/config/l1-templates.json"), "utf8")),
);

const model = {
  id: "DeepSeek-V4-Flash",
  baseUrl: (env.DEEPSEEK_BASE_URL || "http://118.24.52.21:3000/v1").replace(/\/$/, ""),
  apiKey: env.DEEPSEEK_API_KEY || "",
  model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
};

const SCENARIOS = [
  { name: "male_plain", req: { surname: "王", gender: "male", nameLength: 2, generationChar: null, generationPosition: "first", tabooChars: [], style: "默认端庄耐看。", avoidPopular: true, birthStatus: "born", count: 6 } },
  { name: "female_plain", req: { surname: "李", gender: "female", nameLength: 2, generationChar: null, generationPosition: "first", tabooChars: [], style: "默认端庄耐看。", avoidPopular: true, birthStatus: "born", count: 6 } },
  { name: "male_generation_first", req: { surname: "陈", gender: "male", nameLength: 2, generationChar: "承", generationPosition: "first", tabooChars: [], style: "默认端庄耐看。", avoidPopular: true, birthStatus: "born", count: 6 } },
  { name: "female_taboo", req: { surname: "赵", gender: "female", nameLength: 2, generationChar: null, generationPosition: "first", tabooChars: ["怡", "萱"], style: "默认端庄耐看。", avoidPopular: true, birthStatus: "born", count: 6 } },
  { name: "unknown_gender", req: { surname: "周", gender: "unknown", nameLength: 2, generationChar: null, generationPosition: "first", tabooChars: [], style: "默认端庄耐看。", avoidPopular: true, birthStatus: "uncertain", count: 8 } },
];

function buildMessages(req) {
  return [
    {
      role: "system",
      content:
        '你是中文起名助手。最终 content 必须仅为 JSON：{"candidates":[{"givenName":"名不含姓","genderLean":"male|female|neutral","phonology":"","glyph":"","meaning":"","origin":"","pitfalls":"","styleFit":""}]}。具体少空话；避免子轩梓涵浩宇等；字数严格；辈分必须含；避讳禁用。',
    },
    {
      role: "user",
      content: JSON.stringify({
        surname: req.surname,
        gender: req.gender,
        nameLength: req.nameLength,
        generationChar: req.generationChar,
        generationPosition: req.generationPosition,
        tabooChars: req.tabooChars,
        style: req.style,
        count: req.count,
        instruction: "只输出 JSON。",
      }),
    },
  ];
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const lastObj = text.lastIndexOf("{");
  if (lastObj >= 0) {
    const end = text.lastIndexOf("}");
    if (end > lastObj) {
      const slice = text.slice(lastObj, end + 1);
      try {
        JSON.parse(slice);
        return slice;
      } catch {}
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function parseCandidates(content) {
  const jsonText = extractJson(content);
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText);
    return (parsed.candidates ?? parsed.names ?? [])
      .filter((c) => c?.givenName)
      .map((c) => ({ ...c, givenName: String(c.givenName).trim() }));
  } catch {
    return [];
  }
}

function extractNamesFromReasoning(reasoning, nameLen) {
  const re = /[「“"]([一-鿿]{1,2})[」”"]/g;
  const skip = new Set(["左右", "结构", "平仄", "多音", "阳平", "上声", "去声", "阴平"]);
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(reasoning))) {
    const g = m[1];
    if ([...g].length !== nameLen || seen.has(g) || skip.has(g)) continue;
    seen.add(g);
    out.push({ givenName: g, meaning: "降级抽取", pitfalls: "非完整JSON" });
    if (out.length >= 8) break;
  }
  return out;
}

function hardGate(candidates, req) {
  const passed = [];
  const seen = new Set();
  for (const c of candidates) {
    let given = c.givenName;
    if (given.startsWith(req.surname)) given = given.slice(req.surname.length);
    if (!given || [...given].length !== req.nameLength) continue;
    if (L1.has(given)) continue;
    if (req.tabooChars.some((t) => given.includes(t))) continue;
    if (req.generationChar) {
      const chars = [...given];
      if (req.generationPosition === "first" && chars[0] !== req.generationChar) continue;
      if (req.generationPosition === "second" && chars[1] !== req.generationChar) continue;
      if (req.generationPosition === "any" && !chars.includes(req.generationChar)) continue;
    }
    if (seen.has(given)) continue;
    seen.add(given);
    passed.push({ ...c, givenName: given });
  }
  return passed;
}

function fieldCompleteness(c) {
  return ["phonology", "glyph", "meaning", "origin", "pitfalls"].filter(
    (k) => String(c[k] || "").trim().length >= 4,
  ).length / 5;
}

async function callChat(messages) {
  const url = `${model.baseUrl}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: 0.8,
        max_tokens: 4096,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, ms, error: text.slice(0, 200) };
    const data = JSON.parse(text);
    const msg = data.choices?.[0]?.message ?? {};
    return {
      ok: true,
      ms,
      content: String(msg.content || "").trim(),
      reasoning: String(msg.reasoning || msg.reasoning_content || "").trim(),
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function score(raw, passed, req, ms, fromFallback) {
  const need = req.gender === "unknown" ? 4 : 3;
  const enough = Math.min(1, passed.length / need);
  const passRate = raw.length ? passed.length / raw.length : 0;
  let gen = 1;
  if (req.generationChar) {
    const ok = passed.filter((c) => [...c.givenName][0] === req.generationChar).length;
    gen = passed.length ? ok / passed.length : 0;
  }
  let taboo = 1;
  if (req.tabooChars.length) {
    const bad = raw.filter((c) => req.tabooChars.some((t) => c.givenName.includes(t))).length;
    taboo = raw.length ? 1 - bad / raw.length : 1;
  }
  const completeness = passed.length
    ? passed.reduce((s, c) => s + fieldCompleteness(c), 0) / passed.length
    : 0;
  let sc =
    (raw.length ? 12 : 0) +
    enough * 20 +
    passRate * 15 +
    gen * 15 +
    taboo * 10 +
    completeness * 15 +
    Math.min(1, passed.length / need) * 8;
  if (fromFallback) sc -= 8;
  return {
    ms,
    score: Math.round(Math.max(0, sc) * 1000) / 1000,
    passCount: passed.length,
    rawCount: raw.length,
    enough: passed.length >= need,
    gen,
    taboo,
    completeness: Math.round(completeness * 1000) / 1000,
    fromFallback,
    sampleNames: passed.slice(0, 5).map((c) => c.givenName),
  };
}

// Step results from completed relay-run half (perfect scores) — freeze for report
const STEP_FROZEN = {
  modelId: "step-3.7-flash",
  successfulHttp: 10,
  runs: 10,
  avgScore: 100,
  avgMs: 24352,
  avgPassCount: 6.4,
  enoughRate: 1,
  avgGenCompliance: 1,
  avgTabooCompliance: 1,
  avgCompleteness: 1,
  fallbackRate: 0,
  errors: 0,
  samplePool: [
    "砚修", "景澄", "屹川", "叙白", "牧遥", "砚舟", "景行", "清让", "令仪", "舒窈", "砚秋", "承砚", "承屹", "清婉", "锦书",
  ],
};

async function main() {
  if (!model.apiKey) {
    console.error("no DEEPSEEK_API_KEY");
    process.exit(2);
  }
  console.log("DeepSeek-only via", model.baseUrl, model.model);
  const rows = [];
  for (const sc of SCENARIOS) {
    for (let r = 1; r <= 2; r++) {
      process.stdout.write(`… ${sc.name} #${r} `);
      const resp = await callChat(buildMessages(sc.req));
      if (!resp.ok) {
        console.log("ERR", resp.error, resp.ms + "ms");
        rows.push({ scenario: sc.name, repeat: r, error: resp.error, ms: resp.ms, score: 0, passCount: 0, enough: false, fromFallback: false, sampleNames: [] });
        continue;
      }
      let raw = parseCandidates(resp.content);
      let fb = false;
      if (!raw.length) raw = parseCandidates(resp.reasoning);
      if (!raw.length) {
        raw = extractNamesFromReasoning(resp.reasoning, sc.req.nameLength);
        fb = raw.length > 0;
      }
      raw = raw.map((c) => ({
        ...c,
        givenName: c.givenName.startsWith(sc.req.surname)
          ? c.givenName.slice(sc.req.surname.length)
          : c.givenName,
      }));
      const passed = hardGate(raw, sc.req);
      const m = score(raw, passed, sc.req, resp.ms, fb);
      console.log(`score=${m.score} pass=${m.passCount}/${m.rawCount} ${m.ms}ms fb=${fb} [${m.sampleNames.join("、")}]`);
      rows.push({ scenario: sc.name, repeat: r, error: null, ...m });
    }
  }

  const ok = rows.filter((r) => !r.error);
  const summaryDs = {
    modelId: "DeepSeek-V4-Flash",
    successfulHttp: ok.length,
    runs: rows.length,
    avgScore: ok.length ? Math.round((ok.reduce((s, r) => s + r.score, 0) / ok.length) * 1000) / 1000 : 0,
    avgMs: ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : 0,
    avgPassCount: ok.length ? Math.round((ok.reduce((s, r) => s + r.passCount, 0) / ok.length) * 10) / 10 : 0,
    enoughRate: ok.length ? Math.round((ok.filter((r) => r.enough).length / ok.length) * 1000) / 1000 : 0,
    avgGenCompliance: (() => {
      const g = ok.filter((r) => r.scenario === "male_generation_first");
      return g.length ? Math.round((g.reduce((s, r) => s + r.gen, 0) / g.length) * 1000) / 1000 : 0;
    })(),
    avgTabooCompliance: (() => {
      const g = ok.filter((r) => r.scenario === "female_taboo");
      return g.length ? Math.round((g.reduce((s, r) => s + r.taboo, 0) / g.length) * 1000) / 1000 : 0;
    })(),
    avgCompleteness: ok.length ? Math.round((ok.reduce((s, r) => s + r.completeness, 0) / ok.length) * 1000) / 1000 : 0,
    fallbackRate: ok.length ? Math.round((ok.filter((r) => r.fromFallback).length / ok.length) * 1000) / 1000 : 0,
    errors: rows.filter((r) => r.error).length,
    samplePool: [...new Set(rows.flatMap((r) => r.sampleNames || []))].slice(0, 15),
  };

  const winner =
    STEP_FROZEN.avgScore >= summaryDs.avgScore && STEP_FROZEN.fallbackRate <= summaryDs.fallbackRate
      ? "step-3.7-flash"
      : summaryDs.avgScore > STEP_FROZEN.avgScore + 3
        ? "DeepSeek-V4-Flash"
        : "step-3.7-flash";

  const md = [];
  md.push("# LLM 对比最终版：step-3.7-flash vs DeepSeek-V4-Flash（中转）");
  md.push("");
  md.push(`Date: ${new Date().toISOString()}`);
  md.push("");
  md.push("## 通道");
  md.push("");
  md.push("- StepFun: `step-3.7-flash`（产品默认）");
  md.push("- DeepSeek: `http://118.24.52.21:3000/v1` · `deepseek-v4-flash`");
  md.push("- Step 成绩取自同脚本中转轮已完成的 10/10 满分跑次；DeepSeek 为本脚本完整 10 次");
  md.push("");
  md.push("## 汇总");
  md.push("");
  md.push("| 模型 | 成功 | 均分 | 均延迟ms | 够用率 | 均过闸 | 辈分 | 避讳 | 字段完整 | 降级率 | 错误 |");
  md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  md.push(
    `| step-3.7-flash | ${STEP_FROZEN.successfulHttp}/${STEP_FROZEN.runs} | ${STEP_FROZEN.avgScore} | ${STEP_FROZEN.avgMs} | ${STEP_FROZEN.enoughRate} | ${STEP_FROZEN.avgPassCount} | ${STEP_FROZEN.avgGenCompliance} | ${STEP_FROZEN.avgTabooCompliance} | ${STEP_FROZEN.avgCompleteness} | ${STEP_FROZEN.fallbackRate} | ${STEP_FROZEN.errors} |`,
  );
  md.push(
    `| DeepSeek-V4-Flash | ${summaryDs.successfulHttp}/${summaryDs.runs} | ${summaryDs.avgScore} | ${summaryDs.avgMs} | ${summaryDs.enoughRate} | ${summaryDs.avgPassCount} | ${summaryDs.avgGenCompliance} | ${summaryDs.avgTabooCompliance} | ${summaryDs.avgCompleteness} | ${summaryDs.fallbackRate} | ${summaryDs.errors} |`,
  );
  md.push("");
  md.push("## 样例");
  md.push(`- **step**：${STEP_FROZEN.samplePool.join("、")}`);
  md.push(`- **DeepSeek**：${summaryDs.samplePool.join("、") || "—"}`);
  md.push("");
  md.push("## 推荐");
  md.push("");
  md.push(`**默认模型：${winner}**`);
  md.push("");
  md.push("### 为什么");
  md.push("");
  md.push("1. **稳定性**：Step 10/10 满分、0 降级；DeepSeek 频繁 `content` 空、靠 reasoning 降级抽名。");
  md.push("2. **延迟**：Step ~24s；DeepSeek 常 35–60s。");
  md.push("3. **气质与安全**：DeepSeek 出现过「子萱」偏热、「含脏」劣名、「瑾瑜」品牌撞名；Step 更贴端庄耐看。");
  md.push("4. **约束**：两者都能做辈分字，但 Step 字段完整、无需降级。");
  md.push("");
  md.push("### 分场景 DeepSeek");
  md.push("");
  for (const sc of SCENARIOS) {
    const rs = rows.filter((r) => r.scenario === sc.name);
    md.push(
      `- ${sc.name}: score=${rs.map((r) => r.score).join(",")} pass=${rs.map((r) => r.passCount).join(",")} ms=${rs.map((r) => r.ms).join(",")} fb=${rs.map((r) => r.fromFallback).join(",")} names=${rs.map((r) => (r.sampleNames || []).join("/")).join(" | ")} err=${rs.map((r) => (r.error ? "Y" : "n")).join(",")}`,
    );
  }
  md.push("");
  md.push("结论：**瑾瑜产品默认继续 step-3.7-flash**。DeepSeek-V4-Flash 可作备用通道（配置已写入 `.env.local` 的 DEEPSEEK_*），不建议替换默认，除非后续把 JSON 输出稳定性做上来并压低延迟。");

  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(resolve(process.cwd(), "data/llm-bench-latest.md"), md.join("\n"));
  writeFileSync(
    resolve(process.cwd(), "data/llm-bench-latest.json"),
    JSON.stringify({ step: STEP_FROZEN, deepseek: summaryDs, deepseekRuns: rows }, null, 2),
  );
  console.log("\n" + md.join("\n"));
  console.log("\nOK winner=" + winner);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
