import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatLiveSummary, parseLiveEvent, summarizeLiveLog, type LoggedEvent } from "@/live/live-log";
import { appendLiveLog, dayKey, listLiveLogDays, readLiveLog } from "@/live/live-log-store";

describe("parseLiveEvent：接口按形状收，不对整条不收", () => {
  it("收下改字记录，多余字段丢掉", () => {
    const got = parseLiveEvent({
      kind: "fix",
      fullName: "马梓宸",
      waitMs: 1234.4,
      prefetched: true,
      options: [{ fullName: "马知宸", score: 92, meaning: "不该记" }],
      birthday: "2024-05-01",
    });
    expect(got).toEqual({ kind: "fix", fullName: "马梓宸", waitMs: 1234, prefetched: true, options: [{ fullName: "马知宸", score: 92 }] });
  });

  it("不认识的种类、超长的名字、分数越界、性别不对都不收", () => {
    expect(parseLiveEvent({ kind: "hack" })).toBeNull();
    expect(parseLiveEvent(null)).toBeNull();
    expect(parseLiveEvent({ kind: "card", fullName: "一二三四五六七八九" })).toBeNull();
    const score = { kind: "score", fullName: "文海军", gender: "female", score: 75, bandLabel: "建议改", rules: ["genderWhole"], next: "fix", genderAsk: false };
    expect(parseLiveEvent(score)).toEqual(score);
    expect(parseLiveEvent({ ...score, score: 101 })).toBeNull();
    expect(parseLiveEvent({ ...score, rules: ["genderWhole", 3] })).toBeNull();
    expect(parseLiveEvent({ ...score, next: "maybe" })).toBeNull();
    const naming = { kind: "naming", surname: "张", gender: "male", birthday: true, primary: "张清远", alternatives: ["张知行"], library: false, waitMs: 6000 };
    expect(parseLiveEvent(naming)).toEqual(naming);
    expect(parseLiveEvent({ ...naming, gender: "unknown" })).toBeNull();
    expect(parseLiveEvent({ ...naming, waitMs: -1 })).toBeNull();
    expect(parseLiveEvent({ kind: "fix", fullName: "马梓宸", waitMs: 0, options: [], unfixable: null })).toBeNull();
  });
});

describe("直播日志读写", () => {
  let dir: string;
  const prev = process.env.JINYU_DATA_DIR;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "jinyu-live-log-"));
    process.env.JINYU_DATA_DIR = dir;
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.JINYU_DATA_DIR;
    else process.env.JINYU_DATA_DIR = prev;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("按本地日期追加到临时目录，写坏的行跳过，日期从早到晚", async () => {
    const day1 = new Date(2026, 10, 1, 20, 5);
    const day2 = new Date(2026, 10, 2, 0, 10);
    await appendLiveLog({ kind: "card", fullName: "马知宸" }, day2);
    await appendLiveLog({ kind: "card", fullName: "孙书宸" }, day1);
    await appendLiveLog({ kind: "choose", fullName: "孙梓宸", chosen: "孙书宸" }, day1);
    const file = path.join(dir, "live-log", `${dayKey(day1)}.jsonl`);
    await fs.appendFile(file, "{写坏了\n", "utf8");

    expect(dayKey(day1)).toBe("2026-11-01");
    expect(await listLiveLogDays()).toEqual(["2026-11-01", "2026-11-02"]);
    expect(await readLiveLog("2026-11-01")).toEqual([
      { kind: "card", fullName: "孙书宸", at: day1.toISOString() },
      { kind: "choose", fullName: "孙梓宸", chosen: "孙书宸", at: day1.toISOString() },
    ]);
    expect(await readLiveLog("2026-10-31")).toEqual([]);
  });

  it("目录还没有时，日期列表是空的", async () => {
    expect(await listLiveLogDays()).toEqual([]);
  });
});

