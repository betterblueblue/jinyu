import { promises as fs } from "node:fs";
import path from "node:path";
import type { LiveEvent, LoggedEvent } from "./live-log";

/**
 * 直播日志写在 data/live-log/<本地日期>.jsonl，一行一条，只追加。data/ 不进 git。
 * 路径调用时求值（照 report-store.ts）：测试里设的 JINYU_DATA_DIR 才生效，不会写进真实的 data/。
 */

function logDir(): string {
  return path.join(process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data"), "live-log");
}

/** 本地日期，如 2026-11-01；一场直播过了午夜会分成两个文件 */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function appendLiveLog(event: LiveEvent, now = new Date()): Promise<void> {
  const dir = logDir();
  await fs.mkdir(dir, { recursive: true });
  const line: LoggedEvent = { ...event, at: now.toISOString() };
  await fs.appendFile(path.join(dir, `${dayKey(now)}.jsonl`), `${JSON.stringify(line)}\n`, "utf8");
}

/** 读一天的日志；写坏的行跳过 */
export async function readLiveLog(day: string): Promise<LoggedEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(logDir(), `${day}.jsonl`), "utf8");
  } catch {
    return [];
  }
  const out: LoggedEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LoggedEvent);
    } catch {
      /* 跳过 */
    }
  }
  return out;
}

/** 有日志的日期，从早到晚 */
export async function listLiveLogDays(): Promise<string[]> {
  try {
    return (await fs.readdir(logDir()))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}
