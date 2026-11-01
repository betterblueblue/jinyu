import type { FixOption, FixOutcome } from "@/domain/score/types";

/**
 * 读 /api/analyze/fix?stream=1 的返回：一行一个 JSON（ndjson）。
 * 每核过一个改法来一帧 option，马上交给 onOption（打分榜和提词页边收边显示）；最后一帧 result 是完整结果。
 * 非流式返回（未登录、参数错误）照旧按 JSON 处理。
 */
export async function readFixStream(res: Response, onOption: (option: FixOption) => void): Promise<FixOutcome | null> {
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    return (await res.json()) as FixOutcome;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let outcome: FixOutcome | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg: { type?: string; option?: FixOption; outcome?: FixOutcome };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue;
      }
      if (msg.type === "option" && msg.option) onOption(msg.option);
      else if (msg.type === "result" && msg.outcome) outcome = msg.outcome;
    }
  }
  return outcome;
}
