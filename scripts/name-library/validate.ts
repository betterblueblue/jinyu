/**
 * 第 2 步：自动校验。
 *
 * 只判机器能确定的事，语义交给第 3 步审核。任何一条不过就进 rejected.jsonl，带 code。
 *
 * 用法：pnpm tsx scripts/name-library/validate.ts
 * 输入：drafts.jsonl
 * 输出：validated.jsonl（送审）、rejected.jsonl（可追溯）
 */
import fs from "node:fs";
import path from "node:path";
import { gbLevel } from "../../src/domain/analysis/chars";
import { leanOf } from "../../src/domain/analysis/gender-lean";
import { pinyin } from "pinyin-pro";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "name-library", "drafts");
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const IN_FILE = path.join(DIR, argOf("--in") ?? "drafts.jsonl");
const OK_FILE = path.join(DIR, argOf("--out") ?? "validated.jsonl");
const BAD_FILE = path.join(DIR, argOf("--rejected") ?? "rejected.jsonl");
const L1_FILE = path.join(ROOT, "src", "config", "l1-templates.json");
const VERDICT_DIR = path.join(ROOT, "data", "name-library", "review", "verdicts");
const EXCLUDE_REVIEWED = argv.includes("--exclude-reviewed");

/** 已经审过的名字：同一个名字换个出处再送审，会让结论和内容错配，所以直接排掉 */
function reviewedNames(): Set<string> {
  const set = new Set<string>();
  if (!fs.existsSync(VERDICT_DIR)) return set;
  for (const f of fs.readdirSync(VERDICT_DIR).filter((x) => x.endsWith(".json"))) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), "utf8")) as {
        items?: { givenName: string }[];
      };
      for (const it of v.items ?? []) set.add(it.givenName);
    } catch {
      /* 坏文件忽略 */
    }
  }
  return set;
}

const STOP = new Set([..."之乎者也而不於于与为所者曰无毋勿莫未非否然是此彼何如则且乃焉哉矣兮夫盖故若虽其以我尔汝吾予余你他她它谁孰自曾相共"]);
/**
 * 2026-10-31 补：冥、幽、阴、暗、昧、晦、霾、殡、椁、殂、殒、陨、殁。
 * 原先缺这几个，才会让「冥鸿」这种从白居易诗里摘出来的字过闸——诗里意思好，
 * 但「冥」是阴间的冥，上户口不能用。字面忌一律走这张表，不靠审核的语感。
 * 注意：微不在表里。知微、熹微都是好名，别把「卑微」的微拆出来误伤。
 */
const BAD = new Set([..."死病亡丧哭泣悲哀愁苦贫贱辱罪刑狱杀戮灭败坏恶毒凶残暴虐妖魔鬼怪尸血骨灰坟墓棺葬疾痛伤残孤寡鳏独奴仆婢妾妓娼盗贼匪寇敌仇怨恨怒骂诈欺谎虚假伪陋丑衰朽枯槁污浊秽臭腐烂溃疮痈瘤疤痣聋哑盲瞎瘸跛疯癫痴傻愚蠢笨拙懒怠傲慢骄奢淫赌嫖酗醉昏聩耻羞愧惭惧恐怖惊慌忧患祸殃灾厄夭殇冥幽冥暗昧晦霾殡椁殂殒陨殁"]);
const HAN = /^[\u4e00-\u9fff]$/;

interface Draft {
  pieceId: string;
  source: string;
  piece: string;
  givenName: string;
  lean: string;
  quote: string;
  meaning: string;
  composition: string;
  pitfalls: string;
  batch: string;
}

/** 折成可比对形态：只留汉字 */
function fold(text: string): string {
  return [...text].filter((c) => HAN.test(c)).join("");
}

interface Check {
  ok: boolean;
  codes: string[];
  details: Record<string, unknown>;
}

function check(d: Draft, l1: Set<string>, seen: Map<string, Draft>): Check {
  const codes: string[] = [];
  const chars = [...d.givenName];

  if (chars.length !== 2) codes.push("length");
  if (!chars.every((c) => HAN.test(c))) codes.push("not_han");
  if (chars.some((c) => STOP.has(c))) codes.push("stop_char");
  if (chars.some((c) => BAD.has(c))) codes.push("bad_char");
  if (l1.has(d.givenName)) codes.push("l1_template");
  if (chars.some((c) => gbLevel(c) === null)) codes.push("char_unknown");
  else if (chars.every((c) => gbLevel(c) === 2)) codes.push("rare_both");
  if (!d.meaning?.trim()) codes.push("no_meaning");
  if (!d.composition?.trim()) codes.push("no_composition");
  if (d.meaning.length > 60) codes.push("meaning_too_long");
  if (d.composition.length > 80) codes.push("composition_too_long");

  // 引文核验：quote 必须是该篇原文的子串（去标点后）
  // 原文这里没带进来，改由调用方注入
  const positions: [number, number] | null = null;

  // 拼音：两个字都必须在字库里查到
  let py: string[] = [];
  try {
    py = pinyin(d.givenName, { toneType: "symbol", type: "array" }) as string[];
    py = (Array.isArray(py) ? py : [String(py)]).map(String);
    if (py.some((s, i) => s === chars[i])) codes.push("pinyin_missing");
  } catch {
    codes.push("pinyin_error");
  }

  // 性别倾向与标注一致性：只标注不拒
  const leans = chars.map(leanOf);
  const male = leans.filter((l) => l === "male").length;
  const female = leans.filter((l) => l === "female").length;
  const conflict =
    (d.lean === "male" && female > 0 && male === 0) || (d.lean === "female" && male > 0 && female === 0);

  const dup = seen.get(d.givenName);

  return {
    ok: codes.length === 0 && !dup,
    codes: dup ? [...codes, "duplicate"] : codes,
    details: { positions, pinyin: py.join(" "), leanConflict: conflict, leans },
  };
}

