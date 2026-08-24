import { nanoid } from "nanoid";
import type {
  EliminationNote,
  GatedCandidate,
  NameDetail,
  NormalizedRequest,
  ReportDocument,
  BaziSummary,
} from "./types";

const ORIGIN_DISCLAIMER =
  "寓意与出处由模型与提示约束生成，首版不做字典自动核验，不保证零幻觉；请以家庭认可与实用避坑为准。";

export interface AssembleInput {
  request: NormalizedRequest;
  ranked: GatedCandidate[];
  primaryIndex: number;
  eliminated: EliminationNote[];
  styleNotes: string[];
  relaxations: string[];
  stages: string[];
  bazi?: BaziSummary | null;
}

function targetCounts(req: NormalizedRequest): { total: number; male?: number; female?: number } {
  if (req.gender === "unknown") {
    return { total: 4, male: 2, female: 2 };
  }
  return { total: 4 };
}

function pickNames(
  ranked: GatedCandidate[],
  req: NormalizedRequest,
  primaryIndex: number,
): {
  selected: GatedCandidate[];
  primary: GatedCandidate;
  maleNames?: string[];
  femaleNames?: string[];
} {
  const { total, male, female } = targetCounts(req);

  // 统一去重：模型可能重复输出同一 givenName 的候选（不同 genderLean/pitfalls），
  // 全部路径（男/女/未知）按 givenName 只保留最先出现的那个，杜绝重复进报告
  const seen = new Set<string>();
  const uniqueRanked = ranked.filter((c) => {
    if (seen.has(c.givenName)) return false;
    seen.add(c.givenName);
    return true;
  });

  if (req.gender !== "unknown") {
    const selected = uniqueRanked.slice(0, Math.min(total, uniqueRanked.length));
    // ensure primary is in selected
    let primary = selected[Math.min(primaryIndex, selected.length - 1)] ?? selected[0]!;
    if (!selected.includes(uniqueRanked[primaryIndex]!)) {
      const p = uniqueRanked[primaryIndex]!;
      if (p && !selected.find((s) => s.givenName === p.givenName)) {
        selected[0] = p;
        primary = p;
      }
    } else {
      primary = uniqueRanked[primaryIndex]!;
    }
    // reorder: primary first
    const rest = selected.filter((s) => s.givenName !== primary.givenName);
    return { selected: [primary, ...rest], primary };
  }

  // 未知性别：男向/女向严格分拣，neutral 只作补齐且不跨组重复，
  // 保证 maleNames 与 femaleNames 完全不重叠
  const needMale = male ?? 2;
  const needFemale = female ?? 2;
  const maleLean = uniqueRanked.filter((c) => c.genderLean === "male");
  const femaleLean = uniqueRanked.filter((c) => c.genderLean === "female");
  const neutralPool = uniqueRanked.filter((c) => c.genderLean !== "male" && c.genderLean !== "female");

  // 男向/女向全量倾向都保留，缺口用 neutral 补齐，每个 neutral 只进一组
  const mPick: GatedCandidate[] = [...maleLean];
  const fPick: GatedCandidate[] = [...femaleLean];
  if (mPick.length < needMale) {
    for (const c of neutralPool) {
      if (mPick.length >= needMale) break;
      mPick.push(c);
    }
  }
  if (fPick.length < needFemale) {
    for (const c of neutralPool) {
      if (fPick.length >= needFemale) break;
      if (mPick.includes(c)) continue; // neutral 已入男向则不再进女向
      fPick.push(c);
    }
  }

  const selected = [...mPick, ...fPick];
  const deduped = Array.from(new Map(selected.map((c) => [c.givenName, c])).values());
  const primary =
    deduped.find((s) => !s.l2Hot) ??
    deduped[Math.min(primaryIndex, Math.max(0, deduped.length - 1))] ??
    deduped[0]!;
  const rest = deduped.filter((s) => s.givenName !== primary.givenName);
  return {
    selected: [primary, ...rest],
    primary,
    maleNames: mPick.map((c) => c.fullName),
    femaleNames: fPick.map((c) => c.fullName),
  };
}

export function assembleReport(input: AssembleInput): ReportDocument {
  const { request, ranked, primaryIndex, eliminated, styleNotes, relaxations, stages, bazi } = input;
  const { selected, primary, maleNames: groupMale, femaleNames: groupFemale } = pickNames(
    ranked,
    request,
    primaryIndex,
  );

  const names: NameDetail[] = selected.map((c) => ({
    fullName: c.fullName,
    givenName: c.givenName,
    isPrimary: c.givenName === primary.givenName,
    genderLean: c.genderLean,
    pinyin: c.pinyin || undefined,
    phonology: c.phonology || "读音与声调宜在家庭内试叫确认。",
    glyph: c.glyph || "字形宜工整好写，避免生僻难认。",
    meaning: c.meaning || "寓意宜具体，忌空话套话。",
    origin: c.origin || "出处为提示生成，请自行核验。",
    pitfalls: c.pitfalls || "未见明显硬伤记录；仍建议家人试念。",
    styleFit: c.styleFit || styleNotes[0] || "默认端庄耐看方向。",
    baziFit: c.baziFit || undefined,
    l2Hot: Boolean(c.l2Hot),
  }));

  const maleNames = request.gender === "unknown" ? groupMale : undefined;
  const femaleNames = request.gender === "unknown" ? groupFemale : undefined;
  // 未知性别时按实际分组情况措辞：两侧都有名字才说「均有备选」
  const bothSides = Boolean(maleNames?.length && femaleNames?.length);

  const oneLinerParts = [
    `首推 ${primary.fullName}`,
    request.gender === "unknown"
      ? bothSides
        ? "含男向与女向备选，得知实际性别后可收窄"
        : "备选较少，得知实际性别后可按向补充"
      : "精选少量备选便于比较",
    request.isPreparationName ? "备名语境" : null,
    relaxations.length ? `已放宽：${relaxations.join("、")}` : null,
  ].filter(Boolean);

  const decisionAdvice = [
    `首推「${primary.fullName}」：在音形义与规则闸门后综合靠前，适合作为主决策参考。`,
    names.length > 1
      ? `其余 ${names
          .filter((n) => !n.isPrimary)
          .map((n) => n.fullName)
          .join("、")} 可作为备选：可按辈分习惯、书写便利与家人试念再定。`
      : "",
    request.gender === "unknown"
      ? bothSides
        ? "性别未知时男向与女向均有备选；得知实际性别后建议从对应分组收窄。"
        : "性别未知，当前备选较少；得知实际性别后建议针对性再取一两个名字。"
      : "",
    ...styleNotes,
  ]
    .filter(Boolean)
    .join("\n");

  const notRecommended: EliminationNote[] = eliminated.slice(0, 12);
  if (!notRecommended.length) {
    notRecommended.push({
      givenName: "常见网红模板",
      reasons: ["为避免过于同质化的热门组合，这类名字已默认排除。"],
    });
  }

  return {
    id: nanoid(12),
    createdAt: new Date().toISOString(),
    request,
    stages,
    relaxations,
    overview: {
      primaryName: primary.fullName,
      names: names.map((n) => n.fullName),
      oneLiner: oneLinerParts.join(" · "),
      maleNames,
      femaleNames,
    },
    names,
    notRecommended,
    bazi: bazi ?? undefined,
    decisionAdvice,
    preparationNote: request.isPreparationName
      ? "本报告为未出生/备名语境：不写精确四柱定名结论，名字可作备选。"
      : undefined,
    originDisclaimer: ORIGIN_DISCLAIMER,
  };
}
