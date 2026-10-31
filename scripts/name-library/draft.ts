/**
 * 第 1 步：模型起草。
 *
 * 给模型整篇原文，让它从里面取双字名——引文是原文子串，因此可核验，
 * 不会出现「现代常用字组合」那种编造出处。每篇要 1 男 1 女 1 中。
 *
 * 2026-10-31 加了语域规则（第 5–8 条）：这一版是按「2026 年能不能上户口」判的，
 * 不是按「有没有出处」。791 条旧库就是缺这层判断，出来的多是字、号、景物拼合。
 * 「允修」这类抽象字组合靠第 7 条的例外说明仍可过，其余德业志功礼一路一律作废。
 *
 * 用法：pnpm tsx scripts/name-library/draft.ts [--limit N] [--concurrency N]
 * 输入：data/name-library/drafts/pieces.jsonl
 * 输出：data/name-library/drafts/drafts.jsonl（可断点续跑，已起草的篇会跳过）
 */
import fs from "node:fs";
import path from "node:path";
import { streamChat, extractJson } from "../../src/providers/chat";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "name-library", "drafts");
const IN_FILE = path.join(DIR, "pieces.jsonl");
const OUT_FILE = path.join(DIR, "drafts.jsonl");

const PIECES_PER_CALL = 6;
const EMPTY_RETRY = 1;
const MAX_TOKENS = 8192;

/** 被 max_tokens 截断时，把已经完整的对象捞回来，不整批作废 */
function salvageObjects(text: string): unknown[] {
  const out: unknown[] = [];
  const re = /\{[^{}]+\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[0]) as Record<string, unknown>;
      if (obj && typeof obj === "object" && "pieceId" in obj) out.push(obj);
    } catch {
      /* 半截对象，跳过 */
    }
  }
  return out;
}

