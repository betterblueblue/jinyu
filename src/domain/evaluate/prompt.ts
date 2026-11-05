import { extractJson, type ChatMessage } from "@/providers/chat";
import type {
  EvalIssueKind,
  NameFacts,
  OriginalEvaluation,
  RawCandidate,
  RawEvaluation,
  RawOriginal,
  TierChoice,
} from "./types";
import { clampTier, type TierDim } from "./scoring";

/**
 * 一次调用（2026-11-04 最终版）。
 *
 * 因为两阶段实测更慢：第二次调用单独跑要 15–17 秒，总时间翻倍。
 * 还是一次调用，但输出顺序固定：先 scores 四个数字（程序立刻算分），再理由和候选。
 */

const ISSUE_KINDS: EvalIssueKind[] = ["读音", "字义", "气质", "识读", "流行", "谐音", "联想"];

const EVAL_RULES = [
  "你是直播间里的起名顾问。观众报了一个名字，性别已知。只输出 JSON。",
  "推理里只写「读音 x 字义 x 性别 x 风格 x」这一行，不要展开分析、不要复述规则。",
  "",
  "评价标准：",
  "- 女孩名偏明亮、聪慧、大方，有力量但不过分硬，不刻意柔弱；要重视女性辨识度，但不是非得用女字旁。",
  "- 男孩名温和、有精神，避免武侠感和过分刚硬。",
  "- 评价的是连着姓的整个名字，字表只作参考。",
  "- 年代感、撞名、热门字已经在事实里单独给了，style 只评整体气质，不要因为「老气」重复扣一次。",
  "- 读音只评按正确读法顺不顺，不评多音字会不会被念错；多音、生僻在识读维度里，程序已经处理。",
  "- 整名像上一辈的名字、菜市场名（到处都有人叫）、时代口号或职业词（淑芬、国强、卫东、空军），在 issues 里单独写一条，并把 meaning 压到最多 12：这是这类名字最主要的毛病，不要因为字义正面就给高分。",
  "- issues 最多 3 条，同一类只写一条，尤其年代感最多一条；读音、字义、气质、识读、流行、谐音、联想里哪个维度明显弱，就写一条具体的问题，不要只复述规则编号，也不要为了凑数写空话。",
  "",
  "档位只能取下面几个数，不要写别的：",
  "- pronunciation 读音（20 / 16 / 12 / 8）：20 自然顺畅；16 基本顺畅；12 略绕口；8 明显不顺。只说连着姓念的感觉，不评字义。",
  "- meaning 字义与组合（20 / 16 / 12 / 8 / 0）：20 意涵鲜明自然；16 正面清楚；12 组合联系弱；8 明显牵强；0 明确严重负面。整名直接是常见词、职业、军种或口号（空军、卫东、援朝），最多给 12，不要因为「意思正面」就给 16。",
  "- gender 性别辨识（12 / 8 / 4）：12 符合目标性别；8 中性；4 明显偏另一边。看整个名字，不只看单字。",
  "- style 风格适配（8 / 6 / 4 / 2）：8 符合，明亮或温和里有精神；6 基本符合，只是稍弱；4 有偏离，明显偏软、偏老、偏冷、偏硬，或者少了这一性别该有的气质；2 明显不符。温和不等于直接给 8，要看有没有亮色和精神。",
  "",
  "不要写：分数、扣几分、五行、八字、命理、运势、旺；「寓意深远」「气质不凡」「大气」这类空话；诗句原文和出处。",
];

