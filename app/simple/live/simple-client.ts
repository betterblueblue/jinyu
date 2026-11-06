import type { NameFacts } from "@/domain/evaluate/types";
import type { FastFailure, FastSuccess } from "@/fast/types";
import type { LiveEvent } from "@/live/live-log";
import type { PrompterDictEntry, PrompterRound, PrompterScoreRound } from "@/live/prompter";
import type { SimpleAnalysis, SimpleEvalResult, SimpleFix, SimpleStatus } from "@/simple/evaluate";

/**
 * 简化版页面在浏览器里用的几样东西（2026-11-06）：记日志、推提词页、读打分流、把打分结果转成提词页的样子。
 * 都发到 /api/simple/...，和现在的系统分开。显示仍用现在的 ScoreView（app/live/prompter/score-view.tsx，只读引用）。
 */

/** 记一条直播日志，写到 data/simple/live-log。不等、不报错 */
export function logLive(event: LiveEvent): void {
  void fetch("/api/simple/live/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}

/** 推给简化版提词页；推不上不影响直播台 */
export function pushPrompter(round: PrompterRound): void {
  void fetch("/api/simple/live/prompter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(round),
    keepalive: true,
  }).catch(() => undefined);
}

export interface SimpleEvalHandlers {
  onFacts?: (facts: NameFacts) => void;
  onThought?: (text: string) => void;
  onAnalysis?: (a: SimpleAnalysis) => void;
  onFix?: (f: SimpleFix) => void;
}

/**
 * 读 /api/simple/fast 的 NDJSON：写好一个名字、去掉一个名字都当场交给 onFrame（直播台等待页上一行一行出来），最后是结果。
 * 观众看得见这几行，所以写「写好了第几个」，名字本身留到揭晓。
 */
export async function readSimpleFast(res: Response, onFrame: (text: string) => void): Promise<FastSuccess | FastFailure | null> {
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    return (await res.json().catch(() => null)) as FastSuccess | FastFailure | null;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let payload: FastSuccess | FastFailure | null = null;
  let written = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m: { type?: string; kept?: { citation?: unknown; library?: unknown }; dropped?: { name: string; reasons: string[] }; result?: FastSuccess | FastFailure };
      try {
        m = JSON.parse(line) as typeof m;
      } catch {
        continue;
      }
      if (m.type === "stage" && m.kept) onFrame(`第 ${++written} 个名字写好了${m.kept.citation ? "，出处逐字核过" : ""}`);
      else if (m.type === "stage" && m.dropped) onFrame(`去掉一个：${m.dropped.reasons[0] ?? "不合适"}`);
      else if (m.type === "result" && m.result) payload = m.result;
    }
  }
  return payload;
}

/** 读 /api/simple/evaluate 的 NDJSON；不是流（未登录、参数错）就按 JSON 读，返回 null */
export async function readSimpleEvaluateStream(res: Response, h: SimpleEvalHandlers): Promise<Partial<SimpleEvalResult> | null> {
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) return null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: Partial<SimpleEvalResult> | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m: { type?: string; facts?: NameFacts; text?: string; analysis?: SimpleAnalysis; fix?: SimpleFix; result?: Partial<SimpleEvalResult> };
      try {
        m = JSON.parse(line) as typeof m;
      } catch {
        continue;
      }
      if (m.type === "facts" && m.facts) h.onFacts?.(m.facts);
      else if (m.type === "thought" && m.text) h.onThought?.(m.text);
      else if (m.type === "analysis" && m.analysis) h.onAnalysis?.(m.analysis);
      else if (m.type === "fix" && m.fix) h.onFix?.(m.fix);
      else if (m.type === "result" && m.result) result = m.result;
    }
  }
  return result;
}

const STATUS_WORD: Record<SimpleStatus, string> = {
  options: "还能更好",
  no_better: "还能更好",
  needs_gender: "先确认性别",
  error: "没评完",
  timeout: "超时",
};

export interface SimpleRowForPrompter {
  no: number;
  facts: NameFacts;
  analysis: SimpleAnalysis | null;
  fixes: SimpleFix[];
  status?: SimpleStatus;
  note?: string;
  thoughts: string[];
  dictionary?: PrompterDictEntry[];
}

/**
 * 简化版打分结果 → 提词页打分稿（和现在 prompterFromEvaluation 同一个形状，ScoreView 照样画）。
 * 八个维度都显示；点评、拆字是模型写的，先到的只有八维分时标「还在写」。
 */
export function prompterFromSimple(s: SimpleRowForPrompter): PrompterScoreRound {
  const a = s.analysis;
  const status = s.status;
  const running = status === undefined;
  const writing = Boolean(a && running && !a.comment);
  const meritLines = a ? [a.comment, a.charMeaning].filter(Boolean) : [];
  const options = s.fixes.map((f) => ({
    full: f.fullName,
    pinyin: f.pinyin,
    change: `${f.kind === "add" ? `单名加一个「${f.to}」变双名` : `${f.from} → ${f.to}`}${f.why ? ` · ${f.why}` : ""}`,
    score: f.score,
    meaning: f.meaning,
    ...(f.loss ? { loss: f.loss } : {}),
  }));
  let say: string | undefined;
  if (status === "needs_gender") say = "先问一句：是男宝还是女宝？选好性别再打一次分。";
  else if (status === "options") say = a && a.issues.length ? "毛病在哪说清楚了，往下看改法。" : "这个名字整体不错。";
  else if (status === "no_better") say = s.note;
  else if (status === "error" || status === "timeout") say = "评价没完成，先念上面已经出来的部分。";
  return {
    state: "score",
    no: s.no,
    full: s.facts.fullName,
    pinyin: s.facts.pinyin,
    score: a?.total ?? 0,
    bandLabel: a?.bandLabel ?? (status ? STATUS_WORD[status] : "评价中"),
    ...(s.dictionary?.length ? { dictionary: s.dictionary.slice(0, 4) } : {}),
    ...(a ? { dimensions: a.dims.map((d) => ({ label: d.label, score: d.score, max: d.max, ...(d.reason ? { reason: d.reason } : {}) })) } : {}),
    ...(s.thoughts.length && (running || !a?.comment) ? { thinking: s.thoughts.slice(-6) } : {}),
    ...(a?.strengths.length ? { strengths: a.strengths } : {}),
    ...(a
      ? a.issues.length
        ? { issues: a.issues }
        : {}
      : s.facts.issues.length
        ? { issues: s.facts.issues.map((it) => ({ text: it.line, importance: it.severity === "plain" ? ("minor" as const) : ("major" as const) })) }
        : {}),
    ...(a?.reminders.length ? { reminders: a.reminders } : {}),
    ...(a && (writing || meritLines.length) ? { merit: { writing, lines: writing ? [] : meritLines } } : {}),
    ...(status === "needs_gender" ? { genderAsk: "没填性别，先问是男宝还是女宝，再打一次分。" } : {}),
    deductions: [],
    folk: s.facts.reminders.slice(0, 4),
    ...(say ? { say } : {}),
    ...(a ? { fix: { running, options, ...(status && status !== "options" && s.note && status !== "no_better" ? { note: s.note } : {}) } } : {}),
  };
}
