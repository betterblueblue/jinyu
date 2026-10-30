import type { ChatMessage } from "@/providers/chat";
import type { AnalysisFacts, AnalysisGender } from "./types";

/**
 * 名字分析的提示词。
 *
 * 三条硬约束写在这里，也在 analyze.ts 里做机器校验：
 *   1. 说人话——不许出现术语和分数
 *   2. 结论放在第一句，不替人圆场
 *   3. 引文必须是原文，篇名要对得上，核验不过的直接丢掉
 */

export interface AnalysisPromptInput {
  fullName: string;
  surname: string;
  givenName: string;
  gender: AnalysisGender;
  facts: AnalysisFacts;
  /** 已排好的四柱，模型只解释不推算 */
  baziText?: string;
  /** 能做原文核验的书目 */
  catalog: string[];
}

export interface RawIssue {
  kind?: string;
  severity?: string;
  text?: string;
  hint?: string;
}

export interface RawCitation {
  source?: string;
  piece?: string;
  quote?: string;
  gloss?: string;
}

export interface RawAnalysis {
  headline?: string;
  goodPoints?: unknown;
  issues?: unknown;
  citations?: unknown;
  closing?: string;
  fitAngle?: string;
  regenBrief?: { tabooChars?: unknown; styleNotes?: unknown; avoidPopular?: unknown };
}

const KIND_WHITELIST = new Set(["phonology", "glyph", "meaning", "gender", "era", "popularity"]);

/**
 * 给模型看的事实用中文写。
 * 写成 gb/lean 这种字段名，模型会把「GB 一级」原样抄进文案——它就是会抄。
 */
function describeFacts(facts: AnalysisFacts): unknown {
  return {
    字: facts.chars.map((c) => ({
      字: c.char,
      笔画: c.strokes ?? "未知",
      常用度:
        c.gb === 1 ? "最常用" : c.gb === 2 ? "次常用" : c.gb === 0 ? "不在最常用字里" : "未知",
    })),
    人名性别倾向: facts.lean.map((l) => ({
      字: l.char,
      倾向: l.lean === "male" ? "多用于男" : l.lean === "female" ? "多用于女" : "中性",
    })),
    整名倾向:
      facts.overallLean === "male"
        ? "偏男"
        : facts.overallLean === "female"
          ? "偏女"
          : facts.overallLean === "mixed"
            ? "男女字混用"
            : "中性",
  };
}

