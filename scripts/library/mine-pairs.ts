/**
 * 从名篇里挖候选名，给起草的人挑。
 *
 * 用法：pnpm tsx scripts/library/mine-pairs.ts [最多列几个，默认 400]
 *
 * 挑法：两个字都在「好字表」里，在同一个分句里挨着或隔一个字（「天朗气清」→ 朗清）。
 *   好字表 = 起手字表（src/config/seed-chars.json，已经按热门、忌字、多音、年代、笔画过滤过）
 *            去掉用户评审时嫌软、嫌老的字，再补几个评审里得分高的字。
 *   排除：已经评过的名字、爆款名单、叠字、两个字都带三点水（用户说「清源」都带水）、
 *         打分规则判了硬伤的。
 *   书：经部、屈原的楚辞、唐诗三百首、千家诗、古文观止、名家宋词。别的书句子多但难出好名字。
 * 只列候选，意思通不通、原诗晦不晦气，要人看。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import seedChars from "../../src/config/seed-chars.json";
import l1Templates from "../../src/config/l1-templates.json";
import { foldText, toSimplified } from "../../src/domain/analysis/chars";
import { __displayableQuote as displayableQuote } from "../../src/fast/cite";
import { scoreName } from "../../src/domain/score/score";
import { BOOK_LABEL, corpus, MAX_LINE } from "./corpus";

const LIMIT = Number(process.argv[2] ?? 400);

/** 评审里嫌软、嫌老、嫌没力气的字（静姝、柔嘉、婉如、惠风、明慧、琼华、若英、晓岚、鹤鸣、鸣谦、灵均…） */
const DISLIKE = new Set([..."柔婉静慧惠英琼晓鹤谦灵淑娴苒筱蕾芊妤蓓娅婕茵蕊雯曼芸恬悠楚乔素疏晚"]);
/** 评审里出现在高分名字里的字，起手字表没收的补上 */
const EXTRA = "舜闻维璋章微穆晖华含树弘瑾桢昭朗晴霁博允岳诗言文思心远致修竹澜安嘉知舒望川景明清越岩松妍青云韵";
/**
 * STRICT=1 时再去掉古文里常作虚词或代词的字（如、言、维、然、时、思、若、云……）：
 * 经部里这些字大多是语气词，挖出来全是「言思」「如云」这种。代价是思齐、若华这类好名挖不到，这些靠人想。
 */
const FUNCTION_LIKE = new Set([..."如言维然时思若云夏冬南初念意心知宜和安"]);
const STRICT = process.env.STRICT === "1";
/** ADJ=1 只要挨着的两个字 */
const ADJ_ONLY = process.env.ADJ === "1";
const GOOD = new Set(
  [...seedChars.female, ...seedChars.male, ...EXTRA].filter((c) => !DISLIKE.has(c) && !(STRICT && FUNCTION_LIKE.has(c))),
);
/** 三点水的字（只收好字表里会出现的） */
const WATER = new Set([..."清澄源涛波浩泽澜渊涵沐洋海江河湖溪漪沁洛潇澈淳汐泓洁润涓滢沛沧淇汉沂洲渝濯浚"]);
const NAME_BLOCKING = new Set(["forbidden", "swap", "template", "rare", "misread", "eraName", "hot"]);

const BOOK_ORDER = ["shijing", "chuci", "lunyu", "mengzi", "daxue", "zhongyong", "zhouyi", "liji", "tangshi300", "qianjiashi", "guwenguanzhi", "songci"];
const SONGCI_AUTHORS = ["苏轼", "辛弃疾", "李清照", "晏殊", "晏几道", "欧阳修", "秦观", "柳永", "周邦彦", "姜夔", "陆游", "范仲淹", "张孝祥", "岳飞", "王安石", "黄庭坚", "贺铸", "张先", "陈亮", "朱敦儒"];

// 已经评过的名字不再列
const reviewed = new Set<string>();
const reviewDir = join(process.cwd(), "data", "name-library", "v2", "review");
for (const f of readdirSync(reviewDir).filter((x) => x.endsWith(".json") && !x.endsWith(".verdicts.json"))) {
  const b = JSON.parse(readFileSync(join(reviewDir, f), "utf8")) as { items: { givenName: string }[] };
  for (const i of b.items) reviewed.add(i.givenName);
}
const L1 = new Set(l1Templates as string[]);

interface Hit {
  pair: string;
  book: number;
  len: number;
  text: string;
  where: string;
}
const best = new Map<string, Hit>();

for (const rec of corpus()) {
  const book = BOOK_ORDER.indexOf(rec.s);
  if (book < 0) continue;
  const author = rec.a ? toSimplified(rec.a) : "";
  if (rec.s === "chuci" && !author.includes("屈原")) continue;
  if (rec.s === "songci" && !SONGCI_AUTHORS.some((a) => author.includes(a))) continue;
  for (const raw of rec.x.split(/[。！？；\n]/)) {
    const text = toSimplified(raw).replace(/^[\s“”‘’「」『』"]+|[\s“”‘’「」『』"]+$/g, "");
    const len = foldText(text).length;
    if (len < 4 || len > MAX_LINE || !displayableQuote(text)) continue;
    for (const clause of text.split(/[，、：,]/)) {
      const chars = [...foldText(clause)];
      for (let i = 0; i < chars.length; i++) {
        for (let j = i + 1; j <= i + (ADJ_ONLY ? 1 : 2) && j < chars.length; j++) {
          const a = chars[i]!;
          const b = chars[j]!;
          if (a === b || !GOOD.has(a) || !GOOD.has(b)) continue;
          if (WATER.has(a) && WATER.has(b)) continue;
          const pair = `${a}${b}`;
          if (reviewed.has(pair) || L1.has(pair)) continue;
          const old = best.get(pair);
          if (old && (old.book < book || (old.book === book && old.len <= len))) continue;
          const where = `${BOOK_LABEL[rec.s]}·${toSimplified(rec.t).replace(/^卷.+?·/, "")}${author ? `(${author.replace(/^.*：/, "")})` : ""}`;
          best.set(pair, { pair, book, len, text, where });
        }
      }
    }
  }
}

const out = [...best.values()]
  .filter((h) => {
    const s = scoreName({ surname: "林", givenName: h.pair, alternatives: [] }, "unknown");
    return !s.deductions.some((d) => NAME_BLOCKING.has(d.rule));
  })
  .sort((x, y) => x.book - y.book || x.len - y.len);

console.log(`候选 ${out.length} 个（列前 ${Math.min(LIMIT, out.length)} 个）`);
for (const h of out.slice(0, LIMIT)) console.log(`${h.pair}｜${h.where}｜${h.text}`);
