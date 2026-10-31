import type { FastFailure, FastSuccess } from "@/fast/types";

/**
 * 读 /api/fast?stream=1 的返回：一行一个 JSON（ndjson），阶段事件和最后的结果。
 *
 * 阶段事件变成加载页上的一帧帧文字（staged），先收着，结果到了再由直播台按节奏放出来。
 * 非流式返回（未登录、参数错误）照旧按 JSON 处理。
 */
export async function readFastResponse(
  res: Response,
): Promise<{ payload: FastSuccess | FastFailure | null; staged: string[] }> {
  let payload: FastSuccess | FastFailure | null = null;
  /** 服务端推过来的真实阶段，先收着，结果到了再按节奏放出来 */
  const staged: string[] = [];
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    // 非流式返回（未登录、参数错误）照旧按 JSON 处理
    payload = (await res.json()) as FastSuccess | FastFailure;
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (msg.type === "stage") {
          // 每一帧都是 run.ts 真算出来的：给了几个、拦了谁、核到几条。
          // 这些步骤本身只花几毫秒，全在模型返回之后才发生，所以先收着，
          // 等结果到了再逐帧放——放的是刚发生的事实，不是编的进度。
          if (msg.stage === "draft") staged.push(`候选 ${String(msg.drafted)} 个`);
          else if (msg.stage === "gate") {
            const dropped = (msg.dropped ?? []) as { name: string; reasons: string[] }[];
            if (dropped.length === 0) staged.push(`${String(msg.kept)} 个全部通过闸门`);
            else for (const d of dropped.slice(0, 2)) staged.push(`排除 ${d.name} · ${d.reasons.join("、")}`);
          } else if (msg.stage === "cite") {
            const missing = Number(msg.missing ?? 0);
            staged.push(`原文核验 ${String(msg.withLine)} 条${missing ? `，${missing} 个留白` : ""}`);
          }
        } else if (msg.type === "result") {
          payload = msg.result as FastSuccess | FastFailure;
        }
      }
    }
  }
  return { payload, staged };
}
