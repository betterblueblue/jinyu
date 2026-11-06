import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import type { FastFormInput } from "@/fast/types";
import { runSimpleFast } from "@/simple/fast";

/**
 * 简化版直播起名（2026-11-06，照 /api/fast?stream=1，换成 src/simple/fast.ts）。
 * NDJSON：stage（kept：留下一个名字，直播台等待页先放出来；dropped：去掉一个和原因）→ result（FastSuccess / FastFailure，和现在一样）。
 */
export const dynamic = "force-dynamic";

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
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* 客户端断了 */
        }
      };
      let result;
      try {
        result = await runSimpleFast(body, (s) => send({ type: "stage", ...s }));
      } catch (err) {
        result = { ok: false, code: "UPSTREAM", message: err instanceof Error ? err.message : "生成失败" };
      }
      send({ type: "result", result });
      try {
        controller.close();
      } catch {
        /* 已经断开 */
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
