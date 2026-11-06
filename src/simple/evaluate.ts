import { buildFacts } from "@/domain/evaluate/facts";
import { bandOf } from "@/domain/evaluate/scoring";
import type { NameFacts } from "@/domain/evaluate/types";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { resolveSplit, scoreName } from "@/domain/score/score";
import { hardProblems } from "./checks";
import { failText, parseObject, simpleCall, str, strs, thoughtSplitter } from "./llm";

/**
 * 简化版打分改字（2026-11-06）。
 * 观众屏幕副标题写的八个维度，模型各给分、写一句理由，程序只相加（用户定）；原来实际只算六维，国学、字形 0 分。
 * 改法：程序只查硬伤、只动一个字、比原名分高，不验收重写。盲选 2:7:1（现在 : 简化 : 差不多）。
 */

export const DIMS = [
  { key: "sound", label: "音律", max: 15 },
  { key: "meaning", label: "字义", max: 20 },
  { key: "temperament", label: "气质", max: 15 },
  { key: "literacy", label: "识读", max: 10 },
  { key: "popularity", label: "流行", max: 10 },
  { key: "homophone", label: "谐音", max: 10 },
  { key: "classic", label: "国学", max: 10 },
  { key: "glyph", label: "字形", max: 10 },
] as const;

export interface SimpleDim {
  label: string;
  score: number;
  max: number;
  reason: string;
}
export interface SimpleIssue {
  text: string;
  importance: "major" | "minor";
  kind?: string;
}
export interface SimpleFix {
  fullName: string;
  givenName: string;
  pinyin: string;
  /** swap：换一个字；add：单名加一个字 */
  kind: "swap" | "add";
  from: string;
  to: string;
  score: number;
  why: string;
  meaning: string;
  loss?: string;
}
export interface SimpleAnalysis {
  total: number;
  band: string;
  bandLabel: string;
  dims: SimpleDim[];
  comment: string;
  strengths: string[];
  issues: SimpleIssue[];
  reminders: string[];
  charMeaning: string;
}
export type SimpleStatus = "options" | "no_better" | "needs_gender" | "error" | "timeout";
export interface SimpleEvalResult {
  facts: NameFacts;
  analysis: SimpleAnalysis | null;
  fixes: SimpleFix[];
  status: SimpleStatus;
  note?: string;
  tookMs: number;
  cached?: boolean;
}

const GW = { male: "男孩", female: "女孩" } as const;

export function evalPrompt(facts: NameFacts, gender: "male" | "female", pinned?: SimpleAnalysis): string {
  const single = [...facts.givenName].length === 1;
  const head = `名字：${facts.fullName}（${GW[gender]}，姓${facts.surname}，名${facts.givenName}，读 ${facts.pinyin}）。`;
  const fixRule = [
    "改法：姓不动，只改名里的一个字" + (single ? "；单名也可以加一个字变双名，原来的字留着" : "") + "。新字要和留下的字搭出具体的意思，别用谁都能配的万能字（悦宁晴安然清知舒昭澜）。",
    "每个改法也按同样的标准打一个总分，要比原名高才写。",
  ];
  if (pinned) {
    return [
      head,
      `这个名字已经评过：${pinned.total} 分。问题：${pinned.issues.map((i) => i.text).join("；") || "没有大问题"}。`,
      "只再给两个改法，和上次不一样的。",
      ...fixRule,
      'JSON：{"fixes":[{"fullName":"改后全名","score":数字,"why":"为什么更好，15 字内","meaning":"新字的意思和合起来的意思，一两句","loss":"损失什么，一句"}]}',
    ].join("\n");
  }
  return [
    `给这个名字打分并点评。${head}`,
    `按八个方面打分，满分 100：${DIMS.map((d) => `${d.label} ${d.max}`).join("、")}。流行看重名和年代感，国学看有没有典故出处，字形看好写好看、偏旁搭不搭。每一项一句理由，具体到字。`,
    "说清楚好在哪、问题在哪，要具体到字。90 分以下给两个改法。",
    ...fixRule,
    `JSON：{"dims":{${DIMS.map((d) => `"${d.key}":{"score":数字,"reason":"一句"}`).join(",")}},"comment":"一段话点评，80 字内，主播先念","strengths":["…"],"issues":[{"text":"…","importance":"major 或 minor","kind":"八个方面里哪一个"}],"charMeaning":"拆字，每个字的意思，一句","reminders":["只给主播看的提醒：谐音、联想、撞名人，没把握就空"],"fixes":[{"fullName":"改后全名","score":数字,"why":"为什么更好，15 字内","meaning":"新字的意思和合起来的意思，一两句","loss":"损失什么，一句"}]}`,
  ].join("\n");
}

