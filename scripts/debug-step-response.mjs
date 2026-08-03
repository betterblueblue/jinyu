import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  const map = {};
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
const url = `${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`;

const body = {
  model: env.LLM_MODEL || "step-3.7-flash",
  messages: [
    {
      role: "system",
      content:
        '你是中文起名助手。只输出 JSON，不要 markdown。输出格式：{"candidates":[{"givenName":"名不含姓","genderLean":"male|female|neutral","phonology":"","glyph":"","meaning":"","origin":"","pitfalls":"","styleFit":""}]}',
    },
    {
      role: "user",
      content: JSON.stringify({
        surname: "王",
        gender: "male",
        nameLength: 2,
        count: 6,
        instruction: "请生成多个候选名（不含姓）。",
      }),
    },
  ],
  temperature: 0.8,
  max_tokens: 2000,
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.LLM_API_KEY}`,
  },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log("status", res.status);
console.log("body keys sample:");
try {
  const data = JSON.parse(text);
  console.log("top keys", Object.keys(data));
  const ch = data.choices?.[0];
  console.log("choice keys", ch ? Object.keys(ch) : null);
  console.log("message keys", ch?.message ? Object.keys(ch.message) : null);
  console.log("content type", typeof ch?.message?.content);
  console.log("content length", (ch?.message?.content || "").length);
  console.log("content head:", String(ch?.message?.content || "").slice(0, 500));
  console.log("reasoning head:", String(ch?.message?.reasoning || "").slice(0, 200));
  // dump full message without flooding
  console.log("full message JSON:", JSON.stringify(ch?.message, null, 2).slice(0, 2000));
} catch (e) {
  console.log("parse fail", e.message, text.slice(0, 800));
}
