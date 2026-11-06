import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { isSensitiveName, SENSITIVE_NOTE } from "@/domain/evaluate/sensitive";
import { evaluateSimple, type SimpleEvalResult } from "@/simple/evaluate";
import { simpleClient } from "@/simple/llm";

/**
 * 简化版打分改字（2026-11-06，照 /api/analyze/evaluate 的样子，换成 src/simple/evaluate.ts）。
 * NDJSON 按顺序推：facts（几毫秒）→ thought（模型推理里的判断）→ analysis（先只有八维分，写完再补点评）→ fix → result。
 * 敏感人物直接拒；性别没填只推 facts 和 needs_gender。
 * 同一个名字这一场评过就重放（缓存只在内存、挂 globalThis）；body 带 retry: true 时原名分钉住，只重写改法。
 */
export const dynamic = "force-dynamic";

const g = globalThis as typeof globalThis & { __jinyuSimpleEval?: Map<string, SimpleEvalResult> };
const cache: Map<string, SimpleEvalResult> = g.__jinyuSimpleEval ?? new Map();
g.__jinyuSimpleEval = cache;

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
  if (!checked.ok) return NextResponse.json({ ok: false, message: checked.message }, { status: 400 });
  if (isSensitiveName(checked.input.fullName)) return NextResponse.json({ ok: false, message: SENSITIVE_NOTE }, { status: 400 });
  if (!simpleClient()) return NextResponse.json({ ok: false, message: "没有配模型钥匙" }, { status: 503 });

  const input = {
    fullName: checked.input.fullName,
    gender: checked.input.gender,
    ...(checked.input.surnameOverride ? { surnameOverride: checked.input.surnameOverride } : {}),
  };
  const key = `${checked.input.surnameOverride ?? ""}|${checked.input.fullName}|${checked.input.gender}`;
  const cached = cache.get(key);
  const retry = body.retry === true;
  const pinned = cached?.analysis ?? undefined;

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
      const close = () => {
        try {
          controller.close();
        } catch {
          /* 已经断开 */
        }
      };
      if (cached && !retry) {
        send({ type: "facts", facts: cached.facts });
        if (cached.analysis) send({ type: "analysis", analysis: cached.analysis });
        for (const fix of cached.fixes) send({ type: "fix", fix });
        send({ type: "result", result: { ...cached, cached: true, tookMs: 0 } });
        close();
        return;
      }
      if (pinned) send({ type: "analysis", analysis: pinned });
      let result: SimpleEvalResult;
      try {
        result = await evaluateSimple(input, { ...(retry && pinned ? { pinned } : {}), signal: req.signal }, {
          onFacts: (facts) => send({ type: "facts", facts }),
          onThought: (text) => send({ type: "thought", text }),
          onAnalysis: (analysis) => send({ type: "analysis", analysis }),
          onFix: (fix) => send({ type: "fix", fix }),
        });
      } catch (err) {
        send({ type: "result", result: { status: "error", note: err instanceof Error ? err.message : "评价没成功" } });
        close();
        return;
      }
      // 只记写完的；重试这次没写出改法，保留上次的
      if (result.analysis && !(retry && pinned && result.fixes.length === 0)) cache.set(key, result);
      send({ type: "result", result });
      close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
