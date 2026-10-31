/**
 * 起手字「字出」原句表 src/config/seed-lines.json：核对，以及选句时列候选。
 *
 * 「字出」是什么：直播名字里那个起手字，在经典里的一句原文。结果页和存图写成
 * 「婉」字见《诗经·郑风·野有蔓草》：有美一人，婉如清扬。
 * 只说这一个字出自哪里，不说整个名字出自哪里；表是事先挑好、逐字核过的，运行时不花模型时间。
 *
 * 核对（默认）：表里每一句
 *   - 逐字出现在语料里那一篇（篇名按简体比；正文繁简、标点折合后比对，和 cite.ts 同一套）
 *   - 句里有这个字，这个字在起手字表里
 *   - 过得了引文展示闸门（cite.ts：不晦气，没有方块字和表外生僻字）
 *   - 不超过 MAX_LEN 个字（存图两行放得下），结尾不带标点（页面自己加「」）
 * 有一条不过就退出码 1。最后列出没配原句的起手字。
 *
 * 列候选：$env:CANDIDATES="1"; $env:CHARS="棠禾溪"; pnpm tsx scripts/check-seed-lines.ts
 *   不设 CHARS 就列全部起手字。按书排（诗经、楚辞、四书在前，诗选其次），每个字最多 PER_CHAR 句。
 *   只是给人挑的：字在句里的意思要和名字里的用法对得上，这一步代码判断不了。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldText, toSimplified } from "../src/domain/analysis/chars";
import { __displayableQuote as displayableQuote } from "../src/fast/cite";

interface Rec {
  s: string;
  t: string;
  a?: string;
  x: string;
}

interface Entry {
  s: string;
  t: string;
  from: string;
  line: string;
}

const ROOT = process.cwd();
/** 文选不收：正文里混着李善注，截出来的句子常是注文（cite.ts 的 NO_FALLBACK_SOURCES 同理） */
const BOOKS = [
  "shijing",
  "chuci",
  "lunyu",
  "mengzi",
  "daxue",
  "zhongyong",
  "zhouyi",
  "shangshu",
  "liji",
  "tangshi300",
  "qianjiashi",
  "guwenguanzhi",
];
const MAX_LEN = 24;
const PER_CHAR = 8;
const PER_BOOK = 2;
const TRAILING_PUNCT = /[，。！？；：、,.!?;:]$/;

const seedChars = JSON.parse(readFileSync(join(ROOT, "src/config/seed-chars.json"), "utf8")) as {
  female: string[];
  male: string[];
};
const SEEDS = [...new Set([...seedChars.female, ...seedChars.male])];

function loadCorpus(): Rec[] {
  const out: Rec[] = [];
  for (const line of readFileSync(join(ROOT, "data/corpus/pieces.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const rec = JSON.parse(line) as Rec;
    if (BOOKS.includes(rec.s)) out.push(rec);
  }
  return out;
}

/** 按句号一级切句，去掉两头的引号和空白；逗号留在句里，诗句正好是一联 */
function sentencesOf(body: string): string[] {
  return body
    .split(/[。！？；\n]/)
    .map((s) => toSimplified(s).replace(/^[\s“”‘’「」『』"]+|[\s“”‘’「」『』"]+$/g, ""))
    .filter(Boolean);
}

function listCandidates(corpus: Rec[], chars: string[]): void {
  const byBook = new Map<string, Rec[]>();
  for (const rec of corpus) {
    const list = byBook.get(rec.s) ?? [];
    list.push(rec);
    byBook.set(rec.s, list);
  }
  for (const ch of chars) {
    const picked: string[] = [];
    const seenText = new Set<string>();
    for (const book of BOOKS) {
      let inBook = 0;
      const hits: { text: string; rec: Rec }[] = [];
      for (const rec of byBook.get(book) ?? []) {
        for (const text of sentencesOf(rec.x)) {
          if (!text.includes(ch)) continue;
          const len = [...text].length;
          if (len < 4 || len > MAX_LEN - 4) continue;
          if (!displayableQuote(text)) continue;
          if (seenText.has(text)) continue;
          hits.push({ text, rec });
        }
      }
      hits.sort((a, b) => [...a.text].length - [...b.text].length);
      for (const h of hits) {
        if (inBook >= PER_BOOK || picked.length >= PER_CHAR) break;
        seenText.add(h.text);
        const author = h.rec.a ? ` | ${toSimplified(h.rec.a)}` : "";
        picked.push(`  ${book} | ${toSimplified(h.rec.t)}${author} | ${h.text}`);
        inBook++;
      }
    }
    console.log(`【${ch}】${picked.length ? "" : " （没有候选）"}`);
    for (const p of picked) console.log(p);
  }
}

function check(corpus: Rec[]): number {
  const table = JSON.parse(readFileSync(join(ROOT, "src/config/seed-lines.json"), "utf8")) as {
    lines: Record<string, Entry>;
  };
  const errors: string[] = [];
  for (const [ch, e] of Object.entries(table.lines)) {
    const where = `${ch}「${e.line}」`;
    if (!SEEDS.includes(ch)) errors.push(`${where}：「${ch}」不在起手字表里`);
    if (!e.line.includes(ch)) errors.push(`${where}：句里没有「${ch}」`);
    if ([...e.line].length > MAX_LEN) errors.push(`${where}：超过 ${MAX_LEN} 字`);
    if (TRAILING_PUNCT.test(e.line)) errors.push(`${where}：结尾带了标点`);
    if (!displayableQuote(e.line)) errors.push(`${where}：过不了引文展示闸门`);
    if (!e.from || !e.from.includes("《")) errors.push(`${where}：出处写法不对（${e.from}）`);
    // 篇名按简体比：唐诗、千家诗的篇名在语料里有繁体字
    const pieces = corpus.filter((r) => r.s === e.s && toSimplified(r.t) === e.t);
    if (!pieces.length) {
      errors.push(`${where}：语料里没有 ${e.s}「${e.t}」这一篇`);
      continue;
    }
    const folded = foldText(e.line);
    if (!pieces.some((p) => foldText(p.x).includes(folded))) errors.push(`${where}：在 ${e.s}「${e.t}」里核不到原文`);
  }
  const missing = SEEDS.filter((ch) => !table.lines[ch]);
  const count = Object.keys(table.lines).length;
  console.log(`起手字 ${SEEDS.length} 个，配了原句 ${count} 个，没配 ${missing.length} 个：${missing.join("")}`);
  if (errors.length) {
    console.log(`\n核对不过 ${errors.length} 条：`);
    for (const e of errors) console.log(`  ${e}`);
    return 1;
  }
  console.log("全部逐字核过");
  return 0;
}

const corpus = loadCorpus();
if (process.env.CANDIDATES) {
  const chars = process.env.CHARS ? [...process.env.CHARS] : SEEDS;
  listCandidates(corpus, chars);
} else {
  process.exitCode = check(corpus);
}
