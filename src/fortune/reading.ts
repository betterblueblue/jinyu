import { chartFacts, findConflict } from "./consistency";
import type { ReadingProvider } from "./provider";
import type { RawReading, RawSection } from "./prompt";
import type { FortuneChart, FortuneReading, ReadingSection } from "./types";

/**
 * 模型解读的落地：结构校验 + 措辞闸门。
 *
 * - 大运、流年只收和命盘对得上的那几项，顺序按命盘，模型多写的、写错干支的丢掉；
 * - 「注定、必然」这类断语改成倾向性说法；
 * - 谈寿命、血光、克夫克妻、离婚、改运化解的整句删掉——提示词已经禁止，这里兜底。
 */

const SECTIONS: { key: ReadingSection["key"]; title: string }[] = [
  { key: "personality", title: "性格" },
  { key: "career", title: "事业" },
  { key: "wealth", title: "财运" },
  { key: "relationship", title: "感情婚姻" },
  { key: "health", title: "健康" },
];

export const BANNED_SENTENCE =
  /(血光|牢狱|坐牢|官非|短命|早逝|早夭|夭折|寿命|寿元|阳寿|横死|死亡|丧命|克父|克母|克夫|克妻|克子|刑克|离婚|绝后|不孕|开光|法事|符咒|改运|化煞|化解(?:灾|劫|厄|凶|煞)|摆件)/;

const SOFTEN: [RegExp, string][] = [
  [/注定/g, "多半"],
  [/必然/g, "往往"],
  [/必定/g, "多半"],
  [/一定会/g, "容易"],
];

/** 半角标点改全角，去掉 markdown 符号与多余空白 */
function tidy(text: string): string {
  return text
    .replace(/[#*`]+/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/(?<!\d),(?!\d)/g, "，")
    .replace(/(?<!\d);/g, "；")
    .replace(/(?<!\d):(?!\d)/g, "：")
    .replace(/(?<!\d)\?/g, "？")
    .replace(/(?<!\d)!/g, "！")
    .replace(/([\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

interface Cleaned {
  text: string;
  removed: number;
  /** 和排盘对不上被删掉的句子数（见 consistency.ts） */
  conflicts: number;
}

/**
 * 按句子过闸：命中禁区的整句删，和排盘对不上的整句删（给了 conflictOf 才查），断语软化，
 * 再按句子边界截到 max 字以内
 */
export function cleanText(raw: unknown, max: number, conflictOf?: (sentence: string) => string | null): Cleaned {
  if (typeof raw !== "string") return { text: "", removed: 0, conflicts: 0 };
  const sentences = tidy(raw).match(/[^。！？；]+[。！？；]?/g) ?? [];
  let removed = 0;
  let conflicts = 0;
  let out = "";
  for (const sentence of sentences) {
    if (BANNED_SENTENCE.test(sentence)) {
      removed++;
      continue;
    }
    if (conflictOf?.(sentence)) {
      conflicts++;
      continue;
    }
    let s = sentence;
    for (const [pattern, replacement] of SOFTEN) s = s.replace(pattern, replacement);
    if ((out + s).length > max) {
      if (!out) out = s.slice(0, max);
      break;
    }
    out += s;
  }
  return { text: out.trim(), removed, conflicts };
}

export function normalizeReading(raw: RawReading, chart: FortuneChart, providerName: string): FortuneReading | null {
  let removed = 0;
  let conflicts = 0;
  const facts = chartFacts(chart);
  // 命局总论、各项、建议讲的是原局，全部查；大运、流年只查日主、喜忌、生肖、神煞（见 consistency.ts）
  const natal = (s: string) => findConflict(s, facts, true);
  const period = (s: string) => findConflict(s, facts, false);
  const take = (value: unknown, max: number, check: (s: string) => string | null = natal) => {
    const c = cleanText(value, max, check);
    removed += c.removed;
    conflicts += c.conflicts;
    return c.text;
  };

  const overview = take(raw.overview, 420);
  const sections: ReadingSection[] = [];
  for (const { key, title } of SECTIONS) {
    const section = (raw[key] ?? {}) as RawSection;
    const text = take(section.text, 360);
    if (!text) continue;
    sections.push({ key, title, basis: take(section.basis, 60), text });
  }
  if (!overview && !sections.length) return null;

  const rawLuck = Array.isArray(raw.luck) ? raw.luck : [];
  const luck = chart.luck.steps
    .map((step) => {
      const hit = rawLuck.find(
        (x): x is { ganzhi?: unknown; text?: unknown } =>
          Boolean(x) && typeof x === "object" && String((x as { ganzhi?: unknown }).ganzhi ?? "").trim() === step.ganzhi,
      );
      return { ganzhi: step.ganzhi, text: hit ? take(hit.text, 200, period) : "" };
    })
    .filter((x) => x.text);

  const rawYears = Array.isArray(raw.years) ? raw.years : [];
  const years = chart.years
    .map((y) => {
      const hit = rawYears.find(
        (x): x is { year?: unknown; text?: unknown } =>
          Boolean(x) && typeof x === "object" && Number((x as { year?: unknown }).year) === y.year,
      );
      return { year: y.year, text: hit ? take(hit.text, 240, period) : "" };
    })
    .filter((x) => x.text);

  const advice = (Array.isArray(raw.advice) ? raw.advice : [])
    .map((a) => take(a, 80))
    .filter(Boolean)
    .slice(0, 5);

  return { overview, sections, luck, years, advice, provider: providerName, removed, conflicts };
}

export type ReadingOutcome = { ok: true; reading: FortuneReading } | { ok: false; message: string };

export async function runReading(chart: FortuneChart, provider: ReadingProvider): Promise<ReadingOutcome> {
  const raw = await provider.read(chart);
  if (!raw) return { ok: false, message: "解读没有生成成功，请重试" };
  const reading = normalizeReading(raw, chart, provider.name);
  if (!reading) return { ok: false, message: "解读内容不完整，请重试" };
  return { ok: true, reading };
}