function clampDims(raw: unknown): SimpleDim[] | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return null;
  const out: SimpleDim[] = [];
  for (const d of DIMS) {
    const v = o[d.key] as Record<string, unknown> | number | undefined;
    const n = typeof v === "number" ? v : typeof v?.score === "number" ? v.score : NaN;
    if (!Number.isFinite(n)) return null;
    out.push({ label: d.label, max: d.max, score: Math.max(0, Math.min(d.max, Math.round(n))), reason: typeof v === "object" ? str(v.reason, 60) : "" });
  }
  return out;
}

/** 规则确认的问题（谐音「肚子疼」、和反面人物同名这种）模型漏写时补上：主播一定要知道 */
function withRuleIssues(issues: SimpleIssue[], facts: NameFacts): SimpleIssue[] {
  const out = [...issues];
  for (const it of facts.issues) {
    if (it.severity === "plain") continue;
    const key = it.chars.join("");
    if (out.some((x) => (key && x.text.includes(key)) || x.text.slice(0, 6) === it.line.slice(0, 6))) continue;
    out.push({ text: it.line, importance: it.severity === "severe" ? "major" : "minor" });
  }
  return out.slice(0, 4);
}

function buildAnalysis(j: Record<string, unknown>, facts: NameFacts): SimpleAnalysis | null {
  const dims = clampDims(j.dims);
  if (!dims) return null;
  const total = dims.reduce((n, d) => n + d.score, 0);
  const b = bandOf(total);
  const issues = (Array.isArray(j.issues) ? j.issues : [])
    .map((x) => (typeof x === "string" ? { text: str(x, 120), importance: "minor" as const } : { text: str((x as Record<string, unknown>).text, 120), importance: (x as Record<string, unknown>).importance === "major" ? ("major" as const) : ("minor" as const), ...(str((x as Record<string, unknown>).kind, 4) ? { kind: str((x as Record<string, unknown>).kind, 4) } : {}) }))
    .filter((x) => x.text)
    .slice(0, 3);
  return {
    total, band: b.band, bandLabel: b.label, dims,
    comment: str(j.comment, 200), strengths: strs(j.strengths, 3), issues: withRuleIssues(issues, facts),
    reminders: strs(j.reminders, 2), charMeaning: str(j.charMeaning, 120),
  };
}

/** 改法：姓不动、只动一个字（单名可以加一个字）、没有硬伤、比原名分高 */
function checkFix(raw: Record<string, unknown>, facts: NameFacts, gender: "male" | "female", base: number): SimpleFix | null {
  const full = str(raw.fullName, 6);
  if (!full.startsWith(facts.surname)) return null;
  const given = full.slice(facts.surname.length);
  const a = [...facts.givenName];
  const b = [...given];
  let kind: SimpleFix["kind"];
  let from = "";
  let to = "";
  if (b.length === a.length) {
    const diff = b.map((c, i) => (c === a[i] ? -1 : i)).filter((i) => i >= 0);
    if (diff.length !== 1) return null;
    kind = "swap";
    from = a[diff[0]!]!;
    to = b[diff[0]!]!;
  } else if (a.length === 1 && b.length === 2 && b.includes(a[0]!) && b[0] !== b[1]) {
    kind = "add";
    to = b.find((c) => c !== a[0])!;
  } else return null;
  const score = typeof raw.score === "number" ? Math.round(raw.score) : NaN;
  if (!Number.isFinite(score) || score <= base || score > 100) return null;
  if (!hardProblems(facts.surname, given, gender).keep) return null;
  return {
    fullName: full, givenName: given, pinyin: fullNamePinyin(facts.surname, given).text, kind, from, to, score,
    why: str(raw.why, 40), meaning: str(raw.meaning, 160), ...(str(raw.loss, 60) ? { loss: str(raw.loss, 60) } : {}),
  };
}

