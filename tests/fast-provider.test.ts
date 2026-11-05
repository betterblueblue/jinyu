import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { content: string; finishReason: string | null; reasoningChars: number; firstTokenMs: number };
type Step = (signal?: AbortSignal) => Promise<Reply>;

// 模型调用换成脚本：每次 streamChat 按顺序取一步，看补发逻辑怎么走
const mock = vi.hoisted(() => ({
  calls: [] as { signal?: AbortSignal; user: string; timeoutMs?: number }[],
  script: [] as Step[],
}));

vi.mock("@/providers/chat", async () => {
  const actual = await vi.importActual<typeof import("@/providers/chat")>("@/providers/chat");
  return {
    ...actual,
    streamChat: vi.fn((_client: unknown, args: { signal?: AbortSignal; timeoutMs?: number; messages: { role: string; content: string }[] }) => {
      mock.calls.push({
        signal: args.signal,
        timeoutMs: args.timeoutMs,
        user: args.messages.find((m) => m.role === "user")?.content ?? "",
      });
      const next = mock.script.shift();
      return next ? next(args.signal) : Promise.reject(new Error("脚本用完了"));
    }),
  };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FastProvider, type LaneOutcome } from "@/fast/provider";
import { runFast } from "@/fast/run";

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
const two = [{ seeds: ["禾"], avoid: [] }, { seeds: ["晏"], avoid: [] }];
const make = (hedgeMs = 0, roundTimeoutMs = 2000) =>
  new FastProvider({ baseUrl: "http://gateway", apiKey: "k", model: "m", hedgeMs, roundTimeoutMs });
/** 每一路回来都记下；enough 决定够不够 */
const collect = (enough: (all: LaneOutcome[]) => boolean = () => false) => {
  const got: LaneOutcome[] = [];
  return { got, onLane: (l: LaneOutcome) => (got.push(l), enough(got)) };
};

beforeEach(() => {
  mock.calls.length = 0;
  mock.script = [];
});

/*
 * 2026-11-05 改成几路合起来用（draftLanes），原来的「谁先回用谁、其余取消」那套用例跟着改：
 *   第一路及时回来就不补发 → 第一路够了就取消另一路；补发的先回就用它 → 两路都交出来；
 *   两路 / 三路都失败才报错、补发用换过的起手字、第一路报错立刻补发 → 照旧，断言换成 draftLanes 的返回。
 */
describe("精简版几路合起来用", () => {
  it("单路请求带 15 秒超时，不会干等 240 秒", async () => {
    mock.script = [after(5, "清禾")];
    await make().draftLanes(req, [round], collect().onLane);
    expect(mock.calls[0]!.timeoutMs).toBe(15_000);
  });

  it("解析候选的三个档位数字", async () => {
    mock.script = [
      () =>
        Promise.resolve({
          content: JSON.stringify({
            candidates: [{ givenName: "清瑶", why: "清亮", scores: { pronunciation: 20, meaning: 16, gender: 12 } }],
          }),
          finishReason: "stop",
          reasoningChars: 0,
          firstTokenMs: 1,
        }),
    ];
    const r = await make().draftLanes(req, [round], collect().onLane);
    expect(r.lanes[0]!.list[0]?.scores).toEqual({ pronunciation: 20, meaning: 16, gender: 12 });
  });

  it("默认两路一起发，每路用自己那组起手字", async () => {
    mock.script = [after(5, "第一路"), after(10, "第二路")];
    await make().draftLanes(req, two, collect().onLane);
    expect(mock.calls.map((c) => c.user.match(/起手字：(.)/)?.[1])).toEqual(["禾", "晏"]);
  });

  it("第一路回来就够了：另一路取消，不再等", async () => {
    mock.script = [after(5, "够了"), after(500, "慢的")];
    const c = collect(() => true);
    const started = Date.now();
    const r = await make().draftLanes(req, two, c.onLane);
    expect(r.lanes.map((l) => l.list[0]!.givenName)).toEqual(["够了"]);
    expect(mock.calls[1]!.signal!.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("第一路不够：等另一路，两路都交出来，按回来的先后", async () => {
    mock.script = [after(60, "慢的"), after(10, "快的")];
    const c = collect();
    const r = await make().draftLanes(req, two, c.onLane);
    expect(c.got.map((l) => [l.index, l.list[0]!.givenName])).toEqual([[1, "快的"], [0, "慢的"]]);
    expect(r.launched).toBe(2);
  });

  it("一路出错不影响另一路：用回来的那一路", async () => {
    mock.script = [failNow(), after(10, "补上的")];
    const r = await make().draftLanes(req, two, collect().onLane);
    expect(r.lanes.map((l) => l.list[0]!.givenName)).toEqual(["补上的"]);
  });

  it("设了 hedgeMs：第一路报错就立刻发另一路，不等满时间", async () => {
    mock.script = [failNow(), after(5, "补上的")];
    const started = Date.now();
    const r = await make(10_000).draftLanes(req, two, collect().onLane);
    expect(r.lanes[0]!.list[0]!.givenName).toBe("补上的");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("设了 hedgeMs：第一路回来但不够，立刻发另一路，不等满时间", async () => {
    mock.script = [after(5, "不够"), after(5, "补上的")];
    const started = Date.now();
    const r = await make(10_000).draftLanes(req, two, collect().onLane);
    expect(r.lanes).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("到了整轮截止时间：没回的取消，用手里已有的", async () => {
    mock.script = [after(5, "先回的"), after(5_000, "太慢的")];
    const started = Date.now();
    const r = await make(0, 100).draftLanes(req, two, collect().onLane);
    expect(r.lanes.map((l) => l.list[0]!.givenName)).toEqual(["先回的"]);
    expect(mock.calls[1]!.signal!.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("到了截止时间一路都没回：报错，调用方从名字库兜底", async () => {
    mock.script = [after(5_000, "太慢"), after(5_000, "太慢")];
    await expect(make(0, 50).draftLanes(req, two, collect().onLane)).rejects.toThrow();
  });

  it("两路都失败才报错", async () => {
    mock.script = [failNow(), failNow()];
    await expect(make().draftLanes(req, two, collect().onLane)).rejects.toThrow("LLM HTTP 502");
  });

  it("处理回来的那一路时出错：整轮马上报错、另一路取消，不干等到截止时间", async () => {
    mock.script = [after(5, "坏的"), after(5_000, "慢的")];
    const started = Date.now();
    await expect(
      make(0, 5_000).draftLanes(req, two, () => {
        throw new Error("核出处出错");
      }),
    ).rejects.toThrow("核出处出错");
    expect(mock.calls[1]!.signal!.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("runFast：第一路过闸不够 3 个时，把第二路的名字合进来用，不去名字库补", async () => {
    // 名字库指到空目录：要是还走名字库，这一轮就凑不满、报 NO_CANDIDATE
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jinyu-lanes-"));
    const env = { ...process.env };
    Object.assign(process.env, { JINYU_DATA_DIR: dir, LLM_API_KEY: "k", FAST_HEDGE_MS: "0", FAST_LANES: "2" });
    const good = { pronunciation: 20, meaning: 20, gender: 12 };
    const lane = (ms: number, names: string[]): Step => (signal) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => resolve({ content: JSON.stringify({ candidates: names.map((givenName) => ({ givenName, why: "一句话", scores: good })) }), finishReason: "stop", reasoningChars: 0, firstTokenMs: 1 }),
          ms,
        );
        signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("LLM 请求已取消"))), { once: true });
      });
    // 第一路先回：只有清禾能过（沐阳热门名封顶 89）；第二路后回：书宁、若溪
    mock.script = [lane(5, ["清禾", "沐阳"]), lane(30, ["书宁", "若溪"])];
    try {
      const r = await runFast({ surname: "林", gender: "female" });
      if (!r.ok) throw new Error(`应该成功：${r.message}`);
      const names = [r.primary, ...r.alternatives].map((c) => c.givenName).sort();
      expect(names).toEqual(["书宁", "清禾", "若溪"]);
      expect([r.primary, ...r.alternatives].every((c) => !c.library)).toBe(true);
      expect(r.debug?.lanes?.map((l) => l.used)).toEqual([true, true]);
    } finally {
      process.env = env;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("三路时也一样：都交出来，都失败才报错", async () => {
    mock.script = [after(30, "第一路"), after(20, "第二路"), after(10, "第三路")];
    const three = [...two, { seeds: ["澄"], avoid: [] }];
    const r = await make().draftLanes(req, three, collect().onLane);
    expect(r.lanes.map((l) => l.index)).toEqual([2, 1, 0]);
    mock.script = [failNow(), failNow(), failNow()];
    await expect(make().draftLanes(req, three, collect().onLane)).rejects.toThrow("LLM HTTP 502");
  });
});
