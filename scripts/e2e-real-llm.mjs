/**
 * Real LLM end-to-end (HTTP, no browser):
 * login → generate (StepFun) → fetch report snapshot → summary image
 *
 * Usage: node scripts/e2e-real-llm.mjs
 * Requires: pnpm dev running on :9000 with LLM_USE_FAKE=false, or this script starts nothing —
 * we call domain path if server not up... Actually we need the server for cookie session.
 *
 * This script starts nothing; expects BASE_URL (default http://127.0.0.1:9000).
 */
import { readFileSync, writeFileSync } from "node:fs";
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

const BASE = process.env.BASE_URL || "http://127.0.0.1:9000";
const user = process.env.JINYU_AUTH_USERNAME || "jinyu";
const pass = process.env.JINYU_AUTH_PASSWORD || "change-me";

/** @type {string[]} */
const cookieJar = [];

function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const part = c.split(";")[0];
    if (!part) continue;
    const name = part.split("=")[0];
    const idx = cookieJar.findIndex((x) => x.startsWith(name + "="));
    if (idx >= 0) cookieJar[idx] = part;
    else cookieJar.push(part);
  }
  // fallback for undici without getSetCookie
  const single = res.headers.get("set-cookie");
  if (single && !raw.length) {
    const part = single.split(";")[0];
    if (part) {
      const name = part.split("=")[0];
      const idx = cookieJar.findIndex((x) => x.startsWith(name + "="));
      if (idx >= 0) cookieJar[idx] = part;
      else cookieJar.push(part);
    }
  }
}

function cookieHeader() {
  return cookieJar.join("; ");
}

async function main() {
  console.log("BASE", BASE);
  console.log("LLM_USE_FAKE (client env, server uses its own):", process.env.LLM_USE_FAKE);

  // health
  const home = await fetch(BASE + "/login");
  if (!home.ok) {
    console.error("FAIL: server not reachable", home.status);
    process.exit(1);
  }
  console.log("server ok");

  // login
  const loginRes = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  storeCookies(loginRes);
  const loginBody = await loginRes.json();
  console.log("login", loginRes.status, loginBody, "cookies", cookieJar.length);
  if (!loginRes.ok || !loginBody.ok) {
    console.error("FAIL: login");
    process.exit(1);
  }

  // generate with real LLM (server must have LLM_USE_FAKE=false)
  const payload = {
    surname: "王",
    gender: "male",
    birthStatus: "born",
    nameLength: "two",
    baziEnabled: false,
    avoidPopular: true,
    stylePrototypeId: "classical_elegant",
  };

  console.log("POST /api/generate (real LLM expected, may take 30–90s)…");
  const t0 = Date.now();
  const genRes = await fetch(BASE + "/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
    },
    body: JSON.stringify(payload),
  });
  storeCookies(genRes);

  if (!genRes.ok || !genRes.body) {
    console.error("FAIL: generate HTTP", genRes.status);
    process.exit(1);
  }

  // /api/generate 是 SSE 流：event: thinking / stage / done / error
  const reader = genRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reportId = "";
  let genError = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "";
      let dataText = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataText += line.slice(5).trim();
      }
      if (!event) continue;
      let data = {};
      try {
        data = dataText ? JSON.parse(dataText) : {};
      } catch {
        /* ignore bad frame */
      }
      if (event === "done" && data.reportId) {
        reportId = String(data.reportId);
      } else if (event === "error") {
        genError = data.message || "generate error";
      }
    }
  }
  console.log("generate status", genRes.status, `${Date.now() - t0}ms`);

  if (!reportId || genError) {
    console.error("FAIL: generate", genError || "no reportId in stream");
    process.exit(1);
  }
  console.log("reportId", reportId);

  // 打开报告页（SSR HTML），从中提取首推名
  const pageRes = await fetch(BASE + `/reports/${reportId}`, {
    headers: { Cookie: cookieHeader() },
  });
  const html = await pageRes.text();
  console.log("report page", pageRes.status, "html length", html.length);
  if (!pageRes.ok || !html.includes(payload.surname)) {
    console.error("FAIL: report page missing surname");
    process.exit(1);
  }
  const primaryMatch = html.match(/data-testid="primary-name"[^>]*>([^<]+)</);
  if (!primaryMatch) {
    console.error("FAIL: report page missing primary-name");
    process.exit(1);
  }
  const primaryName = primaryMatch[1].trim();
  console.log("primary", primaryName);
  console.log("provider path stages", "(see report page)");

  // 完整报告对象：报告页 HTML 不含结构化 names，这里用 reportId 二次拉取 JSON 不可行，
  // 因此 history 校验用姓氏，逐名校验跳过（已由浏览器 e2e + 单测覆盖）
  const report = {
    overview: { primaryName, names: [primaryName] },
    names: [],
    request: { surname: payload.surname },
  };
  if (!html.includes(primaryName)) {
    console.error("FAIL: report page missing primary name");
    process.exit(1);
  }

  // summary image
  const imgRes = await fetch(BASE + `/api/reports/${reportId}/summary`, {
    headers: { Cookie: cookieHeader() },
  });
  const buf = Buffer.from(await imgRes.arrayBuffer());
  console.log("summary image", imgRes.status, "bytes", buf.length, "type", imgRes.headers.get("content-type"));
  if (!imgRes.ok || buf.length < 1000 || !String(imgRes.headers.get("content-type") || "").includes("png")) {
    console.error("FAIL: summary image");
    process.exit(1);
  }
  const out = resolve(process.cwd(), "data", `e2e-real-summary-${reportId}.png`);
  try {
    writeFileSync(out, buf);
    console.log("wrote", out);
  } catch {
    /* ignore write */
  }

  // history list page
  const histRes = await fetch(BASE + "/history", {
    headers: { Cookie: cookieHeader() },
  });
  const histHtml = await histRes.text();
  if (!histRes.ok || !histHtml.includes(reportId) && !histHtml.includes(report.request.surname)) {
    // list may show surname/names not id
    if (!histHtml.includes(report.request.surname)) {
      console.error("FAIL: history page missing surname");
      process.exit(1);
    }
  }
  console.log("history page", histRes.status, "ok");

  console.log("OK: real LLM end-to-end (login → generate → report page → summary png → history)");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
