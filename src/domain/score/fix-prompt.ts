import { extractJson, type ChatMessage } from "@/providers/chat";
import type { AnalysisGender } from "@/domain/analysis/types";

/**
 * 改字的提示词：模型只做一件事，从给定的同音候选里挑字、配一句话。
 *
 * 写法照精简版实测出来的经验：
 *   - 不把原名以外的名字、已给过的名字念给模型听（逐个比对会把一轮拖到 14–31 秒）；
 *   - 候选已经由代码筛干净，模型不用再查谐音、笔画、热门度，推理限死在 60 字以内；
 *   - 挑出来的字代码还会再核一遍：不在候选里的一律丢掉。
 */

export interface FixTarget {
  /** 要换的字 */
  char: string;
  /** 在名里的位置，0 起 */
  index: number;
  /** 带声调的读音，如 chén */
  reading: string;
  /** 为什么要换，直接用打分时那几句话 */
  reasons: string[];
  candidates: { char: string; py: string; sameTone: boolean }[];
}

export interface FixPromptInput {
  fullName: string;
  gender: AnalysisGender;
  targets: FixTarget[];
}

export interface RawFix {
  fixes?: unknown;
}

const SYSTEM = [
  "你是起名顾问，正在直播里帮观众把名字里不合适的字换掉。只换字、不改读音，所以只能从给定的同音候选里挑。",
  "挑字标准：放进这个名字意思好、现代人常用、念出来自然。带贬义、老气、生僻、多用来做姓的字都不要。",
  "只输出 JSON，不要解释。推理不超过 60 字，不要逐个分析候选字。",
].join("\n");

export function buildFixMessages(input: FixPromptInput): ChatMessage[] {
  const who = input.gender === "male" ? "男孩" : input.gender === "female" ? "女孩" : "孩子，性别没说";
  const lines = [`名字：${input.fullName}（${who}）`, "要换的字："];
  input.targets.forEach((t, i) => {
    const cands = t.candidates.map((c) => (c.sameTone ? `${c.char}（${c.py}）` : `${c.char}（${c.py}，声调不同）`));
    lines.push(`${i + 1}. 「${t.char}」，名字第 ${t.index + 1} 个字，读 ${t.reading}。原因：${t.reasons.join(" ")}`);
    lines.push(`   同音候选：${cands.join("、")}`);
  });
  lines.push(
    "",
    "每个要换的字，从它自己的候选里挑最多 2 个，挑放进这个名字最自然、意思最好的。都不合适就给空数组，不要硬挑，也不要挑候选以外的字。",
    "每个挑出的字配一句理由，15 个字以内，说这个字好在哪，主播要当场念给观众听。",
    '输出：{"fixes":[{"from":"要换的字","picks":[{"char":"挑中的字","why":"理由"}]}]}',
  );
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

export function parseFixOutput(content: string): RawFix | null {
  const json = extractJson(content);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RawFix) : null;
  } catch {
    return null;
  }
}