const ONE_SYSTEM = [
  ...EVAL_RULES,
  "",
  "输出顺序：status → scores → original → options。scores 先写四个档位数字，程序立刻算分上屏；理由、优点、问题放 original；候选最后写。",
  "",
  "scores 只写四个数字，不要写理由（档位取值见上）：",
  '{"pronunciation":16,"meaning":16,"gender":12,"style":6}',
  "",
  "original 写理由和优缺点：",
  "- comment：先像跟家长聊天一样，用一段话把名字讲一遍：好在哪、问题在哪、像哪类名字（比如「像军种词」「偏上一辈」「文雅但偏静」），80 字以内，不要分点、不要打分。这段话主播会先念。",
  "- pronunciation / meaning / gender / style：各写一句理由，字符串，不要重复分数。",
  "- strengths：主要优点，一到三条，每条一句。",
  "- charMeaning：拆字，一句话，说每个字在名字里最常见的意思，像「丽是美好、好看」。",
  "- whole：合起来，一句话，以「合起来」开头，说这几个字拼成的画面或说法，再说一句爸妈的心意，40 字以内。",
  "- issues：最多 3 条，每条 {\"text\":\"具体问题\",\"importance\":\"major 或 minor\",\"kind\":\"读音/字义/气质/识读/流行/谐音/联想\"}。规则已确认的问题在下面给了编号，照抄编号对应的问题，同一类只写一条（尤其年代感最多一条）；你另外看出来的具体问题也写进来。没有就空数组。",
  "- reminders：只给主播看的提醒，只写谐音、联想、撞名人这类没把握的事；没把握就空数组，不要编。",
  "",
  "候选 options（原名有明显问题时给 2 个，最多 3 个，程序最后留 2 个）：",
  "- 小改优先：姓不动，尽量保住原名里还有价值的字或读音，能换一个字就不换两个。",
  "- 第一个候选是首选，第二个是备选，按推荐顺序排，不要随便排。",
  "- 同音雅化：保留读音，换一个更雅、更具体的字。只在毛病出在写法和字义上时有用（字义消极、字太生僻、两个字写出来是个军种词或口号词），换上的字意思要确实更好。撞名、年代感、谐音是念出来才有的毛病，换同音字念出来还是原来那个名字，不算解决。",
  "- 姓不动，名的字数不变，只换一个字。简繁变化不算改字。",
  "- givenName 写改完之后完整的名字（只有名，不带姓）：原名两个字就写两个字，原名一个字就写一个字。不要只写换上的那个字，也不要把原名和新字拼在一起。",
  "- 原名是单名时，候选也必须是那一个字。例：原名柯丽，候选写「昀」，不要写「丽昀」。",
  "- 先看原名的优点和问题，再决定换哪个字。只换一个字解决不了、或者原名已经很好，options 给空数组。",
  "- 原名有年代感、撞名、性别不符、字义消极这类明确问题时，给 2 个候选，换不同的字；两个候选不要都走同一个方向（比如都换成同音字、都换成同一类意思）。",
  "- 每个候选写：givenName（只写名，不带姓）；pronunciation / meaning / gender / style 四个档位，{tier, reason}；solves（解决了 original.issues 里的哪几条，写编号，如 [\"R1\"]）；keeps（保住原名哪几个优点，照抄 strengths 里的句子）；loss（损失和取舍，一句）；verdict（better / similar / worse）；why（15 字以内，榜上念的一句改善）；spoken（寓意，12–90 字）。",
  "- 候选不能新增已确认的严重问题；原名有严重谐音时，候选不能还带着谐音。",
  "",
  "status 三选一：",
  "- options：有值得换的候选；",
  "- no_better：原名可以用，没有比它更值得换的；",
  "- one_char_insufficient：只改一个字解决不了已经指出的问题。",
  "note：只写一句具体原因，不指示保留还是重新起名。",
  "",
  "spoken 和 why 里不出现分数和档位。",
  "",
  "格式示例（只看格式，别照抄内容）：",
  '{"status":"options","scores":{"pronunciation":16,"meaning":16,"gender":12,"style":6},"original":{"pronunciation":"连姓念节奏平稳，收尾略轻","meaning":"字义正面，意思直白","gender":"丽字女性倾向明确","style":"整体端正，少一点亮色","strengths":["字义干净，好认好写"],"charMeaning":"丽是美好、好看。","whole":"合起来是端端正正、清清爽爽的样子，爸妈盼孩子长得好、过得好。","comment":"好认好写，读着顺；但丽字单名偏上一辈，像爸妈那代的名字。","issues":[{"text":"丽字单名在女孩名里偏上一辈","importance":"major","kind":"流行"}],"reminders":[]},"options":[{"givenName":"昀","pronunciation":{"tier":16,"reason":"读音更亮"},"meaning":{"tier":16,"reason":"昀是日光"},"gender":{"tier":12,"reason":"女性辨识度保住了"},"style":{"tier":8,"reason":"明亮大方"},"solves":["R1"],"keeps":["字义干净，好认好写"],"loss":"少了一点安静的气质","verdict":"better","why":"换掉老气的丽，名字更亮","spoken":"昀是日光，合起来是明朗开阔的样子，愿孩子心里有光、自在长大。"},{"givenName":"澜","pronunciation":{"tier":16,"reason":"水波开阔"},"meaning":{"tier":16,"reason":"澜是波澜"},"gender":{"tier":8,"reason":"澜偏中性"},"style":{"tier":8,"reason":"明快"},"solves":["R1"],"keeps":["字义干净"],"loss":"少了柔婉","verdict":"better","why":"更明快","spoken":"澜是水波、波澜，愿孩子心胸开阔、遇事从容。"}],"note":""}',
].join("\n");

