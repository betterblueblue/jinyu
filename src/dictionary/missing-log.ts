import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 直播时字典查不到的字，记到 data/qmz-dict/missing.jsonl（2026-11-05）。
 * 一行一个字，只记字和时间，不记是谁报的名字。
 * 下次跑 scripts/dict/fetch-qmz.ts 会把这些字补抓进字典。
 * 路径调用时求值：测试里设的 JINYU_DATA_DIR 才生效，不会写进真实的 data/。
 * 写失败不影响打分：调用方不等它。
 */

function missingFile(): string {
  return path.join(process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data"), "qmz-dict", "missing.jsonl");
}

/** 进程里已经记过的字，同一个字一场只记一次 */
const seen = new Set<string>();

export async function logMissingChars(chars: string[]): Promise<void> {
  const fresh = [...new Set(chars)].filter((c) => !seen.has(c));
  if (!fresh.length) return;
  for (const c of fresh) seen.add(c);
  const at = new Date().toISOString();
  const file = missingFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, fresh.map((char) => `${JSON.stringify({ char, at })}\n`).join(""), "utf8");
}

export function resetMissingLog(): void {
  seen.clear();
}
