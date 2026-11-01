import { pinyin } from "pinyin-pro";
import { toSimplified } from "@/domain/analysis/chars";
import type { NameSplit } from "@/domain/analysis/types";
import { nameSyllables } from "@/domain/pinyin-name";
import { BANNED_TALK_WORDS } from "@/library/talk";
import type { CharFixProvider } from "@/providers/fix-provider";
import { sameSoundCandidates } from "./candidates";
import type { FixIssue, FixPromptInput, RawFix, RawFixOption } from "./fix-prompt";
import { HARD_SOUND_POINTS } from "./next-step";
import { heardIssue, scoreName } from "./score";
import type { Deduction, FixOption, FixOutcome, NameScore } from "./types";

/**
 * 改字：只改名里的一个字。改哪个、改成什么、改一个字够不够，由模型看扣分理由判断（2026-11-01 用户定）。
 *
 * 代码只核能机械判断的，核不过的一律丢掉，宁可说「没挑出来」，也不让主播念一个没核过的名字：
 *   1. 新旧名字只差一个字，姓不动；
 *   2. 用同一套规则重新打分，必须比原来高；
 *   3. 换上的字自己不被扣分（拿一个毛病换另一个毛病不算改好）；
 *   4. 那个字身上是听出来的毛病（年代感、撞名、谐音……），读音必须变；
 *   5. 有读音硬伤（谐音、娣）的，改完不能还带着；
 *   6. 寓意不空、不超长、不碰命理禁词、不引大段原文。
 * 模型一边写，这里一边核，核过一条就交给 onOption（接口推给直播台和提词页）。
 */

const MAX_OPTIONS = 3;
const WHY_MAX = 20;
const MEANING_MIN = 12;
const MEANING_MAX = 120;
const NONE_MAX = 100;
/** 引号里超过这么多字，多半是诗句原文：没核过，不念 */
const QUOTE_MAX = 6;
/** 理由和寓意里不许出现分数和五格术语：分数由代码算，术语观众听不懂 */
const BANNED_FIX = /(\d+\s*分|五格|三才|数理)/;

function squash(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, "").trim() : "";
}

