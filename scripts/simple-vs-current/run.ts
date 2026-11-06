/**
 * 简化版对比 Demo（2026-11-06）：三个核心功能，同一批输入，「现在的系统」对「一段短提示词、调一次模型」。
 * 只是后台脚本，不改产品代码。
 *
 * 用法（必须走本地网关，不读 .env.local，免得用上官方 API）：
 *   LLM_BASE_URL=http://127.0.0.1:3425/v1 LLM_MODEL=opendesign/deepseek-v4.1-flash LLM_API_KEY=local \
 *     pnpm tsx scripts/simple-vs-current/run.ts [smoke|all]
 * smoke：每个功能只跑第一组；all：全部。跑过的（功能 + 序号 + 哪一版）记在结果里，再跑会跳过。
 * 结果：data/eval/simple-vs-current/results.json；出报告和盲选页：report.ts。
 *
 * 关不掉思考：网关上 reasoning_effort low / none / thinking disabled / 不传，模型都照样先想（2026-11-06 实测）。
 * 所以简化版是「low」，现在的系统完整起名是「xhigh」、另外两个是「low」，照实记推理字数和出第一个正文字的时间。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type Kind = "score" | "fast" | "full";
export type Arm = "current" | "simple";
type G = "male" | "female" | "unknown";

export interface ScoreCase { fullName: string; surname: string; gender: "male" | "female" }
export interface FastCase { surname: string; gender: "male" | "female"; birthday?: string }
export interface FullCase {
  label: string;
  surname: string;
  gender: G;
  nameLength: "one" | "two";
  birthStatus: "born" | "unborn";
  dueDate?: string;
  baziEnabled?: boolean;
  birthDate?: string;
  birthHour?: string;
  generationChar?: string;
  generationPosition?: "first" | "second" | "any";
  tabooChars?: string;
  avoidPopular?: boolean;
}

export const SCORE_CASES: ScoreCase[] = [
  { fullName: "文娟", surname: "文", gender: "female" },
  { fullName: "王秀英", surname: "王", gender: "female" },
  { fullName: "刘洋", surname: "刘", gender: "male" },
  { fullName: "张伟", surname: "张", gender: "male" },
  { fullName: "杜子腾", surname: "杜", gender: "male" },
  { fullName: "李婷婷", surname: "李", gender: "female" },
  { fullName: "王梓涵", surname: "王", gender: "female" },
  { fullName: "陈建国", surname: "陈", gender: "male" },
  { fullName: "林易安", surname: "林", gender: "female" },
  { fullName: "高登科", surname: "高", gender: "male" },
];

export const FAST_CASES: FastCase[] = [
  { surname: "王", gender: "female" },
  { surname: "李", gender: "male" },
  { surname: "沈", gender: "female", birthday: "2026-03-18" },
  { surname: "张", gender: "male", birthday: "2026-07-02" },
  { surname: "欧阳", gender: "female" },
  { surname: "刘", gender: "male", birthday: "2025-12-20" },
  { surname: "陈", gender: "female", birthday: "2026-09-10" },
  { surname: "赵", gender: "male" },
];

export const FULL_CASES: FullCase[] = [
  { label: "辈分字在第一个字 + 避讳字", surname: "王", gender: "male", nameLength: "two", birthStatus: "born", generationChar: "承", generationPosition: "first", tabooChars: "明,强" },
  { label: "一字名", surname: "林", gender: "female", nameLength: "one", birthStatus: "born" },
  { label: "已出生、开八字（带时辰）", surname: "李", gender: "female", nameLength: "two", birthStatus: "born", baziEnabled: true, birthDate: "2026-05-12", birthHour: "9" },
  { label: "未出生、填预产期、性别未知", surname: "张", gender: "unknown", nameLength: "two", birthStatus: "unborn", dueDate: "2027-01-20" },
  { label: "辈分字在第二个字 + 避开流行名", surname: "陈", gender: "female", nameLength: "two", birthStatus: "born", generationChar: "思", generationPosition: "second", avoidPopular: true },
  { label: "复姓 + 辈分字不限位置 + 避讳字", surname: "欧阳", gender: "male", nameLength: "two", birthStatus: "born", generationChar: "德", generationPosition: "any", tabooChars: "华,伟" },
];

/* ---------- 简化版提示词：按需求写，像在网页上直接问 ---------- */

