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
 * 两种返回方式：
 *   - 默认：一次性 JSON（e2e 和别的调用方继续这么用）
 *   - ?stream=1：NDJSON 流，先逐条推「真实阶段」，最后推一帧 result
 *
 * 为什么加流：一轮压到 2–3 秒之后，加载页原来是一块死画面。阶段帧的内容全是
 * run.ts 真算出来的东西（模型给了几个、闸门拦了谁、核到几条原文），不是演的。
 * 没有这些帧，加载页就只能写「正在思考」——那正是普通 AI 工具的样子。
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

  const wantsStream = new URL(req.url).searchParams.get("stream") === "1";
  if (!wantsStream) {
    const result = await runFast(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* 客户端断了就不推了，结果照常算完 */
        }
      };
      let result;
      try {
        result = await runFast(body, (stage) => send({ type: "stage", ...stage }));
      } catch (err) {
        send({ type: "result", result: { ok: false, code: "UPSTREAM", message: err instanceof Error ? err.message : "生成失败" } });
        controller.close();
        return;
      }
      send({ type: "result", result });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
