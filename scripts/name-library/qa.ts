/**
 * 发布后自检：不复用建库时的判定，独立把 library.json 再验一遍。
 *
 * 用法：pnpm tsx scripts/name-library/qa.ts
 * 有任何一项不过就 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { gbLevel } from "../../src/domain/analysis/chars";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "name-library");
const LIB = path.join(DIR, "library.json");
const PIECES = path.join(DIR, "drafts", "pieces.jsonl");
const L1_FILE = path.join(ROOT, "src", "config", "l1-templates.json");

const HAN = /^[\u4e00-\u9fff]$/;
const fold = (s: string) => [...s].filter((c) => HAN.test(c)).join("");

interface Entry {
  id: string;
  givenName: string;
  genderEligibility: string[];
  givenPinyin: [string, string];
  meaning: string;
  composition: string;
  citation: { source: string; piece: string; quote: string; sourcePieceId: string; extraction: { kind: string; positions: [number, number] } };
  review: { verdict: string };
}

function main(): void {
  const failures: string[] = [];
  const fail = (msg: string) => failures.push(msg);

  if (!fs.existsSync(LIB)) {
    console.error(`缺 ${LIB}`);
    process.exit(1);
  }
  const lib = JSON.parse(fs.readFileSync(LIB, "utf8")) as { libraryVersion: string; entries: Entry[] };
  const entries = lib.entries ?? [];

  const pieces = new Map<string, string>();
  for (const line of fs.readFileSync(PIECES, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as { id: string; text: string };
    pieces.set(p.id, p.text);
  }
  const l1 = new Set(JSON.parse(fs.readFileSync(L1_FILE, "utf8")) as string[]);

  const seenId = new Set<string>();
  const seenName = new Set<string>();

  for (const e of entries) {
    const tag = `${e.givenName}(${e.id})`;

    if (seenId.has(e.id)) fail(`${tag} 重复 id`);
    seenId.add(e.id);
    if (seenName.has(e.givenName)) fail(`${tag} 重复名字`);
    seenName.add(e.givenName);

    const chars = [...(e.givenName ?? "")];
    if (chars.length !== 2) fail(`${tag} 不是双字名`);
    if (!chars.every((c) => HAN.test(c))) fail(`${tag} 含非汉字`);
    if (chars.some((c) => gbLevel(c) === null)) fail(`${tag} 有字不在字表里`);
    if (l1.has(e.givenName)) fail(`${tag} 命中网红名表`);

    if (!e.genderEligibility?.length || e.genderEligibility.some((g) => g !== "male" && g !== "female")) {
      fail(`${tag} 方向字段非法`);
    }
    if (e.review?.verdict !== "approve") fail(`${tag} 未通过审核却入库`);

    if (!e.meaning?.trim()) fail(`${tag} 缺寓意`);
    if (!e.composition?.trim()) fail(`${tag} 缺组合依据`);

    const py = e.givenPinyin ?? [];
    if (py.length !== 2 || py.some((p) => !p?.trim())) fail(`${tag} 拼音不完整`);
    if (py.some((p, i) => p === chars[i])) fail(`${tag} 有字没有读音`);

    const pieceText = pieces.get(e.citation?.sourcePieceId ?? "");
    if (!pieceText) {
      fail(`${tag} 找不到来源篇 ${e.citation?.sourcePieceId}`);
      continue;
    }
    const foldedPiece = fold(pieceText);
    const foldedQuote = fold(e.citation.quote ?? "");
    if (!foldedQuote) fail(`${tag} 引文为空`);
    else if (!foldedPiece.includes(foldedQuote)) fail(`${tag} 引文不在原文里：「${e.citation.quote}」`);

    // 取字位置必须真的对应名字两字
    const [i, j] = e.citation.extraction?.positions ?? [-1, -1];
    if (foldedQuote[i] !== chars[0] || foldedQuote[j] !== chars[1]) {
      fail(`${tag} 取字位置对不上（positions=${i},${j}）`);
    }
    if (j <= i) fail(`${tag} 取字顺序反了`);
  }

  const maleDir = entries.filter((e) => e.genderEligibility.includes("male")).length;
  const femaleDir = entries.filter((e) => e.genderEligibility.includes("female")).length;
  const neutral = entries.filter((e) => e.genderEligibility.length === 2).length;

  const bySource: Record<string, number> = {};
  for (const e of entries) bySource[e.citation?.source ?? "?"] = (bySource[e.citation?.source ?? "?"] ?? 0) + 1;

  console.log(`库版本 ${lib.libraryVersion}，条目 ${entries.length}`);
  console.log(`男向可用 ${maleDir} / 女向可用 ${femaleDir} / 中性 ${neutral}`);
  console.log("按出处：" + Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("、"));

  if (failures.length) {
    console.error(`\n❌ 自检不通过，${failures.length} 处：`);
    for (const f of failures.slice(0, 40)) console.error("  - " + f);
    if (failures.length > 40) console.error(`  …还有 ${failures.length - 40} 处`);
    process.exit(1);
  }
  console.log("\n✅ 自检通过：引文全部在原文里，取字位置对得上，无重名，拼音完整，无网红名。");
}

main();
