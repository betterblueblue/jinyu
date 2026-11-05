import type { AnalysisGender } from "@/domain/analysis/types";
import type {
  CharFact,
  DimensionScores,
  EvalBand,
  NameFacts,
  ScoreBreakdown,
  TierChoice,
} from "./types";

/**
 * 综合分的算分规则（第一版）。
 *
 *   读音 20 + 字义 20 + 气质 20（性别辨识 12 + 风格 8）+ 识读 15 + 流行 10 + 谐音 15 = 100
 *
 * 模型只给四类档位（读音、字义、性别辨识、风格），其余三维由程序按字表和词表分档。
 * 总分 = min(六项相加, 风险上限)。上限只为「已确认的严重问题」设置，不让好寓意和高风格分抵消。
 *
 * 档位、权重和分界都是第一版初值，等样例跑完再校准；改这里就能整体改口径。
 */

export const TIER_SETS = {
  pronunciation: [20, 16, 12, 8],
  meaning: [20, 16, 12, 8, 0],
  gender: [12, 8, 4],
  style: [8, 6, 4, 2],
} as const;

export type TierDim = keyof typeof TIER_SETS;

/** 取不高于给定值的最大合法档，模型写 18 就按 16 算，不会虚高 */
export function clampTier(dim: TierDim, raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 0;
  for (const v of TIER_SETS[dim]) if (v <= n) return v;
  return TIER_SETS[dim][TIER_SETS[dim].length - 1]!;
}

/**
 * 分界沿用旧的 90 / 80：风险上限 89 就是为了把它压在「非常优秀」以下，
 * 分界要是 85，上限 89 就失去意义。综合分整体会不会下移，等样例跑完再看要不要调。
 */
export const BAND_CUTS = { great: 90, ok: 80 } as const;

/** 80–89 叫「还能更好」（2026-11-05 用户定）：打分榜是引导改字的，「可以用」听着像不用改 */
export function bandOf(total: number): { band: EvalBand; label: string } {
  if (total >= BAND_CUTS.great) return { band: "great", label: "非常优秀" };
  if (total >= BAND_CUTS.ok) return { band: "ok", label: "还能更好" };
  return { band: "change", label: "建议改" };
}

/**
 * 进「非常优秀」要过门（2026-11-05 用户定，独立评审建议）。
 *
 * 分数是从满分往下扣的，原来没查到毛病就直接 90 以上：30 个常见现代名配 10 个大姓，67% 到 90。
 * 打分榜是引导改字的，90 以上又不给改法，这一段就没内容了。现在 90 以上要同时满足：
 *   规则没查到问题（热门字、撞名、同调、年代字、容易念错……都有字表或声调可查，观众听得懂）、
 *   不是老派名字、字义至少 16、性别辨识 12。
 * 差一条就封顶 89，理由写那一条。模型自己写的问题只当提示，不封顶，免得每个名字都被挑一句压下来。
 * 热门字挡不挡 90 用户定了挡；真实名字跑出来「非常优秀」低于 15% 时，把 POPULAR_BLOCKS_GREAT 改成 false。
 */
export const POPULAR_BLOCKS_GREAT = true;
const POPULAR_RULES = new Set(["hot", "template", "singleName"]);

export function greatBlock(
  facts: NameFacts,
  tiers: { meaning: TierChoice; gender: TierChoice },
  old: boolean,
): string | null {
  const rule = facts.issues.find((it) => POPULAR_BLOCKS_GREAT || !POPULAR_RULES.has(it.rule));
  if (rule) return rule.line;
  if (old) return "整名像上一辈的名字";
  if (tiers.meaning.tier < 16) return "两个字的意思联系偏弱";
  if (tiers.gender.tier < 12) return "整体偏中性，性别辨识度不够";
  return null;
}

const LITERACY_TIERS = [15, 12, 9, 6, 3, 0];
const POPULARITY_TIERS = [10, 8, 6, 4, 2, 0];

function floorTier(tiers: readonly number[], raw: number): number {
  for (const v of tiers) if (v <= raw) return v;
  return tiers[tiers.length - 1]!;
}

/**
 * 识读：看常用度和读音歧义，不再因为姓和名笔画差大扣分。
 * 生僻字 -6，次常用又多音 -4，次常用单音 -2。
 */
export function literacyScore(chars: CharFact[]): { score: number; reason: string } {
  let raw = 15;
  const notes: string[] = [];
  for (const c of chars) {
    if (c.gbLevel === 0) {
      raw -= 6;
      notes.push(`「${c.char}」不在常用字表里`);
    } else if (c.gbLevel === 2 && c.readings.length >= 2) {
      raw -= 4;
      notes.push(`「${c.char}」不是最常用的字，又有 ${c.readings.length} 个读音`);
    } else if (c.gbLevel === 2) {
      raw -= 2;
      notes.push(`「${c.char}」不是最常用的字`);
    }
  }
  return {
    score: floorTier(LITERACY_TIERS, Math.max(0, raw)),
    reason: notes.length ? notes.join("；") : "用字都在常用字里，读音单一",
  };
}

