/**
 * 把一批起草好的名字核对后生成评审批次，给 /review 页面读。
 *
 * 用法：pnpm tsx scripts/library/build-review.ts trial-60
 *   输入 data/name-library/v2/drafts/<batch>.json（agent 起草：名字、出处、我的建议、好在哪、问题在哪）
 *   输出 data/name-library/v2/review/<batch>.json
 *
 * 做三件事，全是确定性计算，不调模型：
 *   1. 出处逐字回语料核对（scripts/library/corpus.ts 的 checkCitation）；有一条不过就退出码 1，不生成文件
 *   2. 配王、李、陈三个常见姓，用打分规则（src/domain/score/score.ts）算分，扣分理由一并写进去
 *   3. 标上名字拼音
 * 建议「要」的名字如果名字本身扣分超过 10 分，打印提醒（说明我的建议和规则对不上，要么改建议，要么补规则）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pinyin } from "pinyin-pro";
import { fullNamePinyin } from "../../src/domain/pinyin-name";
import { scoreName } from "../../src/domain/score/score";
import type { DraftBatch, ReviewBatch, ReviewItem } from "../../src/library/review-types";
import { checkCitation } from "./corpus";

const SAMPLE_SURNAMES = ["王", "李", "陈"];
/** 和姓无关的扣分（字义、年代、性别、热门、常用度），用来看名字本身 */
const NAME_ONLY_RULES = new Set(["forbidden", "swap", "template", "gender", "misread", "rare", "hot", "eraName", "era", "remind", "style"]);

const batchName = process.argv[2];
if (!batchName || !/^[a-z0-9-]+$/.test(batchName)) {
  console.error("用法：pnpm tsx scripts/library/build-review.ts <批次名，只含小写字母、数字、横线>");
  process.exit(1);
}

const root = join(process.cwd(), "data", "name-library", "v2");
const draft = JSON.parse(readFileSync(join(root, "drafts", `${batchName}.json`), "utf8")) as DraftBatch;

const errors: string[] = [];
const warnings: string[] = [];
const seen = new Set<string>();
const items: ReviewItem[] = draft.items.map((d) => {
  if (seen.has(d.id)) errors.push(`${d.id} 编号重复`);
  seen.add(d.id);
  if (![...d.givenName].every((ch) => /[\u4e00-\u9fff]/.test(ch)) || [...d.givenName].length !== 2) {
    errors.push(`${d.id} ${d.givenName}：不是两个汉字`);
  }

  let order: ReviewItem["order"];
  if (d.citation) {
    const checked = checkCitation(d.givenName, d.citation);
    for (const e of checked.errors) errors.push(`${d.id} ${d.givenName}：${e}`);
    order = checked.order ?? undefined;
  }

  const gender = d.gender === "neutral" ? "unknown" : d.gender;
  const samples = SAMPLE_SURNAMES.map((surname) => {
    const s = scoreName({ surname, givenName: d.givenName, alternatives: [] }, gender);
    return {
      fullName: `${surname}${d.givenName}`,
      pinyin: fullNamePinyin(surname, d.givenName).text,
      score: s.score,
      deductions: s.deductions.map((x) => ({ points: x.points, line: x.line })),
    };
  });

  if (d.suggestion === "要") {
    const s = scoreName({ surname: SAMPLE_SURNAMES[0]!, givenName: d.givenName, alternatives: [] }, gender);
    const own = s.deductions.filter((x) => NAME_ONLY_RULES.has(x.rule)).reduce((n, x) => n + x.points, 0);
    if (own > 10) warnings.push(`${d.id} ${d.givenName}：建议「要」，但名字本身被规则扣了 ${own} 分`);
  }

  const py = pinyin(d.givenName, { toneType: "symbol", type: "array" });
  return { ...d, pinyin: (Array.isArray(py) ? py : [py]).join(" "), ...(order ? { order } : {}), samples };
});

for (const w of warnings) console.log(`提醒 ${w}`);
if (errors.length) {
  console.log(`\n核对不过 ${errors.length} 条，没有生成评审文件：`);
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}

const out: ReviewBatch = {
  batch: draft.batch,
  title: draft.title,
  note: draft.note,
  builtAt: new Date().toISOString(),
  items,
};
mkdirSync(join(root, "review"), { recursive: true });
writeFileSync(join(root, "review", `${batchName}.json`), `${JSON.stringify(out, null, 2)}\n`, "utf8");

const count = (k: string) => items.filter((i) => i.suggestion === k).length;
const cited = items.filter((i) => i.citation).length;
console.log(
  `${batchName}：${items.length} 个（建议要 ${count("要")} / 拿不准 ${count("拿不准")} / 不要 ${count("不要")}），带出处 ${cited} 个，全部逐字核过`,
);
