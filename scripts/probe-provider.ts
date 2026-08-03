/**
 * Probe app StepFunProvider + gate parse path (not Fake).
 * Usage: pnpm exec tsx scripts/probe-provider.ts
 * Or: npx tsx after install — we use dynamic import of compiled logic via vitest-free node.
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
process.env.LLM_USE_FAKE = "false";

async function main() {
  const { StepFunProvider } = await import("../src/providers/stepfun-provider");
  const { applyHardGate } = await import("../src/domain/gate");
  const { normalizeRequest } = await import("../src/domain/normalizer");

  const n = normalizeRequest({ surname: "王", gender: "male", nameLength: "two" });
  if (!n.ok) {
    console.error("normalize fail", n.message);
    process.exit(1);
  }

  const provider = new StepFunProvider({
    baseUrl: process.env.LLM_BASE_URL || "https://api.stepfun.com/step_plan/v1",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "step-3.7-flash",
  });

  console.log("calling StepFunProvider.generateCandidates…");
  const started = Date.now();
  const raw = await provider.generateCandidates(n.value, 0);
  console.log(`got ${raw.length} raw candidates in ${Date.now() - started}ms`);
  console.log(JSON.stringify(raw.slice(0, 5), null, 2));

  if (!raw.length) {
    console.error("FAIL: zero candidates parsed");
    process.exit(1);
  }

  const gate = applyHardGate(raw, n.value);
  console.log(`after gate: passed=${gate.passed.length} eliminated=${gate.eliminated.length}`);
  console.log(
    "passed names:",
    gate.passed.map((p) => p.fullName).join("、"),
  );
  console.log("OK: app StepFunProvider + gate path works");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