const ONE_COMPACT = [
  "",
  "本轮是精简模式，照样只输出 JSON，但每段都写短：",
  "- 四个维度的理由每条不超过 12 个字。",
  "- strengths 只写 1 条，不超过 15 个字。",
  "- issues 最多 2 条，每条不超过 20 个字；reminders 最多 1 条。",
  "- 候选给 2 个，按推荐顺序；两个换不同的字。每个候选：loss 不超过 20 字；why 不超过 12 字；spoken 30–60 字。",
].join("\n");

const ORIGINAL_SYSTEM = [
  ...EVAL_RULES,
  "",
  "这次只做原名评价，不要写候选：options 给空数组。",
  "输出顺序：status → scores → original。",
  "",
  "scores 只写四个档位数字，不要写理由：",
  '{"pronunciation":16,"meaning":16,"gender":12,"style":6}',
  "",
  "original 写理由和优缺点：",
  "- comment：先像跟家长聊天一样，用一段话把名字讲一遍：好在哪、问题在哪、像哪类名字（比如「像军种词」「偏上一辈」「文雅但偏静」），80 字以内，不要分点、不要打分。这段话主播会先念。",
  "- pronunciation / meaning / gender / style：各写一句理由，字符串，不要重复分数。",
  "- strengths：主要优点，一到三条，每条一句。",
  "- charMeaning：拆字，一句话，说每个字在名字里最常见的意思，像「丽是美好、好看」。",
  "- whole：合起来，一句话，以「合起来」开头，说这几个字拼成的画面或说法，再说一句爸妈的心意，40 字以内。",
  "- issues：最多 3 条，每条 {\"text\":\"具体问题\",\"importance\":\"major 或 minor\",\"kind\":\"读音/字义/气质/识读/流行/谐音/联想\"}。规则已确认的问题在下面给了编号，照抄编号对应的问题，同一类只写一条（尤其年代感最多一条）；你另外看出来的具体问题也写进来。没有就空数组。",
  "- reminders：只给主播看的提醒，只写谐音、联想、撞名人这类没把握的事；没把握就空数组，不要编。",
  "",
  "status 三选一：",
  "- options：原名有问题、值得改（候选由下一次调用写）；",
  "- no_better：原名可以用，不用改；",
  "- one_char_insufficient：只改一个字解决不了已经指出的问题。",
  "note：只写一句具体原因。",
  "",
  "格式示例（只看格式，别照抄内容）：",
  '{"status":"options","scores":{"pronunciation":16,"meaning":16,"gender":12,"style":6},"original":{"pronunciation":"连姓念节奏平稳，收尾略轻","meaning":"字义正面，意思直白","gender":"丽字女性倾向明确","style":"整体端正，少一点亮色","strengths":["字义干净，好认好写"],"charMeaning":"丽是美好、好看。","whole":"合起来是端端正正、清清爽爽的样子，爸妈盼孩子长得好、过得好。","comment":"好认好写，读着顺；但丽字单名偏上一辈，像爸妈那代的名字。","issues":[{"text":"丽字单名在女孩名里偏上一辈","importance":"major","kind":"流行"}],"reminders":[]},"options":[],"note":""}',
].join("\n");

