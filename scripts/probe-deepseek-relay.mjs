import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const map = {};
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    map[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return map;
}

const env = loadEnv();
const base = (env.DEEPSEEK_BASE_URL || "http://118.24.52.21:3000/v1").replace(/\/$/, "");
const key = env.DEEPSEEK_API_KEY || "";
const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";

// try with and without /v1 if needed
const urls = [`${base}/chat/completions`];
if (!base.endsWith("/v1")) urls.push(`${base}/v1/chat/completions`);

for (const url of urls) {
  console.log("POST", url, "model", model);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: '只输出 JSON：{"ok":true,"ping":1}' },
        ],
        max_tokens: 64,
        temperature: 0,
      }),
    });
    const text = await res.text();
    console.log("status", res.status, `${Date.now() - t0}ms`);
    console.log(text.slice(0, 400));
    if (res.ok) {
      console.log("OK_ENDPOINT", url);
      process.exit(0);
    }
  } catch (e) {
    console.log("fail", e.message);
  }
}
console.log("ALL_FAILED");
process.exit(1);