function loadEnvLocal(): void {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

interface Piece {
  id: string;
  source: string;
  piece: string;
  text: string;
}

interface DraftName {
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

const SYSTEM = `你是中文起名顾问。唯一任务：从给定古籍原文里取出适合做双字名的两个字，并写出能直接念给直播间观众听的解释。
只输出 JSON，不要解释过程。想不出来就少给，绝不为了凑数编造。
推理不超过 150 字，不要反复推敲，直接取词写结论。
判断标准是「这个名字写上 2026 年的出生证明，家长会不会认」，不是「有没有出处、意思正不正」。
引经据典但当代没人会用的字（德、道、志、业、功、礼、治、济、猷、谟），一律不取。`;

function buildPrompt(batch: Piece[]): string {
  const blocks = batch
    .map((p) => `[${p.id}] ${p.source}·${p.piece}\n${p.text}`)
    .join("\n\n");
  return `下面有 ${batch.length} 篇古籍原文，每篇有编号。请为每篇取 3 个双字名：1 个偏男、1 个偏女、1 个中性。

硬性规则：
1. 名字两个字必须按顺序出现在该篇原文里（相邻取词，或同一句内跳字都行），不许用原文里没有的字。
2. quote 必须从该篇原文原样抄一句，逐字照抄，不许改写、不许拼接、不许自己造句。
3. 不取含否定词（不、无、未、莫、勿、非、毋）的字组，不取「之子」「其叶」这类虚词组合。
4. 不取生僻到直播里念不出、写不出的字。字面忌：冥、幽、阴、暗、昧、晦、霾、死、病、亡、丧、哭、泣、悲、哀、愁、苦、贫、贱、辱、罪、刑、狱、杀、戮、尸、血、骨、坟、墓、棺、葬、疾、痛、伤、残、孤、寡、鳏、独、妖、邪、鬼、魂、腐、朽、枯、槁、污、秽、臭、夭、殇、昏、聩——一律不取，诗里意思再好也不用（「冥鸿」就是反例：白居易原句「不信有冥鸿」意思不差，但「冥」是阴间的冥）。

语域规则（比上面四条更重要，违反即作废）：
5. 户籍语域：这名字写上 2026 年的出生证明，家长不会觉得「这是我爷爷的字」。作废例：进德、修德、刚健、方刚、守志、大成、嘉绩、策勋、忠良、守业、敬治、宣威。这类是「字」和「号」的写法，不是名字。
6. 撞车排除：不得与现成的地名、县名、年号、品牌、成语、官职、校训同形。作废例：寿宁（县）、建德（市）、太和（县）、清远（市）、天润（乳业）、宜家（IKEA）、景阳（景阳冈）、明德/厚德（校训）、弘毅（成语）。
7. 字面避让：不拿只当第二字的老派抽象字打头或收尾——德、道、志、业、功、礼、政、仁、义、信、忠、孝、敬、慎、允、克、维、惟、攸、懋、丕、谟、猷。（「允」在「允修」这类现代活跃词里可以，但要在 composition 里说明为什么成立。）
8. 气质优先：要的是「意象名词／动作＋意象」这一路——望舒、观澜、嘉树、清越、静姝、知微。取到抽象德性字就是跑偏，宁可这一篇不给。

格式规则：
9. meaning 不超过 40 字，讲这个名字什么意思，不要「寓意美好」「文化底蕴深厚」这类空话。
10. composition 不超过 50 字，讲两个字的关系，以及与所引原句的联系。
11. pitfalls 只在确实有问题时写（容易被念错、容易被起外号、撞品牌或地名），没有就空字符串。
12. 名字首字不要用「自、曾、予、余、我、汝、尔、其、所、相」这类代词或姓氏字。
13. 原文本身不适合取名（战乱、悼亡、贬义、叙事）时，该篇就少给或不给。

输出 JSON，形如：
{"names":[{"pieceId":"p001","givenName":"静嘉","lean":"female","quote":"笾豆静嘉","meaning":"安静而美好","composition":"静取安静，嘉取美善，原句写祭器洁净美好","pitfalls":""}]}

lean 只能是 male / female / neutral。givenName 必须是两个汉字。

原文：

${blocks}`;
}

async function draftBatch(batch: Piece[], client: { baseUrl: string; apiKey: string; model: string }, batchId: string): Promise<DraftName[]> {
  const byId = new Map(batch.map((p) => [p.id, p]));
  let lastErr = "";
  for (let attempt = 0; attempt <= EMPTY_RETRY; attempt++) {
    try {
      const { content } = await streamChat(client, {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(batch) },
        ],
        maxTokens: MAX_TOKENS,
      });
      const json = extractJson(content);
      let list: unknown[] = [];
      if (json) {
        try {
          const parsed = JSON.parse(json) as { names?: unknown };
          list = Array.isArray(parsed.names) ? parsed.names : [];
        } catch {
          list = salvageObjects(content);
        }
      } else {
        list = salvageObjects(content);
      }
      if (!list.length) {
        lastErr = "names 为空";
        continue;
      }
      const out: DraftName[] = [];
      for (const item of list) {
        const rec = item as Record<string, unknown>;
        const pieceId = String(rec.pieceId ?? "");
        const src = byId.get(pieceId);
        if (!src) continue;
        const givenName = String(rec.givenName ?? "").trim();
        if ([...givenName].length !== 2) continue;
        out.push({
          pieceId,
          source: src.source,
          piece: src.piece,
          givenName,
          lean: ["male", "female", "neutral"].includes(String(rec.lean)) ? String(rec.lean) : "neutral",
          quote: String(rec.quote ?? "").trim(),
          meaning: String(rec.meaning ?? "").trim(),
          composition: String(rec.composition ?? "").trim(),
          pitfalls: String(rec.pitfalls ?? "").trim(),
          batch: batchId,
        });
      }
      if (!out.length) {
        lastErr = "解析后为空";
        continue;
      }
      return out;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`批次 ${batchId} 失败：${lastErr}`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!fs.existsSync(IN_FILE)) {
    console.error(`缺 ${IN_FILE}，先跑 pick-pieces.ts`);
    process.exit(1);
  }
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    console.error("LLM_API_KEY 缺失（检查 .env.local）");
    process.exit(1);
  }
  const client = {
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
  };

  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const concArg = args.indexOf("--concurrency");
  const concurrency = concArg >= 0 ? Math.max(1, Number(args[concArg + 1])) : 4;

  const all = fs
    .readFileSync(IN_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Piece);

  const done = new Set<string>();
  if (fs.existsSync(OUT_FILE)) {
    for (const line of fs.readFileSync(OUT_FILE, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        done.add((JSON.parse(line) as DraftName).pieceId);
      } catch {
        /* 半行，忽略 */
      }
    }
  }
  const todo = all.filter((p) => !done.has(p.id));
  console.log(`总篇数 ${all.length}，已起草 ${all.length - todo.length}，待起草 ${todo.length}`);

  const batches: Piece[][] = [];
  for (let i = 0; i < todo.length; i += PIECES_PER_CALL) {
    batches.push(todo.slice(i, i + PIECES_PER_CALL));
  }
  const runnable = Number.isFinite(limit) ? batches.slice(0, limit) : batches;
  console.log(`批次 ${runnable.length}，并发 ${concurrency}，每批 ${PIECES_PER_CALL} 篇`);

  const out = fs.createWriteStream(OUT_FILE, { flags: "a" });
  let written = 0;
  let failed = 0;
  let cursor = 0;
  const started = Date.now();

  async function worker(workerId: number): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= runnable.length) return;
      const batch = runnable[idx]!;
      const batchId = `b${String(idx + 1).padStart(3, "0")}`;
      try {
        const names = await draftBatch(batch, client, batchId);
        for (const n of names) out.write(JSON.stringify(n) + "\n");
        written += names.length;
        const okPieces = new Set(names.map((n) => n.pieceId)).size;
        console.log(`  [${batchId}] w${workerId} 出 ${names.length} 名 / 覆盖 ${okPieces} 篇`);
      } catch (err) {
        failed++;
        console.warn(`  [${batchId}] w${workerId} 失败：${err instanceof Error ? err.message : err}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, runnable.length) }, (_, i) => worker(i + 1)));
  await new Promise<void>((res) => out.end(res));

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n完成：新增 ${written} 条，失败批次 ${failed}，耗时 ${secs}s`);
  console.log(`累计见 ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
