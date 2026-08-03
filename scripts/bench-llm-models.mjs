/**
 * Compare LLMs for 瑾瑜 naming pipeline.
 * Fixed: read content OR reasoning; stronger JSON instruction; max_tokens 4096.
 *
 * Usage: node scripts/bench-llm-models.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path, map = {}) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      map[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    /* ignore */
  }
  return map;
}

const jinyuEnv = loadEnvFile(resolve(process.cwd(), ".env.local"));
const treasuryEnv = loadEnvFile(
  "D:\\MyPythonProject\\awsome-skill\\jinyutreasury\\.env.local",
);

const L1 = new Set(
  JSON.parse(readFileSync(resolve(process.cwd(), "src/config/l1-templates.json"), "utf8")),
);

const MODELS = [
  {
    id: "step-3.7-flash",
    vendor: "stepfun",
    baseUrl: jinyuEnv.LLM_BASE_URL || "https://api.stepfun.com/step_plan/v1",
    apiKey: jinyuEnv.LLM_API_KEY || "",
    model: jinyuEnv.LLM_MODEL || "step-3.7-flash",
  },
  {
    id: "DeepSeek-V4-Flash",
    vendor: "relay",
    // 用户指定的 OpenAI 兼容中转（优先环境变量，便于轮换）
    baseUrl:
      process.env.DEEPSEEK_BASE_URL ||
      jinyuEnv.DEEPSEEK_BASE_URL ||
      "http://118.24.52.21:3000/v1",
    apiKey:
      process.env.DEEPSEEK_API_KEY ||
      jinyuEnv.DEEPSEEK_API_KEY ||
      "",
    model:
      process.env.DEEPSEEK_MODEL ||
      jinyuEnv.DEEPSEEK_MODEL ||
      "deepseek-v4-flash",
  },
];

const SCENARIOS = [
  {
    name: "male_plain",
    req: {
      surname: "王",
      gender: "male",
      nameLength: 2,
      generationChar: null,
      generationPosition: "first",
      tabooChars: [],
      style: "默认端庄耐看：好念好写、少空话、避开烂大街模板。",
      avoidPopular: true,
      birthStatus: "born",
      count: 6,
    },
  },
  {
    name: "female_plain",
    req: {
      surname: "李",
      gender: "female",
      nameLength: 2,
      generationChar: null,
      generationPosition: "first",
      tabooChars: [],
      style: "默认端庄耐看：好念好写、少空话、避开烂大街模板。",
      avoidPopular: true,
      birthStatus: "born",
      count: 6,
    },
  },
  {
    name: "male_generation_first",
    req: {
      surname: "陈",
      gender: "male",
      nameLength: 2,
      generationChar: "承",
      generationPosition: "first",
      tabooChars: [],
      style: "默认端庄耐看：好念好写、少空话、避开烂大街模板。",
      avoidPopular: true,
      birthStatus: "born",
      count: 6,
    },
  },
  {
    name: "female_taboo",
    req: {
      surname: "赵",
      gender: "female",
      nameLength: 2,
      generationChar: null,
      generationPosition: "first",
      tabooChars: ["怡", "萱"],
      style: "默认端庄耐看：好念好写、少空话、避开烂大街模板。",
      avoidPopular: true,
      birthStatus: "born",
      count: 6,
    },
  },
  {
    name: "unknown_gender",
    req: {
      surname: "周",
      gender: "unknown",
      nameLength: 2,
      generationChar: null,
      generationPosition: "first",
      tabooChars: [],
      style: "默认端庄耐看：好念好写、少空话、避开烂大街模板。",
      avoidPopular: true,
      birthStatus: "uncertain",
      count: 8,
    },
  },
];

const REPEATS = 2;

