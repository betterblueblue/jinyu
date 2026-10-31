import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { parsePrompterRound } from "@/live/prompter";
import { readPrompter, writePrompter } from "@/live/prompter-store";

/**
 * 主播提词页的同步接口。
 *   POST：直播页推这一轮的稿子（开始取名、出结果、回到输入各推一次）
 *   GET：提词页每秒取一次最新的
 * 只存最新一轮、只在内存里（src/live/prompter-store.ts）。
 */
export const dynamic = "force-dynamic";

/** 一轮稿子正常 2KB 上下 */
const BODY_MAX = 20_000;

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...readPrompter() }, { headers: { "Cache-Control": "no-store" } });
}

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
  const round = parsePrompterRound(body);
  if (!round) {
    return NextResponse.json({ ok: false, message: "提词内容格式不对" }, { status: 400 });
  }
  const snap = writePrompter(round);
  return NextResponse.json({ ok: true, seq: snap.seq });
}