/**
 * 流行与辨识：按已有热门、年代名单分档，不编具体重名率。
 *
 * 年代感只放这一维，按旧规则的轻重对应：整名就是老一辈的常见名扣得最重，
 * 单名是年代字次之，名里只有一个年代字最轻。撞烂大街名单独再扣。
 * 第一版样例里王秀英、王伟这种旧规则 70 分的名字新分到了 90，就是这里扣轻了。
 */
export function popularityScore(
  givenName: string,
  facts: NameFacts["popularityFacts"],
): { score: number; reason: string } {
  let raw = 10;
  const notes: string[] = [];
  if (facts.template) {
    raw -= 6;
    notes.push("是这些年最常见的名字之一");
  }
  if (facts.singleNameBigSurname) {
    raw -= 2;
    notes.push("大姓配单名，重名概率高");
  }
  for (const ch of facts.hotChars) {
    raw -= 2;
    notes.push(`「${ch}」是这几年用得最多的字之一`);
  }
  if (facts.era) {
    const cut = facts.era.kind === "name" ? 8 : facts.era.kind === "pair" ? 6 : facts.era.kind === "single" ? 6 : 3;
    raw -= cut;
    notes.push(`${givenName} 有明显的年代感`);
  }
  if (facts.eraWord) {
    raw -= 4;
    notes.push("整名是那个年代的口号或职业词");
  }
  return {
    score: floorTier(POPULARITY_TIERS, Math.max(0, raw)),
    reason: notes.length ? notes.join("；") : "用字和名字都没有明显的年代或撞名",
  };
}

/**
 * 谐音与联想：只算规则里已经确认的负面词和反面人物同名。
 * 和姓同音、三声连读、同调属于读音问题，放在读音维度，这里不重复扣。
 */
export function homophoneScore(
  hasInfamous: boolean,
  homophones: { points: number }[],
  hasTrap: boolean,
): { score: number; reason: string } {
  if (hasInfamous) return { score: 0, reason: "和反面人物同名" };
  if (homophones.some((h) => h.points >= 30)) return { score: 0, reason: "连着姓念有一个不好的词" };
  if (homophones.length > 0) return { score: 6, reason: "连着姓念有一般的负面联想" };
  if (hasTrap) return { score: 6, reason: "姓和名的首字连读成一个常用词" };
  return { score: 15, reason: "没有查到负面谐音" };
}

/**
 * 读音档以规则为准（2026-11-05 用户定）。
 *
 * 模型给读音档很随机：同一个洪锐 4 次给了 16 20 20 20，黄锐 20 20 16 16；
 * 两个名字声调一模一样（hóng/huáng 都是二声接去声），打分榜上挨着就能差 4 分。
 * 所以先按规则查出的读音毛病定基准档，模型只有在理由里说出名字里具体哪个字怎么不顺时，才能往下调一档。
 *   没有读音毛病 20；同调、变调 16；和姓同音（连着念绕）12；两样都有再降一档。
 * 连读成词（trap）算在谐音维度里，这里不重复扣。
 */
const PRONUNCIATION_RULE_TIER: Record<string, number> = { flatTone: 16, sandhi: 16, sameSound: 12 };

export function pronunciationBase(facts: NameFacts): { tier: number; reason: string } {
  const hits = facts.issues.filter((it) => it.rule in PRONUNCIATION_RULE_TIER);
  if (!hits.length) return { tier: 20, reason: "连着姓念顺，规则没查到读音毛病" };
  const worst = Math.min(...hits.map((it) => PRONUNCIATION_RULE_TIER[it.rule]!));
  return { tier: clampTier("pronunciation", hits.length > 1 ? worst - 4 : worst), reason: hits[0]!.line };
}

/** 模型说「不顺」要说到具体的字和具体的毛病，「基本顺畅」「收尾略轻」这种不算 */
const PRONUNCIATION_PROBLEM = /拗口|绕口|别扭|不顺|难念|念不清|听不清|含糊|吞音|打架|同声母|同韵母|双声|叠韵|没有?起伏|单调/;

export function anchorPronunciation(facts: NameFacts, model: TierChoice): TierChoice {
  const base = pronunciationBase(facts);
  const reason = model.reason ?? "";
  const specific =
    PRONUNCIATION_PROBLEM.test(reason) && [...`${facts.surname}${facts.givenName}`].some((c) => reason.includes(c));
  if (specific && model.tier < base.tier) {
    return { tier: clampTier("pronunciation", base.tier - 4), reason };
  }
  return { tier: base.tier, reason: base.tier < 20 ? base.reason : reason || base.reason };
}

