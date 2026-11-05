import { pinyin } from "pinyin-pro";
import { toSimplified } from "@/domain/analysis/chars";
import { sayable } from "@/domain/score/fix";
import { nameSyllables } from "@/domain/pinyin-name";
import { factsOf } from "./facts";
import { parseTierChoice } from "./prompt";
import { anchorPronunciation, scoreBreakdown } from "./scoring";
import type { EvalCandidate, NameFacts, OriginalEvaluation, RawCandidate, RejectedCandidate, TierChoice } from "./types";

/**
 * 候选验收（第一版）。机械能判的都判，判不过就丢，不交给主播念。
 *
 *   1. 姓不变、名长度不变、只换一个字；简繁变化不算改字；
 *   2. 不新增已确认的严重问题；原名有严重谐音时，候选不能还带着；
 *   3. 原名性别辨识已经符合目标时，候选不能降低；再用字表做一道兜底，防模型给虚高的档；
 *   4. 总分提高，并且能指出具体改善（solves 给了编号，或者某一维确实涨了）；
 *   5. 模型比较结论是 better；
 *   6. 理由和寓意能当众念（长度、禁词、不引大段原文）。
 */

const WHY_MAX = 20;
const SPOKEN_MIN = 12;
const SPOKEN_MAX = 90;
const LOSS_MAX = 60;

/** 名里第 index 个字的读音（带声调） */
function markAt(surname: string, givenName: string, index: number): string {
  const marks = pinyin(`${toSimplified(surname)}${toSimplified(givenName)}`, { type: "array", surname: "head" });
  return String(marks[[...surname].length + index] ?? "");
}

function plainAt(surname: string, givenName: string, index: number): string {
  const syllables = nameSyllables(`${toSimplified(surname)}${toSimplified(givenName)}`);
  return (syllables[[...surname].length + index]?.py ?? "").toLowerCase();
}

function tierPair(raw: RawCandidate): { pronunciation: TierChoice; meaning: TierChoice; gender: TierChoice; style: TierChoice } | null {
  const pronunciation = parseTierChoice(raw.pronunciation, "pronunciation");
  const meaning = parseTierChoice(raw.meaning, "meaning");
  const gender = parseTierChoice(raw.gender, "gender");
  const style = parseTierChoice(raw.style, "style");
  return pronunciation && meaning && gender && style ? { pronunciation, meaning, gender, style } : null;
}

function clean(raw: RawCandidate, surname: string, givenLength: number): string | null {
  let given = typeof raw.givenName === "string" ? raw.givenName.replace(/\s+/g, "") : "";
  if (given.startsWith(surname) && [...given].length === [...surname].length + givenLength) {
    given = given.slice(surname.length);
  }
  const chars = [...given];
  if (chars.length !== givenLength) return null;
  if (chars.some((c) => !/^[一-鿿]$/.test(c))) return null;
  return given;
}

