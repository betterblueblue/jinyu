/**
 * 从本地古籍语料抽「快速取名」候选：连续两字取词。
 *
 * 只做机器能确定的事：字在原文里、两字都常用、不是虚词、不带明确坏意思、
 * 不在网红名表里、按字的性别倾向分组。**不做**语义判断——一个词能不能当名字
 * 仍要靠后续模型起草 + 人工审核，这里只负责把 100 万级组合压到可以审的量级。
 *
 * 用法：pnpm tsx scripts/name-library/extract.ts
 * 输出：data/name-library/drafts/raw-candidates.jsonl + 漏斗统计打到 stdout
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { gbLevel, toSimplified } from "../../src/domain/analysis/chars";
import { leanOf } from "../../src/domain/analysis/gender-lean";

const ROOT = process.cwd();
const CORPUS = path.join(ROOT, "data", "corpus", "pieces.jsonl");
const OUT_DIR = path.join(ROOT, "data", "name-library", "drafts");
const OUT_FILE = path.join(OUT_DIR, "raw-candidates.jsonl");

/** 出处优先级：经部优先，诗词次之。去重时保留优先级高的那条 */
const SOURCE_RANK: Record<string, number> = {
  shijing: 1,
  chuci: 2,
  lunyu: 3,
  daxue: 3,
  zhongyong: 3,
  mengzi: 3,
  zhouyi: 3,
  shangshu: 3,
  liji: 3,
  zuozhuan: 4,
  wenxuan: 5,
  tangshi300: 6,
  qianjiashi: 6,
  nalan: 6,
  songci: 7,
  quantangshi: 8,
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

/** 虚词与功能字：出现即不代表名字用字 */
const STOP = new Set(
  [..."之乎者也而不其以於于与为所者曰无毋勿莫未非否然是此彼何如则且乃焉哉矣兮夫盖故若虽虽然可以于是矣乎耶邪耳哉矣兮皆具共同异亦又复更益愈甚最颇极更相自相互各每诸凡百千万亿兆一二三四五六七八九十零两半双对".split("")].concat(
    [..."我尔汝吾予余尔你他她它谁孰岂宁盍曷奚胡恶安焉".split("")],
  ),
);

/** 明确的坏意思字：出现在名字里就是硬伤 */
const BAD = new Set(
  [..."死病亡丧哭泣悲哀愁苦贫贱辱罪刑狱杀戮灭败坏恶毒凶残暴虐妖魔鬼怪尸血骨灰坟墓棺葬疾痛伤残孤寡鳏独奴仆婢妾妓娼盗贼匪寇敌仇怨恨怒骂诈欺谎虚假伪陋丑衰朽枯槁污浊秽臭腐烂溃疮痈瘤疤痣聋哑盲瞎瘸跛疯癫痴傻愚蠢笨拙懒怠傲慢骄奢淫赌嫖酗醉昏聩昧耻羞愧惭惧恐怖惊慌忧患祸殃灾厄夭殇嗤嗤".split("")],
);

const HAN = /^[\u4e00-\u9fff]$/;

function isHan(ch: string): boolean {
  return HAN.test(ch);
}

/** 切句：按标点与换行切成短句，名字只在句内连续取，不跨标点 */
function clauses(text: string): string[] {
  return String(text)
    .split(/[，,。．.！？!?；;：:、\s]+/u)
    .filter((c) => c.length > 0);
}

interface Row {
  givenName: string;
  lean: "male" | "female" | "neutral";
  source: string;
  piece: string;
  quote: string;
  positions: [number, number];
  rank: number;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CORPUS)) {
    console.error(`语料不存在：${CORPUS}\n先跑 pnpm corpus:build`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const funnel = {
    clauses: 0,
    windows: 0,
    windowRejects: { notBothGb1: 0, stop: 0, bad: 0, mixedLean: 0, same: 0 } as Record<string, number>,
    survived: 0,
    deduped: 0,
  };
  const best = new Map<string, Row>();

  const rl = readline.createInterface({ input: fs.createReadStream(CORPUS), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: { s?: string; t?: string; x?: string };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const src = rec.s ?? "";
    const rank = SOURCE_RANK[src];
    if (!rank) continue;
    const title = rec.t ?? "";
    const text = rec.x;
    if (!text) continue;

    for (const raw of clauses(text)) {
      const quote = toSimplified(raw);
      const chars = [...quote];
      if (chars.length < 4 || chars.length > 20) continue;
      if (!chars.every(isHan)) continue;
      funnel.clauses++;

      for (let i = 0; i + 1 < chars.length; i++) {
        funnel.windows++;
        const a = chars[i];
        const b = chars[i + 1];
        const given = a + b;

        if (gbLevel(a) !== 1 || gbLevel(b) !== 1) {
          funnel.windowRejects.notBothGb1++;
          continue;
        }
        if (STOP.has(a) || STOP.has(b)) {
          funnel.windowRejects.stop++;
          continue;
        }
        if (BAD.has(a) || BAD.has(b)) {
          funnel.windowRejects.bad++;
          continue;
        }
        if (a === b) {
          funnel.windowRejects.same++;
          continue;
        }
        const la = leanOf(a);
        const lb = leanOf(b);
        let lean: Row["lean"];
        if (la === "male" && lb === "female") {
          funnel.windowRejects.mixedLean++;
          continue;
        }
        if (la === "female" && lb === "male") {
          funnel.windowRejects.mixedLean++;
          continue;
        }
        if (la === "male" && lb === "male") lean = "male";
        else if (la === "female" && lb === "female") lean = "female";
        else lean = "neutral";

        funnel.survived++;
        const prev = best.get(given);
        if (prev && prev.rank <= rank) continue;
        best.set(given, {
          givenName: given,
          lean,
          source: SOURCE_LABEL[src] ?? src,
          piece: title,
          quote,
          positions: [i, i + 1],
          rank,
        });
      }
    }
  }

  const rows = [...best.values()].sort((x, y) => x.rank - y.rank || x.givenName.localeCompare(y.givenName));
  funnel.deduped = rows.length;

  const out = fs.createWriteStream(OUT_FILE, "utf8");
  for (const r of rows) {
    const { rank: _rank, ...rest } = r;
    out.write(JSON.stringify(rest) + "\n");
  }
  await new Promise<void>((res) => out.end(res));

  const bySource: Record<string, number> = {};
  const byLean: Record<string, number> = { male: 0, female: 0, neutral: 0 };
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byLean[r.lean]++;
  }

  console.log("=== 漏斗 ===");
  console.log(`可用短句（4–20 个常用汉字）      ${funnel.clauses}`);
  console.log(`连续两字窗口                    ${funnel.windows}`);
  for (const [k, v] of Object.entries(funnel.windowRejects)) {
    console.log(`  剔除 ${k.padEnd(14)} ${v}`);
  }
  console.log(`存活窗口（未去重）              ${funnel.survived}`);
  console.log(`按名字去重后                    ${funnel.deduped}`);
  console.log("\n=== 按方向 ===");
  for (const [k, v] of Object.entries(byLean)) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log("\n=== 按出处 ===");
  for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${v}`);
  }
  console.log(`\n写入 ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
