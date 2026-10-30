import { foldText, gbLevel, strokesOf } from "./chars";
import { leanFacts } from "./gender-lean";
import type { AnalysisFacts, AnalysisGender, CharFact, NameIssue, NameSplit } from "./types";

/**
 * 本地确定性检查。
 *
 * 这几项不交给模型：笔画、字集在不在、性别倾向字，都是查表能查出来的，
 * 让模型去数笔画只会得到看起来很像对的错答案。
 */

const STROKE_GAP = 9;
/** GB2312 一级共 3755 字，是「最常用」的边界 */
const COMMON_LEVEL = 1;

export function buildLocalChecks(
  split: NameSplit,
  gender: AnalysisGender,
): { facts: AnalysisFacts; issues: NameIssue[] } {
  const chars: CharFact[] = [];
  const issues: NameIssue[] = [];
  const seen = new Set<string>();

  for (const ch of split.surname + split.givenName) {
    const key = foldText(ch);
    if (seen.has(key)) continue;
    seen.add(key);
    chars.push({ char: ch, strokes: strokesOf(ch), gb: gbLevel(ch) });
  }

  const given = chars.filter((c) => split.givenName.includes(c.char));

  // 笔画失衡：整名里最繁和最简差得太多，签名和小学生写字都难受
  const measured = chars.filter((c) => c.strokes !== null);
  if (measured.length >= 2) {
    const sorted = [...measured].sort((a, b) => a.strokes! - b.strokes!);
    const low = sorted[0]!;
    const high = sorted[sorted.length - 1]!;
    if (high.strokes! - low.strokes! >= STROKE_GAP) {
      issues.push({
        kind: "glyph",
        severity: "cost",
        text: `笔画差得有点远：「${low.char}」${low.strokes} 画，「${high.char}」${high.strokes} 画，写在一起一边轻一边重。`,
        hint: "签名和小时候练字都会吃力一点，介意的话可以把笔画往中间收一收。",
      });
    }
  }

  // 字集：不在 GB2312 一级里的字，办证、开户、订票时可能出不来
  for (const c of given) {
    if (c.gb === 0) {
      issues.push({
        kind: "glyph",
        severity: "cost",
        text: `「${c.char}」不在最常用的那三千多字里，有些老系统会打不出来或者显示成方框。`,
        hint: "如果常年要填表、买票、办证，先确认一下身份证和银行能不能正常录入这个字。",
      });
    }
  }

  const lean = leanFacts(split.givenName);
  const opposite = gender === "male" ? lean.femaleCount : gender === "female" ? lean.maleCount : 0;
  const same = gender === "male" ? lean.maleCount : gender === "female" ? lean.femaleCount : 0;

  if (opposite > 0 && same === 0) {
    const toward = gender === "male" ? "女性" : "男性";
    issues.push({
      kind: "gender",
      severity: opposite >= 2 ? "hard" : "cost",
      text:
        `名字里的字在人名里更多用在${toward}身上，和填的性别对不上。` +
        (gender === "male" ? "男生用这一组字，从小到大容易被当成女生。" : "女生用这一组字，容易被当成男生。"),
      hint: "不是不能这么取，只是每次自报家门都要多解释一句。",
    });
  } else if (opposite > 0 && same > 0) {
    const toward = gender === "male" ? "女性" : "男性";
    issues.push({
      kind: "gender",
      severity: "cost",
      text: `名字里男女字混着用，其中偏${toward}的字会让人一时猜不准。`,
      hint: "中性名有中性名的好处，看你在不在意被猜错。",
    });
  }

  return {
    facts: {
      chars,
      lean: lean.facts,
      overallLean: lean.overall,
    },
    issues,
  };
}

export { COMMON_LEVEL };
