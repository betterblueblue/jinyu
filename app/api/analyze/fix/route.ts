import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { suggestFixes } from "@/domain/score/fix";
import { resolveSplit, scoreName } from "@/domain/score/score";
import type { FixOutcome } from "@/domain/score/types";
import { createFixProvider } from "@/providers";

/**
 * 打分榜的「改一个字」：主播点了按钮才调。改哪个字、改成什么由模型看扣分理由定，服务端逐条核验。
 *
 * 分数在服务端重新算，不信前端传来的。
 * 两种返回方式：
 *   - 默认：一次性 JSON；
 *   - ?stream=1：NDJSON，每核过一个改法推一帧 option，最后推一帧 result（完整结果）。
 *     直播台边收边显示、边推提词页，主播不用等三个改法全写完。
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
  }

  const checked = validateAnalysisInput(body);
  if (!checked.ok) {
    return NextResponse.json({ ok: false, message: checked.message }, { status: 400 });
  }
  const split = resolveSplit(checked.input.fullName, checked.input.surnameOverride);
  if (!split) {
    return NextResponse.json({ ok: false, message: "姓名无法拆分" }, { status: 400 });
  }

  const score = scoreName(split, checked.input.gender);
  const provider = createFixProvider();

  if (new URL(req.url).searchParams.get("stream") !== "1") {
    const outcome = await suggestFixes(score, split, provider);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
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
      let outcome: FixOutcome;
      try {
        outcome = await suggestFixes(score, split, provider, (option) => send({ type: "option", option }));
      } catch (err) {
        outcome = { ok: false, message: err instanceof Error ? err.message : "改字没成功" };
      }
      send({ type: "result", outcome });
      try {
        controller.close();
      } catch {
        /* 已经断开 */
      }
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
