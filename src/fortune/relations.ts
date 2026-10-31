import { POSITION } from "./strength";
import type { Element, Pillar, Relation } from "./types";

/**
 * 干支之间的合、冲、刑、害。只列关系本身，不判断「合而化」——合化要看月令和透干，
 * 规则太多，交给解读时按盘面说，不在这里下结论。
 */

const GAN_HE = new Set(["甲己", "乙庚", "丙辛", "丁壬", "戊癸"]);
const GAN_CHONG = new Set(["甲庚", "乙辛", "丙壬", "丁癸"]);
const ZHI_HE = new Set(["子丑", "寅亥", "卯戌", "辰酉", "巳申", "午未"]);
const ZHI_CHONG = new Set(["子午", "丑未", "寅申", "卯酉", "辰戌", "巳亥"]);
const ZHI_HAI = new Set(["子未", "丑午", "寅巳", "卯辰", "申亥", "酉戌"]);
/** 寅申、丑未已按相冲列出，两两相刑里不重复 */
const ZHI_XING = new Set(["寅巳", "巳申", "丑戌", "戌未", "子卯"]);
const SELF_XING = "辰午酉亥";
const SAN_HE: [string, Element][] = [
  ["申子辰", "水"],
  ["亥卯未", "木"],
  ["寅午戌", "火"],
  ["巳酉丑", "金"],
];
const SAN_HUI: [string, Element][] = [
  ["寅卯辰", "木"],
  ["巳午未", "火"],
  ["申酉戌", "金"],
  ["亥子丑", "水"],
];
const SAN_XING = ["寅巳申", "丑戌未"];

interface Slot {
  label: string;
  char: string;
}

const pairIn = (set: Set<string>, a: string, b: string) => set.has(a + b) || set.has(b + a);
const at = (s: Slot) => `${s.label}${s.char}`;

function stemPair(a: Slot, b: Slot): Relation[] {
  const out: Relation[] = [];
  if (pairIn(GAN_HE, a.char, b.char)) out.push({ kind: "天干五合", text: `${at(a)}与${at(b)}相合` });
  if (pairIn(GAN_CHONG, a.char, b.char)) out.push({ kind: "天干相冲", text: `${at(a)}与${at(b)}相冲` });
  return out;
}

/** 两个地支之间的关系。半合只认带中神（子午卯酉）的两支 */
function branchPair(a: Slot, b: Slot): Relation[] {
  const out: Relation[] = [];
  const x = a.char;
  const y = b.char;
  if (pairIn(ZHI_HE, x, y)) out.push({ kind: "六合", text: `${at(a)}与${at(b)}六合` });
  if (pairIn(ZHI_CHONG, x, y)) out.push({ kind: "六冲", text: `${at(a)}与${at(b)}相冲` });
  if (pairIn(ZHI_XING, x, y)) out.push({ kind: "相刑", text: `${at(a)}与${at(b)}相刑` });
  if (pairIn(ZHI_HAI, x, y)) out.push({ kind: "相害", text: `${at(a)}与${at(b)}相害` });
  if (x === y && SELF_XING.includes(x)) out.push({ kind: "自刑", text: `${at(a)}与${at(b)}自刑` });
  for (const [group, el] of SAN_HE) {
    const middle = group[1];
    if (x !== y && group.includes(x) && group.includes(y) && (x === middle || y === middle)) {
      out.push({ kind: "半合", text: `${at(a)}与${at(b)}半合${el}局` });
    }
  }
  return out;
}

function stemsOf(pillars: Pillar[]): Slot[] {
  return pillars.map((p) => ({ label: `${POSITION[p.key]}干`, char: p.gan }));
}

function branchesOf(pillars: Pillar[]): Slot[] {
  return pillars.map((p) => ({ label: `${POSITION[p.key]}支`, char: p.zhi }));
}

/** 从若干地支里找出凑齐的三合、三会、三刑（每组只报一次） */
function triples(slots: Slot[]): { relations: Relation[]; fullHe: Set<string> } {
  const relations: Relation[] = [];
  const fullHe = new Set<string>();
  const pick = (group: string) =>
    [...group].map((ch) => slots.find((s) => s.char === ch)).filter((s): s is Slot => Boolean(s));

  for (const [group, el] of SAN_HE) {
    const found = pick(group);
    if (found.length === 3) {
      fullHe.add(group);
      relations.push({ kind: "三合", text: `${found.map(at).join("、")}三合${el}局` });
    }
  }
  for (const [group, el] of SAN_HUI) {
    const found = pick(group);
    if (found.length === 3) relations.push({ kind: "三会", text: `${found.map(at).join("、")}三会${el}方` });
  }
  for (const group of SAN_XING) {
    const found = pick(group);
    if (found.length === 3) relations.push({ kind: "三刑", text: `${found.map(at).join("、")}三刑` });
  }
  return { relations, fullHe };
}

/** 原局内部的干支关系 */
export function natalRelations(pillars: Pillar[]): Relation[] {
  const stems = stemsOf(pillars);
  const branches = branchesOf(pillars);
  const out: Relation[] = [];

  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) out.push(...stemPair(stems[i], stems[j]));
  }

  const { relations, fullHe } = triples(branches);
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const pair = branchPair(branches[i], branches[j]).filter(
        // 已凑成三合局的，不再把其中两支另报半合
        (r) => r.kind !== "半合" || ![...fullHe].some((g) => g.includes(branches[i].char) && g.includes(branches[j].char)),
      );
      out.push(...pair);
    }
  }
  out.push(...relations);
  return out;
}

/** 大运、流年的干支与原局的关系；label 如「流年」「大运」 */
export function incomingRelations(label: string, gan: string, zhi: string, pillars: Pillar[]): Relation[] {
  const stem: Slot = { label: `${label}干`, char: gan };
  const branch: Slot = { label: `${label}支`, char: zhi };
  const out: Relation[] = [];
  for (const s of stemsOf(pillars)) out.push(...stemPair(stem, s));
  for (const b of branchesOf(pillars)) out.push(...branchPair(branch, b));

  const natal = branchesOf(pillars);
  const groups: [string, string][] = [
    ...SAN_HE.map(([g, el]) => [g, `三合${el}局`] as [string, string]),
    ...SAN_HUI.map(([g, el]) => [g, `三会${el}方`] as [string, string]),
    ...SAN_XING.map((g) => [g, "三刑"] as [string, string]),
  ];
  for (const [group, what] of groups) {
    if (!group.includes(zhi)) continue;
    const rest = [...group].filter((ch) => ch !== zhi);
    const found = rest.map((ch) => natal.find((s) => s.char === ch));
    if (found.every(Boolean)) {
      out.push({
        kind: what.startsWith("三合") ? "三合" : what.startsWith("三会") ? "三会" : "三刑",
        text: `${at(branch)}与${(found as Slot[]).map(at).join("、")}凑成${what}`,
      });
    }
  }
  return out;
}
