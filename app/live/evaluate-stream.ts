import type { EvalCandidate, EvaluateResult, NameFacts, OriginalEvaluation } from "@/domain/evaluate/types";

/**
 * 读 /api/analyze/evaluate?stream=1 的返回：一行一个 JSON（ndjson）。
 * facts 最早到，analysis 是核过、算过分的原名评价，option 是核过的改法，result 是完整结果。
 * 非流式返回（未登录、参数错误）照旧按 JSON 处理。
 */
export interface EvaluateHandlers {
  onFacts?: (facts: NameFacts) => void;
  onAnalysis?: (original: OriginalEvaluation) => void;
  onOption?: (option: EvalCandidate) => void;
  /** 模型推理里正在看的判断，一句一条 */
  onThought?: (text: string) => void;
}

export async function readEvaluateStream(res: Response, handlers: EvaluateHandlers): Promise<EvaluateResult | null> {
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    const body = (await res.json()) as { ok?: boolean; result?: EvaluateResult; message?: string };
    return body.ok && body.result ? body.result : null;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: EvaluateResult | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg: {
        type?: string;
        facts?: NameFacts;
        original?: OriginalEvaluation;
        option?: EvalCandidate;
        result?: EvaluateResult;
        text?: string;
      };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue;
      }
      if (msg.type === "facts" && msg.facts) handlers.onFacts?.(msg.facts);
      else if (msg.type === "analysis" && msg.original) handlers.onAnalysis?.(msg.original);
      else if (msg.type === "option" && msg.option) handlers.onOption?.(msg.option);
      else if (msg.type === "thought" && msg.text) handlers.onThought?.(msg.text);
      else if (msg.type === "result" && msg.result) result = msg.result;
    }
  }
  return result;
}
