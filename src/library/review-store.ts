import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReviewBatch, Verdict, VerdictMap, VerdictRecord } from "./review-types";

/**
 * 名字评审的读写。批次文件由 scripts/library/build-review.ts 生成，用户的评审结果单独存一份 <批次>.verdicts.json。
 * 路径调用时求值（照 report-store.ts 的写法），测试可以用 JINYU_DATA_DIR 指到临时目录。
 */

const BATCH_NAME = /^[a-z0-9-]{1,40}$/;
const VERDICTS: readonly Verdict[] = ["yes", "no", "unsure"];
export const NOTE_MAX = 200;

function reviewDir(): string {
  const base = process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(base, "name-library", "v2", "review");
}

export function isBatchName(name: string): boolean {
  return BATCH_NAME.test(name);
}

export async function listBatches(): Promise<string[]> {
  try {
    const files = await fs.readdir(reviewDir());
    return files
      .filter((f) => f.endsWith(".json") && !f.endsWith(".verdicts.json"))
      .map((f) => f.slice(0, -".json".length))
      .filter(isBatchName)
      .sort();
  } catch {
    return [];
  }
}

export async function loadBatch(name: string): Promise<ReviewBatch | null> {
  if (!isBatchName(name)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(reviewDir(), `${name}.json`), "utf8")) as ReviewBatch;
  } catch {
    return null;
  }
}

export async function loadVerdicts(name: string): Promise<VerdictMap> {
  if (!isBatchName(name)) return {};
  try {
    return JSON.parse(await fs.readFile(path.join(reviewDir(), `${name}.verdicts.json`), "utf8")) as VerdictMap;
  } catch {
    return {};
  }
}

export type SaveResult = { ok: true; record: VerdictRecord } | { ok: false; message: string };

/** 串行写：主播连点几下也不会互相覆盖 */
let queue: Promise<unknown> = Promise.resolve();

export function saveVerdict(name: string, id: string, verdict: string, note?: string): Promise<SaveResult> {
  const run = async (): Promise<SaveResult> => {
    if (!isBatchName(name)) return { ok: false, message: "批次名不对" };
    if (!VERDICTS.includes(verdict as Verdict)) return { ok: false, message: "只能选 要 / 不要 / 拿不准" };
    const batch = await loadBatch(name);
    if (!batch) return { ok: false, message: "找不到这一批名字" };
    if (!batch.items.some((i) => i.id === id)) return { ok: false, message: "这一批里没有这个名字" };

    const verdicts = await loadVerdicts(name);
    const text = typeof note === "string" ? [...note.trim()].slice(0, NOTE_MAX).join("") : "";
    const record: VerdictRecord = { verdict: verdict as Verdict, ...(text ? { note: text } : {}), at: new Date().toISOString() };
    verdicts[id] = record;

    const file = path.join(reviewDir(), `${name}.verdicts.json`);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(verdicts, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
    return { ok: true, record };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