const SIMPLE_SYSTEM = "你是一位懂汉字、懂古典诗文的起名老师，说话像跟家长聊天，具体、不说空话。只输出一个 JSON 对象。";
const GW = { male: "男孩", female: "女孩", unknown: "性别还不知道" } as const;

function scorePrompt(c: ScoreCase): string {
  return [
    `给这个名字打分并点评：${c.fullName}（${GW[c.gender]}，姓${c.surname}）。`,
    "从音律、字义、气质、识读、流行（重名和年代感）、谐音、国学、字形八个方面看，满分 100。",
    "说清楚好在哪、问题在哪，要具体到字。",
    "90 分以下就给两个改法：姓不动，只改名里的一个字（大姓配单名可以加一个字变双名），新字要和留下的字搭出具体的意思，别用谁都能配的万能字。",
    'JSON：{"score":数字,"comment":"一段话点评，80 字内","strengths":["…"],"issues":["…"],"fixes":[{"fullName":"改后全名","why":"为什么更好，一句"}]}',
  ].join("\n");
}

function fastPrompt(c: FastCase): string {
  return [
    `直播间里给观众起名：姓${c.surname}，${GW[c.gender]}${c.birthday ? `，生日 ${c.birthday}（只按出生季节参考，不讲八字）` : ""}。`,
    "起 3 个两个字的名，第一个是首推。不要网红名、烂大街名，不要生僻字和多音字，三个名不要用同一个字。",
    "每个名一句话讲清楚好在哪；有靠得住的古诗文出处就写原句，没有就不写，不要编。",
    'JSON：{"names":[{"givenName":"名（不带姓）","pinyin":"带声调拼音","why":"一句话","source":"书名或作者篇名","quote":"原句"}]}',
  ].join("\n");
}

function fullPrompt(c: FullCase): string {
  const lines = [`给宝宝起名：姓${c.surname}，${GW[c.gender]}，名${c.nameLength === "one" ? "一个字" : "两个字"}。`];
  if (c.birthStatus === "unborn") lines.push(`还没出生${c.dueDate ? `，预产期 ${c.dueDate}` : ""}。`);
  if (c.baziEnabled && c.birthDate) lines.push(`生日 ${c.birthDate}${c.birthHour ? ` ${c.birthHour} 点` : ""}，可以参考出生季节和八字，说法要温和，不下定论，不写天干地支。`);
  if (c.generationChar) {
    const pos = c.generationPosition === "first" ? "名的第一个字" : c.generationPosition === "second" ? "名的第二个字" : "名里";
    lines.push(`辈分字「${c.generationChar}」，必须放在${pos}。`);
  }
  if (c.tabooChars) lines.push(`避讳字：${c.tabooChars}，名里不能出现。`);
  if (c.avoidPopular) lines.push("尽量避开这些年流行的名字。");
  lines.push(
    `起 ${c.gender === "unknown" ? "6 个（男孩、女孩、中性都要有）" : "6 个"}，按推荐顺序排。不要生僻字、多音字、网红名。`,
    "每个名写清楚两个字各是什么意思、合起来为什么成立；有靠得住的古诗文出处就写原句，没有就不写，不要编。",
    `JSON：{"names":[{"givenName":"名（不带姓）","pinyin":"带声调拼音","gender":"male/female/neutral","meaning":"整体意思","composition":"两个字为什么搭","source":"书名","piece":"篇名","quote":"原句"${c.baziEnabled ? ',"baziFit":"和出生季节合不合，一句"' : ""}}]}`,
  );
  return lines.join("\n");
}

/* ---------- 一次结果：两版写成同一个样子，盲选时看不出是哪版 ---------- */

export interface CheckItem {
  /** 名（不带姓） */
  givenName: string;
  citation?: { source?: string; piece?: string; quote?: string };
}
export interface Card {
  /** 打分改字：点评一段；起名：空 */
  comment?: string;
  strengths?: string[];
  issues?: string[];
  /** 起名的名字，或打分改字的改法：一行一个 */
  items: { name: string; lines: string[] }[];
}
export interface Run {
  kind: Kind;
  index: number;
  arm: Arm;
  /** 从发出去到全部写完 */
  totalMs: number;
  /** 观众/主播第一次能看到东西：打分是分数出来，起名是名字出来；简化版是第一个正文字 */
  firstMs?: number;
  /** 简化版：推理写了多少字 */
  reasoningChars?: number;
  /** 模型自己给的分（打分改字） */
  score?: number;
  card: Card;
  /** 要过规则检查的名字（起名的名，或改法的名） */
  names: CheckItem[];
  /** 现在的系统里，没过规则被拦掉的有几个（简化版没有这一层） */
  blocked?: number;
  note?: string;
  error?: string;
}

