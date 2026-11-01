import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { checkFastCandidate } from "@/fast/gate";
import type { FastCandidate, FastCitation, FastGender } from "@/fast/types";
import type { LibraryEntry, LibraryFile } from "./review-types";

/**
 * 直播首推从名字库里挑（2026-10-31 定）。库里是用户在 /review 逐个评过「很好 / 可以」的名字，比模型临时起的稳。
 *
 * 挑法：
 *   1. 性别对得上：男孩用「男孩」和「男女都可」的，女孩同理
 *   2. 这一场还没给过（recent）
 *   3. 配观众的姓过直播闸门（src/fast/gate.ts，和模型起的名字同一道：谐音、忌字、撞名都没有，打分不低于 90）
 *   4. 有出处的排前面；都有或都没有时分高的排前面；再一样就随机，免得每场开头都是同一个
 * 挑不到返回 null，调用方用模型起的名字。备选仍由模型起：库现在只有几十个，四个都从库里出，一场八九轮就用完了。
 * 只有模型这一轮出错、或者能用的不够时，备选才从库里补（src/fast/run.ts 的 fillFromLibrary）。
 *
 * 库文件按修改时间缓存：重新发布（scripts/library/publish.ts）以后，下一轮就用新库，不用重启服务。
 * 文件不在或读坏了都当空库，直播照常走模型。
 */

function libraryFile(): string {
  const base = process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(base, "name-library", "v2", "library.json");
}

const HAN2 = /^[\u4e00-\u9fff]{2}$/;
const GENDERS = new Set(["male", "female", "neutral"]);

function isEntry(e: unknown): e is LibraryEntry {
  const x = e as Partial<LibraryEntry> | null;
  return Boolean(
    x &&
      typeof x.id === "string" &&
      typeof x.givenName === "string" &&
      HAN2.test(x.givenName) &&
      typeof x.gender === "string" &&
      GENDERS.has(x.gender) &&
      typeof x.grade === "number",
  );
}

let cache: { file: string; mtimeMs: number; entries: LibraryEntry[] } | null = null;

export function loadLibrary(): LibraryEntry[] {
  const file = libraryFile();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    cache = null;
    return [];
  }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.entries;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<LibraryFile>;
    const entries = Array.isArray(data.entries) ? data.entries.filter(isEntry) : [];
    cache = { file, mtimeMs, entries };
    return entries;
  } catch {
    // 正在发布、写了一半：这一轮当空库，不缓存，下一轮再读
    return [];
  }
}

/** 「《诗经·大雅·崧高》」→ 诗经 / 大雅·崧高；「崔颢《黄鹤楼》」→ 崔颢 / 黄鹤楼 */
function splitFrom(from: string): { source: string; piece: string } {
  const m = from.match(/^(.*?)《(.+)》$/);
  if (!m) return { source: from, piece: "" };
  const author = m[1]!.trim();
  const inner = m[2]!;
  if (author) return { source: author, piece: inner };
  const dot = inner.indexOf("·");
  return dot < 0 ? { source: inner, piece: "" } : { source: inner.slice(0, dot), piece: inner.slice(dot + 1) };
}

const CLAUSE_SEP = /[，。；！？、：]/;

/**
 * 观众屏幕只放带这两个字的那一小句（「晴川历历汉阳树」），整联放上去要折成两行；
 * 两个字分在两小句里（「倬彼云汉，为章于天」）就两句都放。提词页仍念整句。
 */
export function shortQuote(line: string, givenName: string): string {
  const [a, b] = [...givenName];
  if (!a || !b) return line;
  const clauses = line.split(CLAUSE_SEP).map((s) => s.trim());
  const seps = line.match(new RegExp(CLAUSE_SEP.source, "g")) ?? [];
  const both = clauses.findIndex((c) => c.includes(a) && c.includes(b));
  if (both >= 0) return clauses[both]!;
  const ia = clauses.findIndex((c) => c.includes(a));
  const ib = clauses.findIndex((c) => c.includes(b));
  if (ia < 0 || ib < 0) return line;
  const [from, to] = [Math.min(ia, ib), Math.max(ia, ib)];
  let out = "";
  for (let k = from; k <= to; k++) out += clauses[k]! + (k < to ? (seps[k] ?? "，") : "");
  return out;
}

function toCandidate(e: LibraryEntry, surname: string, hotChar: boolean): FastCandidate {
  const py = fullNamePinyin(surname, e.givenName);
  const citation: FastCitation | undefined = e.citation
    ? {
        ...splitFrom(e.citation.from),
        quote: shortQuote(e.citation.line, e.givenName),
        line: e.citation.line,
        label: e.citation.from,
      }
    : undefined;
  return {
    givenName: e.givenName,
    fullName: `${surname}${e.givenName}`,
    pinyin: py.text,
    ...(py.hint ? { pinyinHint: py.hint } : {}),
    why: e.talk?.one ?? e.meaning,
    hotChar,
    ...(citation ? { citation } : {}),
    library: { id: e.id, ...(e.talk ? { talk: e.talk } : {}) },
  };
}

/**
 * 模型这一轮起的名字正好是名字库里的（晴川、徽音、煦宁……用户评过的），就换成库里那一条：
 * 带上库里核过的出处、一句话寓意和整段口播稿。性别对不上的不算（男孩库里的名字不给女孩）。
 */
export function matchLibrary(
  entries: readonly LibraryEntry[],
  givenName: string,
  surname: string,
  gender: FastGender,
  hotChar: boolean,
): FastCandidate | null {
  const e = entries.find((x) => x.givenName === givenName && (x.gender === gender || x.gender === "neutral"));
  return e ? toCandidate(e, surname, hotChar) : null;
}

/**
 * 按上面的顺序挑最多 count 个。挑多个时（模型这一轮出错或给得不够，要从库里补）彼此不撞字，
 * 也不和 avoidChars 里的字撞（同一轮模型已经给出的名字）。
 */
export function pickLibraryCandidates(
  entries: readonly LibraryEntry[],
  surname: string,
  gender: FastGender,
  recent: readonly string[],
  count: number,
  random: () => number = Math.random,
  avoidChars: Iterable<string> = [],
): FastCandidate[] {
  const used = new Set(recent);
  const pool = entries
    .filter((e) => (e.gender === gender || e.gender === "neutral") && !used.has(e.givenName))
    .map((e) => ({ e, r: random() }))
    .sort((a, b) => {
      const ca = a.e.citation ? 0 : 1;
      const cb = b.e.citation ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (a.e.grade !== b.e.grade) return b.e.grade - a.e.grade;
      return a.r - b.r;
    });
  const out: FastCandidate[] = [];
  const takenChars = new Set<string>(avoidChars);
  for (const { e } of pool) {
    if (out.length >= count) break;
    if ([...e.givenName].some((ch) => takenChars.has(ch))) continue;
    const verdict = checkFastCandidate(e.givenName, surname, gender);
    if (!verdict.keep) continue;
    out.push(toCandidate(e, surname, verdict.hotChar));
    for (const ch of e.givenName) takenChars.add(ch);
  }
  return out;
}

export function pickLibraryCandidate(
  entries: readonly LibraryEntry[],
  surname: string,
  gender: FastGender,
  recent: readonly string[],
  random: () => number = Math.random,
): FastCandidate | null {
  return pickLibraryCandidates(entries, surname, gender, recent, 1, random)[0] ?? null;
}
