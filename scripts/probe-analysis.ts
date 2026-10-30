/**
 * 名字分析链路的离线自检（不联网）。
 *
 *   pnpm tsx scripts/probe-analysis.ts           # 用假模型跑一遍
 *   pnpm tsx scripts/probe-analysis.ts 高登科     # 指定姓名
 *
 * 验证三件事：语料能不能加载、引文核验会不会误放、本地查表和拼装是否正常。
 */

import { corpusCatalog, corpusStats, verifyCitation } from "../src/domain/analysis/corpus";
import { splitFullName } from "../src/domain/analysis/split-name";
import { buildLocalChecks } from "../src/domain/analysis/rules";
import { runAnalysis } from "../src/domain/analysis/analyze";
import { FakeAnalysisProvider } from "../src/providers/analysis-provider";

const name = process.argv[2] ?? "高登科";

async function main() {
  const t0 = Date.now();
  const stats = corpusStats();
  console.log(`语料：${stats.sources} 部、${stats.pieces} 篇（加载 ${Date.now() - t0}ms）`);
  const catalog = corpusCatalog().filter((s) => s.available);
  console.log(`可核验书目 ${catalog.length} 部：${catalog.map((s) => s.name).join("、")}`);
  console.log();

  const cases = [
    { source: "诗经", piece: "周南·桃夭", quote: "桃之夭夭，灼灼其华" },
    { source: "诗经", piece: "小雅·鹿鸣", quote: "桃之夭夭，灼灼其华" },
    { source: "楚辞", piece: "离骚", quote: "路漫漫其修远兮，吾将上下而求索" },
    { source: "周易", piece: "乾", quote: "天行健，君子以自强不息" },
    { source: "诗经", piece: "周南", quote: "这句话是编的根本没有" },
    { source: "菜根谭", piece: "", quote: "宠辱不惊，闲看庭前花开花落" },
  ];
  for (const c of cases) {
    const r = verifyCitation(c);
    if (r.ok) {
      console.log(`✓ ${c.source}·${c.piece} → ${r.citation.piece}${r.citation.corrected ? "（篇名已校正）" : ""}`);
      console.log(`   ${r.citation.line}`);
    } else {
      console.log(`✗ ${c.source}·${c.piece} → ${r.rejected.reason}`);
    }
  }
  console.log();

  const split = splitFullName(name);
  console.log(`拆分：${split.split?.surname} / ${split.split?.givenName}`, split.split?.alternatives);
  const local = buildLocalChecks(split.split!, "male");
  console.log("本地事实：", local.facts.chars, local.facts.overallLean);
  console.log("本地问题：", local.issues.map((i) => `[${i.severity}] ${i.text}`));
  console.log();

  const t1 = Date.now();
  const out = await runAnalysis(
    { fullName: name, gender: "male", birthDate: "1995-06-12" },
    new FakeAnalysisProvider(),
  );
  console.log(`分析耗时 ${Date.now() - t1}ms`);
  if (!out.ok) {
    console.log("失败：", out.message);
    return;
  }
  const r = out.result;
  console.log("档次：", r.verdict);
  console.log("总评：", r.headline);
  console.log("站得住：", r.goodPoints);
  console.log("问题：", r.issues.map((i) => `[${i.severity}] ${i.text} → ${i.hint ?? ""}`));
  console.log("引文：", r.citations);
  console.log("被驳回：", r.rejectedCitations);
  console.log("结尾：", r.closing);
  console.log("更贴合：", r.fitAngle ?? "—");
  console.log("改名约束：", r.regenBrief);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