describe("一场的统计", () => {
  const at = (h: number, m: number) => new Date(2026, 10, 1, h, m).toISOString();
  const events: LoggedEvent[] = [
    { kind: "naming", surname: "张", gender: "male", birthday: true, primary: "张清远", alternatives: ["张知行"], library: true, waitMs: 5000, at: at(20, 0) },
    { kind: "naming", surname: "李", gender: "female", birthday: false, primary: "李书禾", alternatives: [], library: false, waitMs: 9000, at: at(20, 2) },
    { kind: "nameError", surname: "王", message: "模型超时", at: at(20, 3) },
    { kind: "talk", primary: "李书禾", needed: 2, written: 1, at: at(20, 3) },
    { kind: "score", fullName: "马梓宸", gender: "male", score: 70, bandLabel: "建议改", rules: ["homophone"], next: "fix", genderAsk: false, at: at(20, 10) },
    { kind: "merit", fullName: "马梓宸", ok: true, tip: false, ms: 2800, at: at(20, 10) },
    { kind: "fix", fullName: "马梓宸", waitMs: 3000, prefetched: false, options: [], at: at(20, 11) },
    { kind: "score", fullName: "文雅", gender: "unknown", score: 96, bandLabel: "非常优秀", rules: [], next: "ask", genderAsk: true, at: at(20, 12) },
    { kind: "score", fullName: "马梓宸", gender: "male", score: 70, bandLabel: "建议改", rules: ["homophone"], next: "fix", genderAsk: false, at: at(20, 15) },
    { kind: "fix", fullName: "马梓宸", waitMs: 0, prefetched: true, options: [{ fullName: "马知宸", score: 92 }], at: at(20, 15) },
    { kind: "fix", fullName: "马梓宸", waitMs: 4000, prefetched: false, options: [], unfixable: "两个字合起来的毛病", at: at(20, 16) },
    { kind: "choose", fullName: "马梓宸", chosen: "马知宸", at: at(20, 16) },
    { kind: "naming", surname: "马", gender: "male", birthday: false, primary: "马景行", alternatives: [], library: false, waitMs: 6000, from: "score", at: at(20, 17) },
    { kind: "card", fullName: "马景行", at: at(20, 18) },
  ];

  it("各项计数、中位数，改字和换选算到同名最近那次打分上", () => {
    const s = summarizeLiveLog(events);
    expect(s.naming).toEqual({ count: 3, errors: 1, waitMedianMs: 6000, waitMaxMs: 9000, library: 1, fromScore: 1, talkNeeded: 2, talkWritten: 1 });
    expect(s.score).toEqual({ count: 3, bands: { 建议改: 2, 非常优秀: 1 }, genderAsk: 1 });
    expect(s.merit).toEqual({ count: 1, ok: 1, tip: 0, msMedian: 2800 });
    // 没出改法的两次（3 秒、4 秒）不算进「点了到出第一条改法」
    expect(s.fix).toEqual({ count: 3, prefetched: 1, waitMedianMs: 0, unfixable: 1, empty: 1, errors: 0 });
    expect(s.choose).toBe(1);
    expect(s.card).toBe(1);
    // 20:11 那次改字算到 20:10 那次打分上（当时最近的一次），不算到 20:15 那次
    expect(s.scored.map((r) => [r.fullName, r.fixed, r.chosen])).toEqual([
      ["马梓宸", true, undefined],
      ["文雅", false, undefined],
      ["马梓宸", true, "马知宸"],
    ]);
  });

  it("写成主播看得懂的几行，打过分的名字带时间", () => {
    const lines = formatLiveSummary(summarizeLiveLog(events));
    expect(lines[0]).toBe("起名 3 次（没出名字 1 次）；揭晓前等了中位 6.0 秒、最久 9.0 秒；首推是名字库里的 1 次；从打分榜「重新起名」过来的 1 次。");
    expect(lines).toContain("20:12 文雅（不填）96 分 非常优秀");
    expect(lines).toContain("20:15 马梓宸（男）70 分 建议改，点了改字，选了 马知宸");
    expect(formatLiveSummary(summarizeLiveLog([]))[0]).toContain("中位 —");
  });
});
