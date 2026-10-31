import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { runFast } from "@/fast/run";
import type { FastFormInput } from "@/fast/types";

/**
 * 精简快速版接口（直播台专用）。
 *
 * 与 /api/generate 完全独立：不同输入形状、不同 provider、不同返回结构、
 * 不写 data/reports、不写 index.json。改这里不会影响正式取名页。
 *
 * 一次性返回 JSON（不是 SSE）：整轮 3–9 秒，前端一个转圈就够，
 * 不需要事件流那套 sse/controller 代码。
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, code: "BAD_INPUT", message: "请先登录" }, { status: 401 });
  }

  let body: FastFormInput;
  try {
    body = (await req.json()) as FastFormInput;
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_INPUT", message: "请求体解析失败" }, { status: 400 });
  }

  const result = await runFast(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
