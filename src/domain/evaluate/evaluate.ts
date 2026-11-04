import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { resolveSplit, scoreName } from "@/domain/score/score";
import { buildFacts } from "./facts";
import { parseOriginal, parseScores, scoresFromOriginal, type ParsedScores } from "./prompt";
import type { EvaluateProvider } from "./provider";
import { applyAgePenalty, scoreBreakdown } from "./scoring";
import { verifyCandidate } from "./verify";
import type {
  EvalCandidate,
  EvalIssue,
  EvaluateResult,
  NameFacts,
  OriginalEvaluation,
  RawCandidate,
  RawEvaluation,
  RawOriginal,
  RejectedCandidate,
} from "./types";

/**
 * 一次完整评价的编排（2026-11-04）。
 *
 * 规则出事实 → 一次模型调用 → 程序核验、算分、压上限。
 * 一次调用里按 scores → original → options 的顺序流式交回：
 *   分数先出，理由随后，候选最后逐条到。
 * 试过拆两次调用，第二次单独跑要 15–17 秒，总时间翻倍，改回一次。
 *
 * 性别没填不调模型：先返回基础材料，让主播问一句是男宝还是女宝。
 * 模型不输出分数，总分和上限都在这里算。
 */

export interface EvaluateInput {
  fullName: string;
  gender: "male" | "female" | "unknown";
  splitSurname?: string;
}

export interface EvaluateOptions {
  /** 最多收几个候选。直播只收 2 个，模型多给的丢掉 */
  maxCandidates?: number;
}

export interface EvaluateCallbacks {
  /** 只拿到四个档位时：先给分数和维度 */
  onScores?: (original: OriginalEvaluation) => void;
  /** 完整原名评价（理由、优点、问题） */
  onOriginal?: (original: OriginalEvaluation) => void;
  /** 核过一个候选就交一个 */
  onOption?: (candidate: EvalCandidate) => void;
  /** 模型推理里正在看的判断，一句一条，给主播照着念 */
  onThought?: (text: string) => void;
}

const STATUS_NOTE: Record<string, string> = {
  no_better: "原名可以用，这轮没有比它更值得换的。",
  all_rejected: "模型给的改法没有比原名更好，可以再试一次。",
  one_char_insufficient: "只改一个字解决不了已经指出的问题。",
  needs_gender: "请先确认是男宝还是女宝，再做完整评价。",
  timeout: "改法没在时限内写完，原名评价已经保留。",
  error: "改法没写成，原名评价已经保留。",
};

