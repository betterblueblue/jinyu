/**
 * 直播口播稿：名字库里每个名字配一段固定格式的说法，主播照着念，评审页和提词页用同一套拼法。
 *
 *   ① 王晴川，寓意{one}。                 one 也是观众屏幕上名字下面那一行
 *   ② 出自{from}「{line}」。              只有核过的出处才有这句；没有就不讲，不硬凑
 *   ③ {chars}                             拆字：两个字各是什么意思
 *   ④ {whole}                             合起来的画面，和对孩子的祝福
 *   ⑤ 系统按王姓查过，没查到不好的谐音和生僻字。
 *
 * 第⑤句只在名字过了 checkRecommendable（src/domain/score/recommend.ts）之后才会念，所以总是成立；
 * 措辞是「没查到」，不说「绝对没有」。
 */
import type { ReviewCitation, TalkScript } from "./review-types";

export const TALK_ONE_MAX = 15;

/**
 * 和命理挂钩的说法一律不进口播稿（《网络主播行为规范》第十四条第二十一项）。
 * 按词查，不按单字查：「运行」「缺点」这类正常用法不误伤。
 */
const BANNED = ["五行", "八字", "生辰", "命理", "命格", "运势", "运气", "好运", "转运", "补运", "风水", "喜用", "缺什么", "旺"];

export function checkLine(surname: string): string {
  return `系统按${surname}姓查过，没查到不好的谐音和生僻字。`;
}

export function talkLines(
  surname: string,
  givenName: string,
  talk: TalkScript,
  citation?: Pick<ReviewCitation, "from" | "line">,
): string[] {
  return [
    `${surname}${givenName}，寓意${talk.one}。`,
    ...(citation ? [`出自${citation.from}「${citation.line}」。`] : []),
    talk.chars,
    talk.whole,
    checkLine(surname),
  ];
}

/** 起草时的格式检查，build-review 用；返回空数组就是没问题 */
export function talkProblems(talk: TalkScript): string[] {
  const out: string[] = [];
  const one = talk.one?.trim() ?? "";
  if (!one) out.push("一句话寓意是空的");
  else {
    if ([...one].length > TALK_ONE_MAX) out.push(`一句话寓意超过 ${TALK_ONE_MAX} 字：${one}`);
    if (/[。！？，、；]$/.test(one)) out.push("一句话寓意结尾不要标点（念的时候接「寓意」和句号）");
  }
  for (const [label, text] of [
    ["拆字", talk.chars],
    ["合起来", talk.whole],
  ] as const) {
    if (!text?.trim()) out.push(`${label}是空的`);
    else if (!text.trim().endsWith("。")) out.push(`${label}要以句号结尾`);
  }
  const all = [talk.one, talk.chars, talk.whole, talk.tip ?? ""].join("|");
  for (const w of BANNED) if (all.includes(w)) out.push(`出现了「${w}」：直播不讲命理`);
  return out;
}
