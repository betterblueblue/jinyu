import { nanoid } from "nanoid";
import { buildBaziSummary } from "../bazi";
import type { AnalysisProvider } from "@/providers/analysis-provider";
import { corpusCatalog, verifyCitation } from "./corpus";
import { isCjk } from "./chars";
import { normalizeRawCitations, normalizeRawIssues } from "./prompt";
import { buildLocalChecks } from "./rules";
import { splitFullName } from "./split-name";
import type {
  AnalysisGender,
  AnalysisInput,
  AnalysisOutcome,
  AnalysisResult,
  NameIssue,
  RejectedCitation,
  Verdict,
  VerifiedCitation,
} from "./types";

/**
 * 名字分析的编排。
 *
 * 分工：本地查表算笔画、字集、性别倾向；模型看谐音、字义、年代感、措辞；
 * 引文一律回到原文逐字核验，核不过的删掉。
 *
 * 结论档次由这里算出来，不由模型说了算——模型只能提供「问题」，
 * 有没有硬伤、算不算只是代价，是规则判的。
 */

/** 分数、术语、圆场话，一律不许出现在结论句里 */
const BANNED_IN_VERDICT =
  /(总体来说|综合来看|不失为一个|打分|评分|\d+\s*分|五格|三才|数理|五行|音韵|格局|阴平|阳平|上声|去声|GB|字表|字符集|编码)/;

const SOFT_ENDING = /(能用|还行|还可以|整体不错|总体上|挺好的|没啥问题|问题不大)/;

export function isBannedVerdict(text: string): boolean {
  return BANNED_IN_VERDICT.test(text) || SOFT_ENDING.test(text);
}

/**
 * 版面感：中文里的半角逗号分号改成全角，数字和汉字之间留空格。
 * 模型经常把「登12画」写成连着的，屏幕上很挤。
 */
