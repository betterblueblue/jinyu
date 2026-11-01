/**
 * 一场直播的统计：读 data/live-log/<日期>.jsonl（直播台、打分榜自动记的），打印起名、打分、改字的次数和等待时长，
 * 再列出打过分的名字，方便对着回想哪些分被观众质疑过。
 *
 * 用法：pnpm tsx scripts/live-stats.ts            （最近有日志的那一天）
 *       pnpm tsx scripts/live-stats.ts 2026-11-01
 */
import { formatLiveSummary, summarizeLiveLog } from "../src/live/live-log";
import { listLiveLogDays, readLiveLog } from "../src/live/live-log-store";

async function main() {
  const days = await listLiveLogDays();
  const day = process.argv[2] ?? days.at(-1);
  if (!day) {
    console.log("还没有直播日志：直播台起名、打分榜打分以后会自动记在 data/live-log/ 里。");
    return;
  }
  const events = await readLiveLog(day);
  console.log(`# ${day} 直播统计（${events.length} 条记录）\n`);
  console.log(formatLiveSummary(summarizeLiveLog(events)).join("\n"));
  if (days.length > 1) console.log(`\n其他有日志的日期：${days.filter((d) => d !== day).join("、")}`);
}

void main();
