import { pinyin } from "pinyin-pro";
import l1Templates from "@/config/l1-templates.json";
import l2Chars from "@/config/l2-chars.json";
import forbiddenChars from "@/config/forbidden-chars.json";

/**
 * 精简版闸门：只查机器能确定的事，不调模型、不看语感。
 *
 * 与完整版 gate.ts 分开的原因：那边吃 NormalizedRequest（辈分字/避讳/字数字段），
 * 精简版没这些字段，硬塞进去会把整套逻辑带过来。
 */

const L1 = new Set(l1Templates as string[]);
const L2 = new Set(l2Chars as string[]);
const FORBIDDEN = new Set(forbiddenChars as string[]);
const HAN2 = /^[\u4e00-\u9fff]{2}$/;

/**
 * 连姓谐音坏词表。
 *
 * 用「姓 + 名首字」的拼音做前缀比对，不是拿整个全名全等——
 * 双字名连姓是三个音节（沈静姝 = shen jing shu），而坏词基本都是两个音节
 * （shen jing = 神经），全等比永远匹配不上，等于死代码。第一版就栽在这。
 *
 * 只收「念到第二字就已经不雅」的词。像「雷雨」这种正常词不要放进来，
 * 否则雷云帆、雷予禾全部误伤。
 */
const BAD_PREFIX = new Set([
  "wude", // 吴德 → 无德
  "wuyong", // 吴用 → 无用
  "fantong", // 范统 → 饭桶
  "shenjing", // 沈静 → 神经
  "yangwei", // 杨伟 → 阳痿
  "wangba", // 王巴 → 王八
  "shabi", // 沙碧 → 傻逼
  "mabi", // 马屁
  "laji", // 拉基 → 垃圾
  "feiwu", // 费武 → 废物
  "zhutou", // 朱头 → 猪头
  "gouzhu", // 苟住 → 狗住
  "naocan", // 脑残
  "chunzhu", // 蠢猪
  "bendan", // 笨蛋
  "hunzhang", // 混账
  "weishengjin", // 魏生津 → 卫生巾（三音节，走全名比对）
]);

export interface FastGateVerdict {
  keep: boolean;
  reasons: string[];
  hotChar: boolean;
  homophone?: string;
}

function flatPinyin(text: string): string {
  const out = pinyin(text, { toneType: "none", type: "array" });
  return (Array.isArray(out) ? out : [out]).map(String).join("").toLowerCase();
}

export function checkFastCandidate(givenName: string, surname: string): FastGateVerdict {
  const reasons: string[] = [];
  const name = givenName.trim();

  if (!HAN2.test(name)) {
    reasons.push("不是两个汉字");
  }
  if (L1.has(name)) {
    reasons.push("撞热门名字");
  }
  const badChars = [...name].filter((c) => FORBIDDEN.has(c));
  if (badChars.length) {
    reasons.push(`含不宜用字（${badChars.join("、")}）`);
  }

  const hotChar = [...name].some((c) => L2.has(c));
  // 姓 + 名首字 已经是坏词开头 → 念出来就尴尬
  const head = flatPinyin(`${surname}${[...name][0] ?? ""}`);
  const full = flatPinyin(`${surname}${name}`);
  const homophone = BAD_PREFIX.has(head) ? head : BAD_PREFIX.has(full) ? full : undefined;
  if (homophone) {
    reasons.push("连姓读起来不雅");
  }

  return { keep: reasons.length === 0, reasons, hotChar, ...(homophone ? { homophone } : {}) };
}

export function fastGateStats() {
  return { l1: L1.size, l2: L2.size, forbidden: FORBIDDEN.size };
}
