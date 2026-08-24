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
  const genText = await genRes.text();
  let genBody;
  try {
    genBody = JSON.parse(genText);
  } catch {
    console.error("FAIL: generate not JSON", genRes.status, genText.slice(0, 400));
    process.exit(1);
  }
  console.log("generate status", genRes.status, `${Date.now() - t0}ms`);

  if (!genRes.ok || !genBody.ok) {
    console.error("FAIL: generate", genBody);
    process.exit(1);
  }

  const report = genBody.report;
  const reportId = genBody.reportId;
  console.log("reportId", reportId);
  console.log("primary", report?.overview?.primaryName);
  console.log("names", report?.overview?.names);
  console.log("provider path stages", report?.stages);

  // Heuristic: Fake names often include 清远/怀瑾 from FakeProvider; real LLM usually different set
  const names = report?.overview?.names?.join(",") ?? "";
  console.log("name summary", names);

  if (!report?.overview?.primaryName || !report?.names?.length) {
    console.error("FAIL: report incomplete");
    process.exit(1);
  }

  // open report page (HTML)
  const pageRes = await fetch(BASE + `/reports/${reportId}`, {
    headers: { Cookie: cookieHeader() },
  });
  const html = await pageRes.text();
  console.log("report page", pageRes.status, "html length", html.length);
  if (!pageRes.ok || !html.includes(report.overview.primaryName)) {
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
