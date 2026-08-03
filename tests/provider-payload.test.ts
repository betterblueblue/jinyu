import { afterEach, describe, expect, it, vi } from "vitest";
import { StepFunProvider } from "@/providers/stepfun-provider";
import { normalizeRequest } from "@/domain/normalizer";

/** 最小 SSE 响应：一个 content delta + [DONE]，让 provider 解析到候选 */
function sseResponse(content: string): Response {
  const enc = new TextEncoder();
  const event = JSON.stringify({
    choices: [{ delta: { content }, finish_reason: "stop" }],
  });
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${event}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

function captureFetch(captured: string[]) {
  vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
    captured.push(String(opts.body));
    return sseResponse('{"candidates":[{"givenName":"嘉言"}]}');
  });
}

function userContent(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as { role: string; content: string }[];
  const user = messages.find((m) => m.role === "user");
  return JSON.parse(user!.content) as Record<string, unknown>;
}

function systemContent(body: Record<string, unknown>): string {
  const messages = body.messages as { role: string; content: string }[];
  return messages.find((m) => m.role === "system")!.content;
}

describe("StepFunProvider payload（八字字段进 prompt）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("开启八字时 payload 携带 baziEnabled/birthDate/birthHour", async () => {
    const captured: string[] = [];
    captureFetch(captured);

    const n = normalizeRequest({
      surname: "王",
      gender: "male",
      nameLength: "two",
      baziEnabled: true,
      birthDate: "2024-05-01",
      birthHour: "9",
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;

    const provider = new StepFunProvider({ baseUrl: "http://x", apiKey: "k", model: "m" });
    await provider.generateCandidates(n.value, 0);

    const body = JSON.parse(captured[0]!) as Record<string, unknown>;
    const user = userContent(body);
    expect(user.baziEnabled).toBe(true);
    expect(user.birthDate).toBe("2024-05-01");
    expect(user.birthHour).toBe("9");
    // system 的 JSON 格式定义要求输出 baziFit
    expect(systemContent(body)).toContain('"baziFit":"与生辰气质的呼应');
    // user instruction 硬强调每个候选必须包含 baziFit
    expect(String(user.instruction)).toContain("每个候选的 JSON 对象必须包含 baziFit 字段");
    expect(String(user.instruction)).toContain("不作五行用神铁口定论");
  });

  it("关闭八字时 payload 不含八字字段", async () => {
    const captured: string[] = [];
    captureFetch(captured);

    const n = normalizeRequest({ surname: "王", gender: "male", nameLength: "two" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;

    const provider = new StepFunProvider({ baseUrl: "http://x", apiKey: "k", model: "m" });
    await provider.generateCandidates(n.value, 0);

    const body = JSON.parse(captured[0]!) as Record<string, unknown>;
    const user = userContent(body);
    expect(user).not.toHaveProperty("baziEnabled");
    expect(user).not.toHaveProperty("birthDate");
    expect(user).not.toHaveProperty("birthHour");
    // 关闭八字时 system 格式不含 baziFit、instruction 不要求输出
    expect(systemContent(body)).not.toContain("baziFit");
    expect(String(user.instruction)).not.toContain("baziFit");
    expect(String(user.instruction)).not.toContain("不作五行用神铁口定论");
  });

  it("开启八字但模型漏输出 baziFit 时，用本地排盘兜底补齐", async () => {
    // 模拟模型输出：candidates 无 baziFit 字段
    vi.stubGlobal("fetch", async (_url: string, _opts: RequestInit) => {
      return sseResponse(
        '{"candidates":[{"givenName":"嘉言","genderLean":"male","phonology":"","glyph":"","meaning":"","origin":"","pitfalls":"","styleFit":""}]}',
      );
    });

    const n = normalizeRequest({
      surname: "王",
      gender: "male",
      nameLength: "two",
      baziEnabled: true,
      birthDate: "2024-05-01",
      birthHour: "9",
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;

    const provider = new StepFunProvider({ baseUrl: "http://x", apiKey: "k", model: "m" });
    const list = await provider.generateCandidates(n.value, 0);
    expect(list.length).toBe(1);
    expect(list[0]?.baziFit).toBeDefined();
    expect(list[0]?.baziFit).toContain("四柱示意为");
  });
});
