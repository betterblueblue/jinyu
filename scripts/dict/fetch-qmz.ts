/**
 * 抓起名字典（zd.qmz.in）的单字页，存成本地字典。
 *
 * 用法：
 *   pnpm tsx scripts/dict/fetch-qmz.ts            # 补抓：字表 + 观众常报的字 + 直播时查不到的字，已有的跳过
 *   LIMIT=10 pnpm tsx scripts/dict/fetch-qmz.ts    # 只抓前 10 个，先验证
 *   pnpm tsx scripts/dict/fetch-qmz.ts --all      # 再加上 sitemap 里的单字页（500 个，站点没列全）
 *   CHARS=子梓涵 pnpm tsx scripts/dict/fetch-qmz.ts # 另外指定几个字
 *   pnpm tsx scripts/dict/fetch-qmz.ts --refresh  # 已有的也重抓
 *
 * 站点没有 JSON API，页面需要 Cookie hvtest=pt；这里只做离线抓取，不接运行时。
 * 结果合并进 data/qmz-dict/chars.json（不覆盖已有的字），report.md 写整份字典（data/ 不进 git）。
 * sitemap 只列了 500 个单字，不在里面的字（子、凤、禹……）直接请求也有页面（2026-11-05 实测）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseQmzCharHtml, type QmzChar, type QmzDictionary } from "../../src/dictionary/qmz";

const BASE = "https://zd.qmz.in";
const COOKIE = "hvtest=pt";
const USER_AGENT = "jinyu-dict-builder/1.0";
const DELAY_MS = Number(process.env.FETCH_DELAY_MS ?? 700);
const LIMIT = Number(process.env.LIMIT ?? 0);

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function loadSeedChars(): string[] {
  const raw = JSON.parse(readFileSync(resolve("src/config/seed-chars.json"), "utf8")) as {
    female: string[];
    male: string[];
  };
  return [...new Set([...raw.female, ...raw.male])];
}

function loadNameChars(): string[] {
  return JSON.parse(readFileSync(resolve("src/config/name-chars.json"), "utf8")) as string[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

/**
 * 观众报上来的名字常用、但起手字和 name-chars 不收的字（2026-11-05）：
 * 热门字（梓涵诺航）、烂大街名用到的字（子然宸奕）、年代名和年代字（秀英、凤）。
 * 项目自己起名刻意避开它们，可打分时观众报的正是这些。
 */
function loadAudienceChars(): string[] {
  const hot = readJson<string[]>("src/config/l2-chars.json");
  const templates = readJson<string[]>("src/config/l1-templates.json").flatMap((n) => [...n]);
  const era = readJson<{ chars: { chars: string }[]; names: { list: string[] }[] }>("src/config/era-names.json");
  const eraChars = era.chars.flatMap((g) => [...g.chars]);
  const eraNames = era.names.flatMap((g) => g.list.flatMap((n) => [...n]));
  return [...hot, ...templates, ...eraChars, ...eraNames];
}

