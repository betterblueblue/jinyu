/**
 * 下载新华字典的单字数据，抽成每字一句释义，给提词页做兜底（2026-11-05）。
 *
 * 用法：pnpm tsx scripts/dict/build-xinhua.ts
 * 已经下载过 data/xinhua/word.json 就不再下载；加 --download 重新下载。
 * 输出 data/xinhua/gloss.json（data/ 不进 git）。来源和版权说明见 src/dictionary/xinhua.ts。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { xinhuaGlossOf, type XinhuaGloss } from "../../src/dictionary/xinhua";

/** 钉住提交，换版本要有意为之 */
const SHA = "cad702f2fbf4fa28755821772fbbe8525b6771b0";
const URL = `https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/${SHA}/data/word.json`;

async function main() {
  const dir = resolve(process.env.JINYU_DATA_DIR ?? "data", "xinhua");
  mkdirSync(dir, { recursive: true });
  const raw = resolve(dir, "word.json");
  if (!existsSync(raw) || process.argv.includes("--download")) {
    console.log(`下载 ${URL}`);
    const res = await fetch(URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(raw, await res.text(), "utf8");
  }
  const list = JSON.parse(readFileSync(raw, "utf8")) as { word?: unknown; explanation?: unknown }[];
  const out: Record<string, XinhuaGloss> = {};
  let ben = 0;
  for (const x of list) {
    if (typeof x.word !== "string" || [...x.word].length !== 1 || typeof x.explanation !== "string") continue;
    const g = xinhuaGlossOf(x.word, x.explanation);
    if (!g) continue;
    out[x.word] = g;
    if (g.from === "本义") ben++;
  }
  writeFileSync(resolve(dir, "gloss.json"), JSON.stringify(out), "utf8");
  const n = Object.keys(out).length;
  console.log(`共 ${list.length} 个字，抽出释义 ${n} 个（本义 ${ben}、现代释义 ${n - ben}）→ ${resolve(dir, "gloss.json")}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