export function verifyCandidate(
  raw: RawCandidate,
  originalFacts: NameFacts,
  original: OriginalEvaluation,
): { candidate: EvalCandidate; rejected?: undefined } | { candidate?: undefined; rejected: RejectedCandidate } {
  const surname = originalFacts.surname;
  const givenLength = [...originalFacts.givenName].length;
  const given = clean(raw, surname, givenLength);
  const reject = (reasons: string[], total?: number): { rejected: RejectedCandidate } => ({
    rejected: { givenName: given ?? String(raw.givenName ?? "（无名）"), reasons, ...(total === undefined ? {} : { total }) },
  });

  if (!given) return reject(["长度变了、不是汉字，或者名字写错了"]);
  if (toSimplified(given) === toSimplified(surname) && [...given].length === 1) return reject(["候选写成了姓，不是名"]);
  const oldChars = [...originalFacts.givenName];
  const next = [...given];
  const diff = next.map((c, i) => (c === oldChars[i] ? -1 : i)).filter((i) => i >= 0);
  if (diff.length !== 1) return reject(["不是只换一个字"]);
  const index = diff[0]!;
  const from = oldChars[index]!;
  const to = next[index]!;
  if (toSimplified(to) === toSimplified(from)) return reject(["换上的字和原来的字一样（只是简繁写法不同）"]);

  const rawTiers = tierPair(raw);
  if (!rawTiers) return reject(["四个维度的档位或理由不完整"]);

  const facts = factsOf(surname, given, originalFacts.gender);
  // 读音档和原名一样以规则为准，「读音更好」也按规则比，不认模型自己说的（2026-11-05）
  const tiers = { ...rawTiers, pronunciation: anchorPronunciation(facts, rawTiers.pronunciation) };
  /*
   * 读音没变的改法（李一诺 → 李仪诺、王伟 → 王玮）：撞名、年代感、谐音是念出来才有的毛病，
   * 换个同音字，喊名字时还是原来那个。流行、谐音两维是按字查表的，会以为毛病没了。
   * 所以读音没变时这两维按原名算，只认字义、写法上的提升（军 → 钧 不再是军种词，这算）。
   * 不一律拦同音改法：看出来的毛病（字义、生僻、多音）换同音字正好（2026-11-05 用户：读音必须变不合理）。
   */
  const sameSound = plainAt(surname, given, index) === plainAt(surname, originalFacts.givenName, index);
  const scoredFacts: NameFacts = sameSound
    ? {
        ...facts,
        program: {
          ...facts.program,
          popularity: originalFacts.program.popularity,
          homophone: originalFacts.program.homophone,
        },
      }
    : facts;
  // 2026-11-05 定（方案 A）：原名和候选都不把风格算进总分；风格只用于 betterDimension 和排序
  const scores = scoreBreakdown(scoredFacts, tiers, { styleBaseline: true });
  const reasons: string[] = [];

  if (raw.verdict !== "better") reasons.push("模型自己的比较结论不是更值得用");
  if (facts.risk.severe.length > 0) reasons.push(`新增了已确认的严重问题：${facts.risk.severe[0]!.line}`);
  if (originalFacts.risk.hasSevereHomophone && facts.risk.hasHomophone) reasons.push("原来的严重谐音没有解决");
  /*
   * 候选解决了原名的谐音（谐音分比原名高；读音没变时按原名算，不会误判成解决了）。
   * 杜子腾 → 杜子衡 69 → 90，原来被下面两条挡掉（2026-11-05）：
   *   - 「至少一项比原名好」只看模型的四个档位，谐音是程序算的，不在里面；
   *   - 「流行、识读不能变差」没有例外，杜宇腾因为宇是热门字被拒。
   * 谐音是会被起外号的硬伤，比用了个热门字重，所以解决了谐音时流行分可以降；
   * 识读可以降到 12（一个次常用字），再低就是换上了生僻或多音的次常用字，等于拿一个新麻烦换旧麻烦，照样拒。
   */
  const homophoneFixed = scoredFacts.program.homophone.score > originalFacts.program.homophone.score;
  // 独立于模型档位的检查：候选不能新增一般问题，也不能让流行或识读变差
  if (facts.risk.minor.length > originalFacts.risk.minor.length) reasons.push("新增了一般问题");
  if (!homophoneFixed && facts.program.popularity.score < originalFacts.program.popularity.score) reasons.push("流行分比原名低");
  const literacyFloor = homophoneFixed ? Math.min(12, originalFacts.program.literacy.score) : originalFacts.program.literacy.score;
  if (facts.program.literacy.score < literacyFloor) reasons.push("识读分比原名低");

  const gain = scores.total - original.scores.total;
  if (gain <= 0) {
    reasons.push(
      sameSound && scoreBreakdown(facts, tiers, { styleBaseline: true }).total > original.scores.total
        ? `读音没变，撞名、年代感念出来还在，总分没有提高（${scores.total} 对 ${original.scores.total}）`
        : `总分没有提高（${scores.total} 对 ${original.scores.total}）`,
    );
  }
  // solves 只能引用原名真实存在的规则问题编号；模型常按示例习惯写 R1，这里必须过滤
  const ruleIds = new Set(originalFacts.issues.map((it) => it.id));
  const solves = Array.isArray(raw.solves)
    ? raw.solves
        .filter((x): x is string => typeof x === "string" && ruleIds.has(x))
        .slice(0, 4)
    : [];
  // 原名有规则问题时，候选至少要对应一条真实编号；没有规则问题时不做这个门槛
  if (originalFacts.issues.length > 0 && solves.length === 0) {
    reasons.push("没有对应原名的问题编号");
  }
  /*
   * 换上的字本身要更好，不能只是「换了个不老的写法」。
   * 文娟 → 文晴：风格变亮，过；文娟 → 文安：三维都没动，只是换了个中性字，拒。
   * 不看性别档降不降：性别辨识已经在气质分里算过，再单独拦一次会误伤「中性但更亮」的候选。
   */
  const betterDimension =
    homophoneFixed ||
    (["pronunciation", "meaning", "gender", "style"] as const).some((k) => tiers[k].tier > original.tiers[k].tier);
  if (!betterDimension) reasons.push("读音、字义、风格、谐音没有一项比原名好");

  const why = typeof raw.why === "string" ? raw.why.replace(/\s+/g, "").trim() : "";
  if (!why || !sayable(why, WHY_MAX)) reasons.push("榜上那句理由不能念");
  const spoken = typeof raw.spoken === "string" ? raw.spoken.replace(/\s+/g, "").trim() : "";
  if (!spoken || !sayable(spoken, SPOKEN_MAX, SPOKEN_MIN)) reasons.push("寓意不能念（长度、禁词或引文）");

  const loss = typeof raw.loss === "string" ? raw.loss.replace(/\s+/g, "").trim().slice(0, LOSS_MAX) : "";

  if (reasons.length > 0) return reject(reasons, scores.total);

  const oldMark = markAt(surname, originalFacts.givenName, index);
  const newMark = markAt(surname, given, index);
  return {
    candidate: {
      fullName: `${surname}${given}`,
      givenName: given,
      from,
      to,
      index,
      pinyin: facts.pinyin,
      soundLine: oldMark === newMark ? "读音不变" : `${oldMark} → ${newMark}`,
      scores,
      tiers,
      solves,
      keeps: Array.isArray(raw.keeps) ? raw.keeps.filter((x): x is string => typeof x === "string").slice(0, 3) : [],
      loss,
      why,
      spoken: /[。！？]$/.test(spoken) ? spoken : `${spoken}。`,
      verdict: "better",
      gain,
    },
  };
}