/**
 * 输出上限：第一轮用 4096，直播起名 2 次、完整起名 3 次没出 JSON（思考字数中位 5000 上下，把预算吃光了）。
 * 现在的系统完整起名是 8192、截断了还重试，所以简化版也放到 8192，失败的那几次重跑（retry 模式）。
 */
const SIMPLE_MAX_TOKENS = 8192;

async function simpleCall(prompt: string): Promise<{ json: Record<string, unknown> | null; totalMs: number; firstMs?: number; reasoningChars: number; finishReason?: string }> {
  const t0 = Date.now();
  let firstMs: number | undefined;
  const res = await fetch(`${process.env.LLM_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
      messages: [
        { role: "system", content: SIMPLE_SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: SIMPLE_MAX_TOKENS,
      stream: true,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
    }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoningChars = 0;
  let finishReason: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const p = line.slice(5).trim();
      if (p === "[DONE]") continue;
      try {
        const ev = JSON.parse(p);
        // 网关中途断线会在流里给一条 error（2026-11-06 查到）；原来这里不认，算成了「没解析出 JSON」
        if (ev.error) finishReason = `网关报错：${String(ev.error.message ?? "").slice(0, 80)}`;
        const choice = ev.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const d = choice?.delta;
        const th = d?.reasoning_content ?? d?.reasoning;
        if (th) reasoningChars += th.length;
        if (d?.content) {
          firstMs ??= Date.now() - t0;
          content += d.content;
        }
      } catch {
        /* 半截的行等下一块 */
      }
    }
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(content);
  } catch {
    const a = content.indexOf("{");
    const b = content.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        json = JSON.parse(content.slice(a, b + 1));
      } catch {
        json = null;
      }
    }
  }
  return { json, totalMs: Date.now() - t0, ...(firstMs !== undefined ? { firstMs } : {}), reasoningChars, ...(finishReason ? { finishReason } : {}) };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

async function runSimple(kind: Kind, index: number): Promise<Run> {
  const prompt =
    kind === "score" ? scorePrompt(SCORE_CASES[index]!) : kind === "fast" ? fastPrompt(FAST_CASES[index]!) : fullPrompt(FULL_CASES[index]!);
  const r = await simpleCall(prompt);
  const base = { kind, index, arm: "simple" as const, totalMs: r.totalMs, ...(r.firstMs !== undefined ? { firstMs: r.firstMs } : {}), reasoningChars: r.reasoningChars };
  if (!r.json) return { ...base, card: { items: [] }, names: [], error: `没解析出 JSON${r.finishReason === "length" ? "（输出到上限被截断）" : r.finishReason ? `（结束原因 ${r.finishReason}）` : ""}` };
  const j = r.json;
  if (kind === "score") {
    const c = SCORE_CASES[index]!;
    const fixes = (Array.isArray(j.fixes) ? j.fixes : []).slice(0, 2) as Record<string, unknown>[];
    const items = fixes.map((f) => ({ name: str(f.fullName), lines: [str(f.why)].filter(Boolean) })).filter((f) => f.name);
    return {
      ...base,
      ...(typeof j.score === "number" ? { score: j.score } : {}),
      card: { comment: str(j.comment), strengths: strs(j.strengths), issues: strs(j.issues), items },
      names: items.map((f) => ({ givenName: f.name.startsWith(c.surname) ? f.name.slice(c.surname.length) : f.name })),
    };
  }
  const surname = kind === "fast" ? FAST_CASES[index]!.surname : FULL_CASES[index]!.surname;
  const keep = kind === "fast" ? 3 : 4;
  const list = (Array.isArray(j.names) ? j.names : []).slice(0, keep) as Record<string, unknown>[];
  const items = list.map((n) => {
    const quote = str(n.quote);
    const lines = [
      [str(n.pinyin), str(n.why) || str(n.meaning)].filter(Boolean).join(" · "),
      str(n.composition),
      quote ? `出处：${[str(n.source), str(n.piece)].filter(Boolean).join("·")}「${quote}」` : "",
      str(n.baziFit),
    ].filter(Boolean);
    return { name: `${surname}${str(n.givenName)}`, lines };
  });
  const names = list.map((n) => {
    const quote = str(n.quote);
    return { givenName: str(n.givenName), ...(quote ? { citation: { source: str(n.source), piece: str(n.piece), quote } } : {}) };
  });
  return { ...base, card: { items }, names };
}

/* ---------- 现在的系统：直接调产品里的函数，和线上走同一条路 ---------- */

async function runCurrent(kind: Kind, index: number): Promise<Run> {
  const t0 = Date.now();
  if (kind === "score") {
    const c = SCORE_CASES[index]!;
    const { evaluateName } = await import("../../src/domain/evaluate/evaluate");
    const { createEvaluateProvider } = await import("../../src/domain/evaluate/provider");
    const provider = createEvaluateProvider();
    if (!provider) throw new Error("没有模型");
    let firstMs: number | undefined;
    const out = await evaluateName({ fullName: c.fullName, gender: c.gender }, provider, { maxCandidates: 2 }, {
      onScores: () => {
        firstMs ??= Date.now() - t0;
      },
    });
    const o = out.original;
    const items = out.candidates.map((x) => ({ name: x.fullName, lines: [x.why, x.spoken].filter(Boolean) }));
    return {
      kind, index, arm: "current", totalMs: Date.now() - t0, ...(firstMs !== undefined ? { firstMs } : {}),
      ...(o ? { score: o.scores.total } : {}),
      card: { comment: o?.comment ?? "", strengths: o?.strengths ?? [], issues: o?.issues.map((it) => it.text) ?? [], items },
      names: out.candidates.map((x) => ({ givenName: x.givenName })),
      blocked: out.rejected.length,
      ...(out.note ? { note: out.note } : {}),
      ...(out.status === "error" || out.status === "timeout" ? { error: out.note ?? out.status } : {}),
    };
  }
  if (kind === "fast") {
    const c = FAST_CASES[index]!;
    const { runFast } = await import("../../src/fast/run");
    const r = await runFast({ surname: c.surname, gender: c.gender, ...(c.birthday ? { birthday: c.birthday } : {}) });
    if (!r.ok) return { kind, index, arm: "current", totalMs: Date.now() - t0, card: { items: [] }, names: [], error: r.message };
    const all = [r.primary, ...r.alternatives];
    const items = all.map((n) => ({
      name: n.fullName,
      lines: [
        [n.pinyin, n.why].filter(Boolean).join(" · "),
        n.citation ? `出处：${n.citation.label ?? [n.citation.source, n.citation.piece].filter(Boolean).join("·")}「${n.citation.line || n.citation.quote}」` : "",
      ].filter(Boolean),
    }));
    return {
      kind, index, arm: "current", totalMs: Date.now() - t0,
      ...(r.debug ? { reasoningChars: r.debug.reasoningChars, blocked: Math.max(0, r.debug.drafted - r.debug.kept) } : {}),
      card: { items },
      names: all.map((n) => ({ givenName: n.givenName, ...(n.citation ? { citation: { source: n.citation.source, piece: n.citation.piece, quote: n.citation.quote } } : {}) })),
      note: all.some((n) => n.library) ? `名字库出了 ${all.filter((n) => n.library).length} 个` : "",
    };
  }
  const c = FULL_CASES[index]!;
  const { normalizeRequest } = await import("../../src/domain/normalizer");
  const { runGeneration } = await import("../../src/domain/orchestrator");
  const { createCandidateProvider } = await import("../../src/providers");
  const norm = normalizeRequest({
    surname: c.surname, gender: c.gender, nameLength: c.nameLength, birthStatus: c.birthStatus,
    ...(c.dueDate ? { dueDate: c.dueDate } : {}),
    ...(c.baziEnabled ? { baziEnabled: true, birthDate: c.birthDate, birthHour: c.birthHour } : {}),
    ...(c.generationChar ? { generationChar: c.generationChar, generationPosition: c.generationPosition } : {}),
    ...(c.tabooChars ? { tabooChars: c.tabooChars } : {}),
    avoidPopular: Boolean(c.avoidPopular),
  });
  if (!norm.ok) return { kind, index, arm: "current", totalMs: 0, card: { items: [] }, names: [], error: `输入不对：${norm.message}` };
  let firstMs: number | undefined;
  const r = await runGeneration(norm.value, createCandidateProvider(), (e) => {
    if (e.type === "stage" && e.stage === "filter") firstMs ??= Date.now() - t0;
  });
  if (!r.ok) return { kind, index, arm: "current", totalMs: Date.now() - t0, card: { items: [] }, names: [], error: r.message };
  const items = r.report.names.map((n) => ({
    name: n.fullName,
    lines: [
      [n.pinyin, n.meaning].filter(Boolean).join(" · "),
      n.composition,
      n.citation ? `出处：${n.citation.source}${n.citation.piece ? `·${n.citation.piece}` : ""}「${n.citation.quote}」` : "",
      n.baziFit ?? "",
    ].filter(Boolean),
  }));
  return {
    kind, index, arm: "current", totalMs: Date.now() - t0, ...(firstMs !== undefined ? { firstMs } : {}),
    card: { items },
    names: r.report.names.map((n) => ({ givenName: n.givenName, ...(n.citation ? { citation: { source: n.citation.source, ...(n.citation.piece ? { piece: n.citation.piece } : {}), quote: n.citation.quote } } : {}) })),
    blocked: r.report.notRecommended.length,
  };
}

/* ---------- 主流程：两版挨着跑，每组换一下谁先，抵消网关快慢 ---------- */

export const OUT_DIR = resolve("data", "eval", "simple-vs-current");
export const OUT = resolve(OUT_DIR, "results.json");

async function main() {
  if (!process.env.LLM_BASE_URL?.includes("127.0.0.1") || process.env.LLM_API_KEY !== "local") {
    throw new Error("这个脚本只走本地网关：命令行设 LLM_BASE_URL=http://127.0.0.1:3425/v1 LLM_API_KEY=local");
  }
  process.env.LLM_USE_FAKE = "false";
  const mode = process.argv[2] ?? "smoke";
  mkdirSync(OUT_DIR, { recursive: true });
  let runs: Run[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Run[]) : [];
  // retry：只重跑简化版没出 JSON 的那几次（输出上限从 4096 放到 8192 以后）
  if (mode === "retry") {
    const failed = runs.filter((r) => r.arm === "simple" && r.error?.startsWith("没解析出 JSON"));
    runs = runs.filter((r) => !failed.includes(r));
    console.log(`重跑简化版没出 JSON 的 ${failed.length} 次：${failed.map((r) => `${r.kind} ${r.index}`).join("、")}`);
  }
  const has = (k: Kind, i: number, a: Arm) => runs.some((r) => r.kind === k && r.index === i && r.arm === a);
  const plan: [Kind, number][] = [];
  const counts: Record<Kind, number> = { score: SCORE_CASES.length, fast: FAST_CASES.length, full: FULL_CASES.length };
  for (const k of ["score", "fast", "full"] as Kind[]) {
    for (let i = 0; i < (mode === "all" || mode === "retry" ? counts[k] : 1); i++) plan.push([k, i]);
  }
  let n = 0;
  for (const [k, i] of plan) {
    const arms: Arm[] = (n++ % 2 === 0 ? ["current", "simple"] : ["simple", "current"]) as Arm[];
    for (const a of arms) {
      if (has(k, i, a)) continue;
      const t0 = Date.now();
      let run: Run;
      try {
        run = a === "current" ? await runCurrent(k, i) : await runSimple(k, i);
      } catch (e) {
        run = { kind: k, index: i, arm: a, totalMs: Date.now() - t0, card: { items: [] }, names: [], error: e instanceof Error ? e.message : String(e) };
      }
      runs.push(run);
      writeFileSync(OUT, JSON.stringify(runs, null, 1));
      console.log(
        `[${k} ${i}] ${a === "current" ? "现在" : "简化"}  ${(run.totalMs / 1000).toFixed(1)}s` +
          `${run.firstMs !== undefined ? `（先看到 ${(run.firstMs / 1000).toFixed(1)}s）` : ""}` +
          `  ${run.card.items.map((x) => x.name).join("、") || "—"}${run.error ? `  出错：${run.error}` : ""}`,
      );
    }
  }
  console.log(`写到 ${OUT}`);
}

if (/simple-vs-current[\\/]run\.ts$/.test(process.argv[1] ?? "")) void main();
