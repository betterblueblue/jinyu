/**
 * 查原句在语料哪一篇：起草出处时用，填 s / t。
 *
 * 用法：pnpm tsx scripts/library/locate.ts 文件.json
 * 文件内容：[{ "book": "shijing", "line": "静女其姝，俟我于城隅" }, ...]，book 可省（全库找，慢）。
 */
import { readFileSync } from "node:fs";
import { locate } from "./corpus";

const file = process.argv[2];
if (!file) {
  console.error("用法：pnpm tsx scripts/library/locate.ts 文件.json");
  process.exit(1);
}
const list = JSON.parse(readFileSync(file, "utf8")) as { book?: string; line: string; tag?: string }[];
for (const item of list) {
  const hits = locate(item.line, item.book ? [item.book] : undefined);
  const head = `${item.tag ? `${item.tag} ` : ""}「${item.line}」`;
  if (!hits.length) console.log(`✗ ${head} 没找到`);
  else console.log(`✓ ${head} → ${hits.slice(0, 4).map((h) => `${h.s}|${h.t}${h.a ? `|${h.a}` : ""}`).join("  ;  ")}`);
}
