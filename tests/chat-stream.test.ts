import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "@/providers/chat";

/** 造一个流式返回：每一项是一行 data: 后面的内容 */
function sse(events: unknown[], status = 200): Response {
  const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
const think = (t: string) => ({ choices: [{ delta: { reasoning_content: t } }] });
const say = (t: string) => ({ choices: [{ delta: { content: t } }] });
const end = { choices: [{ delta: {}, finish_reason: "stop" }] };
const lost = { error: { message: "Open Design: connection lost mid-reply (ECONNRESET: The socket connection was closed unexpectedly)", type: "api_error" } };

const client = { baseUrl: "http://gw.test/v1", apiKey: "k", model: "m" };
const args = { messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };

afterEach(() => vi.unstubAllGlobals());

describe("streamChat：网关在流里报错（2026-11-06 修）", () => {
  it("正文一个字还没到就断线：自动重发一次，拿第二次的结果", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sse([think("想一想"), lost, "[DONE]"])).mockResolvedValueOnce(sse([say('{"a":1}'), end, "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const r = await streamChat(client, args);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.content).toBe('{"a":1}');
    expect(r.finishReason).toBe("stop");
  });

  it("重发也断：报真正的原因，不再当成空正文", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => sse([lost, "[DONE]"])));
    await expect(streamChat(client, args)).rejects.toThrow(/connection lost mid-reply/);
  });

  it("正文写到一半断线：不重发，把写出来的交回去（finishReason 记 error），调用方照常捞已完成的", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([say('{"names":[{"givenName":"清和"},'), lost, "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const r = await streamChat(client, args);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.finishReason).toBe("error");
    expect(r.content).toContain("清和");
  });

  it("不是网络问题的报错（比如内容审核）：不重发，直接报", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([{ error: { message: "content filtered" } }, "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(streamChat(client, args)).rejects.toThrow(/content filtered/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 503 重发一次；HTTP 400 不重发", async () => {
    const ok = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(sse([say("{}"), end]));
    vi.stubGlobal("fetch", ok);
    await expect(streamChat(client, args)).resolves.toMatchObject({ content: "{}" });
    expect(ok).toHaveBeenCalledTimes(2);

    const bad = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", bad);
    await expect(streamChat(client, args)).rejects.toThrow(/LLM HTTP 400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("正常的流不受影响", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([think("嗯"), say('{"ok":'), say("true}"), end, "[DONE]"])));
    const r = await streamChat(client, args);
    expect(r).toMatchObject({ content: '{"ok":true}', finishReason: "stop", reasoningChars: 1 });
  });
});
