import l1Templates from "@/config/l1-templates.json";
import l2Chars from "@/config/l2-chars.json";
import forbiddenChars from "@/config/forbidden-chars.json";
import forbiddenMild from "@/config/forbidden-mild.json";
import folkChars from "@/config/folk-chars.json";
import badHomophones from "@/config/bad-homophones.json";
import eraNames from "@/config/era-names.json";
import nameChars from "@/config/name-chars.json";

/**
 * 打分用的词表，全部是 src/config 下的 JSON。
 *
 * 刻意不从 src/fast/gate.ts 里取：那边是精简版取名的闸门，正在另一条线上重构。
 * 谐音坏词表是从 gate.ts 的 BAD_PREFIX 抄过来的，多存了一列「听成什么」，
 * 主播才说得出口；精简版以后想用，直接改成读这份文件即可。
 */

export const TEMPLATE_NAMES: ReadonlySet<string> = new Set(l1Templates as string[]);
export const HOT_CHARS: ReadonlySet<string> = new Set(l2Chars as string[]);
export const FORBIDDEN: ReadonlySet<string> = new Set(forbiddenChars as string[]);
/** 不宜字里偏消极、但不涉及死亡疾病犯罪骂人的那一档，扣得轻一些 */
export const FORBIDDEN_MILD: ReadonlySet<string> = new Set(forbiddenMild as string[]);

export type FolkTier = "swap" | "remind" | "style" | "note";

export interface FolkEntry {
  tier: FolkTier;
  /** note 档恒为 0 */
  points: number;
  line: string;
  /** 毛病出在读音上（娣 = 弟），换同音字解决不了 */
  soundBound: boolean;
}

interface FolkGroup {
  chars: string;
  tier: FolkTier;
  points?: number;
  soundBound?: boolean;
  line: string;
}

export const FOLK: ReadonlyMap<string, FolkEntry> = (() => {
  const map = new Map<string, FolkEntry>();
  for (const g of folkChars as FolkGroup[]) {
    for (const c of g.chars) {
      map.set(c, {
        tier: g.tier,
        points: g.tier === "note" ? 0 : (g.points ?? 0),
        line: g.line.replaceAll("{c}", c),
        soundBound: g.soundBound === true,
      });
    }
  }
  return map;
})();

export interface BadWord {
  /** 词本身，只给开发看 */
  word: string;
  /** 主播嘴里的说法：不雅的词换成「一个不雅的词」，免得直播间被拦 */
  say: string;
  /** 骂人、不雅的扣 30；只是被拿来开玩笑的（马子、孙子）扣 15 */
  points: number;
}

/** 键是去声调、连写的拼音，如 duziteng */
export const BAD_WORDS: ReadonlyMap<string, BadWord> = new Map(
  (badHomophones as { py: string; word: string; say: string; points?: number }[]).map((b) => [
    b.py,
    { word: b.word, say: b.say, points: b.points ?? 30 },
  ]),
);

/**
 * 年代感：公安部全国姓名报告里各年代最常用的名字和字，加上几篇「各年代常用名」的整理。
 * 来源和取舍见 docs/直播打分-民俗字表草稿.md 的「年代感」一节。
 */
export interface EraEntry {
  points: number;
  line: string;
}

export const ERA_NAMES: ReadonlyMap<string, EraEntry> = (() => {
  const map = new Map<string, EraEntry>();
  for (const g of eraNames.names as { list: string[]; points: number; line: string }[]) {
    for (const n of g.list) map.set(n, { points: g.points, line: g.line.replaceAll("{n}", n) });
  }
  return map;
})();

export type EraGroup = "elder" | "parent";

export interface EraChar extends EraEntry {
  /** elder：五六十到七十年代；parent：七十到九十年代 */
  era: EraGroup;
  /** 单名就是这个字时扣的分和说的话，比放在双名里重 */
  single: EraEntry;
}

export const ERA_CHARS: ReadonlyMap<string, EraChar> = (() => {
  const map = new Map<string, EraChar>();
  type Group = { chars: string; era: EraGroup; points: number; single: number; line: string; singleLine: string };
  for (const g of eraNames.chars as Group[]) {
    for (const c of g.chars) {
      map.set(c, {
        era: g.era,
        points: g.points,
        line: g.line.replaceAll("{c}", c),
        single: { points: g.single, line: g.singleLine.replaceAll("{c}", c) },
      });
    }
  }
  return map;
})();

/** 双名两个字都是年代字，整名算一条；line 里的 {n} 换成名 */
export const ERA_PAIR: Readonly<Record<EraGroup | "mixed", EraEntry>> = eraNames.pair;

/** 公安部《2020 年全国姓名报告》人口最多的十个姓 */
export const BIG_SURNAMES: ReadonlySet<string> = new Set([..."王李张刘陈杨黄赵吴周"]);

/**
 * 姓本身是某个常用字的异体，名首字一撞就连读成那个词（沈默 → 沉默）。
 * 与 gate.ts 的 SURNAME_CHAR_TRAP 同一份字，as 是姓被听成的那个字。
 */
export const SURNAME_TRAP: Readonly<Record<string, { as: string; chars: ReadonlySet<string> }>> = {
  沈: { as: "沉", chars: new Set([..."默思重香睡浮着稳淀沦迷溺痛"]) },
};

/**
 * 三声姓接三声字，姓要变成二声，正好听成另一个常见姓（许小明 → 徐小明）。
 * 只收变调后撞上常见姓的，依据见 docs/直播打分-民俗字表草稿.md 第 11.3 节。
 */
export const SANDHI_SURNAME: Readonly<Record<string, string>> = {
  李: "黎",
  许: "徐",
  柳: "刘",
  武: "吴",
  伍: "吴",
  史: "石",
  鲁: "卢",
};

/**
 * 名字用字偏好：名字库里出现过的字按次数排在前，后面接性别倾向表里的字。
 * 只用来给同音候选排先后，不参与打分。数值越小越靠前。
 */
export const NAME_CHAR_RANK: ReadonlyMap<string, number> = new Map(
  (nameChars as string[]).map((c, i) => [c, i]),
);
