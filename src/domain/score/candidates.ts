import { pinyin, polyphonic } from "pinyin-pro";
import { getCharTable, toSimplified } from "@/domain/analysis/chars";
import { leanOf } from "@/domain/analysis/gender-lean";
import type { AnalysisGender, NameSplit } from "@/domain/analysis/types";
import { nameSyllables } from "@/domain/pinyin-name";
import { FOLK, FORBIDDEN, HOT_CHARS, NAME_CHAR_RANK } from "./lexicon";
import { scoreName } from "./score";

/**
 * 同音候选：给「改字」用的备选字。
 *
 * 只做机器能确定的筛选：同音（去声调后相同）、GB2312 一级字、不是多音字、
 * 不在不宜字 / 热门字 / 民俗扣分档里、性别倾向不冲突、换上以后分数确实变高。
 * 「放进名字好不好听、意思好不好」机器判断不了（试算时会出现「梓尘」这种），交给模型从这里面挑。
 */

export interface CharCandidate {
  char: string;
  /** 带声调的读音，如 chén */
  py: string;
  /** 和被换的字同一个声调 */
  sameTone: boolean;
  /** 换上以后整名的分数 */
  score: number;
}

interface SoundEntry {
  char: string;
  tone: number;
  mark: string;
}

let soundIndex: Map<string, SoundEntry[]> | null = null;

/** GB2312 一级字里的单音字，按去声调读音分组。第一次用时建，之后常驻 */
function getSoundIndex(): Map<string, SoundEntry[]> {
  if (soundIndex) return soundIndex;
  const map = new Map<string, SoundEntry[]>();
  const table = getCharTable();
  for (const [ch, level] of Object.entries(table.gb)) {
    if (level !== 1) continue;
    const readings = (polyphonic(ch, { type: "array", toneType: "none" }) as unknown as string[][])[0] ?? [];
    if (new Set(readings).size !== 1) continue;
    const num = String(pinyin(ch, { toneType: "num" }));
    const key = num.replace(/\d$/, "");
    const entry: SoundEntry = { char: ch, tone: Number(num.match(/(\d)$/)?.[1] ?? 0), mark: String(pinyin(ch)) };
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  soundIndex = map;
  return map;
}

/** 仅供测试：换了字表夹具后重建索引 */
export function resetSoundIndex(): void {
  soundIndex = null;
}

/**
 * 名里第 at 个字的同音候选，最多 limit 个。
 * 排序：同声调在前 → 名字库里常用的在前 → 换上后分数高的在前。
 */
export function sameSoundCandidates(
  split: NameSplit,
  gender: AnalysisGender,
  at: number,
  limit = 12,
): CharCandidate[] {
  const givOrig = [...split.givenName];
  const target = givOrig[at];
  if (!target) return [];
  const simpTarget = toSimplified(target);
  const syl = nameSyllables(`${toSimplified(split.surname)}${toSimplified(split.givenName)}`)[
    [...split.surname].length + at
  ];
  if (!syl?.py) return [];

  const base = scoreName(split, gender);
  const taken = new Set([...toSimplified(split.givenName), simpTarget]);

  const found: (CharCandidate & { rank: number })[] = [];
  for (const entry of getSoundIndex().get(syl.py.toLowerCase()) ?? []) {
    const c = entry.char;
    if (taken.has(c)) continue;
    if (FORBIDDEN.has(c) || HOT_CHARS.has(c)) continue;
    if ((FOLK.get(c)?.points ?? 0) > 0) continue;
    // 填了性别才按性别筛；没填时打分也不判性别，候选都留着，由模型按「性别没说」去挑
    const lean = leanOf(c);
    if (gender !== "unknown" && lean !== "neutral" && lean !== gender) continue;

    const nextGiven = givOrig.map((x, i) => (i === at ? c : x)).join("");
    const next = scoreName({ surname: split.surname, givenName: nextGiven, alternatives: [] }, gender);
    if (next.score <= base.score) continue;
    // 换上的字自己不能再被扣分，否则等于拿一个问题换另一个问题。
    // 三声连读例外：同音同调的字换上去，连读本来就还在，只扣 3 分，不该因此把同调的候选全刷掉。
    if (next.deductions.some((d) => d.positions.includes(at) && d.rule !== "sandhi")) continue;

    found.push({
      char: c,
      py: entry.mark,
      sameTone: entry.tone === syl.tone,
      score: next.score,
      rank: NAME_CHAR_RANK.get(c) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  found.sort((a, b) => Number(b.sameTone) - Number(a.sameTone) || a.rank - b.rank || b.score - a.score);
  return found.slice(0, limit).map(({ rank: _rank, ...c }) => c);
}
