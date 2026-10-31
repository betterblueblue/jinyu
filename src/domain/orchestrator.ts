import { assembleReport } from "./assembler";
import { applyHardGate, assertNoForbiddenPadding } from "./gate";
import { buildBaziSummary } from "./bazi";
import { rankSoft } from "./soft-ranker";
import { corpusCatalog, verifyCitation } from "./analysis/corpus";
import type { CandidateProvider } from "@/providers/types";
import type { GatedCandidate, GenerationResult, NormalizedRequest } from "./types";

const MAX_ATTEMPTS = 2;
const MIN_KNOWN = 3;
const MIN_UNKNOWN = 4;
const LIVE_UNKNOWN_PER_GROUP = 3;

export type ProgressEvent =
  | { type: "thinking"; text: string }
  | { type: "stage"; stage: string };

export async function runGeneration(
  req: NormalizedRequest,
  provider: CandidateProvider,
  onProgress?: (evt: ProgressEvent) => void,
  options?: { source?: "live" | "formal" },
): Promise<GenerationResult> {
  const stages: string[] = [];
  const relaxations: string[] = [];
  const liveUnknownSix = options?.source === "live" && req.gender === "unknown";
  // 出处只认这些书：模型给的出处随后用同一份语料逐字核（verifyCitation），和名字分析用的是同一份书目
  const catalog = corpusCatalog()
    .filter((s) => s.available)
    .map((s) => s.name);
  const providerOptions = { liveUnknownSix, catalog };
  let stage: GenerationResult["stage"] = "candidates";

  const emitThinking = (chunk: string) => onProgress?.({ type: "thinking", text: chunk });

  try {
    stages.push("candidates");
    let allRaw = await provider.generateCandidates(req, 0, emitThinking, providerOptions);

    stage = "filter";
    stages.push("filter");
    onProgress?.({ type: "stage", stage: "filter" });
    let gate = applyHardGate(allRaw, req);

    if (!hasEnoughCandidates(gate.passed, req, liveUnknownSix)) {
      // limited retry
      const more = await provider.generateCandidates(req, 1, emitThinking, providerOptions);
      allRaw = [...allRaw, ...more];
      gate = applyHardGate(allRaw, req);
    }

    // 以前这里有一段「A+ 放宽：热门字可以当首推」，但放宽之后紧接着用同一个条件判失败，
    // 从来没生效过（2026-10-31 删）。硬规则本来就不放宽；候选不够就如实报不够。
    if (!hasEnoughCandidates(gate.passed, req, liveUnknownSix)) {
      return {
        ok: false,
        stage: "filter",
        errorCode: "INSUFFICIENT_CANDIDATES",
        message: buildInsufficientMessage(
          req,
          gate.eliminated.map((e) => e.reasons).flat(),
          liveUnknownSix,
        ),
        relaxations,
      };
    }

    // 出处一律回原文核验，核不过就当没有——不拿模糊说法充数
    const withCitations = gate.passed.map((c) => {
      if (!c.citation?.quote) return c;
      const outcome = verifyCitation({
        source: c.citation.source,
        piece: c.citation.piece,
        quote: c.citation.quote,
        gloss: c.citation.gloss,
      });
      return outcome.ok ? { ...c, verifiedCitation: outcome.citation } : c;
    });

    const ranked = rankSoft(withCitations, req);
    assertNoForbiddenPadding(ranked.ranked, req);

    stage = "assemble";
    stages.push("assemble");
    onProgress?.({ type: "stage", stage: "assemble" });

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
      notes: ranked.notes,
      relaxations,
      stages,
      bazi: baziResult.summary,
      liveUnknownSix,
    });
    // 记录生成来源 provider，供历史列表标注示例模式
    report.providerName = provider.name;
    // 记录生成入口：直播台还是正式取名页
    report.source = options?.source ?? "formal";

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

function hasEnoughCandidates(
  passed: GatedCandidate[],
  req: NormalizedRequest,
  liveUnknownSix: boolean,
): boolean {
  if (liveUnknownSix) {
    const male = passed.filter((c) => c.genderLean === "male").length;
    const female = passed.filter((c) => c.genderLean === "female").length;
    return male >= LIVE_UNKNOWN_PER_GROUP && female >= LIVE_UNKNOWN_PER_GROUP;
  }
  return passed.length >= minNeeded(req);
}

function buildInsufficientMessage(
  req: NormalizedRequest,
  reasons: string[],
  liveUnknownSix: boolean,
): string {
  const hints: string[] = [];
  if (req.generationChar) hints.push(`辈分字「${req.generationChar}」过严时可改位置或调整用字`);
  if (req.tabooChars.length) hints.push("避讳字过多会大幅减少可用名");
  if (req.avoidPopular) hints.push("可暂时关闭「尽量避开热门名」（仍会拦截最烂大街的网红模板）");
  if (reasons.some((r) => r.includes("网红"))) hints.push("许多过于常见的网红名已被排除，属预期行为");
  const extra = hints.length ? `建议：${hints.join("；")}。` : "请回表单放宽条件后重试。";
  if (liveUnknownSix) {
    return `男向或女向候选不足，直播模式需要两组各 ${LIVE_UNKNOWN_PER_GROUP} 个明确推荐，不会用中性名凑数。${extra}`;
  }
  return `可用候选不足，无法凑满精选推荐。硬规则（网红模板/避讳/辈分/字数）不会放宽。${extra}`;
}

export { MAX_ATTEMPTS };
