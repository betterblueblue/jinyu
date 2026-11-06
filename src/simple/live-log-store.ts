import { promises as fs } from "node:fs";
import path from "node:path";
import type { LiveEvent, LoggedEvent } from "@/live/live-log";
import { dayKey } from "@/live/live-log-store";

/**
 * 简化版直播日志：data/simple/live-log/<本地日期>.jsonl，和现在的系统分开，统计不混在一起。
 * 格式照 src/live/live-log.ts，统计脚本可以直接读这个目录。
 */
function logDir(): string {
  return path.join(process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data"), "simple", "live-log");
}

export async function appendSimpleLiveLog(event: LiveEvent, now = new Date()): Promise<void> {
  const dir = logDir();
  await fs.mkdir(dir, { recursive: true });
  const line: LoggedEvent = { ...event, at: now.toISOString() };
  await fs.appendFile(path.join(dir, `${dayKey(now)}.jsonl`), `${JSON.stringify(line)}\n`, "utf8");
}