/** 一句话能不能当众念：长度合适、没有命理词和五行说法、没有大段引文。「名字好在哪」（merit.ts）也用 */
export function sayable(text: string, max: number, min = 1): boolean {
  const n = [...text].length;
  if (n < min || n > max) return false;
  if (BANNED_TALK_WORDS.some((w) => text.includes(w)) || BANNED_FIX.test(text)) return false;
  if (/[补缺][金木水火土]/.test(text)) return false;
  for (const m of text.matchAll(/[「“"]([^」”"]*)[」”"]/g)) if ([...(m[1] ?? "")].length > QUOTE_MAX) return false;
  return true;
}

function cleanWhy(raw: unknown, from: string, to: string): string {
  const text = squash(raw).replace(/[「」『』"“”]/g, "");
  if (text && sayable(text, 200)) {
    if ([...text].length <= WHY_MAX) return text;
    const head = [...text].slice(0, WHY_MAX).join("");
    const cut = head.search(/[，。；！？][^，。；！？]*$/);
    return cut > 4 ? head.slice(0, cut) : head;
  }
  return `「${to}」换下「${from}」`;
}

function cleanMeaning(raw: unknown): string | null {
  const text = squash(raw);
  if (!sayable(text, MEANING_MAX, MEANING_MIN)) return null;
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

/** 模型说改不了的原因：太长的在句号逗号处截短，不整句换掉（原因本身主播要念）；碰禁词才换成固定说法 */
function cleanNone(raw: unknown): string | undefined {
  // 面板和提词页后面会接「建议重新起名」，模型自己写了就去掉，免得念两遍
  let text = squash(raw)
    .replace(/[。！？]+$/, "")
    .replace(/[，,；;]?(建议|最好|可以|请)?(观众)?(直接)?重新起名$/, "");
  if (!text) return undefined;
  if ([...text].length > NONE_MAX) {
    const head = [...text].slice(0, NONE_MAX).join("");
    const cut = head.search(/[，。；！？][^，。；！？]*$/);
    text = cut > 8 ? head.slice(0, cut) : head;
  }
  return sayable(text, NONE_MAX) ? text : "改一个字解决不了这个毛病";
}

/** 名里第 index 个字在整名里的读音（带声调），如 hóng */
function markAt(surname: string, givenName: string, index: number): string {
  const marks = pinyin(`${toSimplified(surname)}${toSimplified(givenName)}`, { type: "array", surname: "head" });
  return String(marks[[...surname].length + index] ?? "");
}

/** 不带声调的读音，和打分时查谐音用的是同一个函数 */
function plainAt(surname: string, givenName: string, index: number): string {
  const syllables = nameSyllables(`${toSimplified(surname)}${toSimplified(givenName)}`);
  return (syllables[[...surname].length + index]?.py ?? "").toLowerCase();
}

/**
 * 落在这个字上、听出来的毛病：换同音字改不掉。
 * 三声连读除外：同音同调的字换上去连读本来就还在，只扣 3 分，不因此挡掉看出来的毛病的改法。
 */
function heardAt(score: NameScore, index: number): Deduction[] {
  return score.deductions.filter((d) => d.positions.includes(index) && heardIssue(d) && d.rule !== "sandhi");
}

/** 核验模型写的一个改法，见文件开头的 6 条。核不过返回 null */
export function verifyOption(raw: RawFixOption | null | undefined, score: NameScore, split: NameSplit): FixOption | null {
  if (!raw || typeof raw !== "object") return null;
  const oldGiven = [...split.givenName];
  let given = typeof raw.givenName === "string" ? raw.givenName.replace(/\s+/g, "") : "";
  // 模型偶尔连姓一起写
  if (given.startsWith(split.surname) && [...given].length === [...split.surname].length + oldGiven.length) {
    given = given.slice(split.surname.length);
  }
  const next = [...given];
  if (next.length !== oldGiven.length || next.some((c) => !/^[一-鿿]$/.test(c))) return null;
  const diff = next.map((c, i) => (c === oldGiven[i] ? -1 : i)).filter((i) => i >= 0);
  if (diff.length !== 1) return null;
  const index = diff[0]!;
  const from = oldGiven[index]!;
  const to = next[index]!;
  if (toSimplified(to) === toSimplified(from)) return null;

  const after = scoreName({ surname: split.surname, givenName: given, alternatives: [] }, score.gender);
  if (after.score <= score.score) return null;
  if (after.deductions.some((d) => d.positions.includes(index) && d.rule !== "sandhi")) return null;
  // 文红艳换成文红雁：分数按字查是变高了，可念出来还是「红艳」，等于没改
  if (heardAt(score, index).length > 0 && plainAt(split.surname, given, index) === plainAt(split.surname, split.givenName, index)) {
    return null;
  }
  if (after.deductions.some((d) => d.soundBound && d.points >= HARD_SOUND_POINTS)) return null;

  const meaning = cleanMeaning(raw.meaning);
  if (!meaning) return null;

  const oldMark = markAt(split.surname, split.givenName, index);
  const newMark = markAt(split.surname, given, index);
  return {
    fullName: `${split.surname}${given}`,
    givenName: given,
    from,
    to,
    index,
    pinyin: after.pinyin,
    soundLine: oldMark === newMark ? "读音不变" : `${oldMark} → ${newMark}`,
    score: after.score,
    band: after.band,
    bandLabel: after.bandLabel,
    why: cleanWhy(raw.why, from, to),
    meaning,
  };
}

/** 给模型的材料：扣分理由（标明听出来的还是看出来的），只有看出来的毛病的字附同音候选 */
export function buildFixInput(score: NameScore, split: NameSplit): FixPromptInput {
  const issues: FixIssue[] = score.deductions.map((d) => ({
    chars: d.chars,
    heard: heardIssue(d),
    points: d.points,
    line: d.line,
  }));
  const sameSound: FixPromptInput["sameSound"] = [];
  [...split.givenName].forEach((char, index) => {
    const here = score.deductions.filter((d) => d.positions.includes(index));
    if (here.length === 0 || heardAt(score, index).length > 0) return;
    const candidates = sameSoundCandidates(split, score.gender, index, 8).map((c) => c.char);
    if (candidates.length) sameSound.push({ index, char, candidates });
  });
  return {
    fullName: score.fullName,
    surname: split.surname,
    givenName: split.givenName,
    gender: score.gender,
    score: score.score,
    issues,
    sameSound,
  };
}

export async function suggestFixes(
  score: NameScore,
  split: NameSplit,
  provider: CharFixProvider,
  onOption?: (option: FixOption) => void,
): Promise<FixOutcome> {
  const started = Date.now();
  if (score.band === "great") {
    return { ok: true, options: [], message: "已经很好，不用改", tookMs: 0 };
  }

  const options: FixOption[] = [];
  let firstMs: number | undefined;
  let tried = 0;
  const take = (raw: RawFixOption) => {
    tried++;
    if (options.length >= MAX_OPTIONS) return;
    const option = verifyOption(raw, score, split);
    if (!option || options.some((o) => o.givenName === option.givenName)) return;
    options.push(option);
    firstMs ??= Date.now() - started;
    onOption?.(option);
  };

  let raw: RawFix | null;
  try {
    raw = await provider.pick(buildFixInput(score, split), take);
  } catch (err) {
    // 写到一半超时或断了：已经核过、推出去的改法照样算数
    if (options.length === 0) {
      const message = err instanceof Error ? err.message : "改字失败";
      return { ok: false, message: `改字没成功：${message}` };
    }
    raw = null;
  }

  // 边写边核时没赶上的（最后一条），收尾时补上
  const all = Array.isArray(raw?.options) ? (raw!.options as RawFixOption[]) : [];
  for (const item of all.slice(tried)) take(item);

  const unfixable = options.length === 0 ? cleanNone(raw?.none) : undefined;
  return {
    ok: true,
    options,
    ...(unfixable ? { unfixable } : {}),
    ...(options.length === 0 && !unfixable ? { message: "这次没挑出合适的字，可以再点一次" } : {}),
    tookMs: Date.now() - started,
    ...(firstMs !== undefined ? { firstMs } : {}),
  };
}