const OPTIONS_SYSTEM = [
  "你是直播间里的起名顾问。原名的评价已经定好了，你只负责改名里的一个字，写两个候选。只输出 JSON。",
  "推理里只写要换的字，比如「丽→昀、澜」，一行一个，不要展开分析。",
  "不要重新评价原名，不要改原名分数，不要写 reason 之外的原名分析；只写候选。",
  "",
  "怎么改：",
  "- 姓不动，名的字数不变，只换一个字。简繁变化不算改字。",
  "- givenName 写改完之后完整的名字（只有名，不带姓）：原名两个字就写两个字，原名一个字就写一个字。不要只写换上的那个字，也不要把原名和新字拼在一起。",
  "- 原名是单名时，候选也必须是那一个字。例：原名柯丽，候选写「昀」，不要写「丽昀」。",
  "- 换上的字要常用、好认、只有一个读音、意思好；不用生僻、古怪、贬义、老气的字。",
  "- 原名有年代感、撞名、性别不符、字义消极这类明确问题时，给 2 个候选，换不同的字；两个候选不要都走同一个方向（比如都换成同音字、都换成同一类意思）。",
  "- 可以同音雅化：保留读音，换一个更雅、更具体的字。只在毛病出在写法和字义上时有用（字义消极、字太生僻、两个字写出来是个军种词或口号词），换上的字意思要确实更好。撞名、年代感、谐音是念出来才有的毛病，换同音字念出来还是原来那个名字，不算解决。",
  "- 原名确实没法只改一个字解决，options 给空数组、status 写 one_char_insufficient。",
  "",
  "每个候选写：",
  "- givenName：改完的名，不带姓。",
  "- pronunciation / meaning / gender / style：四个档位，{tier, reason}，和原名用同一把尺子。",
  "- solves：解决了原名 issues 里的哪几条，写编号，如 [\"R1\"]。",
  "- keeps：保住原名哪几个优点，照抄优点里的句子。",
  "- loss：损失和取舍，一句。",
  "- verdict：better / similar / worse，和原名比是否更值得用。",
  "- why：15 字以内，榜上念的一句改善。",
  "- spoken：寓意，12–90 字，主播照着念。",
  "",
  "不要写：分数、扣几分、五行、八字、命理、运势、旺；「寓意深远」「气质不凡」「大气」这类空话；诗句原文和出处。",
  "spoken 和 why 里不出现分数和档位。",
  "",
  "格式示例（只看格式，别照抄内容）：",
  '{"status":"options","options":[{"givenName":"昀","pronunciation":{"tier":16,"reason":"读音更亮"},"meaning":{"tier":16,"reason":"昀是日光"},"gender":{"tier":12,"reason":"女性辨识度保住了"},"style":{"tier":8,"reason":"明亮大方"},"solves":["R1"],"keeps":["字义干净，好认好写"],"loss":"少了一点安静的气质","verdict":"better","why":"换掉老气的丽，名字更亮","spoken":"昀是日光，合起来是明朗开阔的样子，愿孩子心里有光、自在长大。"},{"givenName":"澜","pronunciation":{"tier":16,"reason":"水波开阔"},"meaning":{"tier":16,"reason":"澜是波澜"},"gender":{"tier":8,"reason":"澜偏中性"},"style":{"tier":8,"reason":"明快"},"solves":["R1"],"keeps":["字义干净"],"loss":"少了柔婉","verdict":"better","why":"更明快","spoken":"澜是水波、波澜，愿孩子心胸开阔、遇事从容。"}],"note":""}',
].join("\n");