export function buildAnalysisMessages(input: AnalysisPromptInput): ChatMessage[] {
  const system: ChatMessage = {
    role: "system",
    content: [
      "你是中文姓名分析助手，帮一个已经取好名字的人看清这个名字的实际情况。",
      "最终回复的 content 必须是且仅是一个 JSON 对象，不要 markdown、不要解释、不要前后缀。",
      "",
      "【说话方式】",
      "像懂行的朋友当面讲话：短句，具体，有数字有例子。",
      "禁止出现的词：音韵、字形、五行、数理、格局、三才、五格、气场、能量、磁场、寓意深远、相得益彰、阴平、阳平、上声、去声、GB、编码、字表、字符集。",
      "说声调就说「一声、二声、三声、四声」，说常用度就说「常用字、不常用的字」。",
      "数字和汉字之间留一个空格：「登 12 画」，不要写成「登12画」。",
      "禁止打分，禁止出现任何分数、等级、星级、百分比。",
      "禁止用「总体来说」「综合来看」「不失为一个」这类公文腔。",
      "禁止在结尾说「能用」「还行」「不错」「挺好的」——那是替人圆场。",
      "",
      "【结论】",
      "headline 一句话说清这个名字到底有没有真麻烦，要放在最前面，开头先叫出这个名字。",
      "写 headline 前先判断档次：",
      "  有硬伤——谐音成不雅词、字打不出来、明确坏意思、性别明显错位：直说，不要软化。",
      "  无硬伤但有代价——读起来闷、重名多、年代旧、意思说满了：说清代价是什么。",
      "  两个都没有：不许编问题。issues 返回空数组，改写 fitAngle。",
      "",
      "【goodPoints（站得住的地方）】",
      "只写这个名字本身有辨识度的东西，最多 3 条；有一条写一条，没有可靠内容就返回空数组，不要凑数。",
      "优先写这三类：",
      "  1. 具体字的含义，以及字与字组合起来传达的意思；",
      "  2. 名字本身明确的特点：表达直接还是含蓄、意象清不清晰、姓和名连起来形成了什么具体意思；",
      "  3. 有依据的文化关联或典籍出处（与 citations 对得上，拿不准就不写）。",
      "下面这些是普通情况，不要单独算优点：",
      "  - 字常见、笔画少、好写、输入方便、办证买票不出问题；",
      "  - 声调平顺、读着不拗口、叫起来顺、不用刻意记；",
      "  - 「寓意美好」「大气好听」「端正耐看」这类套话。",
      "注意：这不等于不许谈读音和书写。如果这个名字确实存在容易误读、字难录入、书写困难的问题，",
      "照样写进 issues，并指明是哪个字、哪个读音。",
      "宁可少写，也不许为了凑条数编造字义或典籍来源。",
      "",
      "【issues】",
      "每条必须有具体依据，能指到某个字、某个读音、某一年代。",
      "说不出依据的不要写。宁可少写，不许凑数。",
      "severity 只能是 hard 或 cost：hard 是会造成实际生活麻烦的，cost 是每次要付一点小亏的。",
      "text 不超过 60 字，hint 不超过 40 字；hint 给方向，不写「必须改」。",
      "kind 只能是 phonology / glyph / meaning / gender / era / popularity。",
      "",
      "【性别】",
      "facts.lean 给的是每个字在人名里偏男还是偏女，以它为准，不要自己重新判断。",
      "overallLean 是整名的倾向。和用户填的性别不一致时要说，但说法是「这个字在人名里更多用于女性」，",
      "不是「这个字不适合女生」。字本身没有性别，是用法有。",
      "反方向也一样：男生用偏女性化的字，同样要说。",
      "",
      "【引经据典】",
      "只有当名字确实出自某句经典、且用得上时，才给 citations，最多 2 条。没有就给空数组。",
      "quote 必须是从原文里一字不差抄下来的连续片段，至少五个字，不许改写、不许拼接、不许自己造句。",
      "source 只能填 catalog 里列出的书名。piece 填篇名（如「周南·桃夭」「离骚」「学而」）。",
      "记不清原文就整条不要给——系统会拿原文逐字核对，对不上的会被删掉，编造只会让你这条白写。",
      "gloss 一句话说这个名怎么用这句，20 字以内。",
      "",
      "【出生信息】",
      "只有给了 baziText 才谈生辰，最多一句，语气克制，不做定论，不说用神。没给就完全不提。",
      "",
      "【regenBrief】",
      "tabooChars：这个名字里应当避开、改名时不要再用的字（有问题的那几个）。",
      "styleNotes：一句话，说明新名该往哪个方向走，具体到能执行。",
      "avoidPopular：这个名字是否因为太常见需要避开热门字。",
      "",
      "JSON 格式：",
      '{"headline":"...","goodPoints":["...","..."],"issues":[{"kind":"phonology","severity":"cost","text":"...","hint":"..."}],"citations":[{"source":"诗经","piece":"周南·桃夭","quote":"桃之夭夭，灼灼其华","gloss":"..."}],"closing":"...","fitAngle":"","regenBrief":{"tabooChars":[],"styleNotes":"","avoidPopular":false}}',
    ].join("\n"),
  };

  const user: ChatMessage = {
    role: "user",
    content: JSON.stringify(
      {
        姓名: input.fullName,
        姓: input.surname,
        名: input.givenName,
        性别: input.gender === "male" ? "男" : input.gender === "female" ? "女" : "未填",
        facts: describeFacts(input.facts),
        ...(input.baziText ? { baziText: input.baziText } : {}),
        catalog: input.catalog,
        instruction:
          "按系统消息的规则分析这个名字。goodPoints 只写名字本身有辨识度的内容（字义、组合后的意思、明确的特点、有依据的出处），" +
          "最多 3 条，少于 3 条或为空都正常——不要把「常用字、好写、读着顺」这类普通情况算成优点，" +
          "也不要为了凑条数编内容；" +
          "issues 只写有依据的，没有问题就返回空数组并把 fitAngle 写具体——" +
          "fitAngle 必须说到姓和名的搭配，不能只说「还能更独特」。最终只输出 JSON。",
      },
      null,
      0,
    ),
  };

  return [system, user];
}

export function parseAnalysisOutput(content: string): RawAnalysis | null {
  const json = extractJsonLocal(content);
  if (!json) return null;
  try {
    return JSON.parse(json) as RawAnalysis;
  } catch {
    return null;
  }
}

function extractJsonLocal(text: string): string | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

export function normalizeRawIssues(raw: unknown): { kind: string; severity: string; text: string; hint?: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { kind: string; severity: string; text: string; hint?: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as RawIssue;
    const text = typeof it.text === "string" ? it.text.trim() : "";
    if (!text) continue;
    const kind = KIND_WHITELIST.has(String(it.kind)) ? String(it.kind) : "meaning";
    const severity = it.severity === "hard" ? "hard" : "cost";
    const hint = typeof it.hint === "string" && it.hint.trim() ? it.hint.trim() : undefined;
    out.push({ kind, severity, text, ...(hint ? { hint } : {}) });
  }
  return out;
}

export function normalizeRawCitations(raw: unknown): RawCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: RawCitation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as RawCitation;
    if (typeof it.quote !== "string" || !it.quote.trim()) continue;
    out.push({
      source: typeof it.source === "string" ? it.source.trim() : "",
      piece: typeof it.piece === "string" ? it.piece.trim() : undefined,
      quote: it.quote.trim(),
      gloss: typeof it.gloss === "string" ? it.gloss.trim() : undefined,
    });
  }
  return out;
}
