import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { computeChart } from "@/fortune/chart";
import { validateFortuneInput } from "@/fortune/normalize";
import { createReadingProvider } from "@/fortune/provider";
import { runReading } from "@/fortune/reading";

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 八字排盘与解读。SSE：chart（本地排盘，立刻返回）→ stage → done（模型解读）/ error。
 *
 * 排盘在开流之前就算好：输入有问题直接回 400，不开流。
 * 结果不落盘——和名字分析一样，是即时查看的内容。
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

  const checked = validateFortuneInput(body);
  if (!checked.ok) {
    return NextResponse.json({ ok: false, message: checked.message }, { status: 400 });
  }

  let chart;
  try {
    chart = computeChart(checked.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "排盘失败";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        try {
          controller.enqueue(sse(event, data));
        } catch {
          /* 客户端断开，让流程自然结束 */
        }
      };

      try {
        emit("chart", { chart });
        emit("stage", { stage: "reading" });
        const outcome = await runReading(chart, createReadingProvider());
        if (!outcome.ok) {
          emit("error", { message: outcome.message });
          return;
        }
        emit("done", { reading: outcome.reading });
      } catch (err) {
        const message = err instanceof Error ? err.message : "解读失败，请稍后重试";
        emit("error", { message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