function dedupeKey(text: string): string {
  return text.replace(/[「」『』“”"，。；：、！？,.;:]/g, "").slice(0, 10);
}

/** 模型新写的问题如果和规则已确认的是同一类（年代、谐音、性别……），就不重复列 */
const RULE_HINTS: { pattern: RegExp; rules: string[] }[] = [
  { pattern: /年代|老气|上一辈|爸妈那辈|七八十年代/, rules: ["era", "eraName"] },
  { pattern: /谐音|念起来像|听着像/, rules: ["homophone", "trap"] },
  { pattern: /中性|女孩感|女性辨识|男孩感|男性辨识/, rules: ["gender"] },
  { pattern: /重名|撞名|烂大街/, rules: ["template", "hot", "singleName"] },
  { pattern: /生僻|不认识|打不出来/, rules: ["rare"] },
  { pattern: /念错|多音|读错/, rules: ["misread"] },
  { pattern: /同调|一个调|声调|平声|没起伏|没有起伏/, rules: ["flatTone", "sandhi"] },
];

function sameKindAsRule(text: string, rules: Set<string>): boolean {
  return RULE_HINTS.some((h) => h.pattern.test(text) && h.rules.some((r) => rules.has(r)));
}

/**
 * 模型写的问题要具体：提到名里的某个字，或者属于读音、谐音、重名、年代、性别这些有依据的类别。
 * 「整体偏静，少了明亮感」这种没有具体对象的话直接丢掉，免得主播念出来像找茬（2026-11-04 用户定）。
 */
function isSpecific(text: string, givenName: string): boolean {
  if ([...givenName].some((c) => text.includes(c))) return true;
  return /读音|谐音|重名|撞名|年代|性别|辨识|生僻|念错|多音|同调|声调|连姓/.test(text);
}

function mergeIssues(facts: NameFacts, modelIssues: { text: string; importance: "major" | "minor" }[]): EvalIssue[] {
  const out: EvalIssue[] = facts.issues.map((it) => ({
    id: it.id,
    text: it.line,
    importance: it.severity === "plain" ? "minor" : "major",
    source: "rule",
  }));
  const ruleSet = new Set(facts.issues.map((it) => it.rule));
  let n = 0;
  for (const mi of modelIssues) {
    // 模型有时把编号当问题文本写回来（"R1" 或 "R1：原文"），这不是新问题
    if (/^R\d+\s*$/i.test(mi.text)) continue;
    const text = mi.text.replace(/^R\d+\s*[:：]\s*/i, "").trim();
    const k = dedupeKey(text);
    if (!k) continue;
    if (!isSpecific(text, facts.givenName)) continue;
    if (sameKindAsRule(text, ruleSet)) continue;
    if (out.some((it) => dedupeKey(it.text).includes(k) || k.includes(dedupeKey(it.text)))) continue;
    out.push({ id: `M${++n}`, text, importance: mi.importance, source: "model" });
  }
  return out;
}

function mergeReminders(facts: NameFacts, modelReminders: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...facts.reminders, ...modelReminders]) {
    const k = dedupeKey(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.slice(0, 4);
}

function buildOriginal(
  facts: NameFacts,
  tiers: NonNullable<ReturnType<typeof parseOriginal>["tiers"]>,
  strengths: string[],
  issues: EvalIssue[],
  reminders: string[],
  charMeaning = "",
  whole = "",
  comment = "",
): OriginalEvaluation {
  const scores = scoreBreakdown(facts, tiers, { styleBaseline: true });
  // 模型说整名像上一辈、菜市场名、口号或职业词：规则表可能没收录（志明、俊杰），这里再压一档
  const modelAge = issues.some(
    (it) => it.source === "model" && /上一辈|老一辈|父辈|爸妈那辈|爷爷奶奶|菜市场|口号|军种|职业词/.test(it.text),
  );
  return {
    // 风格只用于改法排序，不压原名总分
    scores: modelAge ? applyAgePenalty(scores) : scores,
    tiers,
    strengths,
    issues,
    reminders,
    ...(charMeaning ? { charMeaning } : {}),
    ...(whole ? { whole } : {}),
    ...(comment ? { comment } : {}),
  };
}

function candidateList(raw: unknown, max: number): RawCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is RawCandidate => Boolean(x) && typeof x === "object" && !Array.isArray(x)).slice(0, max);
}

