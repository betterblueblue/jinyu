/**
 * 第 0 步：从语料里挑「可以拿去取名的整篇」。
 *
 * 为什么挑篇而不是挑句：语料有噪声（诗经·九罭的「鸿飞遵六」应为「遵陆」，
 * 全唐诗里混了注文碎片），由脚本按字数/常用字挑句会把噪声挑上来。
 * 改成给模型整篇文本、让它自己挑可取的短语，引文仍是原文子串，可核验。
 *
 * 用法：pnpm tsx scripts/name-library/pick-pieces.ts
 * 输出：data/name-library/drafts/pieces.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { gbLevel, toSimplified } from "../../src/domain/analysis/chars";
import { leanOf } from "../../src/domain/analysis/gender-lean";

const ROOT = process.cwd();
const CORPUS = path.join(ROOT, "data", "corpus", "pieces.jsonl");
const OUT_DIR = path.join(ROOT, "data", "name-library", "drafts");
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT_FILE = path.join(OUT_DIR, argOf("--out") ?? "pieces.jsonl");
const EXCLUDE_FILE = argOf("--exclude");
const TARGET = Number(argOf("--target") ?? 500);

const QUOTA: Record<string, number> = {
  shijing: 120,
  chuci: 50,
  lunyu: 12,
  daxue: 4,
  zhongyong: 4,
  mengzi: 14,
  zhouyi: 16,
  shangshu: 12,
  liji: 8,
  zuozhuan: 16,
  wenxuan: 60,
  tangshi300: 80,
  qianjiashi: 40,
  nalan: 30,
  songci: 60,
  // 2026-10-31 打开。实测：按篇均匀抽 50 篇（57,352 篇里）出 0 条能用的；
  // 按名诗人（王维/李商隐/杜牧/孟浩然…）筛出 2,272 篇再抽 40 篇，出 11 条 B 档、0 条 A 档。
  // 所以要开就得配 author 过滤，光给配额只会稀释信噪比。A 档不从这里来。
  quantangshi: 80,
};

const SOURCE_LABEL: Record<string, string> = {
  shijing: "诗经",
  chuci: "楚辞",
  lunyu: "论语",
  daxue: "大学",
  zhongyong: "中庸",
  mengzi: "孟子",
  zhouyi: "周易",
  shangshu: "尚书",
  liji: "礼记",
  zuozhuan: "左传",
  wenxuan: "文选",
  tangshi300: "唐诗三百首",
  qianjiashi: "千家诗",
  nalan: "纳兰词",
  songci: "宋词",
  quantangshi: "全唐诗",
};

const HAN = /[\u4e00-\u9fff]/;
/** 真·校勘痕迹。周易的《》（）是卦名与卦象标注，不能当噪声 */
const NOISE = /校勘|一说|闕文|阙文|誤作|误作|(见|見|案).{0,6}卷|注曰|疏曰|※|＊|一作|鄭玄|郑玄|毛传|毛萇|正义|注疏|【|】/;
/** 篇里出现两个以上就整篇跳过（墓志、悼亡、战乱这类） */
const BAD = new Set([..."死病亡丧哭泣悲哀愁苦贫贱辱罪刑狱杀戮灭败坏恶毒凶残暴虐妖魔鬼怪尸血骨灰坟墓棺葬疾痛伤残孤寡鳏独奴仆婢妾妓娼盗贼匪寇敌仇怨恨怒骂诈欺谎虚假伪陋丑衰朽枯槁污浊秽臭腐烂溃".split("")]);
/** BMP 之外的扩展区汉字：显示字体常缺，念不出写不出 */
const EXT = /[\u{20000}-\u{3FFFF}]/u;

interface Piece {
  source: string;
  piece: string;
  text: string;
  hans: number;
  gb1Ratio: number;
  leanChars: number;
  score: number;
}

/** 长篇章按标点切成 ≤280 汉字的块，块内仍可整句取词 */
function chunk(text: string): string[] {
  const parts = text.split("／").filter(Boolean);
  const out: string[] = [];
  let buf: string[] = [];
  let count = 0;
  const flush = () => {
    if (buf.length) out.push(buf.join("／"));
    buf = [];
    count = 0;
  };
  for (const part of parts) {
    const n = [...part].filter((c) => HAN.test(c)).length;
    if (count + n > 280) flush();
    buf.push(part);
    count += n;
  }
  flush();
  return out;
}

function scorePiece(text: string): { score: number; hans: number; gb1Ratio: number; leanChars: number } | null {
  const chars = [...text];
  const hans = chars.filter((c) => HAN.test(c)).length;
  if (hans < 20 || hans > 300) return null;
  if (NOISE.test(text)) return null;
  if (EXT.test(text)) return null;
  let bad = 0;
  for (const ch of chars) if (BAD.has(ch)) bad++;
  if (bad >= 2) return null;

  let gb1 = 0;
  let lean = 0;
  const uniq = new Set<string>();
  for (const ch of chars) {
    if (!HAN.test(ch)) continue;
    const lv = gbLevel(ch);
    if (lv === 1) gb1++;
    if (lv === 1 || lv === 2) uniq.add(ch);
    if (leanOf(ch) !== "neutral") lean++;
  }
  const gb1Ratio = gb1 / hans;
  // 生僻字太多的篇，取出来的名字直播里念不出、写不出
  if (gb1Ratio < 0.55) return null;
  // 没有倾向字的篇基本出不了男女向定向名
  if (lean === 0) return null;

  const score = gb1Ratio * 10 + Math.min(lean, 8) * 0.5 + Math.min(uniq.size, 80) * 0.05;
  return { score, hans, gb1Ratio, leanChars: lean };
}

