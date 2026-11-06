import { assembleReport } from "@/domain/assembler";
import { buildBaziSummary } from "@/domain/bazi";
import { rankSoft } from "@/domain/soft-ranker";
import type { EliminationNote, GatedCandidate, GenerationResult, NormalizedRequest } from "@/domain/types";
import { checkCitation, hardProblems } from "./checks";
import { failText, simpleCall, str } from "./llm";

/**
 * 简化版完整起名（2026-11-06）：一段短提示词、low、调一次模型；程序只去掉硬伤和没做到要求的，不重试。
 * 报告还是现在那个样子（assembleReport），页面不用改。
 * 盲选 1:4:1（现在 : 简化 : 差不多），中位 47 秒；现在的系统 xhigh 中位 142 秒，最慢 482 秒还失败。
 */

const GW = { male: "男孩", female: "女孩", unknown: "性别还不知道" } as const;

export function fullPrompt(req: NormalizedRequest, pillars?: string): string {
  const len = req.nameLength === "one" ? 1 : 2;
  const lines = [`给宝宝起名：姓${req.surname}，${GW[req.gender]}，名${len === 1 ? "只要一个字（全名两个字）" : "要两个字（全名三个字）"}。`];
  if (req.birthStatus === "unborn") lines.push(`还没出生${req.dueDate ? `，预产期 ${req.dueDate}` : ""}。`);
  if (req.baziEnabled && req.birthDate) {
    lines.push(
      `生日 ${req.birthDate}${req.birthHour ? ` ${req.birthHour} 点` : ""}${pillars ? `，八字 ${pillars}` : ""}。可以参考出生季节和八字，说法要温和，不下定论，句子里不写天干地支。`,
    );
  }
  if (req.generationChar) {
    const pos = req.generationPosition === "first" ? "名的第一个字" : req.generationPosition === "second" ? "名的第二个字" : "名里";
    lines.push(`辈分字「${req.generationChar}」，必须放在${pos}。`);
  }
  if (req.tabooChars.length) lines.push(`避讳字：${req.tabooChars.join("、")}，名里不能出现。`);
  if (req.avoidPopular) lines.push("尽量避开这些年流行的名字。");
  if (req.requirements) lines.push(`家里的要求：${req.requirements}`);
  lines.push(
    `起 ${req.gender === "unknown" ? "8 个（男孩、女孩都要有，也可以有中性的）" : "6 个"}，按推荐顺序排。不要生僻字、多音字、网红名。`,
    "每个名写清楚两个字各是什么意思、合起来为什么成立；有靠得住的古诗文出处就写原句，没有就不写，不要编。",
    `JSON：{"names":[{"givenName":"名（不带姓）","pinyin":"带声调拼音","gender":"male/female/neutral","meaning":"整体意思","composition":"两个字为什么搭","source":"书名","piece":"篇名","quote":"原句"${req.baziEnabled ? ',"baziFit":"和出生季节合不合，一句"' : ""}}]}`,
  );
  return lines.join("\n");
}

export async function runSimpleGeneration(
  req: NormalizedRequest,
  onProgress?: (evt: { type: "thinking"; text: string } | { type: "stage"; stage: string }) => void,
): Promise<GenerationResult> {
  const stages = ["candidates"];
  const bazi = buildBaziSummary(req);
  if (!bazi.ok) return { ok: false, stage: "assemble", errorCode: "BAZI_REJECTED", message: bazi.message, relaxations: [] };

  let raw: Record<string, unknown> | null;
  try {
    const r = await simpleCall(fullPrompt(req, bazi.summary?.pillarsText), {
      onThinking: (t) => onProgress?.({ type: "thinking", text: t }),
    });
    raw = r.json;
    if (!raw) {
      return {
        ok: false, stage: "candidates", errorCode: "GENERATION_ERROR", relaxations: [],
        message: `${failText(r.finishReason)}，请再试一次`,
      };
    }
  } catch (err) {
    return { ok: false, stage: "candidates", errorCode: "GENERATION_ERROR", relaxations: [], message: `生成过程出错：${err instanceof Error ? err.message : "未知错误"}` };
  }

  stages.push("filter");
  onProgress?.({ type: "stage", stage: "filter" });
  const wantLen = req.nameLength === "one" ? 1 : 2;
  const list = (Array.isArray(raw.names) ? raw.names : []) as Record<string, unknown>[];
  const passed: GatedCandidate[] = [];
  const eliminated: EliminationNote[] = [];
  const seen = new Set<string>();
  for (const n of list) {
    const givenName = str(n.givenName, 4).replace(new RegExp(`^${req.surname}`), "");
    const reasons: string[] = [];
    const chars = [...givenName];
    if (chars.length !== wantLen) reasons.push(`字数不符（需要${wantLen}字名）`);
    if (req.tabooChars.some((t) => givenName.includes(t))) reasons.push("含避讳字");
    if (req.generationChar) {
      const g = req.generationChar;
      const ok = req.generationPosition === "first" ? chars[0] === g : req.generationPosition === "second" ? (chars.length === 1 ? chars[0] === g : chars[1] === g) : chars.includes(g);
      if (!ok) reasons.push(`缺少辈分字「${g}」`);
    }
    if (seen.has(givenName)) reasons.push("重复候选");
    const lean = str(n.gender) === "male" || str(n.gender) === "female" ? (str(n.gender) as "male" | "female") : "neutral";
    let hotChar = false;
    if (!reasons.length) {
      const exempt = req.generationChar ? chars.map((c, i) => (c === req.generationChar ? i : -1)).filter((i) => i >= 0) : [];
      const gender = req.gender !== "unknown" ? req.gender : lean === "neutral" ? "unknown" : lean;
      const p = hardProblems(req.surname, givenName, gender, exempt);
      reasons.push(...p.reasons);
      hotChar = p.hotChar;
    }
    if (reasons.length) {
      eliminated.push({ givenName: givenName || "(空)", reasons });
      continue;
    }
    seen.add(givenName);
    const verified = checkCitation({ source: str(n.source), piece: str(n.piece), quote: str(n.quote) });
    passed.push({
      givenName,
      fullName: `${req.surname}${givenName}`,
      genderLean: lean,
      pinyin: str(n.pinyin, 40),
      meaning: str(n.meaning),
      composition: str(n.composition),
      ...(str(n.baziFit) ? { baziFit: str(n.baziFit) } : {}),
      ...(verified ? { verifiedCitation: verified } : {}),
      l2Hot: hotChar,
    });
  }
  if (!passed.length) {
    return {
      ok: false, stage: "filter", errorCode: "INSUFFICIENT_CANDIDATES", relaxations: [],
      message: `这一轮的名字都没过检查（${eliminated.slice(0, 3).map((e) => `${e.givenName}：${e.reasons[0]}`).join("；")}），请再试一次。`,
    };
  }

  stages.push("assemble");
  onProgress?.({ type: "stage", stage: "assemble" });
  const ranked = rankSoft(passed, req);
  const report = assembleReport({
    request: req, ranked: ranked.ranked, primaryIndex: ranked.primaryIndex, eliminated, notes: ranked.notes,
    relaxations: [], stages, bazi: bazi.summary,
  });
  report.providerName = "simple";
  report.source = "formal";
  return { ok: true, stage: "assemble", report };
}