function buildMessages(req) {
  const system = [
    "你是中文起名助手。",
    "最终回复的 content 必须是且仅是一个 JSON 对象，不要 markdown，不要解释。",
    'JSON 格式：{"candidates":[{"givenName":"名不含姓","genderLean":"male|female|neutral","phonology":"","glyph":"","meaning":"","origin":"","pitfalls":"","styleFit":""}]}',
    "要求：具体少空话；不编造铁口命理；避免烂大街网红模板（如子轩/梓涵/浩宇等）；",
    "givenName 不要包含姓氏；字数严格符合用户要求。",
    "若你需要思考，思考过程不要占用最终 content；content 只放 JSON。",
  ].join("");

  const user = JSON.stringify(
    {
      surname: req.surname,
      gender: req.gender,
      nameLength: req.nameLength,
      generationChar: req.generationChar,
      generationPosition: req.generationPosition,
      tabooChars: req.tabooChars,
      style: req.style,
      avoidPopular: req.avoidPopular,
      birthStatus: req.birthStatus,
      count: req.count,
      instruction:
        "请生成多个候选「名」（不含姓）。若有辈分字必须按位置包含。不要使用避讳字。最终只输出 JSON。",
    },
    null,
    0,
  );

  return [
    { role: "system", content: system },
    { role: "user", content: user },
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
      } catch {
        /* fall through */
      }
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
    const list = parsed.candidates ?? parsed.names ?? [];
    return list
      .filter((c) => c && typeof c.givenName === "string")
      .map((c) => ({
        givenName: String(c.givenName).trim(),
        genderLean: c.genderLean,
        phonology: c.phonology || "",
        glyph: c.glyph || "",
        meaning: c.meaning || "",
        origin: c.origin || "",
        pitfalls: c.pitfalls || "",
        styleFit: c.styleFit || "",
      }));
  } catch {
    return [];
  }
}

