import type { Element, FortuneChart, StrengthLevel } from "./types";

/**
 * 解读和排盘对不对得上：一句一句查，对不上的整句删（reading.ts 调）。
 *
 * 只查能机械判断的硬事实，宁可漏掉，不可错删：
 * - 日主：写成别的天干（「甲木日主」「日主为辛金」），或别的五行（「日主属火」）；
 * - 强弱：排盘偏弱却说身强、身旺，或反过来；中和不查；
 * - 喜忌：把排盘的忌神说成喜用，或把喜用说成忌神；
 * - 四柱：写出的年柱、月柱、日柱、时柱，以及年干、日支这类单字，和排盘不一样；
 * - 十神：「月干为正印」这类和排盘对不上的；
 * - 生肖：「你属鼠」和排盘不一样；
 * - 神煞：排盘里没有、提示词也不让提的（桃花、驿马、天乙贵人……）。
 *
 * 句子里写着「若论格局」「从调候看」「也有人」这类另说的，强弱和喜忌不查：提示词允许在这类句子里补别的看法。
 * 出生时间不确定时，chart.uncertain 里写了另一种干支，这些干支也算对。
 * 大运、流年两段里的「年干」「日支」常指运和流年本身，所以那两段只查日主、喜忌、生肖、神煞。
 */

const GAN = "甲乙丙丁戊己庚辛壬癸";
const ZHI = "子丑寅卯辰巳午未申酉戌亥";
const WEAK: StrengthLevel[] = ["极弱", "身弱", "偏弱"];
const STRONG: StrengthLevel[] = ["偏强", "身强", "极旺"];
const PILLAR_CHAR = { 年: "year", 月: "month", 日: "day", 时: "time" } as const;

/** 另说：提示词允许在这类句子里讲调候、格局的不同看法 */
const ALT_VIEW = /格局|调候|也有人|有人认为|另一种|另有|若按|若从|从格|从弱|从强|从势|专旺/;
const SHENSHA = /桃花|驿马|天乙贵人|太极贵人|羊刃|华盖|文昌|红鸾|天喜|孤辰|寡宿|将星|劫煞|亡神|魁罡|金舆|天德|月德/;
const GOD_ALIAS: Record<string, string> = { 偏官: "七杀", 枭神: "偏印" };

const ELS = "[木火土金水](?:[、和与及]?[木火土金水])*";
const LIKE: RegExp[] = [
  new RegExp(`喜用神?(?:为|是|在)?(${ELS})`, "g"),
  new RegExp(`(?<![欢恭贺道])喜神?(?:为|是)?(${ELS})`, "g"),
  new RegExp(`用神(?:为|是|取)?(${ELS})`, "g"),
  new RegExp(`(${ELS})(?:为|是)(?:喜用|用神|喜神|喜(?![欢事庆悦气]))`, "g"),
];
const AVOID: RegExp[] = [new RegExp(`忌神?(?:为|是|在)?(${ELS})`, "g"), new RegExp(`(${ELS})(?:为|是)忌`, "g")];

/** 「身」前面是这些字时是普通用法（自身、本身、终身……），不算强弱的说法 */
const SHEN = "(?<![自本全终健修动出翻随亲切安脱置挺献人立养保强起转护])身";
const SUBJECT = `(?:${SHEN}|日主(?:[${GAN}][木火土金水]?)?|日元(?:[${GAN}][木火土金水]?)?)`;
const STRONG_CLAIM = new RegExp(`${SUBJECT}(?:较|偏|过|太|极|很)?(?:强|旺)`);
const WEAK_CLAIM = new RegExp(`${SUBJECT}(?:较|偏|过|太|极|很)?(?:弱|衰)`);
/** 泛泛地讲「看旺衰」「论强弱」，不是在下结论 */
const STRENGTH_TOPIC = /旺衰|衰旺|强弱|弱强/;
/** 「流年干」「今年干支」里的年不是年柱 */
const PILLAR = "((?<![流今明去前后当本每])年|月|日|时)";

export interface ChartFacts {
  dayGan: string;
  dayElement: Element;
  level: StrengthLevel;
  favorable: Set<string>;
  unfavorable: Set<string>;
  zodiac: string;
  pillars: Record<"year" | "month" | "day" | "time", { gan: string; zhi: string; ganzhi: string; tenGod: string }>;
  /** 出生时间不确定时另一种可能的干支 */
  alternates: Set<string>;
  timeUncertain: boolean;
}

export function chartFacts(chart: FortuneChart): ChartFacts {
  const s = chart.strength;
  const pillars = Object.fromEntries(
    chart.pillars.map((p) => [p.key, { gan: p.gan, zhi: p.zhi, ganzhi: p.ganzhi, tenGod: p.tenGod }]),
  ) as ChartFacts["pillars"];
  const alternates = new Set(chart.uncertain.join("").match(new RegExp(`[${GAN}][${ZHI}]`, "g")) ?? []);
  return {
    dayGan: s.dayMaster.gan,
    dayElement: s.dayMaster.element,
    level: s.level,
    favorable: new Set(s.favorable),
    unfavorable: new Set(s.unfavorable),
    zodiac: chart.zodiac,
    pillars,
    alternates,
    timeUncertain: chart.uncertain.length > 0,
  };
}

