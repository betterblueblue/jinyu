import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { content: string; finishReason: string | null; reasoningChars: number; firstTokenMs: number };
type Step = (signal?: AbortSignal) => Promise<Reply>;

// 模型调用换成脚本：每次 streamChat 按顺序取一步，看补发逻辑怎么走
const mock = vi.hoisted(() => ({
  calls: [] as { signal?: AbortSignal; user: string }[],
  script: [] as Step[],
}));

vi.mock("@/providers/chat", async () => {
  const actual = await vi.importActual<typeof import("@/providers/chat")>("@/providers/chat");
  return {
    ...actual,
    streamChat: vi.fn((_client: unknown, args: { signal?: AbortSignal; messages: { role: string; content: string }[] }) => {
      mock.calls.push({ signal: args.signal, user: args.messages.find((m) => m.role === "user")?.content ?? "" });
      const next = mock.script.shift();
      return next ? next(args.signal) : Promise.reject(new Error("脚本用完了"));
    }),
  };
});

import { FastProvider } from "@/fast/provider";

const reply = (name: string): Reply => ({
  content: JSON.stringify({ candidates: [{ givenName: name, why: "一句话" }] }),
  finishReason: "stop",
  reasoningChars: 0,
  firstTokenMs: 1,
});
/** ms 毫秒后返回；被取消就报错（模拟 fetch 被 abort） */
const after =
  (ms: number, name: string): Step =>
  (signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(reply(name)), ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("LLM 请求已取消"));
        },
        { once: true },
      );
    });
const failNow = (): Step => () => Promise.reject(new Error("LLM HTTP 502"));

const req = { surname: "沈", gender: "female" as const };
const round = { seeds: ["禾"], avoid: [] };
const make = (hedgeMs: number) => new FastProvider({ baseUrl: "http://gateway", apiKey: "k", model: "m", hedgeMs });

beforeEach(() => {
  mock.calls.length = 0;
  mock.script = [];
});

describe("精简版补发", () => {
  it("第一路及时回来就不补发", async () => {
    mock.script = [after(5, "清禾")];
    const p = make(200);
    const list = await p.draft(req, round);
    expect(list[0]!.givenName).toBe("清禾");
    expect(mock.calls).toHaveLength(1);
    expect(p.lastDraft).toMatchObject({ hedged: false, hedgeWon: false });
  });

  it("第一路超时就补发，补发的先回就用它，第一路被取消", async () => {
    mock.script = [after(500, "慢的"), after(10, "快的")];
    const p = make(20);
    const list = await p.draft(req, round);
    expect(list[0]!.givenName).toBe("快的");
    expect(mock.calls).toHaveLength(2);
    expect(p.lastDraft).toMatchObject({ hedged: true, hedgeWon: true });
    expect(mock.calls[0]!.signal!.aborted).toBe(true);
  });

  it("补发了但原来那一路先回，就用原来那一路，补发的被取消", async () => {
    mock.script = [after(60, "原来的"), after(500, "补发的")];
    const p = make(20);
    const list = await p.draft(req, round);
    expect(list[0]!.givenName).toBe("原来的");
    expect(p.lastDraft).toMatchObject({ hedged: true, hedgeWon: false });
    expect(mock.calls[1]!.signal!.aborted).toBe(true);
  });

  it("第一路直接报错就立刻补发，不等满时间", async () => {
    mock.script = [failNow(), after(5, "补上的")];
    const p = make(10_000);
    const started = Date.now();
    const list = await p.draft(req, round);
    expect(list[0]!.givenName).toBe("补上的");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("补发那一路用换过的起手字", async () => {
    mock.script = [after(500, "慢的"), after(10, "快的")];
    await make(20).draft(req, { seeds: ["禾", "舟"], avoid: [] }, { seeds: ["晏", "澄"], avoid: [] });
    expect(mock.calls[0]!.user).toContain("起手字：禾、舟");
    expect(mock.calls[1]!.user).toContain("起手字：晏、澄");
  });

  it("两路都失败才报错", async () => {
    mock.script = [failNow(), failNow()];
    await expect(make(10).draft(req, round)).rejects.toThrow("LLM HTTP 502");
  });
});