/** 流里先拿到 dims 就先出分：dims 写完是一个完整的对象，不等后面 */
function earlyDims(buf: string): SimpleDim[] | null {
  const m = buf.match(/"dims"\s*:\s*\{/);
  if (!m || m.index === undefined) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const start = m.index + m[0].length - 1;
  for (let i = start; i < buf.length; i++) {
    const ch = buf[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return clampDims(parseObject(buf.slice(start, i + 1)));
  }
  return null;
}

export async function evaluateSimple(
  input: { fullName: string; gender: "male" | "female" | "unknown"; surnameOverride?: string },
  opts: { pinned?: SimpleAnalysis; signal?: AbortSignal } = {},
  cb: {
    onFacts?: (f: NameFacts) => void;
    onThought?: (t: string) => void;
    onAnalysis?: (a: SimpleAnalysis) => void;
    onFix?: (f: SimpleFix) => void;
  } = {},
): Promise<SimpleEvalResult> {
  const t0 = Date.now();
  const split = resolveSplit(input.fullName, input.surnameOverride);
  if (!split) throw new Error("姓名无法拆分");
  const facts = buildFacts(split, scoreName(split, input.gender));
  cb.onFacts?.(facts);
  if (input.gender === "unknown") {
    return { facts, analysis: null, fixes: [], status: "needs_gender", note: "请先确认是男宝还是女宝，再打分。", tookMs: Date.now() - t0 };
  }
  const gender = input.gender;
  let analysis: SimpleAnalysis | null = opts.pinned ?? null;
  let shownEarly = false;
  let buf = "";
  const fixes: SimpleFix[] = [];
  const takeFix = (raw: Record<string, unknown>) => {
    if (!analysis || fixes.length >= 2) return;
    const f = checkFix(raw, facts, gender, analysis.total);
    if (f && !fixes.some((x) => x.givenName === f.givenName)) {
      fixes.push(f);
      cb.onFix?.(f);
    }
  };
  try {
    const r = await simpleCall(evalPrompt(facts, gender, opts.pinned), {
      onThinking: thoughtSplitter((line) => cb.onThought?.(line)),
      onContent: (chunk) => {
        buf += chunk;
        if (!analysis && !shownEarly) {
          const dims = earlyDims(buf);
          if (dims) {
            shownEarly = true;
            const total = dims.reduce((n, d) => n + d.score, 0);
            const b = bandOf(total);
            cb.onAnalysis?.({ total, band: b.band, bandLabel: b.label, dims, comment: "", strengths: [], issues: withRuleIssues([], facts), reminders: [], charMeaning: "" });
          }
        }
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const j = r.json;
    if (!j) return { facts, analysis, fixes, status: "error", note: `${failText(r.finishReason)}，可以再试一次。`, tookMs: Date.now() - t0 };
    if (!opts.pinned) {
      analysis = buildAnalysis(j, facts);
      if (!analysis) return { facts, analysis: null, fixes, status: "error", note: "模型没给全八个方面的分，可以再试一次。", tookMs: Date.now() - t0 };
      cb.onAnalysis?.(analysis);
    }
    for (const f of (Array.isArray(j.fixes) ? j.fixes : []) as Record<string, unknown>[]) takeFix(f);
  } catch (err) {
    const message = err instanceof Error ? err.message : "评价没成功";
    return { facts, analysis, fixes, status: /超时/.test(message) ? "timeout" : "error", note: message, tookMs: Date.now() - t0 };
  }
  const a = analysis!;
  if (fixes.length) return { facts, analysis: a, fixes, status: "options", tookMs: Date.now() - t0 };
  return {
    facts, analysis: a, fixes, status: "no_better", tookMs: Date.now() - t0,
    note: a.total >= 90 ? "这个名字已经很好，不用改。" : "这次没写出比原名好的改法，可以再试一次。",
  };
}