function extractNamesFromReasoning(reasoning, nameLen) {
  const re = /[「“"]([一-鿿]{1,2})[」”"]/g;
  const skip = new Set(["左右", "结构", "平仄", "多音", "阳平", "上声", "去声", "阴平", "用户", "候选"]);
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(reasoning)) !== null) {
    const given = m[1];
    if ([...given].length !== nameLen || seen.has(given) || skip.has(given)) continue;
    seen.add(given);
    out.push({
      givenName: given,
      genderLean: "neutral",
      meaning: "（推理文本降级抽取）",
      phonology: "",
      glyph: "",
      origin: "",
      pitfalls: "非完整 JSON 输出",
      styleFit: "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

function hardGate(candidates, req) {
  const passed = [];
  const eliminated = [];
  const seen = new Set();
  for (const c of candidates) {
    let given = c.givenName;
    if (given.startsWith(req.surname)) given = given.slice(req.surname.length);
    const reasons = [];
    if (!given) reasons.push("empty");
    if ([...given].length !== req.nameLength) reasons.push("length");
    if (L1.has(given)) reasons.push("L1");
    if (req.tabooChars.some((t) => given.includes(t))) reasons.push("taboo");
    if (req.generationChar) {
      const chars = [...given];
      const g = req.generationChar;
      let ok = false;
      if (req.generationPosition === "any") ok = chars.includes(g);
      else if (req.generationPosition === "first") ok = chars[0] === g;
      else ok = chars.length === 1 ? chars[0] === g : chars[1] === g;
      if (!ok) reasons.push("generation");
    }
    if (seen.has(given)) reasons.push("dup");
    if (reasons.length) {
      eliminated.push({ given, reasons });
      continue;
    }
    seen.add(given);
    passed.push({ ...c, givenName: given });
  }
  return { passed, eliminated };
}

function fieldCompleteness(c) {
  const keys = ["phonology", "glyph", "meaning", "origin", "pitfalls"];
  return keys.filter((k) => String(c[k] || "").trim().length >= 4).length / keys.length;
}

function emptyTalkScore(c) {
  const m = String(c.meaning || "");
  if (m.length < 8) return 1;
  if (/很好|不错|优秀|美好|降级抽取/.test(m) && m.length < 24) return 0.7;
  return 0;
}

async function callChat(modelCfg, messages) {
  const url = `${modelCfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelCfg.apiKey}`,
    },
    body: JSON.stringify({
      model: modelCfg.model,
      messages,
      temperature: 0.8,
      max_tokens: 4096,
    }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) {
    return { ok: false, ms, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, content: "", reasoning: "" };
  }
  try {
    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message ?? {};
    const content = String(message.content || "").trim();
    const reasoning = String(message.reasoning || message.reasoning_content || "").trim();
    return { ok: true, ms, content, reasoning, error: null };
  } catch {
    return { ok: false, ms, error: "bad json response", content: "", reasoning: "" };
  }
}

function scoreRun(raw, gated, req, ms, parseOk, fromFallback) {
  const need = req.gender === "unknown" ? 4 : 3;
  const passRate = raw.length ? gated.passed.length / raw.length : 0;
  const l1Count = raw.filter((c) => L1.has(c.givenName)).length;
  let genCompliance = 1;
  if (req.generationChar) {
    const ok = gated.passed.filter((c) => {
      const chars = [...c.givenName];
      if (req.generationPosition === "first") return chars[0] === req.generationChar;
      if (req.generationPosition === "second") return chars[1] === req.generationChar;
      return chars.includes(req.generationChar);
    }).length;
    genCompliance = gated.passed.length ? ok / gated.passed.length : 0;
  }
  let tabooCompliance = 1;
  if (req.tabooChars.length) {
    const bad = raw.filter((c) => req.tabooChars.some((t) => c.givenName.includes(t))).length;
    tabooCompliance = raw.length ? 1 - bad / raw.length : 1;
  }
  const lengthOk = raw.length
    ? raw.filter((c) => [...c.givenName].length === req.nameLength).length / raw.length
    : 0;
  const completeness =
    gated.passed.length > 0
      ? gated.passed.reduce((s, c) => s + fieldCompleteness(c), 0) / gated.passed.length
      : 0;
  const emptyTalk =
    gated.passed.length > 0
      ? gated.passed.reduce((s, c) => s + emptyTalkScore(c), 0) / gated.passed.length
      : 1;
  const unique = new Set(gated.passed.map((c) => c.givenName)).size;
  const enough = Math.min(1, gated.passed.length / need);
  let score =
    (parseOk ? 12 : 0) +
    enough * 20 +
    passRate * 15 +
    genCompliance * 15 +
    tabooCompliance * 10 +
    lengthOk * 10 +
    completeness * 10 +
    (1 - emptyTalk) * 5 +
    Math.min(1, unique / need) * 3 -
    Math.min(10, l1Count * 5);
  if (fromFallback) score -= 8; // penalize degraded extraction
  return {
    ms,
    parseOk,
    fromFallback: !!fromFallback,
    rawCount: raw.length,
    passCount: gated.passed.length,
    elimCount: gated.eliminated.length,
    passRate: round(passRate),
    l1Count,
    genCompliance: round(genCompliance),
    tabooCompliance: round(tabooCompliance),
    lengthOk: round(lengthOk),
    completeness: round(completeness),
    emptyTalk: round(emptyTalk),
    uniquePass: unique,
    enough: gated.passed.length >= need,
    score: round(Math.max(0, score)),
    sampleNames: gated.passed.slice(0, 5).map((c) => c.givenName),
  };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function avg(arr, key) {
  if (!arr.length) return 0;
  return round(arr.reduce((s, x) => s + (x[key] || 0), 0) / arr.length);
}

async function main() {
  console.log("=== 瑾瑜 LLM bench v2 (content+reasoning+fallback) ===");
  for (const m of MODELS) {
    console.log(`model ${m.id}: ${m.model} key=${m.apiKey ? "yes" : "NO"}`);
    if (!m.apiKey) process.exit(2);
  }

  const all = [];
  for (const model of MODELS) {
    for (const sc of SCENARIOS) {
      for (let r = 0; r < REPEATS; r++) {
        const label = `${model.id} / ${sc.name} #${r + 1}`;
        process.stdout.write(`… ${label} `);
        try {
          const resp = await callChat(model, buildMessages(sc.req));
          if (!resp.ok) {
            console.log(`ERR ${resp.error} (${resp.ms}ms)`);
            all.push({
              modelId: model.id,
              scenario: sc.name,
              repeat: r + 1,
              ms: resp.ms,
              parseOk: false,
              error: resp.error,
              score: 0,
              enough: false,
              rawCount: 0,
              passCount: 0,
              sampleNames: [],
              fromFallback: false,
            });
            continue;
          }
          let raw = parseCandidates(resp.content);
          let fromFallback = false;
          if (!raw.length && resp.reasoning) {
            raw = parseCandidates(resp.reasoning);
          }
          if (!raw.length && resp.reasoning) {
            raw = extractNamesFromReasoning(resp.reasoning, sc.req.nameLength);
            fromFallback = raw.length > 0;
          }
          raw = raw.map((c) => ({
            ...c,
            givenName: c.givenName.startsWith(sc.req.surname)
              ? c.givenName.slice(sc.req.surname.length)
              : c.givenName,
          }));
          const gated = hardGate(raw, sc.req);
          const metrics = scoreRun(raw, gated, sc.req, resp.ms, raw.length > 0, fromFallback);
          console.log(
            `score=${metrics.score} pass=${metrics.passCount}/${metrics.rawCount} ${metrics.ms}ms fb=${fromFallback} [${metrics.sampleNames.join("、")}]`,
          );
          all.push({
            modelId: model.id,
            scenario: sc.name,
            repeat: r + 1,
            ...metrics,
            error: null,
            contentLen: resp.content.length,
            reasoningLen: resp.reasoning.length,
          });
        } catch (e) {
          console.log(`THROW ${e.message || e}`);
          all.push({
            modelId: model.id,
            scenario: sc.name,
            repeat: r + 1,
            ms: 0,
            parseOk: false,
            error: String(e.message || e),
            score: 0,
            enough: false,
            rawCount: 0,
            passCount: 0,
            sampleNames: [],
            fromFallback: false,
          });
        }
      }
    }
  }

  const summary = MODELS.map((m) => {
    const rows = all.filter((x) => x.modelId === m.id);
    const okRows = rows.filter((x) => x.parseOk);
    const paidOk = rows.filter((x) => !x.error);
    return {
      modelId: m.id,
      runs: rows.length,
      successfulHttp: paidOk.length,
      parseSuccessRate: round(okRows.length / Math.max(1, paidOk.length)),
      avgScore: avg(paidOk.length ? paidOk : rows, "score"),
      avgMs: avg(paidOk.length ? paidOk : rows, "ms"),
      avgPassCount: avg(paidOk.length ? paidOk : rows, "passCount"),
      enoughRate: round(rows.filter((x) => x.enough).length / Math.max(1, paidOk.length)),
      avgGenCompliance: avg(
        rows.filter((x) => x.scenario === "male_generation_first" && !x.error),
        "genCompliance",
      ),
      avgTabooCompliance: avg(
        rows.filter((x) => x.scenario === "female_taboo" && !x.error),
        "tabooCompliance",
      ),
      avgCompleteness: avg(
        rows.filter((x) => !x.error),
        "completeness",
      ),
      fallbackRate: round(rows.filter((x) => x.fromFallback).length / Math.max(1, paidOk.length)),
      totalL1: rows.reduce((s, x) => s + (x.l1Count || 0), 0),
      errors: rows.filter((x) => x.error).length,
      samplePool: [...new Set(rows.flatMap((x) => x.sampleNames || []))].slice(0, 15),
    };
  });

  // Prefer models with more successful HTTP runs when comparing
  summary.sort((a, b) => {
    if (a.successfulHttp !== b.successfulHttp) return b.successfulHttp - a.successfulHttp;
    return b.avgScore - a.avgScore || a.avgMs - b.avgMs;
  });

  const md = [];
  md.push("# LLM 对比 v2：step-3.7-flash vs DeepSeek-V4-Flash");
  md.push("");
  md.push(`Date: ${new Date().toISOString()}`);
  md.push("");
  md.push("## 方法修正");
  md.push("");
  md.push("- 读取 `content`；为空则读 `reasoning`；仍无 JSON 则从引号中文名降级抽取（扣分）");
  md.push("- `max_tokens=4096`，prompt 要求 content 只放 JSON");
  md.push("- 汇总分母优先用「HTTP 成功」次数，避免余额不足拉低对手");
  md.push("");
  md.push("## 汇总");
  md.push("");
  md.push(
    "| 模型 | 成功请求 | 均分 | 均延迟ms | 解析率 | 够用率 | 均过闸 | 辈分 | 避讳 | 完整度 | 降级率 | 错误 |",
  );
  md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of summary) {
    md.push(
      `| ${s.modelId} | ${s.successfulHttp}/${s.runs} | ${s.avgScore} | ${s.avgMs} | ${s.parseSuccessRate} | ${s.enoughRate} | ${s.avgPassCount} | ${s.avgGenCompliance} | ${s.avgTabooCompliance} | ${s.avgCompleteness} | ${s.fallbackRate} | ${s.errors} |`,
    );
  }
  md.push("");
  md.push("## 样例");
  md.push("");
  for (const s of summary) {
    md.push(`- **${s.modelId}**：${s.samplePool.join("、") || "—"}`);
  }
  md.push("");
  md.push("## 结论");
  md.push("");
  const step = summary.find((s) => s.modelId.includes("step"));
  const ds = summary.find((s) => s.modelId.includes("DeepSeek"));
  if (step && ds) {
    if (ds.successfulHttp < 3) {
      md.push(
        `DeepSeek-V4-Flash 仅完成 ${ds.successfulHttp} 次有效请求（后续 SiliconFlow 余额不足），**对比不完整**。`,
      );
    }
    if (ds.successfulHttp > 0 && ds.avgScore > step.avgScore + 5) {
      md.push(
        `在有效样本上 DeepSeek 均分更高（${ds.avgScore} vs ${step.avgScore}）。若充值后仍稳定，可考虑切换 SiliconFlow + \`deepseek-ai/DeepSeek-V4-Flash\`。`,
      );
    } else if (step.avgScore >= ds.avgScore) {
      md.push(
        `在当前可跑通样本上 **step-3.7-flash 可用且已是产品默认**（均分 ${step.avgScore}）。DeepSeek 样本不足时 **维持 StepFun**。`,
      );
    }
    md.push("");
    md.push("### 系统适配注意（step-3.7-flash）");
    md.push("");
    md.push(
      "该模型常把推理写在 `reasoning`、`content` 为空。产品侧已改为：优先 content → reasoning JSON → 引号名降级抽取。否则会「看起来成功但 0 候选」。",
    );
  }
  md.push("");
  md.push("## 分场景");
  md.push("");
  for (const sc of SCENARIOS) {
    md.push(`### ${sc.name}`);
    for (const m of MODELS) {
      const rows = all.filter((x) => x.modelId === m.id && x.scenario === sc.name);
      md.push(
        `- ${m.id}: score=${rows.map((r) => r.score).join(",")} pass=${rows.map((r) => r.passCount).join(",")} ms=${rows.map((r) => r.ms).join(",")} err=${rows.map((r) => (r.error ? "Y" : "n")).join(",")} names=${rows.map((r) => (r.sampleNames || []).join("/")).join(" | ")}`,
      );
    }
    md.push("");
  }

  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(process.cwd(), `data/llm-bench-${stamp}.json`), JSON.stringify({ summary, runs: all }, null, 2));
  writeFileSync(resolve(process.cwd(), `data/llm-bench-${stamp}.md`), md.join("\n"));
  writeFileSync(resolve(process.cwd(), "data/llm-bench-latest.json"), JSON.stringify({ summary, runs: all }, null, 2));
  writeFileSync(resolve(process.cwd(), "data/llm-bench-latest.md"), md.join("\n"));
  console.log("\n" + md.join("\n"));
  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