const elementsIn = (text: string) => [...text].filter((c) => "木火土金水".includes(c));

/**
 * 查一句话和排盘有没有对不上的地方，返回一句理由；对得上返回 null。
 * natal = true 是命局总论、各项、建议这些讲原局的段落；false 是大运、流年。
 */
export function findConflict(sentence: string, f: ChartFacts, natal: boolean): string | null {
  const ss = sentence.match(SHENSHA);
  if (ss) return `提到排盘里没有的神煞「${ss[0]}」`;

  for (const m of sentence.matchAll(new RegExp(`([${GAN}])[木火土金水]?日(?:主|元)`, "g"))) {
    if (m[1] !== f.dayGan) return `日主写成了${m[1]}（排盘是${f.dayGan}）`;
  }
  for (const m of sentence.matchAll(new RegExp(`日(?:主|元)(?:为|是)([${GAN}])`, "g"))) {
    if (m[1] !== f.dayGan) return `日主写成了${m[1]}（排盘是${f.dayGan}）`;
  }
  for (const m of sentence.matchAll(/日(?:主|元)(?:属|为|是)([木火土金水])/g)) {
    if (m[1] !== f.dayElement) return `日主五行写成了${m[1]}（排盘是${f.dayElement}）`;
  }

  const zodiac = sentence.match(/(?:你|命主|本人)属(鼠|牛|虎|兔|龙|蛇|马|羊|猴|鸡|狗|猪)|生肖(?:为|是|属)?(鼠|牛|虎|兔|龙|蛇|马|羊|猴|鸡|狗|猪)/);
  const zodiacSaid = zodiac?.[1] ?? zodiac?.[2];
  if (zodiacSaid && zodiacSaid !== f.zodiac) return `生肖写成了${zodiacSaid}（排盘是${f.zodiac}）`;

  if (!ALT_VIEW.test(sentence)) {
    const liked = LIKE.flatMap((re) => [...sentence.matchAll(re)].flatMap((m) => elementsIn(m[1]!)));
    const bad = liked.find((e) => f.unfavorable.has(e));
    if (bad) return `把忌神${bad}说成了喜用`;
    const avoided = AVOID.flatMap((re) => [...sentence.matchAll(re)].flatMap((m) => elementsIn(m[1]!)));
    const good = avoided.find((e) => f.favorable.has(e));
    if (good) return `把喜用${good}说成了忌神`;
  }

  if (!natal) return null;

  if (!ALT_VIEW.test(sentence) && !STRENGTH_TOPIC.test(sentence)) {
    const strong = STRONG_CLAIM.test(sentence);
    const weak = WEAK_CLAIM.test(sentence);
    if (strong && !weak && WEAK.includes(f.level)) return `说成身强（排盘是${f.level}）`;
    if (weak && !strong && STRONG.includes(f.level)) return `说成身弱（排盘是${f.level}）`;
  }

  for (const m of sentence.matchAll(new RegExp(`${PILLAR}柱(?:为|是)?([${GAN}][${ZHI}])`, "g"))) {
    const p = f.pillars[PILLAR_CHAR[m[1] as keyof typeof PILLAR_CHAR]];
    if (p.ganzhi !== m[2] && !f.alternates.has(m[2]!)) return `${m[1]}柱写成了${m[2]}（排盘是${p.ganzhi}）`;
  }
  const altGans = new Set([...f.alternates].map((x) => x[0]));
  const altZhis = new Set([...f.alternates].map((x) => x[1]));
  // 后面紧跟另一个干或支的是在讲关系（「日支丑未又冲」= 丑未相冲，牵涉日支），不是在说日支是丑，不查
  for (const m of sentence.matchAll(new RegExp(`${PILLAR}干(?:为|是)?([${GAN}])(?![${GAN}])`, "g"))) {
    const p = f.pillars[PILLAR_CHAR[m[1] as keyof typeof PILLAR_CHAR]];
    if (p.gan !== m[2] && !altGans.has(m[2])) return `${m[1]}干写成了${m[2]}（排盘是${p.gan}）`;
  }
  for (const m of sentence.matchAll(new RegExp(`${PILLAR}支(?:为|是)?([${ZHI}])(?![${ZHI}])`, "g"))) {
    const p = f.pillars[PILLAR_CHAR[m[1] as keyof typeof PILLAR_CHAR]];
    if (p.zhi !== m[2] && !altZhis.has(m[2])) return `${m[1]}支写成了${m[2]}（排盘是${p.zhi}）`;
  }
  const gods = "比肩|劫财|食神|伤官|偏财|正财|七杀|偏官|正官|偏印|正印|枭神";
  for (const m of sentence.matchAll(new RegExp(`((?<![流今明去前后当本每])年|月|时)干(?:[${GAN}][木火土金水]?)?(?:为|是)?(${gods})`, "g"))) {
    const key = PILLAR_CHAR[m[1] as keyof typeof PILLAR_CHAR];
    if (key === "time" && f.timeUncertain) continue;
    const said = GOD_ALIAS[m[2]!] ?? m[2];
    const p = f.pillars[key];
    if (p.tenGod !== said) return `${m[1]}干的十神写成了${m[2]}（排盘是${p.tenGod}）`;
  }
  return null;
}
