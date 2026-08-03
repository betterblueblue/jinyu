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
): { selected: GatedCandidate[]; primary: GatedCandidate } {
  const { total, male, female } = targetCounts(req);

  if (req.gender !== "unknown") {
    const selected = ranked.slice(0, Math.min(total, ranked.length));
    // ensure primary is in selected
    let primary = selected[Math.min(primaryIndex, selected.length - 1)] ?? selected[0]!;
    if (!selected.includes(ranked[primaryIndex]!)) {
      const p = ranked[primaryIndex]!;
      if (p && !selected.find((s) => s.givenName === p.givenName)) {
        selected[0] = p;
        primary = p;
      }
    } else {
      primary = ranked[primaryIndex]!;
    }
    // reorder: primary first
    const rest = selected.filter((s) => s.givenName !== primary.givenName);
    return { selected: [primary, ...rest], primary };
  }

  const males = ranked.filter((c) => c.genderLean !== "female");
  const females = ranked.filter((c) => c.genderLean !== "male");
  const mPick = males.slice(0, male ?? 2);
  const fPick = females.slice(0, female ?? 2);
  // fill if one side short
  const used = new Set([...mPick, ...fPick].map((c) => c.givenName));
  for (const c of ranked) {
    if (mPick.length + fPick.length >= (total ?? 4)) break;
    if (used.has(c.givenName)) continue;
    if (mPick.length < (male ?? 2)) {
      mPick.push(c);
      used.add(c.givenName);
    } else if (fPick.length < (female ?? 2)) {
      fPick.push(c);
      used.add(c.givenName);
    }
  }
  const selected = [...mPick, ...fPick];
  const primary =
    selected.find((s) => !s.l2Hot) ??
    selected[Math.min(primaryIndex, Math.max(0, selected.length - 1))] ??
    selected[0]!;
  const rest = selected.filter((s) => s.givenName !== primary.givenName);
  return { selected: [primary, ...rest], primary };
}

export function assembleReport(input: AssembleInput): ReportDocument {
  const { request, ranked, primaryIndex, eliminated, styleNotes, relaxations, stages, bazi } = input;
  const { selected, primary } = pickNames(ranked, request, primaryIndex);

  const names: NameDetail[] = selected.map((c) => ({
    fullName: c.fullName,
    givenName: c.givenName,
    isPrimary: c.givenName === primary.givenName,
    genderLean: c.genderLean,
    phonology: c.phonology || "读音与声调宜在家庭内试叫确认。",
    glyph: c.glyph || "字形宜工整好写，避免生僻难认。",
    meaning: c.meaning || "寓意宜具体，忌空话套话。",
    origin: c.origin || "出处为提示生成，请自行核验。",
    pitfalls: c.pitfalls || "未见明显硬伤记录；仍建议家人试念。",
    styleFit: c.styleFit || styleNotes[0] || "默认端庄耐看方向。",
    l2Hot: Boolean(c.l2Hot),
  }));

  const maleNames =
    request.gender === "unknown"
      ? names.filter((n) => n.genderLean !== "female").map((n) => n.fullName)
      : undefined;
  const femaleNames =
    request.gender === "unknown"
      ? names.filter((n) => n.genderLean !== "male").map((n) => n.fullName)
      : undefined;

  const oneLinerParts = [
    `首推 ${primary.fullName}`,
    request.gender === "unknown" ? "含男向与女向备选，出生后可按性别收窄" : "精选少量备选便于比较",
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
      ? "性别未知时男向与女向均有备选；孩子出生后建议按实际性别从对应分组收窄。"
      : "",
    ...styleNotes,
  ]
    .filter(Boolean)
    .join("\n");

  const notRecommended: EliminationNote[] = eliminated.slice(0, 12);
  if (!notRecommended.length) {
    notRecommended.push({
      givenName: "常见网红模板",
      reasons: ["L1 硬拦名单中的高同质化组合不会进入推荐，避免「名字太网红」问题。"],
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
      ? "本报告为未出生/备名语境：不写精确四柱定名结论，名字可作孕期备选。"
      : undefined,
    originDisclaimer: ORIGIN_DISCLAIMER,
  };
}
