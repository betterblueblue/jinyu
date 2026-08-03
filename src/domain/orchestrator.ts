import { assembleReport } from "./assembler";
import { applyHardGate, assertNoForbiddenPadding } from "./gate";
import { buildBaziSummary } from "./bazi";
import { rankSoft } from "./soft-ranker";
import type { CandidateProvider } from "@/providers/types";
import type { GenerationResult, NormalizedRequest } from "./types";

const MAX_ATTEMPTS = 2;
const MIN_KNOWN = 3;
const MIN_UNKNOWN = 4;

export async function runGeneration(
  req: NormalizedRequest,
  provider: CandidateProvider,
): Promise<GenerationResult> {
  const stages: string[] = [];
  const relaxations: string[] = [];
  let stage: GenerationResult["stage"] = "candidates";

  try {
    stages.push("candidates");
    let allRaw = await provider.generateCandidates(req, 0);

    stage = "filter";
    stages.push("filter");
    let gate = applyHardGate(allRaw, req);
    let allowL2Primary = false;

    if (countOk(gate.passed, req) < minNeeded(req)) {
      // limited retry
      const more = await provider.generateCandidates(req, 1);
      allRaw = [...allRaw, ...more];
      gate = applyHardGate(allRaw, req);
    }

    if (countOk(gate.passed, req) < minNeeded(req)) {
      // A+: relax soft only — allow L2 as primary, note style hard-fit relaxed
      allowL2Primary = true;
      relaxations.push("L2 可进入首推");
      relaxations.push("风格硬贴合");
      // re-rank later with allowL2Primary; no hard-rule relaxation
    }

    if (countOk(gate.passed, req) < minNeeded(req)) {
      return {
        ok: false,
        stage: "filter",
        errorCode: "INSUFFICIENT_CANDIDATES",
        message: buildInsufficientMessage(req, gate.eliminated.map((e) => e.reasons).flat()),
        relaxations,
      };
    }

    const ranked = rankSoft(gate.passed, req, { allowL2Primary });
    assertNoForbiddenPadding(ranked.ranked, req);

    stage = "assemble";
    stages.push("assemble");

    const baziResult = buildBaziSummary(req);
    if (!baziResult.ok) {
      return {
        ok: false,
        stage: "assemble",
        errorCode: "BAZI_REJECTED",
        message: baziResult.message,
        relaxations,
      };
    }

    const report = assembleReport({
      request: req,
      ranked: ranked.ranked,
      primaryIndex: ranked.primaryIndex,
      eliminated: gate.eliminated,
      styleNotes: ranked.styleNotes,
      relaxations,
      stages,
      bazi: baziResult.summary,
    });

    return { ok: true, stage: "assemble", report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成失败，请稍后重试";
    return {
      ok: false,
      stage,
      errorCode: "GENERATION_ERROR",
      message: `生成过程出错：${message}`,
      relaxations,
    };
  }
}

function minNeeded(req: NormalizedRequest): number {
  return req.gender === "unknown" ? MIN_UNKNOWN : MIN_KNOWN;
}

function countOk(passed: { length: number }, _req: NormalizedRequest): number {
  return passed.length;
}

function buildInsufficientMessage(req: NormalizedRequest, reasons: string[]): string {
  const hints: string[] = [];
  if (req.generationChar) hints.push(`辈分字「${req.generationChar}」过严时可改位置或调整用字`);
  if (req.tabooChars.length) hints.push("避讳字过多会大幅减少可用名");
  if (req.avoidPopular) hints.push("可暂时关闭「尽量避开热门名」（仍会拦截最烂大街 L1 模板）");
  if (reasons.some((r) => r.includes("L1"))) hints.push("许多常见网红名已被硬拦，属预期行为");
  const extra = hints.length ? `建议：${hints.join("；")}。` : "请回表单放宽条件后重试。";
  return `可用候选不足，无法凑满精选推荐。硬规则（L1/避讳/辈分/字数）不会放宽。${extra}`;
}

export { MAX_ATTEMPTS };