/**
 * 打分口径的版本号：改了算分规则就加一，接口层缓存按它分开，不会把旧口径的分数重放出来。
 * 2：读音档以规则为准（2026-11-05）。
 * 3：模型判「像上一辈」由程序压字义和流行，不再被规则的年代字去重掉（2026-11-05）。
 * 4：「非常优秀」要过门，80–89 叫「还能更好」（2026-11-05）。
 * 5：大姓配单名的改法可以加一个字变双名（2026-11-05）；旧缓存里王旭这类是「改一个字解决不了」。
 */
export const SCORING_REV = 5;

export function dimensionScores(
  facts: NameFacts,
  tiers: { pronunciation: TierChoice; meaning: TierChoice; gender: TierChoice; style: TierChoice },
): DimensionScores {
  const gender = tiers.gender.tier;
  const style = tiers.style.tier;
  return {
    pronunciation: tiers.pronunciation.tier,
    meaning: tiers.meaning.tier,
    gender,
    style,
    temperament: gender + style,
    literacy: facts.program.literacy.score,
    popularity: facts.program.popularity.score,
    homophone: facts.program.homophone.score,
  };
}

/** 风险上限：只认已确认的问题，不认模型的主观否定。notGreat 是没过「非常优秀」门槛时的封顶 */
export const CAPS = { severe: 69, minor: 79, neutralFemale: 89, notGreat: 89 } as const;

export interface CapInput {
  gender: AnalysisGender;
  lean: NameFacts["lean"];
  risk: NameFacts["risk"];
  /**
   * 模型给的性别辨识档位。89 这条要求字表和模型都认为中性才压：
   * 只看字表会把「舜华」这种模型判为女性辨识度足够的名字误伤（2026-11-04 样例发现）。
   */
  genderTier?: number;
}

/** 第一版默认女孩要女性辨识度；中性名压到 89，不给「非常优秀」。样例跑完再定要不要关 */
export const STRICT_FEMALE_IDENTITY = true;

export function capFor(input: CapInput): { cap: number; reason: string } | null {
  if (input.risk.severe.length > 0) {
    return { cap: CAPS.severe, reason: input.risk.severe[0]!.line };
  }
  if (input.risk.minor.length > 0 || input.risk.genderMismatch === "whole") {
    const reason = input.risk.minor[0]?.line ?? "整个名字偏另一个性别";
    return { cap: CAPS.minor, reason };
  }
  if (
    STRICT_FEMALE_IDENTITY &&
    input.gender === "female" &&
    input.lean.overall === "neutral" &&
    (input.genderTier ?? 8) <= 8
  ) {
    return { cap: CAPS.neutralFemale, reason: "要女孩名，整体偏中性" };
  }
  return null;
}

/** 原名总分里风格按这个基准算：风格是偏好，不直接压总分（2026-11-04 用户定） */
export const STYLE_BASE = 6;

/**
 * 原名算分时 styleBaseline 打开：风格用 6 分基准，不随模型给的 4/2 掉分。
 * 风格仍然记在 dimensions.style 里，候选验收和排序时用实际档位比。
 * 候选不传这个参数，风格按模型判断算。
 */
export function scoreBreakdown(
  facts: NameFacts,
  tiers: { pronunciation: TierChoice; meaning: TierChoice; gender: TierChoice; style: TierChoice },
  opts: { styleBaseline?: boolean; old?: boolean } = {},
): ScoreBreakdown {
  const dimensions = dimensionScores(facts, tiers);
  if (opts.styleBaseline) dimensions.temperament = dimensions.gender + STYLE_BASE;
  const base =
    dimensions.pronunciation +
    dimensions.meaning +
    dimensions.temperament +
    dimensions.literacy +
    dimensions.popularity +
    dimensions.homophone;
  let cap = capFor({ gender: facts.gender, lean: facts.lean, risk: facts.risk, genderTier: tiers.gender.tier });
  if (!cap) {
    const why = greatBlock(facts, tiers, opts.old ?? false);
    if (why) cap = { cap: CAPS.notGreat, reason: why };
  }
  const total = Math.max(0, Math.min(base, cap?.cap ?? 100));
  const { band, label } = bandOf(total);
  return {
    dimensions,
    base,
    cap: cap?.cap ?? null,
    capReason: cap?.reason ?? null,
    total,
    band,
    bandLabel: label,
  };
}

/**
 * 模型判断整名像上一辈、菜市场名、口号或职业词时，流行分压到 4 再重算总分。
 * 规则表收不全各地常见名（志明、俊杰、建宏这些台湾菜市场名），这类判断交给模型，程序只做这一档降分。
 */
export function applyAgePenalty(scores: ScoreBreakdown): ScoreBreakdown {
  if (scores.dimensions.popularity <= 4) return scores;
  const dimensions = { ...scores.dimensions, popularity: 4 };
  const base =
    dimensions.pronunciation +
    dimensions.meaning +
    dimensions.temperament +
    dimensions.literacy +
    dimensions.popularity +
    dimensions.homophone;
  const total = Math.max(0, Math.min(base, scores.cap ?? 100));
  const { band, label } = bandOf(total);
  return { ...scores, dimensions, base, total, band, bandLabel: label };
}
