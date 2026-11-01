import { extractJson, type ChatMessage } from "@/providers/chat";
import type { AnalysisGender } from "@/domain/analysis/types";
import { HOT_CHARS } from "./lexicon";

/**
 * 改字的提示词（2026-11-01 重写，用户定）：改哪个字、改成什么、改一个字够不够，都交给模型判断。
 *
 * 以前代码先列出「能换的字」和同音候选，模型只从候选里挑。那样只能换同音字，
 * 年代感、撞名这类听出来的毛病换了写法还在（文红艳 → 文红雁）；靠代码一条条列也穷举不完。
 * 现在给模型的是扣分理由本身，每条标明是听出来的还是看出来的，模型自己定怎么改。
 *
 * 代码只核能机械判断的（fix.ts）：只差一个字、换完分数变高、换上的字不被扣分、
 * 听出来的毛病读音得变、寓意不碰禁词。寓意的写法照提词页的稿子（src/fast/talk.ts）：
 * 拆字、合起来的画面和祝福，不讲出处、不说空话、不碰命理。
 */

export interface FixIssue {
  /** 扣分落在哪几个字上，整名规则为空 */
  chars: string[];
  /** 听出来的毛病（谐音、年代感、撞名、和姓连读……）：同音的写法改不掉，读音得变 */
  heard: boolean;
  points: number;
  /** 打分时主播念的那句话 */
  line: string;
}

export interface FixPromptInput {
  fullName: string;
  surname: string;
  givenName: string;
  gender: AnalysisGender;
  score: number;
  issues: FixIssue[];
  /** 只有看出来的毛病的字，给同音候选：保留读音就能改好的，优先从这里挑 */
  sameSound: { index: number; char: string; candidates: string[] }[];
}

/** 模型的原始输出，字段都没核过 */
export interface RawFixOption {
  givenName?: unknown;
  why?: unknown;
  meaning?: unknown;
}

export interface RawFix {
  options?: unknown;
  none?: unknown;
}

const SYSTEM = [
  "你是直播间里的起名顾问。观众报了孩子的名字，规则打完分、列了扣分理由，你帮主播把名字改得更好：只改名里的一个字。只输出 JSON。",
  "",
  "怎么改：",
  "- 姓不动，名的字数不变，只换一个字。先看扣分理由，换掉毛病最大的那个字。",
  "- 理由标了【听出来的】（谐音、年代感、撞名、和姓连读、热门字），说明毛病在读音上：名字是被念、被听到的，换个同音的写法还是那个音，所以要换成读音不同的字。",
  "- 理由标了【看出来的】（字义不好、字太大、生僻、容易念错、男女用字），尽量保留原来的读音，优先从给出的同音候选里挑；候选都不合适，再换别的字。",
  "- 换上的字要常用、好认、只有一个读音、意思好；不用生僻、古怪、贬义、老气的字，也不用这几年用得最多的字：" + [...HOT_CHARS].join("") + "。",
  "- 毛病出在两个字合起来、或者改一个字怎么都改不掉，就不要硬凑：options 给空数组，none 写一句原因，主播会请观众重新起名。",
  "",
  "最多 3 个改法，每个写三样：",
  "- givenName：改完的名，不带姓。",
  "- why：15 字以内，说新名字好在哪，打分榜上显示。",
  "- meaning：寓意，主播照着念给观众听。先说两个字各是什么意思，再说合起来的画面，最后一句对孩子的祝福，80 字以内。用大白话，要有画面、有涵养；名字出自成语的可以点出成语。",
  "- 没换掉的那个字如果也在扣分理由里，寓意里不要夸它被扣分的那一点：扣的是字太大（宸、懿），就只讲字的本义，不说尊贵、大气、帝王；扣的是年代感，照常讲字义就行。",
  "",
  "不要写：「寓意深远」「气质不凡」「大气」这类空话；诗句原文和出处；五行、八字、命理、运势、旺；分数。",
  "推理不超过 150 字，不要逐个分析候选字。",
  "",
  "格式示例（只看格式，别照抄内容）：",
  '{"options":[{"givenName":"益卓","why":"换掉容易念错的仡","meaning":"益是增益、长进，卓是高而直立。合起来是一天比一天长进、站得直走得正，愿孩子越学越有出息。"}],"none":""}',
  "",
  '输出：{"options":[{"givenName":"","why":"","meaning":""}],"none":""}',
].join("\n");

export function buildFixMessages(input: FixPromptInput): ChatMessage[] {
  const who = input.gender === "male" ? "男孩" : input.gender === "female" ? "女孩" : "孩子，性别没说";
  const lines = [`名字：${input.fullName}（姓${input.surname}，名${input.givenName}，${who}）`, `规则打分：${input.score} 分。扣分理由：`];
  input.issues.forEach((it, i) => {
    const where = it.chars.length ? `「${it.chars.join("")}」` : "整个名字";
    lines.push(`${i + 1}. 【${it.heard ? "听出来的" : "看出来的"}】${where}，扣 ${it.points} 分：${it.line}`);
  });
  for (const s of input.sameSound) {
    lines.push(`「${s.char}」保留读音的同音候选：${s.candidates.join("、")}`);
  }
  lines.push("", "按要求改一个字，最多 3 个改法。只输出 JSON。");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

export function parseFixOutput(content: string): RawFix | null {
  const tryParse = (s: string | null): RawFix | null => {
    if (!s) return null;
    try {
      const parsed = JSON.parse(s) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RawFix) : null;
    } catch {
      return null;
    }
  };
  return tryParse(content.trim()) ?? tryParse(extractJson(content));
}

/**
 * 模型还在写的时候，从已经收到的正文里取出 options 数组里已经写完的那几个对象。
 * 一条写完就交出去核验、推给主播，不等整份 JSON 收完。没写完的那一条不动，下次再看。
 */
export function completedOptions(partial: string): RawFixOption[] {
  const key = partial.search(/"options"\s*:\s*\[/);
  if (key < 0) return [];
  const out: RawFixOption[] = [];
  let i = partial.indexOf("[", key) + 1;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (; i < partial.length; i++) {
    const c = partial[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth < 0) break;
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(partial.slice(start, i + 1)) as unknown;
          if (obj && typeof obj === "object") out.push(obj as RawFixOption);
        } catch {
          /* 这一条写坏了，跳过 */
        }
        start = -1;
      }
    } else if (c === "]" && depth === 0) {
      break;
    }
  }
  return out;
}
