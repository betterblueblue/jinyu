import { gbLevel, strokesOf, toSimplified } from "@/domain/analysis/chars";
import { leanFacts, leanOf } from "@/domain/analysis/gender-lean";
import type { NameSplit } from "@/domain/analysis/types";
import { BIG_SURNAMES, ERA_CHARS, ERA_NAMES, ERA_WORDS, FOLK, HOT_CHARS, TEMPLATE_NAMES } from "@/domain/score/lexicon";
import { readingsOf, scoreName } from "@/domain/score/score";
import type { NameScore } from "@/domain/score/types";
import { homophoneScore, literacyScore, popularityScore } from "./scoring";
import type { CharFact, FactIssue, NameFacts } from "./types";

/**
 * 把旧规则查到的结果整理成「程序能确认的材料」。
 *
 * 旧规则仍然是最快的事实来源，但新口径只认其中一部分：
 *   - 确认的严重问题（严重谐音、严重不宜字、反面人物同名）→ 压到 69；
 *   - 确认的一般问题（一般谐音、轻度不宜字、整名偏另一个性别）→ 压到 79；
 *   - 民俗说法（宸太大、懿、笔画像一边轻一边重）→ 只提醒，不计分；
 *   - 生僻、多音、撞名、年代感 → 进识读和流行维度，不再单独扣分。
 *
 * 这样旧扣分值不会叠加到新分数上，但「哪些是已确认的硬伤」仍然以规则为准，不看模型。
 */

const SEVERITY_RULES: Record<string, "severe" | "minor" | "plain"> = {
  homophone: "minor",
  forbidden: "minor",
  infamous: "severe",
  rare: "plain",
  misread: "plain",
  trap: "plain",
  sameSound: "plain",
  flatTone: "plain",
  sandhi: "plain",
  gender: "plain",
  template: "plain",
  hot: "plain",
  era: "plain",
  eraName: "plain",
  singleName: "plain",
};

/** 单独处理的规则：民俗只提醒，笔画不再计分 */
const REMIND_ONLY = new Set(["remind", "style"]);
const SKIP = new Set(["strokes"]);

function severityOf(rule: string, points: number): "severe" | "minor" | "plain" {
  if (
    (rule === "homophone" && points >= 30) ||
    (rule === "forbidden" && points >= 30) ||
    rule === "infamous" ||
    (rule === "swap" && points >= 20)
  ) {
    return "severe";
  }
  if ((rule === "homophone" && points > 0) || rule === "forbidden" || (rule === "gender" && points >= 25)) {
    return "minor";
  }
  return SEVERITY_RULES[rule] ?? "plain";
}

function charFacts(givenName: string): CharFact[] {
  return [...givenName].map((ch) => {
    const simplified = toSimplified(ch);
    const folk = FOLK.get(simplified);
    return {
      char: ch,
      simplified,
      gbLevel: gbLevel(simplified),
      readings: readingsOf(simplified),
      strokes: strokesOf(simplified),
      lean: leanOf(simplified),
      ...(folk ? { folk: { tier: folk.tier, line: folk.line } } : {}),
    };
  });
}

function eraOf(givStr: string, giv: string[]): NameFacts["popularityFacts"]["era"] {
  if (ERA_NAMES.has(givStr)) return { kind: "name", chars: giv };
  if (giv.length === 2 && giv.every((c) => ERA_CHARS.has(c))) return { kind: "pair", chars: giv };
  if (giv.length === 1 && ERA_CHARS.has(giv[0]!)) return { kind: "single", chars: giv };
  const hits = giv.filter((c) => ERA_CHARS.has(c));
  return hits.length ? { kind: "char", chars: hits } : null;
}

export function buildFacts(split: NameSplit, score: NameScore): NameFacts {
  const givenName = split.givenName;
  const giv = [...toSimplified(givenName)];
  const givStr = giv.join("");
  const chars = charFacts(givenName);

  const issues: FactIssue[] = [];
  const reminders: string[] = [];
  for (const d of score.deductions) {
    if (SKIP.has(d.rule)) continue;
    if (REMIND_ONLY.has(d.rule)) {
      reminders.push(d.line);
      continue;
    }
    if (d.rule === "swap" && !d.soundBound) {
      // 宸、懿这类民俗判断：主播可以讲，不当客观硬伤
      reminders.push(d.line);
      continue;
    }
    issues.push({
      id: "",
      line: d.line,
      rule: d.rule,
      severity: severityOf(d.rule, d.points),
      chars: d.chars,
    });
  }
  // 整名是年代口号、职业或军种词（海军、建军、卫国）：单独一条，压到 79
  const eraWordHit = [...ERA_WORDS.keys()].find((w) => givStr.includes(w));
  if (eraWordHit) {
    issues.push({
      id: "",
      line: ERA_WORDS.get(eraWordHit)!,
      rule: "eraWord",
      severity: "minor",
      chars: [...givStr].filter((c) => eraWordHit.includes(c)),
    });
  }
  issues.forEach((it, i) => (it.id = `R${i + 1}`));
  const severe = issues.filter((it) => it.severity === "severe");
  const minor = issues.filter((it) => it.severity === "minor");
  const homophones = score.deductions.filter((d) => d.rule === "homophone");
  const hasInfamous = score.deductions.some((d) => d.rule === "infamous");
  const genderDeduction = score.deductions.find((d) => d.rule === "gender");

  const popularityFacts: NameFacts["popularityFacts"] = {
    template: TEMPLATE_NAMES.has(givStr),
    hotChars: TEMPLATE_NAMES.has(givStr) ? [] : giv.filter((c) => HOT_CHARS.has(c)),
    era: eraOf(givStr, giv),
    singleNameBigSurname: giv.length === 1 && BIG_SURNAMES.has(split.surname),
    eraWord: Boolean(eraWordHit),
  };

  return {
    fullName: score.fullName,
    surname: split.surname,
    givenName,
    gender: score.gender,
    pinyin: score.pinyin,
    syllables: score.syllables,
    chars,
    lean: (() => {
      const l = leanFacts(givStr);
      return { overall: l.overall, maleCount: l.maleCount, femaleCount: l.femaleCount };
    })(),
    issues,
    reminders,
    program: {
      literacy: literacyScore(chars),
      popularity: popularityScore(givenName, popularityFacts),
      homophone: homophoneScore(hasInfamous, homophones.map((d) => ({ points: d.points })), score.deductions.some((d) => d.rule === "trap")),
    },
    risk: {
      severe,
      minor,
      hasHomophone: homophones.length > 0,
      hasSevereHomophone: homophones.some((d) => d.points >= 30),
      hasInfamous,
      genderMismatch: genderDeduction ? (genderDeduction.points >= 25 ? "whole" : "mixed") : null,
    },
    popularityFacts,
  };
}

/** 候选名的事实：候选验收要用同一套材料判有没有新增问题 */
export function factsOf(surname: string, givenName: string, gender: NameFacts["gender"]): NameFacts {
  const split: NameSplit = { surname, givenName, alternatives: [] };
  return buildFacts(split, scoreName(split, gender));
}