function tidy(text: string): string {
  return text
    .replace(/([\u4e00-\u9fa5])(\d)/g, "$1 $2")
    .replace(/(\d)([\u4e00-\u9fa5])/g, "$1 $2")
    // 汉字之间不该有空格：「周子衿 没有硬伤」是模型输出的残留
    .replace(/([\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/(?<!\d),(?!\d)/g, "，")
    .replace(/(?<!\d);/g, "；")
    .replace(/(?<!\d):(?!\d)/g, "：")
    .replace(/(?<!\d)\?(?!\d)/g, "？")
    .replace(/(?<!\d)!(?!\d)/g, "！")
    .replace(/，{2,}/g, "，")
    .replace(/\s{2,}/g, " ");
}

function cleanLine(text: string, maxLen: number): string {
  return tidy(text.replace(/[《》]/g, "").replace(/\s+/g, " ").trim()).slice(0, maxLen);
}

export function validateAnalysisInput(raw: {
  fullName?: unknown;
  gender?: unknown;
  birthDate?: unknown;
  birthHour?: unknown;
  splitSurname?: unknown;
}): { ok: true; input: AnalysisInput } | { ok: false; message: string } {
  const fullName = String(raw.fullName ?? "").replace(/\s/g, "");
  if (!fullName) return { ok: false, message: "请填写姓名" };
  if (fullName.length < 2 || fullName.length > 4) return { ok: false, message: "姓名请填两到四个字" };
  for (const ch of fullName) {
    if (!isCjk(ch)) return { ok: false, message: "姓名里只能有汉字" };
  }
  const gender: AnalysisGender =
    raw.gender === "male" || raw.gender === "female" ? raw.gender : "unknown";

  const birthDate = typeof raw.birthDate === "string" && raw.birthDate ? raw.birthDate : undefined;
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { ok: false, message: "生日请填公历，格式 1998-03-05" };
  }

  // 界面上的拆法切换：只接受姓的前缀，避免把整名拆成不合法的形状
  const rawSurname = typeof raw.splitSurname === "string" ? raw.splitSurname.replace(/\s/g, "") : "";
  const surnameOverride =
    rawSurname && rawSurname.length <= 2 && fullName.startsWith(rawSurname) && fullName.length > rawSurname.length
      ? rawSurname
      : undefined;

  return {
    ok: true,
    input: {
      fullName,
      gender,
      ...(birthDate ? { birthDate } : {}),
      ...(typeof raw.birthHour === "string" && raw.birthHour ? { birthHour: raw.birthHour } : {}),
      ...(surnameOverride ? { surnameOverride } : {}),
    },
  };
}

/** 本地已经覆盖的话题：模型重复说同一件事时按话题丢掉 */
function topicOf(issue: { kind: string; text: string }): string | null {
  if (issue.kind === "gender") return "gender";
  if (/画/.test(issue.text)) return "strokes";
  if (/(打不出来|打不出|录入|方框|生僻|不在最常用|次常用|不常用)/.test(issue.text)) return "charset";
  return null;
}

function verdictFrom(issues: NameIssue[]): Verdict {
  if (issues.some((i) => i.severity === "hard")) return "hard";
  if (issues.length > 0) return "cost";
  return "fit";
}

const CN_COUNT = ["", "一", "两", "三", "四", "五"];

/** 兜底文案里的数量必须跟实际问题条数一致，不能写死「两处」 */
function countPhrase(n: number): string {
  return n >= 1 && n <= 5 ? `${CN_COUNT[n]}处` : `${n} 处`;
}

function fallbackHeadline(verdict: Verdict, fullName: string, issueCount: number): string {
  if (verdict === "hard") return `${fullName}这个名字有一处真麻烦，其余部分倒是不用动。`;
  if (verdict === "cost") {
    return `${fullName}没有硬伤，但${countPhrase(issueCount || 1)}代价，叫一辈子都要付。`;
  }
  return `${fullName}挑不出毛病，真要往前走一步是在「贴不贴这个姓」上。`;
}

function fallbackClosing(verdict: Verdict, split: { surname: string; givenName: string }): string {
  if (verdict === "hard") return "这一处不改会一直跟着，剩下的字可以留着。";
  // 不假定该动的是末字：有的问题出在头一个字上，具体动哪个交给模型写的句子
  if (verdict === "cost") return `想改的话，动名字里的一个字就够，「${split.surname}」不用碰。`;
  return `名字本身没问题，差的是它跟「${split.surname}」还没长在一起。`;
}

function fallbackFitAngle(surname: string): string {
  return `要说还能往哪走一步，是它跟「${surname}」的搭配还没做出非这个姓不可的味道——换个姓也能用，说明姓还没参与进来。`;
}

export async function runAnalysis(
  input: AnalysisInput,
  provider: AnalysisProvider,
  onThinking?: (chunk: string) => void,
  onStage?: (stage: "verifying") => void,
): Promise<AnalysisOutcome> {
  const splitOutcome = splitFullName(input.fullName);
  if (!splitOutcome.ok || !splitOutcome.split) {
    return { ok: false, errorCode: "BAD_NAME", message: splitOutcome.message ?? "姓名无法拆分" };
  }
  let split = splitOutcome.split;
  if (input.surnameOverride) {
    const rest = input.fullName.slice(input.surnameOverride.length);
    if (rest) {
      split = {
        surname: input.surnameOverride,
        givenName: rest,
        alternatives: [split, ...split.alternatives].filter(
          (a, i, all) => a.surname !== input.surnameOverride && all.findIndex((x) => x.surname === a.surname) === i,
        ),
      };
    }
  }

  const local = buildLocalChecks(split, input.gender);

  // 生辰：只在填了生日时排盘，排不出来就整块丢掉，不打断分析
  let baziText: string | undefined;
  if (input.birthDate) {
    const bazi = buildBaziSummary({
      baziEnabled: true,
      birthStatus: "born",
      birthDate: input.birthDate,
      birthHour: input.birthHour,
    });
    if (bazi.ok && bazi.summary) baziText = bazi.summary.pillarsText;
  }

  const catalog = corpusCatalog()
    .filter((s) => s.available)
    .map((s) => s.name);

  let raw;
  try {
    raw = await provider.analyze(
      {
        fullName: input.fullName,
        surname: split.surname,
        givenName: split.givenName,
        gender: input.gender,
        facts: local.facts,
        ...(baziText ? { baziText } : {}),
        catalog,
      },
      onThinking,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "分析失败";
    return { ok: false, errorCode: "ANALYSIS_ERROR", message: `分析过程出错：${message}` };
  }

  if (!raw) {
    return { ok: false, errorCode: "BAD_MODEL_OUTPUT", message: "模型没有返回可用的分析结果，请重试" };
  }

  // ---- 问题：本地 + 模型，去重后按严重度排序 ----
  // 本地已经查实的东西（笔画、字集、性别倾向）不再收模型说的同一件事，
  // 否则一份结果里会出现两条「笔画太重」，读起来像凑数。
  const localTopics = new Set(local.issues.map(topicOf).filter((t): t is string => Boolean(t)));

  const modelIssues: NameIssue[] = normalizeRawIssues(raw.issues)
    .map((i) => ({
      kind: i.kind as NameIssue["kind"],
      severity: i.severity as NameIssue["severity"],
      text: cleanLine(i.text, 90),
      ...(i.hint ? { hint: cleanLine(i.hint, 60) } : {}),
    }))
    .filter((i) => i.text.length >= 6)
    .filter((i) => {
      const topic = topicOf(i);
      return !(topic && localTopics.has(topic));
    });

  const issues: NameIssue[] = [...local.issues, ...modelIssues]
    .filter((issue, index, all) => all.findIndex((x) => x.text === issue.text) === index)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1))
    .slice(0, 5);

  const verdict = verdictFrom(issues);

  // ---- 引文：逐条回原文核验 ----
  onStage?.("verifying");
  const citations: VerifiedCitation[] = [];
  const rejectedCitations: RejectedCitation[] = [];
  for (const claim of normalizeRawCitations(raw.citations)) {
    const outcome = verifyCitation(claim);
    if (outcome.ok) {
      if (citations.length < 2) citations.push(outcome.citation);
    } else {
      rejectedCitations.push(outcome.rejected);
    }
  }

  // ---- 文案：模型写的，但要过规则 ----
  let headline = cleanLine(raw.headline ?? "", 70);
  if (!headline || isBannedVerdict(headline)) headline = fallbackHeadline(verdict, input.fullName, issues.length);
  if (verdict === "hard" && /(没有硬伤|没问题|挑不出)/.test(headline)) {
    headline = fallbackHeadline(verdict, input.fullName, issues.length);
  }

  let closing = cleanLine(raw.closing ?? "", 70);
  if (!closing || isBannedVerdict(closing)) closing = fallbackClosing(verdict, split);

  const goodPoints = Array.isArray(raw.goodPoints)
    ? raw.goodPoints
        .map((g) => cleanLine(String(g), 80))
        .filter((g) => g.length >= 6)
        .slice(0, 3)
    : [];

  let fitAngle: string | undefined;
  if (verdict === "fit") {
    const candidate = cleanLine(raw.fitAngle ?? "", 120);
    // 贴合角度必须落到姓氏上，只说「还能更独特」等于万能话术
    fitAngle = candidate.includes(split.surname) ? candidate : fallbackFitAngle(split.surname);
  }

  // ---- 交给取名用的约束 ----
  const taboo = new Set<string>();
  for (const item of Array.isArray(raw.regenBrief?.tabooChars) ? raw.regenBrief.tabooChars : []) {
    const ch = String(item).trim();
    if (ch.length === 1 && split.givenName.includes(ch)) taboo.add(ch);
  }
  for (const fact of local.facts.chars) {
    if (fact.gb === 0 && split.givenName.includes(fact.char)) taboo.add(fact.char);
  }
  if (verdict === "hard") {
    for (const fact of local.facts.lean) {
      if (fact.lean !== "neutral") taboo.add(fact.char);
    }
  }

  const requirementsRaw = typeof raw.regenBrief?.requirements === "string" ? raw.regenBrief.requirements : "";
  const result: AnalysisResult = {
    id: nanoid(10),
    createdAt: new Date().toISOString(),
    input,
    split,
    verdict,
    headline,
    goodPoints,
    issues,
    citations,
    rejectedCitations,
    closing,
    ...(fitAngle ? { fitAngle } : {}),
    regenBrief: {
      tabooChars: [...taboo].slice(0, 4),
      requirements: cleanLine(requirementsRaw, 60) || "声音更亮，避开同调字",
      avoidPopular: raw.regenBrief?.avoidPopular === true || verdict !== "fit",
    },
    facts: local.facts,
    providerName: provider.name,
  };

  return { ok: true, result };
}
