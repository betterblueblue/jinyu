import { pinyin } from "pinyin-pro";
import { toSimplified } from "@/domain/analysis/chars";
import type { NameSplit } from "@/domain/analysis/types";
import type { CharFixProvider } from "@/providers/fix-provider";
import { sameSoundCandidates } from "./candidates";
import type { FixTarget, RawFix } from "./fix-prompt";
import { scoreName } from "./score";
import type { FixOption, FixOutcome, NameScore } from "./types";

/**
 * 改字：只换一个字、只换同音字。
 *
 * 流程：代码列出哪几个字该换、每个字的同音候选 → 模型挑字配理由 → 代码核验。
 * 核验不过的（候选以外的字、换完分数没变高的）一律丢掉，宁可说「没挑出来」，也不念一个编的字。
 */

/** 一次最多让模型看两个要换的字，再多推理会变长 */
const MAX_TARGETS = 2;
const MAX_OPTIONS = 3;
const MAX_WHY = 20;

/** 理由里不许出现分数和命理术语：分数由代码算，术语观众听不懂 */
const BANNED_WHY = /(\d+\s*分|五格|三才|数理|五行|八字|命理|运势)/;

function cleanWhy(raw: unknown, from: string, to: string): string {
  const text = typeof raw === "string" ? raw.replace(/[「」『』"“”]/g, "").replace(/\s+/g, "").trim() : "";
  if (!text || BANNED_WHY.test(text)) return `同音字，「${to}」比「${from}」更合适`;
  return [...text].slice(0, MAX_WHY).join("");
}

/** 名里第 index 个字在整名里的读音（带声调） */
function readingAt(split: NameSplit, index: number): string {
  const marks = pinyin(`${toSimplified(split.surname)}${toSimplified(split.givenName)}`, {
    type: "array",
    surname: "head",
  });
  return String(marks[[...split.surname].length + index] ?? "");
}

export function buildFixTargets(score: NameScore, split: NameSplit): FixTarget[] {
  const targets: FixTarget[] = [];
  for (const f of score.fixable) {
    if (targets.length >= MAX_TARGETS) break;
    const candidates = sameSoundCandidates(split, score.gender, f.index);
    if (candidates.length === 0) continue;
    targets.push({
      char: f.char,
      index: f.index,
      reading: readingAt(split, f.index),
      reasons: score.deductions.filter((d) => d.positions.includes(f.index)).map((d) => d.line),
      candidates: candidates.map(({ char, py, sameTone }) => ({ char, py, sameTone })),
    });
  }
  return targets;
}

/** 核验模型挑的字：必须在候选里，换完必须比原名分高 */
export function verifyPicks(raw: RawFix | null, targets: FixTarget[], split: NameSplit, score: NameScore): FixOption[] {
  const out: FixOption[] = [];
  const fixes = Array.isArray(raw?.fixes) ? (raw!.fixes as unknown[]) : [];
  for (const item of fixes) {
    if (!item || typeof item !== "object") continue;
    const fix = item as { from?: unknown; picks?: unknown };
    const from = typeof fix.from === "string" ? fix.from.trim() : "";
    const target = targets.find((t) => t.char === from) ?? (targets.length === 1 ? targets[0] : undefined);
    if (!target) continue;
    const picks = Array.isArray(fix.picks) ? (fix.picks as unknown[]) : [];
    for (const p of picks.slice(0, 2)) {
      if (!p || typeof p !== "object") continue;
      const pick = p as { char?: unknown; why?: unknown };
      const ch = typeof pick.char === "string" ? pick.char.trim() : "";
      if (!target.candidates.some((c) => c.char === ch)) continue;
      const givenName = [...split.givenName].map((c, i) => (i === target.index ? ch : c)).join("");
      if (out.some((o) => o.givenName === givenName)) continue;
      const next = scoreName({ surname: split.surname, givenName, alternatives: [] }, score.gender);
      if (next.score <= score.score) continue;
      out.push({
        fullName: `${split.surname}${givenName}`,
        givenName,
        from: target.char,
        to: ch,
        index: target.index,
        score: next.score,
        band: next.band,
        bandLabel: next.bandLabel,
        why: cleanWhy(pick.why, target.char, ch),
      });
    }
  }
  // 稳定排序：同分时保持「先换扣分最多的字、模型先挑的」顺序
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_OPTIONS);
}

export async function suggestFixes(score: NameScore, split: NameSplit, provider: CharFixProvider): Promise<FixOutcome> {
  const started = Date.now();
  if (score.fixable.length === 0) {
    return { ok: true, options: [], message: "这个名字没有要换的字", tookMs: 0 };
  }
  const targets = buildFixTargets(score, split);
  if (targets.length === 0) {
    return { ok: true, options: [], message: "要换的字找不到合适的同音字", tookMs: Date.now() - started };
  }

  let raw: RawFix | null;
  try {
    raw = await provider.pick({ fullName: score.fullName, gender: score.gender, targets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "挑字失败";
    return { ok: false, message: `挑字没成功：${message}` };
  }

  const options = verifyPicks(raw, targets, split, score);
  return {
    ok: true,
    options,
    ...(options.length ? {} : { message: "这次没挑出合适的字，可以再点一次" }),
    tookMs: Date.now() - started,
  };
}
