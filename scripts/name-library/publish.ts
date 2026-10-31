/**
 * 第 4 步：汇总审核结论，发布正式库 + 容量报告。
 *
 * 用法：pnpm tsx scripts/name-library/publish.ts [--dry]
 * 输入：drafts/validated.jsonl + review/verdicts/*.json
 * 输出：library.json、capacity-report.md、review/rejected.jsonl
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "name-library");
const VALIDATED = path.join(DIR, "drafts", "validated.jsonl");
const VERDICT_DIR = path.join(DIR, "review", "verdicts");
const LIB_FILE = path.join(DIR, "library.json");
const REPORT_FILE = path.join(DIR, "capacity-report.md");
const REJECTED_FILE = path.join(DIR, "review", "rejected.jsonl");
const ARCHIVE_DIR = path.join(DIR, "_archive");
const DISABLED_FILE = path.join(DIR, "disabled.json");

const TARGET = { male: 300, female: 300, neutral: 150 };

interface Row {
  pieceId: string;
  source: string;
  piece: string;
  givenName: string;
  lean: "male" | "female" | "neutral";
  quote: string;
  meaning: string;
  composition: string;
  pitfalls: string;
  pinyin?: string;
  positions?: [number, number] | null;
}

interface Verdict {
  batchId: string;
  items: { givenName: string; verdict: string; codes?: string[]; note?: string }[];
}

interface Entry {
  id: string;
  givenName: string;
  genderEligibility: ("male" | "female")[];
  givenPinyin: [string, string];
  meaning: string;
  composition: string;
  pitfalls?: string;
  citation: {
    source: string;
    piece: string;
    quote: string;
    sourcePieceId: string;
    extraction: { kind: "contiguous" | "within_sentence"; positions: [number, number] };
  };
  review: { verdict: string; method: string; at: string; note?: string };
}

function pinyinPair(text: string): [string, string] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return [parts[0] ?? "", parts[1] ?? ""];
}

function main(): void {
  const dry = process.argv.includes("--dry");
  // 分轮校验会产出 validated.jsonl / validated-2.jsonl / validated-3.jsonl…，合并读取
  const draftsDir = path.join(DIR, "drafts");
  const validatedFiles = fs
    .readdirSync(draftsDir)
    .filter((f) => /^validated(-\d+)?\.jsonl$/.test(f))
    .sort();
  const rows: Row[] = [];
  for (const f of validatedFiles) {
    for (const line of fs.readFileSync(path.join(draftsDir, f), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line) as Row);
    }
  }
  console.log(`读取校验文件 ${validatedFiles.join(", ")}，共 ${rows.length} 条`);

  const verdicts = new Map<string, { verdict: string; codes: string[]; note: string }>();
  if (fs.existsSync(VERDICT_DIR)) {
    for (const f of fs.readdirSync(VERDICT_DIR).filter((x) => x.endsWith(".json"))) {
      const v = JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), "utf8")) as Verdict;
      for (const item of v.items ?? []) {
        verdicts.set(item.givenName, {
          verdict: item.verdict,
          codes: item.codes ?? [],
          note: item.note ?? "",
        });
      }
    }
  }

  const approved: Entry[] = [];
  const rejected: unknown[] = [];
  const flagged: unknown[] = [];
  const missing: string[] = [];
  const now = new Date().toISOString();

  for (const r of rows) {
    const v = verdicts.get(r.givenName);
    if (!v) {
      missing.push(r.givenName);
      continue;
    }
    if (v.verdict !== "approve") {
      (v.verdict === "flag" ? flagged : rejected).push({ ...r, review: v });
      continue;
    }
    const py = pinyinPair(r.pinyin ?? "");
    const positions = r.positions ?? [0, 0];
    approved.push({
      id: `jy-${String(approved.length + 1).padStart(4, "0")}`,
      givenName: r.givenName,
      genderEligibility:
        r.lean === "neutral" ? ["male", "female"] : ([r.lean] as ("male" | "female")[]),
      givenPinyin: py,
      meaning: r.meaning,
      composition: r.composition,
      ...(r.pitfalls ? { pitfalls: r.pitfalls } : {}),
      citation: {
        source: r.source,
        piece: r.piece,
        quote: r.quote,
        sourcePieceId: r.pieceId,
        extraction: {
          kind: positions[1] - positions[0] === 1 ? "contiguous" : "within_sentence",
          positions,
        },
      },
      review: { verdict: "approve", method: "subagent", at: now, ...(v.note ? { note: v.note } : {}) },
    });
  }

  const count = (pred: (e: Entry) => boolean) => approved.filter(pred).length;
  const maleOnly = count((e) => e.genderEligibility.length === 1 && e.genderEligibility[0] === "male");
  const femaleOnly = count((e) => e.genderEligibility.length === 1 && e.genderEligibility[0] === "female");
  const both = count((e) => e.genderEligibility.length === 2);

  const bySource: Record<string, number> = {};
  for (const e of approved) bySource[e.citation.source] = (bySource[e.citation.source] ?? 0) + 1;

  const rejectCodes: Record<string, number> = {};
  for (const item of rejected as { review?: { codes: string[] } }[]) {
    for (const c of item.review?.codes ?? []) rejectCodes[c] = (rejectCodes[c] ?? 0) + 1;
  }

  const body = {
    schemaVersion: 1,
    libraryVersion: `2026-10-30.${approved.length}`,
    builtAt: now,
    entries: approved,
  };

  if (dry) {
    console.log(`[dry] 将发布 ${approved.length} 条（男向 ${maleOnly + both} / 女向 ${femaleOnly + both} / 中性 ${both}）`);
    return;
  }

  // 发布前归档旧版本，临时文件写完再原子替换
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (fs.existsSync(LIB_FILE)) {
    const old = JSON.parse(fs.readFileSync(LIB_FILE, "utf8")) as { libraryVersion?: string };
    fs.copyFileSync(LIB_FILE, path.join(ARCHIVE_DIR, `library-${old.libraryVersion ?? "unknown"}.json`));
  }
  const tmp = path.join(DIR, ".library.tmp");
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, LIB_FILE);
  if (!fs.existsSync(DISABLED_FILE)) {
    fs.writeFileSync(DISABLED_FILE, JSON.stringify({ version: 1, givenNames: [], fullNames: [] }, null, 2) + "\n", "utf8");
  }
  fs.writeFileSync(REJECTED_FILE, rejected.map((r) => JSON.stringify(r)).join("\n") + (rejected.length ? "\n" : ""), "utf8");

  const fmt = (n: number, target: number) => `${n} / ${target} ${n >= target ? "✅" : "⚠️ 不足"}`;
  const report = [
    "# 快速取名库容量报告",
    "",
    `生成时间：${now}`,
    `库版本：${body.libraryVersion}`,
    "",
    "## 条数",
    "",
    "| 方向 | 实得 / 目标 |",
    "|---|---|",
    `| 男向可用（含中性） | ${fmt(maleOnly + both, TARGET.male)} |`,
    `| 女向可用（含中性） | ${fmt(femaleOnly + both, TARGET.female)} |`,
    `| 中性（两边可用） | ${fmt(both, TARGET.neutral)} |`,
    `| **合计条目** | **${approved.length}** |`,
    "",
    "## 按出处",
    "",
    "| 书目 | 条数 |",
    "|---|---|",
    ...Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## 审核",
    "",
    `- 送审 ${rows.length} 条`,
    `- 通过 ${approved.length} 条（${((approved.length / Math.max(1, rows.length)) * 100).toFixed(1)}%）`,
    `- 拒绝 ${rejected.length} 条`,
    `- 待定 ${flagged.length} 条（未发布，留待人工复核）`,
    missing.length ? `- **未拿到结论 ${missing.length} 条**：${missing.slice(0, 20).join("、")}` : "- 全部条目均有结论",
    "",
    "### 拒绝原因",
    "",
    ...Object.entries(rejectCodes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}：${v}`),
    "",
    "## 说明",
    "",
    "- 本报告只统计条数，不代表名字质量；质量以审核结论为准。",
    "- 容量按需求稿 §11.2.1 口径（单姓一场约需 50–80 个同向名字）判断，不是全局平均值。",
  ].join("\n");
  fs.writeFileSync(REPORT_FILE, report + "\n", "utf8");

  console.log(`发布 ${approved.length} 条 → ${path.relative(ROOT, LIB_FILE)}`);
  console.log(`容量报告 → ${path.relative(ROOT, REPORT_FILE)}`);
  if (missing.length) console.warn(`⚠️ ${missing.length} 条没有审核结论，未发布`);
}

main();
