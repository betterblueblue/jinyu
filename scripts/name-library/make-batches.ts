/**
 * 第 3 步（前半）：把校验通过的候选切成送审批次。
 *
 * 每批 25 条，带上原句所在篇的原文，审核代理不需要联网、不需要自己找原文。
 *
 * 用法：pnpm tsx scripts/name-library/make-batches.ts
 * 输出：data/name-library/review/batches/batch-NNN.json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "name-library");
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const IN_FILE = path.join(DIR, "drafts", argOf("--in") ?? "validated.jsonl");
const PIECE_FILE = path.join(DIR, "drafts", "pieces.jsonl");
const OUT_DIR = path.join(DIR, "review", "batches");
const VERDICT_DIR = path.join(DIR, "review", "verdicts");
const BATCH_SIZE = Number(argOf("--size") ?? 25);
const START = Number(argOf("--start") ?? 1);
const NO_CLEAN = argv.includes("--no-clean");
const SKIP_REVIEWED = argv.includes("--skip-reviewed");
const SKIP_BATCHED = argv.includes("--skip-batched");

interface Row {
  pieceId: string;
  source: string;
  piece: string;
  givenName: string;
  lean: string;
  quote: string;
  meaning: string;
  composition: string;
  pitfalls: string;
  pinyin?: string;
  positions?: [number, number] | null;
  leanConflict?: boolean;
}

function main(): void {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`缺 ${IN_FILE}，先跑 validate.ts`);
    process.exit(1);
  }
  const texts = new Map<string, string>();
  for (const line of fs.readFileSync(PIECE_FILE, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as { id: string; text: string };
    texts.set(p.id, p.text);
  }

  let rows = fs
    .readFileSync(IN_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);

  // 已经审过的名字不再送审（用于增量补批）
  if (SKIP_REVIEWED) {
    const reviewed = new Set<string>();
    if (fs.existsSync(VERDICT_DIR)) {
      for (const f of fs.readdirSync(VERDICT_DIR).filter((x) => x.endsWith(".json"))) {
        try {
          const v = JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), "utf8")) as {
            items?: { givenName: string }[];
          };
          for (const it of v.items ?? []) reviewed.add(it.givenName);
        } catch {
          /* 坏文件忽略，下次还会送审 */
        }
      }
    }
    const before = rows.length;
    rows = rows.filter((r) => !reviewed.has(r.givenName));
    console.log(`跳过已审 ${before - rows.length} 条，剩 ${rows.length} 条待送审`);
  }

  let readyToSend = rows;
  if (SKIP_BATCHED) {
    // 已经在某个待审批次里的名字不再重复送审：同名带着不同出处送两次会让结论互相覆盖
    const batched = new Set<string>();
    if (fs.existsSync(OUT_DIR)) {
      for (const f of fs.readdirSync(OUT_DIR).filter((x) => x.startsWith("batch-") && x.endsWith(".json"))) {
        try {
          const b = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")) as {
            items?: { givenName: string }[];
          };
          for (const it of b.items ?? []) batched.add(it.givenName);
        } catch {
          /* 坏文件忽略 */
        }
      }
    }
    const before = readyToSend.length;
    readyToSend = readyToSend.filter((r) => !batched.has(r.givenName));
    console.log(`跳过已在待审批次里的 ${before - readyToSend.length} 条，剩 ${readyToSend.length} 条`);
  }

  // 同一批内也不能重名
  const seenName = new Set<string>();
  readyToSend = readyToSend.filter((r) => {
    if (seenName.has(r.givenName)) return false;
    seenName.add(r.givenName);
    return true;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!NO_CLEAN) {
    // 清掉旧批次，避免改名后残留
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.startsWith("batch-") && f.endsWith(".json")) fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }

  let n = START - 1;
  for (let i = 0; i < readyToSend.length; i += BATCH_SIZE) {
    const slice = readyToSend.slice(i, i + BATCH_SIZE);
    n++;
    const batchId = `batch-${String(n).padStart(3, "0")}`;
    const items = slice.map((r, idx) => ({
      idx: idx + 1,
      givenName: r.givenName,
      pinyin: r.pinyin ?? "",
      lean: r.lean,
      meaning: r.meaning,
      composition: r.composition,
      pitfalls: r.pitfalls,
      source: r.source,
      piece: r.piece,
      quote: r.quote,
      leanConflict: Boolean(r.leanConflict),
      context: (texts.get(r.pieceId) ?? "").slice(0, 320),
    }));
    fs.writeFileSync(
      path.join(OUT_DIR, `${batchId}.json`),
      JSON.stringify({ batchId, count: items.length, items }, null, 2) + "\n",
      "utf8",
    );
  }
  console.log(`送入 ${readyToSend.length} 条 → ${n} 批，每批 ≤${BATCH_SIZE} 条`);
  console.log(`目录：${path.relative(ROOT, OUT_DIR)}`);
}

main();

