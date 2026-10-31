import { pinyin } from "pinyin-pro";

/**
 * 全名拼音。
 *
 * 模型只给「名」的拼音，直播和存图要整名带姓一起标音，所以姓氏读音在这里补。
 * 多音姓氏（曾、单、仇、解、查…）不能按常读硬套，统一交给 pinyin-pro 的 surname 模式，
 * 它内置姓氏读音表；拿不准的字会原样返回，这时给一句核对提示，不编一个读音。
 */

/** 作姓时读音与常用读音不同的姓氏（只用于提示主播核对，读音本身来自 pinyin-pro） */
const POLYPHONIC_SURNAMES = new Set([
  "曾",
  "单",
  "仇",
  "解",
  "查",
  "区",
  "朴",
  "尉",
  "乐",
  "任",
  "燕",
  "缪",
  "都",
  "盖",
  "员",
  "种",
  "过",
  "召",
  "繁",
  "能",
  "阚",
  "宁",
  "洗",
  "长",
  "车",
  "秘",
  "折",
  "祭",
  "蕃",
  "藏",
]);

export interface NamePinyin {
  /** 逐字拼音，空格分隔，如 zēng yī míng */
  text: string;
  /** 需要主播/家长核对的提示，没有就不给 */
  hint?: string;
}

export interface NameSyllable {
  ch: string;
  /** 不带声调的拼音，如 qing */
  py: string;
  /** 1–4，轻声/查不到记 0 */
  tone: number;
}

/**
 * 逐字音节 + 声调，直播大字下面那行用。
 *
 * 只给展示用：姓氏位置按姓氏读音取（surname: "head"），和 fullNamePinyin 一致。
 */
export function nameSyllables(text: string, surnameMode = true): NameSyllable[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  const opts = surnameMode ? { surname: "head" as const } : {};
  const nums = pinyin(text, { toneType: "num", type: "array", ...opts });
  const numList = (Array.isArray(nums) ? nums : [nums]).map(String);
  return chars.map((ch, i) => {
    const s = numList[i] ?? ch;
    const tone = Number(s.match(/(\d)$/)?.[1] ?? 0);
    return { ch, py: s.replace(/\d$/, ""), tone };
  });
}

export function fullNamePinyin(surname: string, givenName: string): NamePinyin {
  const full = `${surname}${givenName}`;
  const chars = [...full];
  if (chars.length === 0) return { text: "" };

  // surname: "head" 只把姓氏读音限制在姓氏位置。
  // 用 "all" 会让 pinyin-pro 对**每个字**都套姓氏读音表（core/pinyin/all.mjs:11），
  // 名字里的多音字会被改成姓的读法：陈乐言变 chén yuè yán、解宁变 xiè nìng。
  const raw = pinyin(full, { toneType: "symbol", type: "array", surname: "head" });
  const syllables = (Array.isArray(raw) ? raw : [raw]).map(String);
  const text = syllables.join(" ");

  const unresolved = chars.filter((ch, i) => syllables[i] === ch);
  if (unresolved.length > 0) {
    return { text, hint: `「${unresolved[0]}」的读音没有收录，请核对后再念` };
  }

  const poly = [...surname].find((ch) => POLYPHONIC_SURNAMES.has(ch));
  if (poly) {
    return { text, hint: `姓「${poly}」读 ${syllables[0]}，与日常读法不同` };
  }

  return { text };
}