export async function evaluateName(
  input: EvaluateInput,
  provider: EvaluateProvider,
  options: EvaluateOptions = {},
  callbacks: EvaluateCallbacks = {},
): Promise<EvaluateResult> {
  const maxCandidates = Math.max(1, Math.min(2, options.maxCandidates ?? 2));
  const started = Date.now();
  const empty = (status: EvaluateResult["status"], facts: NameFacts, note?: string): EvaluateResult => ({
    facts,
    status,
    original: null,
    candidates: [],
    rejected: [],
    ...(note ? { note } : {}),
    tookMs: Date.now() - started,
  });

  const checked = validateAnalysisInput(input);
  if (!checked.ok) {
    // 输入本身不合法时没有事实可给；调用方应该先校验，这里退化成空事实
    throw new Error(checked.message);
  }
  const split = resolveSplit(checked.input.fullName, checked.input.surnameOverride);
  if (!split) throw new Error("姓名无法拆分");
  const score = scoreName(split, checked.input.gender);
  const facts = buildFacts(split, score);

  if (checked.input.gender === "unknown") return empty("needs_gender", facts, STATUS_NOTE.needs_gender);

  let early: OriginalEvaluation | null = null;
  let complete = false;
  let latestScores: ParsedScores | null = null;
  let currentOriginal: OriginalEvaluation | null = null;

  const candidates: EvalCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  /** 候选比原名评价先到（顺序乱了）时先攒着，等评价到了再验 */
  const pending: RawCandidate[] = [];

  const takeOption = (rawC: RawCandidate) => {
    if (!currentOriginal) {
      if (pending.length < 4) pending.push(rawC);
      return;
    }
    if (candidates.length >= maxCandidates) return;
    const out = verifyCandidate(rawC, facts, currentOriginal);
    if (out.candidate) {
      if (!candidates.some((c) => c.givenName === out.candidate!.givenName)) {
        candidates.push(out.candidate);
        callbacks.onOption?.(out.candidate);
      }
    } else {
      rejected.push(out.rejected);
    }
  };

  const handleScores = (scores: ParsedScores) => {
    latestScores = scores;
    if (early) return;
    const built = buildOriginal(
      facts,
      {
        pronunciation: { tier: scores.pronunciation, reason: "" },
        meaning: { tier: scores.meaning, reason: "" },
        gender: { tier: scores.gender, reason: "" },
        style: { tier: scores.style, reason: "" },
      },
      [],
      mergeIssues(facts, []),
      mergeReminders(facts, []),
    );
    early = built;
    currentOriginal = built;
    callbacks.onScores?.(built);
  };

  const handleRawOriginal = (rawO: RawOriginal) => {
    if (complete) return;
    const s = latestScores ?? scoresFromOriginal(rawO);
    if (!s) return;
    const p = parseOriginal(s, rawO);
    if (!p.tiers) return;
    const built = buildOriginal(
      facts,
      p.tiers,
      p.strengths,
      mergeIssues(facts, p.issueTexts),
      mergeReminders(facts, p.reminders),
      p.charMeaning,
      p.whole,
      p.comment,
    );
    complete = true;
    early = built;
    currentOriginal = built;
    callbacks.onOriginal?.(built);
    for (const rc of pending.splice(0)) takeOption(rc);
  };

  let raw: RawEvaluation | null;
  try {
    raw = await provider.evaluate(facts, handleScores, handleRawOriginal, takeOption, callbacks.onThought);
  } catch (err) {
    const message = err instanceof Error ? err.message : "评价没成功";
    if (early) {
      return {
        facts,
        status: /超时/.test(message) ? "timeout" : "error",
        original: early,
        candidates,
        rejected,
        note: message,
        tookMs: Date.now() - started,
      };
    }
    return empty(/超时/.test(message) ? "timeout" : "error", facts, message);
  }
  if (!raw) {
    if (early) {
      return { facts, status: "error", original: early, candidates, rejected, note: "整份没写完，原名评价已保留", tookMs: Date.now() - started };
    }
    return empty("error", facts, "模型没给出结果");
  }

  const parsedScores = parseScores(raw.scores) ?? scoresFromOriginal(raw.original);
  const parsed = parseOriginal(parsedScores, raw.original);
  if (!parsed.tiers) {
    if (early) {
      return { facts, status: "error", original: early, candidates, rejected, note: "整份没写完，原名评价已保留", tookMs: Date.now() - started };
    }
    return empty("error", facts, "模型没给出完整的四维评价");
  }

  const issues = mergeIssues(facts, parsed.issueTexts);
  const original =
    complete && early
      ? early
      : buildOriginal(
          facts,
          parsed.tiers,
          parsed.strengths,
          issues,
          mergeReminders(facts, parsed.reminders),
          parsed.charMeaning,
          parsed.whole,
          parsed.comment,
        );
  if (!complete) callbacks.onOriginal?.(original);
  currentOriginal = original;

  for (const rc of pending.splice(0)) takeOption(rc);
  // 不按分数重排：模型给的顺序就是推荐顺序，第一个是首选
  for (const rc of candidateList(raw.options, maxCandidates)) {
    if (candidates.length >= maxCandidates) break;
    takeOption(rc);
  }

  const status: EvaluateResult["status"] =
    candidates.length > 0
      ? "options"
      : // 原名已经很好（85+），候选比不过很正常，不该显示成「改法没通过核验」
        original.scores.total >= 85
        ? "no_better"
        : raw.status === "one_char_insufficient"
          ? "one_char_insufficient"
          : raw.status === "no_better"
            ? "no_better"
            : rejected.length > 0
              ? "all_rejected"
              : "no_better";

  const note =
    candidates.length === 0 && original.scores.total >= 85
      ? "原名已经很好了，这轮没有比它更值得换的。"
      : typeof raw.note === "string" && raw.note.trim()
        ? raw.note.replace(/\s+/g, "").trim().slice(0, 120)
        : STATUS_NOTE[status];

  return {
    facts,
    status,
    original,
    candidates,
    rejected,
    ...(note ? { note } : {}),
    tookMs: Date.now() - started,
  };
}
