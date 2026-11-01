import type { AnalysisGender, GenderLeanFact } from "./types";

/**
 * 人名里的性别倾向字表。
 *
 * 这是一张经验表，不是统计结论：它记录的是「这个字在人名里更多被用在男/女身上」，
 * 不表示这个字本身有性别。所以文案写「在人名里更多用于女性」，不写「不适合女生」。
 *
 * 只收倾向足够明确的字。像 英、华、平、文、明、欣 这类真正常中性化的字一律不收，
 * 宁可放过，也不能把一个中性名判成性别错位。
 */

/*
 * 2026-11-01 补字（用户要的）：李俊峰给女孩、王雅琳给男孩只扣 8 分、还是 92 分，因为俊、雅不在表里，
 * 整个名字偏另一个性别没认出来。补的是名字里倾向明确、表里漏了的字：
 *   男：俊飞豪健坚驰彬翰霆轩楷；女：雅梦彤菲艳梅凤依黛雪香萌蝶。
 * 宇、辰、涵、欣、诺、子、梓、一、然、安、宁这类男女都常用的照旧不收。
 * 晴也不收：名字库里男孩的晴川、女孩的晴光都有，收了晴川给男孩就推荐不出去了。
 */
const MALE_LEAN = new Set(
  "伟强军勇刚毅峰磊涛鹏龙虎杰斌彪兵波超聪德登东栋发帆锋钢根光广贵国海汉浩皓恒宏洪鸿厚焕辉晖骏峻凯康奎坤雷力立亮禄伦茂民铭璞奇启乾钦庆全泉群仁荣锐森山绍升胜圣石世仕守树帅顺硕松泰天铁庭挺图拓威卫武贤显宪祥翔霄雄修旭宣玄勋迅严炎阳洋尧耀业义益逸鹰友育元原源远岳泽增章彰钊哲振震铮正政志智忠仲柱壮宗祖佐腾骁骐建成功名寿富福" +
    "俊飞豪健坚驰彬翰霆轩楷",
);

const FEMALE_LEAN = new Set(
  "娟秀丽娜婷静芳燕玲霞莉慧敏怡妍媛娴娅妮姝婉婕淑贞蓉薇蕾琪琳璐瑶璇颖嫣姗妙姣婧娇媚曼娆茹蕊莎珊滢莹瑛樱妤茵吟芸纭藻珍芝芷姿紫婵嫦翠娥妃芬芙桂菡红花惠姬洁晶菁菊兰岚莲珑露玫眉美妹苗茗萍芊茜倩巧琴琼柔诗素桃宛雯馨杏琇萱瑶伊盈瑜悦韵珠" +
    "雅梦彤菲艳梅凤依黛雪香萌蝶",
);

export type Lean = "male" | "female" | "neutral";

export function leanOf(ch: string): Lean {
  if (MALE_LEAN.has(ch)) return "male";
  if (FEMALE_LEAN.has(ch)) return "female";
  return "neutral";
}

export function leanFacts(givenName: string): {
  facts: GenderLeanFact[];
  overall: "male" | "female" | "neutral" | "mixed";
  maleCount: number;
  femaleCount: number;
} {
  const facts: GenderLeanFact[] = [];
  let maleCount = 0;
  let femaleCount = 0;
  for (const ch of givenName) {
    const lean = leanOf(ch);
    facts.push({ char: ch, lean });
    if (lean === "male") maleCount++;
    else if (lean === "female") femaleCount++;
  }
  let overall: "male" | "female" | "neutral" | "mixed";
  if (maleCount > 0 && femaleCount > 0) overall = "mixed";
  else if (maleCount > 0) overall = "male";
  else if (femaleCount > 0) overall = "female";
  else overall = "neutral";
  return { facts, overall, maleCount, femaleCount };
}

export const LEAN_LABEL: Record<AnalysisGender | "neutral" | "mixed", string> = {
  male: "男",
  female: "女",
  unknown: "未填",
  neutral: "中性",
  mixed: "男女字混用",
};
