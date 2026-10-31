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

/**
 * 姓本身就是某个常用字的异体/同形，名首字一撞，连读就成那个词。
 *
 * 沈是「沉」的异体：沈默→沉默、沈思→沉思、沈重→沉重……这些**拼音并不相同**
 * （shěn / chén），上面 BAD_PREFIX 那套拼音前缀比对抓不到，只能按字拦。
 * 2026-10-31 抓到的模型推理原文里，它自己在逐个躲这批字（默、思、重、香、阳……），
 * 说明这是直播真会念错的坑，删了提示词第 7 条之后必须由这里接手。
 *
 * 扩法：谁发现新的就加一行，键是姓，值是「名首字」的集合。
 */
const SURNAME_CHAR_TRAP: Record<string, ReadonlySet<string>> = {
  沈: new Set(["默", "思", "重", "香", "睡", "浮", "着", "稳", "淀", "沦", "迷", "溺", "痛"]),
};

function flatSyllables(text: string, surnameMode = false): string[] {
  const out = pinyin(text, {
    toneType: "none",
    type: "array",
    ...(surnameMode ? { surname: "head" as const } : {}),
  });
  return (Array.isArray(out) ? out : [out]).map((s) => String(s).toLowerCase());
}

function flatPinyin(text: string): string {
  return flatSyllables(text).join("");
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
  // 姓的末字音节 与 名首字音节 相同（王望、林临、欧阳阳）→ 连念两遍同一个音。
  // 坏词表只有十几个词，这一条是不查词表也拦得住的那一半。
  const surnameTail = flatSyllables(surname.trim(), true).at(-1);
  const givenHead = flatSyllables([...name][0] ?? "").at(0);
  if (surnameTail && givenHead && surnameTail === givenHead) {
    reasons.push("姓与名首字同音");
  }
  // 姓与名首字连读成常用词（沈 + 默 = 沉默），按字拦，不按音
  const trap = SURNAME_CHAR_TRAP[surname.trim()];
  if (trap && trap.has([...name][0] ?? "")) {
    reasons.push("姓与名首字连读成常用词");
  }

  return { keep: reasons.length === 0, reasons, hotChar, ...(homophone ? { homophone } : {}) };
}

export function fastGateStats() {
  return { l1: L1.size, l2: L2.size, forbidden: FORBIDDEN.size };
}