async function main(): Promise<void> {
  if (!fs.existsSync(CORPUS)) {
    console.error(`语料不存在：${CORPUS}\n先跑 pnpm corpus:build`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 已用过的篇（第二轮补量时排除，避免同一篇反复挖）
  const used = new Set<string>();
  if (EXCLUDE_FILE && fs.existsSync(EXCLUDE_FILE)) {
    for (const line of fs.readFileSync(EXCLUDE_FILE, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line) as { source: string; piece: string };
        used.add(`${p.source}|${p.piece}`);
      } catch {
        /* 忽略坏行 */
      }
    }
    console.log(`排除已用篇：${used.size}`);
  }

  const pool = new Map<string, Piece[]>();
  const rl = readline.createInterface({ input: fs.createReadStream(CORPUS), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    let rec: { s?: string; t?: string; x?: string };
    try {
      rec = JSON.parse(raw);
    } catch {
      continue;
    }
    const src = rec.s ?? "";
    if (!(src in QUOTA)) continue;
    const piece = (rec.t ?? "").trim();
    if (!piece) continue;
    const whole = toSimplified(rec.x ?? "").replace(/\n+/g, "／").trim();
    for (const [ci, text] of chunk(whole).entries()) {
      const scored = scorePiece(text);
      if (!scored) continue;
      const label = SOURCE_LABEL[src] ?? src;
      const pieceLabel = ci === 0 ? piece : `${piece}（${ci + 1}）`;
      if (used.has(`${label}|${pieceLabel}`)) continue;
      const arr = pool.get(src) ?? [];
      arr.push({
        source: label,
        piece: pieceLabel,
        text,
        hans: scored.hans,
        gb1Ratio: scored.gb1Ratio,
        leanChars: scored.leanChars,
        score: scored.score,
      });
      pool.set(src, arr);
    }
  }

  // 先按配额取，再把剩余名额从全局高分里补，单个来源不超过配额 2 倍
  const picked: Piece[] = [];
  const perSrcCount = new Map<string, number>();
  const leftover: Piece[] = [];

  for (const [src, arr] of pool) {
    arr.sort((a, b) => b.score - a.score || a.piece.localeCompare(b.piece));
    const take = arr.slice(0, QUOTA[src] ?? 0);
    picked.push(...take);
    perSrcCount.set(src, take.length);
    leftover.push(...arr.slice(take.length));
  }

  let need = TARGET - picked.length;
  if (need > 0) {
    leftover.sort((a, b) => b.score - a.score);
    const cap = new Map<string, number>();
    for (const p of leftover) {
      if (need <= 0) break;
      const srcKey = Object.entries(SOURCE_LABEL).find(([, v]) => v === p.source)?.[0];
      const base = srcKey ? (QUOTA[srcKey] ?? 0) : 0;
      const limit = Math.max(base * 2, 8);
      const cur = cap.get(p.source) ?? perSrcCount.get(srcKey ?? "") ?? 0;
      if (cur >= limit) continue;
      cap.set(p.source, cur + 1);
      picked.push(p);
      need--;
    }
  }

  // 同一首字扎堆的问题：按篇名排序后写入，展示时按书目分组
  picked.sort((a, b) => a.source.localeCompare(b.source) || b.piece.localeCompare(a.piece));

  const out = fs.createWriteStream(OUT_FILE, "utf8");
  picked.forEach((p, i) => {
    out.write(
      JSON.stringify({
        id: `p${String(i + 1).padStart(3, "0")}`,
        source: p.source,
        piece: p.piece,
        text: p.text,
        hans: p.hans,
        gb1Ratio: Number(p.gb1Ratio.toFixed(3)),
        leanChars: p.leanChars,
      }) + "\n",
    );
  });
  await new Promise<void>((res) => out.end(res));

  const bySource: Record<string, number> = {};
  for (const p of picked) bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  console.log("=== 按书目 ===");
  for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(8)} ${String(v).padStart(3)}`);
  }
  const avg = picked.reduce((s, p) => s + p.hans, 0) / Math.max(1, picked.length);
  console.log(`\n合计 ${picked.length} 篇，平均 ${avg.toFixed(1)} 个汉字 → ${path.relative(ROOT, OUT_FILE)}`);
  console.log("\n=== 抽样 ===");
  for (const p of picked.filter((_, i) => i % Math.max(1, Math.floor(picked.length / 8)) === 0).slice(0, 8)) {
    console.log(`  ${p.source} | ${p.piece} | ${p.text.slice(0, 44)}…`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


