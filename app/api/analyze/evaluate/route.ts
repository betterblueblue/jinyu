import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { createEvaluateProvider, evaluateName } from "@/domain/evaluate";
import { cacheKey, getCached, setCached } from "@/domain/evaluate/cache";
import { buildFacts } from "@/domain/evaluate/facts";
import { isSensitiveName, SENSITIVE_NOTE } from "@/domain/evaluate/sensitive";
import type { EvaluateResult } from "@/domain/evaluate/types";
import { resolveSplit, scoreName } from "@/domain/score/score";

/**
 * 打分榜的统一评价接口（2026-11-04 新流程）。
 *
 * 一次请求做完：规则出事实 → 一次模型调用写原名评价和候选 → 程序核验、算分、压上限。
 * 默认 NDJSON，按顺序推：
 *   facts    拆名、拼音、用字、命中的规则（几毫秒）
 *   analysis 核过、算过分后的原名评价
 *   option   核过的一个改法（精简模式最多一条）
 *   result   完整结果和结束状态
 * 性别没填时只推 facts 和 result（needs_gender），不调模型（用户定：不出分，先问男宝女宝）。
 * 非流式（不带 ?stream=1）返回一份 JSON，给脚本和调试用。
 *
 * 2026-11-05：
 *   - 敏感人物的名字直接拒，不推任何东西（打分榜在浏览器里已经先拦了，这里再兜一次）；
 *   - 同一个名字这一场评过，直接重放上次的结果；body 带 retry: true 时原名评价钉住，只重写改法。
 */
export const dynamic = "force-dynamic";

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
  if (isSensitiveName(checked.input.fullName)) {
    return NextResponse.json({ ok: false, message: SENSITIVE_NOTE }, { status: 400 });
  }
  const split = resolveSplit(checked.input.fullName, checked.input.surnameOverride);
  if (!split) {
    return NextResponse.json({ ok: false, message: "姓名无法拆分" }, { status: 400 });
  }

  const provider = createEvaluateProvider();
  if (!provider) {
    return NextResponse.json({ ok: false, message: "没有配模型钥匙" }, { status: 503 });
  }
  const input = {
    fullName: checked.input.fullName,
    gender: checked.input.gender,
    ...(checked.input.surnameOverride ? { splitSurname: checked.input.surnameOverride } : {}),
  };

  const key = cacheKey(split.surname, split.givenName, checked.input.gender);
  const cached = getCached(key);
  const retry = body.retry === true;
  const replay: EvaluateResult | null = cached && !retry ? { ...cached, cached: true, tookMs: 0 } : null;
  const pinnedOriginal = cached?.original ?? undefined;

  /** 跑一次模型；钉住原名时，这次没写出改法就保留上次的记录，不拿空结果盖掉 */
  const remember = (result: EvaluateResult) => {
    if (pinnedOriginal && result.candidates.length === 0) return;
    setCached(key, result);
  };

  if (new URL(req.url).searchParams.get("stream") !== "1") {
    if (replay) return NextResponse.json({ ok: true, result: replay });
    const result = await evaluateName(input, provider, { maxCandidates: 2, signal: req.signal, pinnedOriginal });
    remember(result);
    return NextResponse.json({ ok: true, result }, { status: result.status === "error" ? 502 : 200 });
  }

  const facts = buildFacts(split, scoreName(split, checked.input.gender));
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
      const close = () => {
        try {
          controller.close();
        } catch {
          /* 已经断开 */
        }
      };

      if (replay) {
        send({ type: "facts", facts: replay.facts });
        if (replay.original) send({ type: "analysis", original: replay.original });
        for (const option of replay.candidates) send({ type: "option", option });
        send({ type: "result", result: replay });
        close();
        return;
      }

      send({ type: "facts", facts });
      if (pinnedOriginal) send({ type: "analysis", original: pinnedOriginal });

      let result: EvaluateResult;
      try {
        result = await evaluateName(input, provider, { maxCandidates: 2, signal: req.signal, pinnedOriginal }, {
          onScores: (original) => send({ type: "analysis", original }),
          onOriginal: (original) => send({ type: "analysis", original }),
          onOption: (option) => send({ type: "option", option }),
          onThought: (text) => send({ type: "thought", text }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "评价没成功";
        send({
          type: "result",
          result: { facts, status: "error", original: null, candidates: [], rejected: [], note: message, tookMs: 0 },
        });
        close();
        return;
      }

      remember(result);
      send({ type: "result", result });
      close();
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
