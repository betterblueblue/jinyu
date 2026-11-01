import type { FastFailure, FastSuccess } from "@/fast/types";

/**
 * 去掉一个名字的理由，大多是给主播看的短语（「连姓读起来不雅」「叠字像小名」），观众也看得懂；
 * 只有口味过滤那条是对主播说的（src/fast/taste.ts），上屏前换个说法
 */
const VIEWER_REASON: Record<string, string> = { 你在评审页评过不要: "之前评过，不推荐" };

function forViewers(reason: string): string {
  return VIEWER_REASON[reason] ?? reason;
}

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
          // 这几行观众看得见，用观众听得懂的话说，不写「闸门」这类内部叫法
          if (msg.stage === "draft") staged.push(`起草了 ${String(msg.drafted)} 个候选`);
          else if (msg.stage === "gate") {
            const dropped = (msg.dropped ?? []) as { name: string; reasons: string[] }[];
            for (const d of dropped.slice(0, 2)) staged.push(`去掉「${d.name}」：${d.reasons.map(forViewers).join("、")}`);
            staged.push(`${dropped.length ? "其余 " : ""}${String(msg.kept)} 个查过谐音和生僻字`);
          } else if (msg.stage === "cite") {
            const missing = Number(msg.missing ?? 0);
            staged.push(`出处逐字核对 ${String(msg.withLine)} 条${missing ? `，${missing} 个没有出处` : ""}`);
          }
        } else if (msg.type === "result") {
          payload = msg.result as FastSuccess | FastFailure;
        }
      }
    }
  }
  return { payload, staged };
}
