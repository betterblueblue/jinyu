import rejected from "@/config/rejected-names.json";

/**
 * 模型现起的名字，再过一道「口味」检查：名字标准（docs/名字标准.md v2–v5）里用户明确不要、
 * 又能机械判断的几条，加上用户在评审页亲手评过「不要」的名字。命中就不出这个名字。
 *
 * 只管模型起的名字。名字库里的是用户逐个评过的，不走这里（呦呦是叠字，用户给了 80）。
 * 和打分规则（src/domain/score）分开：这几条是用户的口味，不是硬伤，完整版和打分榜不受影响。
 */

/** 景行、知夏、静姝这类：模型照样会起出来（2026-11-01 评测里出过），用户已经评过不要 */
const REJECTED = new Set(rejected.names);

/** v2：「名字里不用未、不、无、莫、非」（未晞「没有早晨」） */
const NEGATIVE = new Set("未不无莫非勿");
/** 晚晴不要（「晚」有迟暮的意思）；疏影不要（「疏」冷清）。同一路的字一起挡 */
const DUSK = new Set("晚暮疏寒凋零落");
/** v3：「两个字都带水的不选」（清源 70）。常见的三点水字 */
const WATER = new Set(
  "清澄澜涵沐泽浩洋海江河湖溪沁洛涛渊源润泊汐淳澈洲漪浅涓潇淼湘沛泓波沫汀涟漫洵浚洪济滢潆淇沅沄澍溶涌沂淑",
);

export function tasteProblems(givenName: string): string[] {
  const chars = [...givenName];
  const out: string[] = [];
  if (REJECTED.has(givenName)) out.push("你在评审页评过不要");
  if (chars.length === 2 && chars[0] === chars[1]) out.push("叠字像小名");
  if (chars.some((c) => NEGATIVE.has(c))) out.push("有否定的字");
  if (chars.some((c) => DUSK.has(c))) out.push("有迟暮、冷清的字");
  if (chars.length === 2 && chars.every((c) => WATER.has(c))) out.push("两个字都带三点水");
  return out;
}
