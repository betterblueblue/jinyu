import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { parseLiveEvent } from "@/live/live-log";
import { appendLiveLog } from "@/live/live-log-store";

/**
 * 直播日志（src/live/live-log.ts）：直播台、打分榜每发生一件事 POST 一条，追加到 data/live-log/<日期>.jsonl。
 * 只存在这台电脑上。写不进去不影响直播，前端也不等它。
 */
export const dynamic = "force-dynamic";

/** 一条日志正常几百字节 */
const BODY_MAX = 4_000;

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  const raw = await req.text();
  if (raw.length > BODY_MAX) {
    return NextResponse.json({ ok: false, message: "内容太长" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
  }
  const event = parseLiveEvent(body);
  if (!event) {
    return NextResponse.json({ ok: false, message: "日志格式不对" }, { status: 400 });
  }
  await appendLiveLog(event);
  return NextResponse.json({ ok: true });
}
