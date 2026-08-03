/**
 * One-shot probe: real StepFun Chat Completions (not Fake).
 * Usage: node scripts/probe-stepfun.mjs
 * Reads LLM_* from process env or .env.local manually below via dotenv-less parse.
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
      if (!(k in process.env) || process.env[k] === "") process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const baseUrl = (process.env.LLM_BASE_URL || "https://api.stepfun.com/step_plan/v1").replace(
  /\/$/,
  "",
);
const apiKey = process.env.LLM_API_KEY || "";
const model = process.env.LLM_MODEL || "step-3.7-flash";

if (!apiKey) {
  console.error("FAIL: LLM_API_KEY empty");
  process.exit(2);
}

const url = `${baseUrl}/chat/completions`;
const body = {
  model,
  messages: [
    {
      role: "system",
      content:
        '你是起名助手。只输出 JSON：{"candidates":[{"givenName":"清远","genderLean":"male","meaning":"…"}]}',
    },
    {
      role: "user",
      content:
        '姓「王」，男，两字名，生成 3 个候选 givenName（不含姓）。JSON only。',
    },
  ],
  temperature: 0.7,
  max_tokens: 800,
};

console.log("POST", url);
console.log("model", model);
console.log("key prefix", apiKey.slice(0, 8) + "…");

const started = Date.now();
let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
} catch (err) {
  console.error("FAIL: network", err);
  process.exit(1);
}

const text = await res.text();
const ms = Date.now() - started;
console.log("status", res.status, res.statusText, `${ms}ms`);
console.log("body head:", text.slice(0, 800));

if (!res.ok) {
  console.error("FAIL: non-2xx");
  process.exit(1);
}

let content = "";
try {
  const data = JSON.parse(text);
  content = data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 500);
  console.log("assistant content:", content.slice(0, 1000));
} catch {
  console.error("FAIL: response not JSON");
  process.exit(1);
}

if (!content || content.length < 5) {
  console.error("FAIL: empty content");
  process.exit(1);
}

console.log("OK: StepFun chat/completions reachable and returned content");
