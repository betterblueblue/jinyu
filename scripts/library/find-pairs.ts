/**
 * 给起草用：列出名字两个字同时出现的古文原句，供人挑一句意思对得上的当出处。
 *
 * 用法：pnpm tsx scripts/library/find-pairs.ts 明远 清源 ...   （或传一个 .json 文件，内容是名字数组）
 * 每个名字按书的先后（经部、楚辞在前，诗选其次，全唐诗最后）列几句：
 *   - 两个字在同一个分句里的优先（「静女其姝」），其次同一句里（「有美一人，清扬婉兮」）
 *   - 过展示闸门、不超过 MAX_LINE 字
 * 只是列候选，句子意思和名字对不对得上、整首诗的主题是否晦气，要人看。
 */
import { readFileSync } from "node:fs";
import { foldText, toSimplified } from "../../src/domain/analysis/chars";
import { __displayableQuote as displayableQuote } from "../../src/fast/cite";
import { BOOK_LABEL, corpus, MAX_LINE, type Rec } from "./corpus";

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
  "zuozhuan",
  "tangshi300",
  "qianjiashi",
  "guwenguanzhi",
  "sanzijing",
  "qianziwen",
  "songci",
  "nalan",
  "wenxuan",
  "quantangshi",
];
const PER_NAME = Number(process.env.PER_NAME ?? 4);
const PER_BOOK = 2;

const args = process.argv.slice(2);
const names: string[] =
  args.length === 1 && args[0]!.endsWith(".json")
    ? (JSON.parse(readFileSync(args[0]!, "utf8")) as string[])
    : args.flatMap((a) => a.split(/[,，\s]+/)).filter(Boolean);

interface Sentence {
  rec: Rec;
  text: string;
  folded: string;
  clauses: string[];
}

const byBook = new Map<string, Sentence[]>();
function sentencesOf(book: string): Sentence[] {
  const hit = byBook.get(book);
  if (hit) return hit;
  const out: Sentence[] = [];
  const push = (rec: Rec, text: string) => {
    const folded = foldText(text);
    if (folded.length < 4 || folded.length > MAX_LINE) return;
    out.push({ rec, text, folded, clauses: text.split(/[，、：,]/).map(foldText) });
  };
  for (const rec of corpus()) {
    if (rec.s !== book) continue;
    for (const raw of rec.x.split(/[。！？；\n]/)) {
      const text = toSimplified(raw).replace(/^[\s“”‘’「」『』"]+|[\s“”‘’「」『』"]+$/g, "");
      if (!text) continue;
      if (foldText(text).length <= MAX_LINE) {
        push(rec, text);
        continue;
      }
      // 长句（兰亭集序「是日也，天朗气清，惠风和畅，仰观……」一逗到底）按相邻两个分句截开
      const parts = text.split(/(?<=[，、：,])/);
      for (let i = 0; i < parts.length; i++) {
        push(rec, parts[i]!.replace(/[，、：,]$/, ""));
        if (i + 1 < parts.length) push(rec, `${parts[i]}${parts[i + 1]}`.replace(/[，、：,]$/, ""));
      }
    }
  }
  byBook.set(book, out);
  return out;
}

/**
 * 排序：两个字连着且同序（就是这个词）> 同一分句 > 同一句；同档里经部、楚辞在前，再按句子短的在前。
 * 每部书最多 PER_BOOK 句，总共 PER_NAME 句。
 */
for (const name of names) {
  const [a, b] = [...name];
  if (!a || !b) continue;
  const hits: { rank: number; book: number; len: number; line: string; key: string }[] = [];
  BOOKS.forEach((book, bookIndex) => {
    let n = 0;
    const seen = new Set<string>();
    const found = sentencesOf(book)
      .filter((s) => s.folded.includes(a) && s.folded.includes(b) && displayableQuote(s.text))
      .map((s) => {
        const adjacent = s.folded.includes(`${a}${b}`);
        const sameClause = s.clauses.some((c) => c.includes(a) && c.includes(b));
        return { s, rank: adjacent ? 0 : sameClause ? 1 : 2 };
      })
      .sort((x, y) => x.rank - y.rank || x.s.folded.length - y.s.folded.length);
    for (const { s, rank } of found) {
      if (n >= PER_BOOK) break;
      if (seen.has(s.folded)) continue;
      seen.add(s.folded);
      const order = s.folded.indexOf(a) <= s.folded.lastIndexOf(b) ? "" : "倒";
      const author = s.rec.a ? `|${toSimplified(s.rec.a).replace(/^.*：/, "")}` : "";
      const mark = rank === 0 ? "●" : rank === 1 ? "◆" : "◇";
      hits.push({
        rank,
        book: bookIndex,
        len: s.folded.length,
        key: s.folded,
        line: `  ${mark}${order} ${BOOK_LABEL[book]}|${toSimplified(s.rec.t)}${author}|${s.text}`,
      });
      n++;
    }
  });
  hits.sort((x, y) => x.rank - y.rank || x.book - y.book || x.len - y.len);
  const lines = hits.slice(0, PER_NAME).map((h) => h.line);
  console.log(`【${name}】${lines.length ? "" : " 没有"}`);
  for (const l of lines) console.log(l);
}