/** 直播时字典查不到的字（/api/dictionary 记的），下次抓取补上 */
function loadMissingChars(dir: string): string[] {
  try {
    return readFileSync(resolve(dir, "missing.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { char?: string }).char ?? "")
      .filter((c) => [...c].length === 1);
  } catch {
    return [];
  }
}

function loadExisting(dir: string): QmzDictionary | null {
  try {
    return JSON.parse(readFileSync(resolve(dir, "chars.json"), "utf8")) as QmzDictionary;
  } catch {
    return null;
  }
}

async function loadSitemapChars(): Promise<string[]> {
  const res = await fetch(`${BASE}/sitemap.txt`, {
    headers: { Cookie: COOKIE, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const text = await res.text();
  const chars = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^https:\/\/zd\.qmz\.in\/([^/?#]+)$/.exec(line.trim());
    if (!m) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(m[1]!);
    } catch {
      continue;
    }
    if ([...decoded].length === 1 && /\p{Script=Han}/u.test(decoded)) chars.add(decoded);
  }
  return [...chars];
}

async function fetchChar(ch: string, fetchedAt: string): Promise<QmzChar | null> {
  const url = `${BASE}/${encodeURIComponent(ch)}`;
  const res = await fetch(url, {
    headers: { Cookie: COOKIE, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseQmzCharHtml(ch, html, url, fetchedAt);
}

function readCorpusStrokes(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(resolve("data/corpus/chars.json"), "utf8")) as {
      strokes?: Record<string, number>;
    };
    return raw.strokes ?? {};
  } catch {
    return {};
  }
}

function short(text: string | undefined, max = 50): string {
  if (!text) return "—";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function makeReport(
  chars: QmzChar[],
  targets: string[],
  failed: { char: string; error: string }[],
  fetchedThisRun: number,
): string {
  const corpus = readCorpusStrokes();
  const fieldCounts = {
    拼音: chars.filter((c) => c.pinyin).length,
    简体笔画: chars.filter((c) => c.simplifiedStrokes !== undefined).length,
    康熙笔画: chars.filter((c) => c.kangxiStrokes !== undefined).length,
    五行: chars.filter((c) => c.wuxing).length,
    部首: chars.filter((c) => c.radical).length,
    基本含义: chars.filter((c) => c.basicMeaning).length,
    起名寓意: chars.filter((c) => c.nameMeaning).length,
    拆字方案: chars.filter((c) => c.decomposition).length,
    相关成语: chars.filter((c) => c.idioms?.length).length,
  };
  const strokeMismatch = chars.filter(
    (c) => c.simplifiedStrokes !== undefined && corpus[c.char] !== undefined && c.simplifiedStrokes !== corpus[c.char],
  );
  const missing = targets.filter((ch) => !chars.some((c) => c.char === ch));
  const lines = [
    `# 起名字典抓取报告`,
    "",
    `- 字典共 ${chars.length} 个字；要的字 ${targets.length} 个，还缺 ${missing.length} 个`,
    `- 这次新抓 ${fetchedThisRun} 个，失败 ${failed.length} 个${failed.length ? `：${failed.map((x) => x.char).join("、")}` : ""}`,
    `- 抓取时间：${new Date().toISOString()}`,
    `- 来源：${BASE}`,
    "",
    "## 字段覆盖",
    "",
    ...Object.entries(fieldCounts).map(([label, n]) => `- ${label}：${n}/${chars.length}`),
    "",
    "## 和现有 Unihan 字表的笔画差异",
    "",
    strokeMismatch.length
      ? `${strokeMismatch.length} 个；前 20 个：${strokeMismatch
          .slice(0, 20)
          .map((c) => `${c.char}(站点${c.simplifiedStrokes}/Unihan${corpus[c.char]})`)
          .join("、")}`
      : "没有差异。",
    "",
    "## 缺失",
    "",
    missing.length ? missing.join("、") : "无。",
    "",
    "## 样例",
    "",
    "| 字 | 拼音 | 简体笔画 | 康熙 | 五行 | 部首 | 拆字 | 基本含义 |",
    "|---|---|---:|---:|---|---|---|---|",
    ...chars.slice(0, 20).map(
      (c) =>
        `| ${c.char} | ${c.pinyin ?? "—"} | ${c.simplifiedStrokes ?? "—"} | ${c.kangxiStrokes ?? "—"} | ${c.wuxing ?? "—"} | ${c.radical ?? "—"} | ${short(c.decomposition, 20)} | ${short(c.basicMeaning)} |`,
    ),
  ];
  return lines.join("\n");
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const all = process.argv.includes("--all");
  const refresh = process.argv.includes("--refresh");
  const dir = resolve(process.env.JINYU_DATA_DIR ?? "data", "qmz-dict");
  mkdirSync(dir, { recursive: true });
  const existing = loadExisting(dir);
  const have = existing?.chars ?? {};

  const extra = [...(process.env.CHARS ?? "")].filter((c) => /\p{Script=Han}/u.test(c));
  const wanted = [
    ...new Set([
      ...loadSeedChars(),
      ...loadNameChars(),
      ...loadAudienceChars(),
      ...loadMissingChars(dir),
      ...extra,
      ...(all ? await loadSitemapChars() : []),
    ]),
  ];
  const targets = refresh ? wanted : wanted.filter((c) => !have[c]);
  console.log(`要的字 ${wanted.length} 个，字典里已有 ${wanted.filter((c) => have[c]).length} 个，这次抓 ${targets.length} 个`);
  const limited = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;

  const chars: QmzChar[] = [];
  const failed: { char: string; error: string }[] = [];
  for (let i = 0; i < limited.length; i++) {
    const ch = limited[i]!;
    try {
      const parsed = await fetchChar(ch, fetchedAt);
      if (!parsed) throw new Error("页面字段解析为空");
      chars.push(parsed);
      console.log(`[${i + 1}/${limited.length}] ${ch} ok`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ char: ch, error: message });
      console.log(`[${i + 1}/${limited.length}] ${ch} FAIL ${message}`);
    }
    if (i < limited.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  // 合并：已有的字保留，这次抓到的覆盖同名的
  const merged = { ...have, ...Object.fromEntries(chars.map((c) => [c.char, c])) };
  const dict: QmzDictionary = { generatedAt: fetchedAt, source: BASE, chars: merged };
  writeFileSync(resolve(dir, "chars.json"), JSON.stringify(dict, null, 2), "utf8");
  writeFileSync(resolve(dir, "report.md"), makeReport(Object.values(merged), wanted, failed, chars.length), "utf8");
  console.log(`\n完成：这次 ${chars.length}/${limited.length}，失败 ${failed.length}；字典共 ${Object.keys(merged).length} 个字`);
  console.log(`输出：${resolve(dir, "chars.json")}`);
  console.log(`报告：${resolve(dir, "report.md")}`);
  if (failed.length) {
    console.log("失败列表：" + failed.slice(0, 10).map((x) => `${x.char}(${x.error})`).join("、"));
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
