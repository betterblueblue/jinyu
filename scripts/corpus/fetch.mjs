/**
 * 下载并归一化语料。
 *
 *   node scripts/corpus/fetch.mjs            # 全部
 *   node scripts/corpus/fetch.mjs shijing   # 指定来源
 *
 * 产物：
 *   data/corpus/raw/<id>/...        原始下载，缓存，重跑不再下载
 *   data/corpus/pieces.jsonl        归一化后的分篇语料，每行一条 {s,t,a?,x}
 *
 * pieces.jsonl 是运行时的核验底本，体积在几十 MB 量级，不进 git。
 */

import fs from "node:fs";
import path from "node:path";
import { SOURCES, POEM_BASE, TXT_BASE } from "./sources.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RAW = path.join(ROOT, "data/corpus/raw");
const OUT = path.join(ROOT, "data/corpus/pieces.jsonl");

const CONCURRENCY = 6;
const MAX_BYTES = 48 * 1024 * 1024;

/** 全角空格、制表、零宽字符一律清掉；保留标点，展示时要用 */
function clean(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u3000\u00a0\t\u200b\ufeff]/g, " ")
    .replace(/ +/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function textOf(item) {
  const parts = [];
  for (const key of ["paragraphs", "content", "para"]) {
    const v = item[key];
    // 只收字符串。content 里套对象（诗经/古文观止那种多层结构）交给 walk 递归，
    // 早先这里 String(对象) 会得到一串 "[object Object]"
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string" && x.trim()) parts.push(x);
    } else if (typeof v === "string" && v.trim()) {
      parts.push(v);
    }
  }
  return clean(parts.join("\n"));
}

function encPath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return "cached";
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "jinyu-corpus" } });
      if (!res.ok) {
        if (res.status === 404) return "missing";
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) return "too-large";
      fs.writeFileSync(dest, buf);
      return "ok";
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  return "failed";
}

/** JSON 语料：递归摊平。有的文件是扁平的数组，有的套了两层 content */
function fromJson(src, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();

  const names = (node) => {
    const list = [node.chapter, node.section, node.title || node.rhythmic].filter(
      (v) => typeof v === "string" && v.trim(),
    );
    return [...new Set(list.map((v) => v.trim()))];
  };

  const walk = (node, path) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, path);
      return;
    }
    if (!node || typeof node !== "object") return;

    const here = [...path, ...names(node)];
    const body = textOf(node);
    if (body.length >= 4) {
      const title = here.join("·") || "第 1 篇";
      const key = title + "|" + body.slice(0, 24);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ s: src.id, t: title, x: body, ...(node.author ? { a: String(node.author).trim() } : {}) });
      }
    }
    for (const key of ["content", "chapters", "sections", "data"]) {
      if (Array.isArray(node[key])) walk(node[key], here);
    }
  };

  if (Array.isArray(data)) walk(data, []);
  else if (data && typeof data === "object" && Array.isArray(data.content)) walk(data.content, []);
  else walk(data, []);

  return out;
}

/** 纯文本语料：按标题行切块；切不出就整本算一块 */
function fromTxt(src, text) {
  const lines = clean(text).split("\n");
  const blocks = [];
  let cur = { t: "", lines: [] };
  let matched = false;

  for (const line of lines) {
    const m = src.heading ? line.match(src.heading) : null;
    if (m) {
      matched = true;
      if (cur.lines.join("").length >= 4) blocks.push(cur);
      cur = { t: (m[1] || m[0]).trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.join("").length >= 4) blocks.push(cur);

  if (!matched) {
    return [{ s: src.id, t: src.name, x: clean(text) }];
  }
  return blocks.map((b) => ({
    s: src.id,
    t: b.t || src.name,
    x: clean(b.lines.join("\n")),
  }));
}

async function pool(items, worker, limit) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const targets = only.length ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;
  if (!targets.length) {
    console.error("没有匹配的来源");
    process.exit(1);
  }

  // 诗词标题里会夹繁体（如「登科後」），界面上和简体正文并排很扎眼。
  // 只折标题、不折正文；也不折经部的篇名，免得「乾」被折成「干」。
  let t2s = null;
  try {
    t2s = JSON.parse(fs.readFileSync(path.join(ROOT, "data/corpus/chars.json"), "utf8")).t2s;
  } catch {
    /* 字表还没生成，标题原样保留 */
  }
  const foldTitle = (text) => (t2s ? [...text].map((c) => t2s[c] ?? c).join("") : text);

  const allRecords = fs.existsSync(OUT)
    ? fs
        .readFileSync(OUT, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((r) => !targets.some((t) => t.id === r.s))
    : [];

  for (const src of targets) {
    const jobs = src.files.map((f) => ({ file: f, url: (src.kind === "txt" ? TXT_BASE : POEM_BASE) + encPath(f) }));
    const stats = { ok: 0, cached: 0, missing: 0, failed: 0, pieces: 0 };
    const texts = await pool(
      jobs,
      async (job) => {
        const dest = path.join(RAW, src.id, job.file.replace(/[\\/]/g, "__"));
        const state = await download(job.url, dest);
        stats[state] = (stats[state] ?? 0) + 1;
        if (state === "ok" || state === "cached") return fs.readFileSync(dest, "utf8");
        return null;
      },
      CONCURRENCY,
    );

    for (const text of texts) {
      if (!text) continue;
      const recs = src.kind === "txt" ? fromTxt(src, text) : fromJson(src, text);
      if (src.kind === "poem") for (const rec of recs) rec.t = foldTitle(rec.t);
      allRecords.push(...recs);
      stats.pieces += recs.length;
    }
    console.log(
      `${src.name.padEnd(6)} ${String(stats.pieces).padStart(7)} 篇  ` +
        `下载 ${stats.ok} / 缓存 ${stats.cached} / 缺 ${stats.missing} / 失败 ${stats.failed}`,
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = allRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(OUT, body);
  const mb = (Buffer.byteLength(body) / 1024 / 1024).toFixed(1);
  console.log(`\n合计 ${allRecords.length} 篇，${mb} MB → ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
