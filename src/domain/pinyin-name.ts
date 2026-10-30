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

export function fullNamePinyin(surname: string, givenName: string): NamePinyin {
  const full = `${surname}${givenName}`;
  const chars = [...full];
  if (chars.length === 0) return { text: "" };

  const raw = pinyin(full, { toneType: "symbol", type: "array", surname: "all" });
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
