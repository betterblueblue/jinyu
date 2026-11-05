import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 字典接口：字典没收的字，用本地数据当场补拼音、笔画、常用度、多音（2026-11-05）。
 * 字典和字表都指到临时目录，不读真实的 data/。
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jinyu-dict-route-"));
const corpus = path.join(tmp, "corpus");
fs.mkdirSync(path.join(tmp, "qmz-dict"), { recursive: true });
fs.mkdirSync(corpus, { recursive: true });
// 字典只收「华」；字表收婳（表外）、乐（一级）
fs.writeFileSync(
  path.join(tmp, "qmz-dict", "chars.json"),
  JSON.stringify({ generatedAt: "", source: "", chars: { 华: { char: "华", pinyin: "huá", basicMeaning: "本意为花。", sourceUrl: "", fetchedAt: "" } } }),
);
fs.writeFileSync(path.join(corpus, "chars.json"), JSON.stringify({ strokes: { 婳: 11, 乐: 5, 华: 6 }, t2s: {}, gb: { 乐: 1, 华: 1 } }));
// 新华字典兜底只收「窈」
fs.mkdirSync(path.join(tmp, "xinhua"), { recursive: true });
fs.writeFileSync(path.join(tmp, "xinhua", "gloss.json"), JSON.stringify({ 窈: { from: "本义", text: "幽深，深远。" } }));
process.env.JINYU_DATA_DIR = tmp;
process.env.JINYU_CORPUS_DIR = corpus;

vi.mock("@/auth/session", () => ({ isAuthenticated: async () => true }));

import { GET } from "../app/api/dictionary/route";
import { resetCharTableCache } from "@/domain/analysis/chars";
import { resetMissingLog } from "@/dictionary/missing-log";
import { resetQmzDictionaryCache } from "@/dictionary/qmz";
import { resetXinhuaCache, xinhuaGlossOf } from "@/dictionary/xinhua";

type Entry = { char: string; missing?: boolean; pinyin?: string; strokes?: number; gbLevel?: number; otherReadings?: string[]; basicMeaning?: string };

async function lookup(name: string): Promise<Entry[]> {
  const res = await GET(new Request(`http://localhost/api/dictionary?name=${encodeURIComponent(name)}`));
  return ((await res.json()) as { entries: Entry[] }).entries;
}

beforeEach(() => {
  resetCharTableCache();
  resetQmzDictionaryCache();
  resetMissingLog();
  resetXinhuaCache();
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("新华字典抽一句释义", () => {
  it("有「本义」用本义", () => {
    const e = "窈 \n\n (形声。从穴,幼声。本义幽深,深远)\n\n 同本义 \n\n 窈,深远也。--《说文》\n\n 窈yǎo\n\n ⒈幽深，深远～静。";
    expect(xinhuaGlossOf("窈", e)).toEqual({ from: "本义", text: "幽深，深远。" });
  });

  it("没有本义用「字＋拼音」后面的现代释义，去掉 ～ 开头的例词", () => {
    const e = "锴 \n\n 好铁 \n\n 铜锴之垠。--《文选》\n\n 锴kǎi好铁。多见于人名。";
    expect(xinhuaGlossOf("锴", e)).toEqual({ from: "释义", text: "好铁。" });
    const t = "听 \n\n (形声。本字从耳德,壬声。听”本义笑貌”。从口,斤声。本义用耳朵感受声音)\n\n 听（聽）tīng\n\n ⒈用耳朵接受声音～录音。";
    expect(xinhuaGlossOf("听", t)).toEqual({ from: "释义", text: "用耳朵接受声音。" });
  });

  it("念不出来的不硬凑：字义未详、只写「见某词」", () => {
    expect(xinhuaGlossOf("鑒", "鑒jiàn 字义未详。")).toBeNull();
    expect(xinhuaGlossOf("蜁", "蜁xuán 见\"蜁蜗\"。")).toBeNull();
  });
});

describe("字典接口兜底", () => {
  it("字典没收的生僻字：当场给拼音、笔画、不在常用字表", async () => {
    const [e] = await lookup("王婳");
    expect(e).toMatchObject({ char: "婳", missing: true, pinyin: "huà", strokes: 11, gbLevel: 0 });
  });

  it("多音字按名字上下文给读音，另外列出别的读音提醒主播", async () => {
    const [e] = await lookup("曾乐");
    expect(e?.missing).toBe(true);
    expect(e?.pinyin).toBe("lè");
    expect(e?.otherReadings).toContain("yuè");
  });

  it("字表也查不到的字：只给拼音，不编笔画和常用度", async () => {
    const [e] = await lookup("王锴");
    expect(e?.pinyin).toBe("kǎi");
    expect(e?.strokes).toBeUndefined();
    expect(e?.gbLevel).toBeUndefined();
  });

  it("起名字典没收、新华字典有：给新华的一句释义，写明来源；新华也没有的照旧等模型", async () => {
    const [w] = await lookup("刘窈");
    expect(w).toMatchObject({ char: "窈", missing: true, basicMeaning: "幽深，深远。", meaningSource: "新华字典·本义" });
    const [h] = await lookup("王婳");
    expect(h?.basicMeaning).toBeUndefined();
  });

  it("字典收了的字照旧用字典", async () => {
    const [e] = await lookup("刘华");
    expect(e?.missing).toBeUndefined();
    expect(e?.basicMeaning).toBe("本意为花。");
  });
});
