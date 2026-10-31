/**
 * 把评过的名字汇总成直播名字库：data/name-library/v2/library.json。
 *
 * 用法：pnpm tsx scripts/library/publish.ts
 *
 * 进库的条件：用户选了「很好」或「可以」（80 分及以上）。
 * 试评那一批还没有分档按钮，用户把分数写在备注开头（「80 还可以更好」），这里照备注取；
 * 只选了「要」、备注里没写分的，按「可以」（80）算。
 * 「一般」（70）、「不要」、「拿不准」都不进库。名字配不配某个姓，直播时再按打分规则逐个查。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreName } from "../../src/domain/score/score";
import type { LibraryEntry, LibraryFile, ReviewBatch, ReviewGender, VerdictMap } from "../../src/library/review-types";

/** 和姓无关、命中就配哪个姓都不能出的规则（与 recommend.ts 的硬伤一致） */
const NAME_BLOCKING = new Set(["forbidden", "swap", "template", "rare", "misread", "eraName"]);

const MIN_GRADE = 80;
const root = join(process.cwd(), "data", "name-library", "v2");
const reviewDir = join(root, "review");

/** 备注开头写的分数：「80理由…」「90分，前途…」「85还可以」 */
function gradeFromNote(note?: string): number | undefined {
  const m = note?.trim().match(/^(\d{2,3})/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : undefined;
}

const entries: LibraryEntry[] = [];
const seen = new Map<string, string>();
const skipped: string[] = [];
for (const file of readdirSync(reviewDir).filter((f) => f.endsWith(".json") && !f.endsWith(".verdicts.json")).sort()) {
  const batch = JSON.parse(readFileSync(join(reviewDir, file), "utf8")) as ReviewBatch;
  let verdicts: VerdictMap = {};
  try {
    verdicts = JSON.parse(readFileSync(join(reviewDir, file.replace(/\.json$/, ".verdicts.json")), "utf8")) as VerdictMap;
  } catch {
    continue;
  }
  for (const item of batch.items) {
    const v = verdicts[item.id];
    if (!v || v.verdict !== "yes") continue;
    const grade = v.grade ?? gradeFromNote(v.note) ?? 80;
    if (grade < MIN_GRADE) {
      skipped.push(`${item.givenName}(${grade})`);
      continue;
    }
    const before = seen.get(item.givenName);
    if (before) {
      skipped.push(`${item.givenName}(和 ${before} 重复)`);
      continue;
    }
    // 用户说要、但打分规则判了硬伤的（浩然在爆款名单里），配哪个姓都出不了，不进库免得数量虚高
    const gender = item.gender === "neutral" ? "unknown" : item.gender;
    const hard = scoreName({ surname: "林", givenName: item.givenName, alternatives: [] }, gender).deductions.find((d) =>
      NAME_BLOCKING.has(d.rule),
    );
    if (hard) {
      skipped.push(`${item.givenName}(规则拦下：${hard.line})`);
      continue;
    }
    seen.set(item.givenName, batch.batch);
    entries.push({
      id: item.id,
      givenName: item.givenName,
      gender: item.gender,
      ...(item.citation ? { citation: item.citation } : {}),
      meaning: item.meaning,
      ...(item.talk ? { talk: item.talk } : {}),
      grade,
      batch: batch.batch,
    });
  }
}

const out: LibraryFile = { builtAt: new Date().toISOString(), entries };
writeFileSync(join(root, "library.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
const count = (g: ReviewGender) => entries.filter((e) => e.gender === g).length;
const male = count("male");
const female = count("female");
const neutral = count("neutral");
console.log(
  `名字库 ${entries.length} 个：男孩 ${male}、女孩 ${female}、男女都可 ${neutral}；男孩能用 ${male + neutral}，女孩能用 ${female + neutral}。带出处 ${entries.filter((e) => e.citation).length} 个，带口播稿 ${entries.filter((e) => e.talk).length} 个`,
);
if (skipped.length) console.log(`没进库（低于 ${MIN_GRADE} 分或重复）：${skipped.join(" ")}`);
const untalked = entries.filter((e) => !e.talk).map((e) => e.givenName);
if (untalked.length) console.log(`提醒 进库但还没有口播稿（直播时提词页只能显示一句话）：${untalked.join(" ")}`);