const ORIGINAL_COMPACT = [
  "",
  "本轮是精简模式，照样只输出 JSON，但写短：",
  "- 四个维度的理由每条不超过 12 个字。",
  "- strengths 只写 1 条，不超过 15 个字。",
  "- issues 最多 2 条，每条不超过 20 个字；reminders 最多 1 条。",
].join("\n");

const OPTIONS_COMPACT = [
  "",
  "本轮是精简模式，照样只输出 JSON，但写短：",
  "- 候选给 2 个，按推荐顺序；两个换不同的字。",
  "- 每个候选的 reason 每条不超过 12 个字；loss 不超过 20 字；why 不超过 12 字；spoken 30–60 字。",
].join("\n");

function leanWord(lean: string): string {
  return lean === "male" ? "男性" : lean === "female" ? "女性" : "中性";
}

function charLine(c: NameFacts["chars"][number]): string {
  const gb = c.gbLevel === 1 ? "最常用字" : c.gbLevel === 2 ? "次常用字" : c.gbLevel === 0 ? "不在常用字表" : "常用度未知";
  const readings = c.readings.length ? c.readings.join("、") : "读音未知";
  const parts = [`「${c.char}」${gb}`, `${c.readings.length || 1} 个读音（${readings}）`, `人名里更多用于${leanWord(c.lean)}`];
  if (c.folk) parts.push(`民俗说法：${c.folk.line}`);
  return `- ${parts.join("；")}`;
}

function whoWord(facts: NameFacts): string {
  return facts.gender === "female" ? "女孩" : facts.gender === "male" ? "男孩" : "性别未填";
}

function factsBlock(facts: NameFacts): string[] {
  const lines = [`名字：${facts.fullName}（姓${facts.surname}，名${facts.givenName}，${whoWord(facts)}）`, `拼音：${facts.pinyin}`, "用字："];
  for (const c of facts.chars) lines.push(charLine(c));
  lines.push("", `字表看整名的倾向：${leanWord(facts.lean.overall === "mixed" ? "neutral" : facts.lean.overall)}（只作参考，整名仍要你判断）。`);
  lines.push("", "规则已经确认的问题（可以直接引用编号）：");
  if (facts.issues.length) for (const it of facts.issues) lines.push(`${it.id}（${it.severity === "plain" ? "一般事实" : it.severity === "severe" ? "严重" : "较重要"}）：${it.line}`);
  else lines.push("没有。");
  if (facts.reminders.length) {
    lines.push("", "民俗和零散说法（只作参考，不当客观硬伤，也不要在 style 里再扣一次）：");
    for (const r of facts.reminders) lines.push(`- ${r}`);
  }
  return lines;
}

