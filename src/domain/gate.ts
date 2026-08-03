import l1Templates from "@/config/l1-templates.json";
import l2Chars from "@/config/l2-chars.json";
import type { EliminationNote, GatedCandidate, NormalizedRequest, RawCandidate } from "./types";

const L1 = new Set(l1Templates as string[]);
const L2 = new Set(l2Chars as string[]);

/** Common high-risk polyphones often misread in daily life */
const POLYPHONE_RISK = new Set(["行", "长", "重", "乐", "会", "朝", "调", "量", "种", "传", "觉"]);

export interface GateOptions {
  /** When true (A+), L2 may still pass but never become the only survivors if avoidPopular — still allowed into list */
  relaxL2ForPrimary?: boolean;
  /** When avoidPopular is false, only L1 hard-blocks; L2 soft marks still apply lightly */
}

export interface GateResult {
  passed: GatedCandidate[];
  eliminated: EliminationNote[];
}

function expectedLength(mode: NormalizedRequest["nameLength"]): number {
  return mode === "one" ? 1 : 2;
}

function hasGeneration(given: string, req: NormalizedRequest): boolean {
  if (!req.generationChar) return true;
  const chars = [...given];
  const g = req.generationChar;
  if (req.generationPosition === "any") return chars.includes(g);
  if (req.generationPosition === "first") return chars[0] === g;
  // second: for one-char names, generation must be that single char
  if (chars.length === 1) return chars[0] === g;
  return chars[1] === g;
}

function hasTaboo(given: string, taboo: string[]): boolean {
  return taboo.some((t) => given.includes(t));
}

function isL1(given: string): boolean {
  return L1.has(given);
}

function isL2Hot(given: string): boolean {
  return [...given].some((c) => L2.has(c));
}

function polyphoneNote(given: string): string | undefined {
  const hits = [...given].filter((c) => POLYPHONE_RISK.has(c));
  if (!hits.length) return undefined;
  return `含多音/易误读风险字：${hits.join("、")}，日常称呼时建议确认读音。`;
}

export function applyHardGate(candidates: RawCandidate[], req: NormalizedRequest): GateResult {
  const passed: GatedCandidate[] = [];
  const eliminated: EliminationNote[] = [];
  const wantLen = expectedLength(req.nameLength);
  const seen = new Set<string>();

  for (const c of candidates) {
    const givenName = c.givenName.trim();
    const reasons: string[] = [];

    if (!givenName) {
      reasons.push("空名");
    }
    if ([...givenName].length !== wantLen) {
      reasons.push(`字数不符（需要${wantLen}字名）`);
    }
    if (isL1(givenName)) {
      reasons.push("常见网红组合，已排除");
    }
    if (hasTaboo(givenName, req.tabooChars)) {
      reasons.push("含避讳字");
    }
    if (!hasGeneration(givenName, req)) {
      reasons.push(
        req.generationPosition === "first"
          ? `缺少辈分字「${req.generationChar}」（需在名第一字）`
          : req.generationPosition === "second"
            ? `缺少辈分字「${req.generationChar}」（需在名第二字/单字名即该字）`
            : `缺少辈分字「${req.generationChar}」`,
      );
    }
    if (seen.has(givenName)) {
      reasons.push("重复候选");
    }

    if (reasons.length) {
      eliminated.push({ givenName: givenName || "(空)", reasons });
      continue;
    }

    seen.add(givenName);
    const l2 = isL2Hot(givenName);
    // When avoidPopular is on, L2 still allowed into list but marked; never hard-drop L2 (soft)
    const poly = polyphoneNote(givenName);
    passed.push({
      ...c,
      givenName,
      fullName: `${req.surname}${givenName}`,
      l2Hot: l2,
      pitfalls: [c.pitfalls, poly].filter(Boolean).join("；") || undefined,
    });
  }

  return { passed, eliminated };
}

/** Never pad recommendations with L1 / taboo / missing-generation names */
export function assertNoForbiddenPadding(names: GatedCandidate[], req: NormalizedRequest): void {
  for (const n of names) {
    if (isL1(n.givenName)) throw new Error(`forbidden pad L1: ${n.givenName}`);
    if (hasTaboo(n.givenName, req.tabooChars)) throw new Error(`forbidden pad taboo: ${n.givenName}`);
    if (!hasGeneration(n.givenName, req)) throw new Error(`forbidden pad generation: ${n.givenName}`);
  }
}

export { isL1, isL2Hot, L1, L2 };
