/**
 * 直播起名评测的版本表：scripts/eval-fast.ts 按名字取。
 *
 *   base   线上现在这一版（src/fast/prompt.ts + config/seed-chars.json）
 *   old    10-31 那一版：旧起手字表 + 四柱进提示词。留着当固定的参照，新版本至少要比它快、比它好
 *
 * 新版本先写在这里跑评测（和 base 交替跑），比 base 好了再搬进 src/fast，线上不跟着实验变。
 *
 * 11-01 调过的版本和结论（每版 30–60 轮，和线上交替跑；「要 / 不要」是 agent 按 docs/名字标准.md 逐个判的首推）：
 *   old                     中位 3.1–3.6s，推理中位 150–210 字；首推「要」4/60，「不要」33/60
 *   v2 起手字表重做 + 提示词写进 v5 口味   中位 4.0s，推理 371 字；「要」19/60，「不要」3/60（不要的少了，但慢）
 *   v3 v2 + 「两个字要有来处」             中位 4.9s，推理 483 字；还把模型赶向同几个名句（怀瑾、含章一场各出两次）
 *   v4 v2 压短提示词                        中位 5.1s，推理 509 字；压短没用，条目在就慢
 *   s2 只换起手字表，提示词不动            中位 3.4s，推理 149 字；「不要」3/30 → 这条路
 *   v5 s2 + 「第 1 个名字呼应出生时节」     没生日的轮次和 old 一样；有生日的轮次中位 5.6s，推理 550 字
 *   v6 v5 + 换两处说法                     推理 416 字，也慢
 * 所以线上：起手字表重做、口味过滤放在模型外面（src/fast/taste.ts）、生日不进提示词（第一个起手字按季节抽）。
 * 这几版的代码在 git 历史里（2026-11-01 那次提交之前的 scripts/eval-fast-variants.ts）。
 */
import { buildBaziSummary } from "../src/domain/bazi";
import { buildFastSystem, buildFastUser, type FastPromptRound } from "../src/fast/prompt";
import type { FastPromptBuilders } from "../src/fast/provider";
import type { FastGender, FastRequest } from "../src/fast/types";

export interface EvalVariant {
  note: string;
  prompt?: FastPromptBuilders;
  seedTable?: Readonly<Record<FastGender, readonly string[]>>;
  /** 一轮发几路（2 或 3），不写跟线上（FAST_LANES） */
  lanes?: number;
}

/** 10-31 的起手字表（scripts/build-seed-chars.ts 第二轮的输出） */
const OLD_FEMALE = [
  ..."棠禾溪岚芸素杏悦韵婉恬晚荷笙锦霁映茉芷茵菁薇蕊雪雯霏雅静颖妍姝娴婧嫣瑜琳珊瑾璇琬柔曼楚乔桐槿苒菡芙筱希冉晗晓煦昀沁潇纯绮音诗蕾芊茗如蕴宛蕙依若月娅妤蓓悠洛泠暖歆漪婕竹安宁然初知言书清和舒晴晏昭澄青简允嘉遥时文明星云南秋夏景佳恩心思念意怀慕宜澜润屿语晨雨瑞枫望熙楠",
];
const OLD_MALE = [
  ..."安宁然初知言书清和舒晴晏昭澄青简允嘉遥时文明星云南秋夏景佳恩心思念意怀慕宜澜润屿语晨光雨瑞枫望熙楠川舟远衡恒砚野原朗致修谨承启越卓牧松柏山岩峻岳立拓帆洲楷柯毅峥骁骏驰鸿铭锐铮崇诚海源澈淳博哲迪逸谦彦煜炜烨焕旭皓恺扬庭钰彬栩弈衍琛璞玮骞叙序齐冬",
];

/** 10-31 的用户消息：多一句四柱 */
function oldUser(req: FastRequest, round: FastPromptRound): string {
  const base = buildFastUser(req, round).replace(/\n只输出 JSON。$/, "");
  if (!req.birthday) return `${base}\n只输出 JSON。`;
  const b = buildBaziSummary({ baziEnabled: true, birthStatus: "born", birthDate: req.birthday, birthHour: undefined });
  const pillars = b.ok && b.summary ? b.summary.pillarsText : "";
  return pillars
    ? `${base}\n这个宝宝的四柱是：${pillars}。名字可以顺带呼应，但不要说天干地支、五行用神这类词，也别说「一定」「注定」——只作温和参考。\n只输出 JSON。`
    : `${base}\n只输出 JSON。`;
}

export const VARIANTS: Record<string, EvalVariant> = {
  base: { note: "线上现在这一版" },
  base2: { note: "线上这一版，只发两路（FAST_LANES=2，11-01 以前的默认）", lanes: 2 },
  old: {
    note: "10-31 那一版：旧起手字表 + 四柱进提示词（固定参照）",
    prompt: { system: buildFastSystem, user: oldUser },
    seedTable: { female: OLD_FEMALE, male: OLD_MALE },
  },
};