/** 第一次调用：只写原名评价 */
export function buildOriginalMessages(facts: NameFacts, compact = false): ChatMessage[] {
  const lines = [...factsBlock(facts), "", "只做原名评价，options 给空数组。只输出 JSON。"];
  return [
    { role: "system", content: compact ? `${ORIGINAL_SYSTEM}\n${ORIGINAL_COMPACT}` : ORIGINAL_SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

/** 第二次调用：原名评价固定，只写候选 */
export function buildOptionsMessages(facts: NameFacts, original: OriginalEvaluation, compact = false): ChatMessage[] {
  const t = original.tiers;
  const lines = [
    ...factsBlock(facts),
    "",
    "原名的评价（已经定好，不要改）：",
    `- 四个档位：读音 ${t.pronunciation.tier}（${t.pronunciation.reason || "—"}）、字义 ${t.meaning.tier}（${t.meaning.reason || "—"}）、性别 ${t.gender.tier}（${t.gender.reason || "—"}）、风格 ${t.style.tier}（${t.style.reason || "—"}）。`,
    `- 优点：${original.strengths.length ? original.strengths.join("；") : "没写"}`,
    `- 问题：${original.issues.length ? original.issues.map((it) => `${it.id} ${it.text}`).join("；") : "没有"}`,
    "",
    "只改名里的一个字，给 2 个候选。只输出 JSON。",
  ];
  return [
    { role: "system", content: compact ? `${OPTIONS_SYSTEM}\n${OPTIONS_COMPACT}` : OPTIONS_SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

/** 一次调用：scores → original → options。banned 是最近给过的候选字，让模型这轮避开 */
export function buildEvaluateMessages(facts: NameFacts, compact = false, banned: string[] = []): ChatMessage[] {
  const lines = [...factsBlock(facts)];
  if (banned.length) lines.push("", `这轮不要用这些字（主播刚给过）：${banned.join("、")}。`);
  lines.push("", "按要求输出 JSON。");
  return [
    { role: "system", content: compact ? `${ONE_SYSTEM}\n${ONE_COMPACT}` : ONE_SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

/** 提取整份 JSON；解析失败返回 null，不猜 */
export function parseEvaluation(content: string): RawEvaluation | null {
  const json = extractJson(content);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as RawEvaluation;
  } catch {
    return null;
  }
}

/** 流式解析：scores 对象一闭合就返回，不用等理由 */
export function completedScores(partial: string): ParsedScores | null {
  const m = /"scores"\s*:\s*\{/.exec(partial);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  const end = partial.indexOf("}", start);
  if (end < 0) return null;
  try {
    return parseScores(JSON.parse(partial.slice(start, end + 1)));
  } catch {
    return null;
  }
}

/** 流式解析：original 对象闭合就返回 */
export function completedOriginal(partial: string): RawOriginal | null {
  const m = /"original"\s*:\s*\{/.exec(partial);
  if (!m) return null;
  return sliceBalancedObject(partial, m.index + m[0].length - 1) as RawOriginal | null;
}

/** 流式解析：options 数组里每写完一个对象就交一个 */
export function completedCandidateObjects(partial: string): RawCandidate[] {
  const key = partial.search(/"options"\s*:\s*\[/);
  if (key < 0) return [];
  const out: RawCandidate[] = [];
  let i = partial.indexOf("[", key) + 1;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (; i < partial.length; i++) {
    const c = partial[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth < 0) break;
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(partial.slice(start, i + 1)) as unknown;
          if (obj && typeof obj === "object" && !Array.isArray(obj)) out.push(obj as RawCandidate);
        } catch {
          /* 这一条写坏了，跳过 */
        }
        start = -1;
      }
    } else if (c === "]" && depth === 0) {
      break;
    }
  }
  return out;
}

function sliceBalancedObject(text: string, start: number): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1)) as unknown;
          return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 一维档位：必须有数字档位和一句理由，非法档位向下取到合法档 */
export function parseTierChoice(raw: unknown, dim: TierDim): TierChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = typeof o.tier === "number" ? o.tier : typeof o.tier === "string" ? Number(o.tier) : NaN;
  if (!Number.isFinite(n)) return null;
  const reason = typeof o.reason === "string" ? o.reason.replace(/\s+/g, "").trim().slice(0, 60) : "";
  if (!reason) return null;
  return { tier: clampTier(dim, n), reason };
}

export function asStringArray(raw: unknown, max = 6): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.replace(/\s+/g, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

/** 顶层 scores：四个档位数字。先写这个，程序能立刻算分上屏 */
export interface ParsedScores {
  pronunciation: number;
  meaning: number;
  gender: number;
  style: number;
}

function toNumber(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
}

export function parseScores(raw: unknown): ParsedScores | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const values = {
    pronunciation: toNumber(o.pronunciation),
    meaning: toNumber(o.meaning),
    gender: toNumber(o.gender),
    style: toNumber(o.style),
  };
  if (Object.values(values).some((v) => !Number.isFinite(v))) return null;
  return {
    pronunciation: clampTier("pronunciation", values.pronunciation),
    meaning: clampTier("meaning", values.meaning),
    gender: clampTier("gender", values.gender),
    style: clampTier("style", values.style),
  };
}

/** 兼容旧结构（original 里每维是 {tier, reason}）：没有顶层 scores 时从这里取 */
export function scoresFromOriginal(raw: RawOriginal | undefined): ParsedScores | null {
  if (!raw) return null;
  const tier = (v: unknown): number => {
    if (v && typeof v === "object") return toNumber((v as Record<string, unknown>).tier);
    return NaN;
  };
  const values = {
    pronunciation: tier(raw.pronunciation),
    meaning: tier(raw.meaning),
    gender: tier(raw.gender),
    style: tier(raw.style),
  };
  if (Object.values(values).some((v) => !Number.isFinite(v))) return null;
  return {
    pronunciation: clampTier("pronunciation", values.pronunciation),
    meaning: clampTier("meaning", values.meaning),
    gender: clampTier("gender", values.gender),
    style: clampTier("style", values.style),
  };
}

/** 理由可以是字符串（新结构），也可以是 {tier, reason}（旧结构） */
function reasonOf(v: unknown): string {
  if (typeof v === "string") return v.replace(/\s+/g, "").trim().slice(0, 60);
  if (v && typeof v === "object") {
    const r = (v as Record<string, unknown>).reason;
    return typeof r === "string" ? r.replace(/\s+/g, "").trim().slice(0, 60) : "";
  }
  return "";
}

export function parseOriginal(
  scores: ParsedScores | null,
  raw: RawOriginal | undefined,
): {
  tiers: { pronunciation: TierChoice; meaning: TierChoice; gender: TierChoice; style: TierChoice } | null;
  strengths: string[];
  issueTexts: { text: string; importance: "major" | "minor"; kind?: EvalIssueKind }[];
  reminders: string[];
  charMeaning: string;
  whole: string;
  comment: string;
} {
  if (!scores || !raw) return { tiers: null, strengths: [], issueTexts: [], reminders: [], charMeaning: "", whole: "", comment: "" };
  const tiers = {
    pronunciation: { tier: scores.pronunciation, reason: reasonOf(raw.pronunciation) },
    meaning: { tier: scores.meaning, reason: reasonOf(raw.meaning) },
    gender: { tier: scores.gender, reason: reasonOf(raw.gender) },
    style: { tier: scores.style, reason: reasonOf(raw.style) },
  };
  const issueTexts = Array.isArray(raw.issues)
    ? raw.issues
        .map((x) => {
          if (!x || typeof x !== "object") return null;
          const o = x as Record<string, unknown>;
          const text = typeof o.text === "string" ? o.text.replace(/\s+/g, "").trim().slice(0, 80) : "";
          if (!text) return null;
          const kind =
            typeof o.kind === "string" && ISSUE_KINDS.includes(o.kind as EvalIssueKind)
              ? (o.kind as EvalIssueKind)
              : undefined;
          return {
            text,
            importance: o.importance === "major" ? ("major" as const) : ("minor" as const),
            ...(kind ? { kind } : {}),
          };
        })
        .filter((x): x is { text: string; importance: "major" | "minor"; kind?: EvalIssueKind } => Boolean(x))
        .slice(0, 6)
    : [];
  return {
    tiers,
    strengths: asStringArray(raw.strengths, 3),
    issueTexts,
    reminders: asStringArray(raw.reminders, 3),
    charMeaning: typeof raw.charMeaning === "string" ? raw.charMeaning.replace(/\s+/g, "").trim().slice(0, 80) : "",
    whole: typeof raw.whole === "string" ? raw.whole.replace(/\s+/g, "").trim().slice(0, 100) : "",
    comment: typeof raw.comment === "string" ? raw.comment.replace(/\s+/g, "").trim().slice(0, 120) : "",
  };
}
