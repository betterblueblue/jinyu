import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { runAnalysis, validateAnalysisInput } from "@/domain/analysis/analyze";
import { createAnalysisProvider } from "@/providers";

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 名字分析。和 /api/generate 同构的 SSE：thinking / stage / done / error。
 *
 * 分析结果不落盘——它是过程，不是交付物。要留下的是随后生成的那份取名报告。
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  let input;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const checked = validateAnalysisInput(body);
    if (!checked.ok) {
      return NextResponse.json({ ok: false, message: checked.message }, { status: 400 });
    }
    input = checked.input;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
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
        emit("stage", { stage: "reading" });
        const outcome = await runAnalysis(input, createAnalysisProvider(), (text) =>
          emit("thinking", { text }),
        );

        if (!outcome.ok) {
          emit("error", { message: outcome.message, errorCode: outcome.errorCode });
          return;
        }

        emit("stage", { stage: "verifying" });
        emit("done", { result: outcome.result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "分析失败，请稍后重试";
        emit("error", { message, errorCode: "SERVER_ERROR" });
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