function main(): void {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`缺 ${IN_FILE}`);
    process.exit(1);
  }
  const l1 = new Set(JSON.parse(fs.readFileSync(L1_FILE, "utf8")) as string[]);
  const pieces = new Map<string, string>();
  const pieceFile = path.join(DIR, "pieces.jsonl");  if (fs.existsSync(pieceFile)) {
    for (const line of fs.readFileSync(pieceFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const p = JSON.parse(line) as { id: string; text: string };
      pieces.set(p.id, p.text);
    }
  }

  const drafts: Draft[] = fs
    .readFileSync(IN_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Draft);

  let pool = drafts;
  if (EXCLUDE_REVIEWED) {
    const reviewed = reviewedNames();
    const before = pool.length;
    pool = pool.filter((d) => !reviewed.has(d.givenName));
    console.log(`排除已审名字 ${before - pool.length} 条，待校验 ${pool.length} 条（已审 ${reviewed.size} 条）`);
  }

  const okOut: string[] = [];
  const badOut: string[] = [];
  const seen = new Map<string, Draft>();
  const counts: Record<string, number> = {};
  const bump = (c: string) => (counts[c] = (counts[c] ?? 0) + 1);

  // 先按出处优先级排序，让更好的那条赢下去重
  const order = ["诗经", "楚辞", "论语", "中庸", "大学", "孟子", "周易", "尚书", "礼记", "左传", "文选", "唐诗三百首", "千家诗", "纳兰词", "宋词"];
  pool.sort((a, b) => {
    const ia = order.indexOf(a.source);
    const ib = order.indexOf(b.source);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  for (const d of pool) {
    const pieceText = pieces.get(d.pieceId) ?? "";
    const foldedPiece = fold(pieceText);
    const foldedQuote = fold(d.quote);

    const extra: string[] = [];
    if (!foldedQuote) extra.push("no_quote");
    else if (!foldedPiece.includes(foldedQuote)) extra.push("quote_not_in_source");

    const chars = [...d.givenName];
    let positions: [number, number] | null = null;
    if (foldedQuote && chars.length === 2) {
      const i = foldedQuote.indexOf(chars[0]!);
      const j = i >= 0 ? foldedQuote.indexOf(chars[1]!, i + 1) : -1;
      if (i < 0 || j < 0) extra.push("char_not_in_quote");
      else positions = [i, j];
    }

    const base = check(d, l1, extra.length ? new Map() : seen);
    const codes = [...base.codes, ...extra];
    const ok = codes.length === 0;

    for (const c of codes) bump(c);
    bump(ok ? "passed" : "rejected");

    const row = {
      ...d,
      pinyin: base.details.pinyin,
      positions,
      leanConflict: base.details.leanConflict,
      leans: base.details.leans,
    };

    if (ok) {
      seen.set(d.givenName, d);
      okOut.push(JSON.stringify(row));
    } else {
      badOut.push(JSON.stringify({ ...row, codes }));
    }
  }

  fs.writeFileSync(OK_FILE, okOut.join("\n") + (okOut.length ? "\n" : ""), "utf8");
  fs.writeFileSync(BAD_FILE, badOut.join("\n") + (badOut.length ? "\n" : ""), "utf8");

  const bySource: Record<string, number> = {};
  const byLean: Record<string, number> = {};
  for (const line of okOut) {
    const r = JSON.parse(line) as Draft;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byLean[r.lean] = (byLean[r.lean] ?? 0) + 1;
  }

  console.log(`草稿 ${pool.length} → 通过 ${okOut.length}，拒绝 ${badOut.length}`);
  console.log("\n=== 拒绝原因（可叠加）===");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log("\n=== 通过：按出处 ===");
  for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log("\n=== 通过：按方向 ===");
  for (const [k, v] of Object.entries(byLean)) console.log(`  ${k.padEnd(8)} ${v}`);
}

main();

