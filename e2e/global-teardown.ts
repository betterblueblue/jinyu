import { cleanupNewReports } from "./test-data";

/** 跑完把用例生成的报告挪进 data/_trash/，别污染用户历史 */
export default function globalTeardown(): void {
  const { removed, trash } = cleanupNewReports();
  if (removed > 0) console.log(`[e2e] 清理测试报告 ${removed} 条 → ${trash}`);
}
