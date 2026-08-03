import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { normalizeRequest } from "@/domain/normalizer";
import { runGeneration, type ProgressEvent } from "@/domain/orchestrator";
import { createCandidateProvider } from "@/providers";
import { saveReport } from "@/store/report-store";
import type { NamingFormInput, NormalizedRequest } from "@/domain/types";

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  // 流开启前的校验失败仍返回普通 JSON（现状不变）
  let request: NormalizedRequest | null = null;
  try {
    const body = (await req.json()) as NamingFormInput;
    const normalized = normalizeRequest(body);
    if (!normalized.ok) {
      return NextResponse.json(
        { ok: false, message: normalized.message, fieldErrors: normalized.fieldErrors },
        { status: 400 },
      );
    }
    request = normalized.value;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        try {
          controller.enqueue(sse(event, data));
        } catch {
          /* 客户端已断开，停止发送但让生成自然结束 */
        }
      };

      try {
        const provider = createCandidateProvider();
        const result = await runGeneration(request!, provider, (evt: ProgressEvent) => {
          if (evt.type === "thinking") emit("thinking", { text: evt.text });
          else if (evt.type === "stage") emit("stage", { stage: evt.stage });
        });

        if (!result.ok) {
          emit("error", {
            message: result.message,
            errorCode: result.errorCode,
            stage: result.stage,
            relaxations: result.relaxations,
          });
          return;
        }

        await saveReport(result.report);
        emit("done", { reportId: result.report.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : "生成失败，请稍后重试";
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
