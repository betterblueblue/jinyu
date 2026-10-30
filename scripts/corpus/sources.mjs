/**
 * 语料源清单。
 *
 * 两类来源：
 *   poem  — chinese-poetry/chinese-poetry 的 JSON（已完成清洗与分篇）
 *   txt   — garychowcmu/daizhigev20（殆知阁古代文献）的纯文本，需按标题行切块
 *
 * 只收录能被「原文精确匹配」核验的来源。格式脏到无法切分或注文混排的，
 * 宁可不收，也不让核验给出看似可信的错误结论。
 */

export const POEM_BASE = "https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/";
export const TXT_BASE = "https://raw.githubusercontent.com/garychowcmu/daizhigev20/master/";

/** 全唐诗、全宋词按千条分片，单独展开 */
function range(start, end, step, prefix, suffix) {
  const out = [];
  for (let i = start; i < end; i += step) out.push(`${prefix}${i}${suffix}`);
  return out;
}

export const SOURCES = [
  // ---------- 经部 ----------
  { id: "shijing", name: "诗经", tier: "core", kind: "poem", files: ["诗经/shijing.json"] },
  { id: "chuci", name: "楚辞", tier: "core", kind: "poem", files: ["楚辞/chuci.json"] },
  { id: "lunyu", name: "论语", tier: "core", kind: "poem", files: ["论语/lunyu.json"] },
  // 四书里 chinese-poetry 的版本是繁体（孟子 21% 繁体字），改取殆知阁的简体本，
  // 否则模型给的简体引文一条都核验不过
  {
    id: "daxue",
    name: "大学",
    tier: "core",
    kind: "txt",
    files: ["儒藏/四书/大学.txt"],
    heading: null,
  },
  {
    id: "zhongyong",
    name: "中庸",
    tier: "core",
    kind: "txt",
    files: ["儒藏/四书/中庸.txt"],
    heading: null,
  },
  {
    id: "mengzi",
    name: "孟子",
    tier: "core",
    kind: "txt",
    files: ["儒藏/四书/孟子.txt"],
    heading: /^\s*卷[一二三四五六七八九十]+\s+\S+\s*$/,
  },
  {
    id: "zhouyi",
    name: "周易",
    tier: "core",
    kind: "txt",
    files: ["易藏/易经/周易.txt"],
    heading: /^\s*\d{1,2}\.\s*(\S+?（卦\S+?）)\s*$/,
  },
  {
    id: "shangshu",
    name: "尚书",
    tier: "core",
    kind: "txt",
    files: ["儒藏/尚书/尚书.txt"],
    heading: /^\s*[虞夏商周]书\s+\S+第[一二三四五六七八九十百]+篇?\s*$/,
  },
  {
    id: "liji",
    name: "礼记",
    tier: "core",
    kind: "txt",
    files: ["儒藏/礼经/礼记.txt"],
    heading: /^\s*《礼记(\S+?)》\s*$/,
  },
  {
    id: "zuozhuan",
    name: "左传",
    tier: "core",
    kind: "txt",
    files: ["儒藏/春秋/春秋左传.txt"],
    heading: /^\s*◇\s*(\S+)$/,
  },

  // ---------- 诗文总集 ----------
  {
    id: "wenxuan",
    name: "文选",
    tier: "optional",
    kind: "txt",
    files: ["集藏/文总集/文选昭明文选.txt"],
    heading: /^\s*卷[一二三四五六七八九十百]+\s+\S+/,
  },
  { id: "guwenguanzhi", name: "古文观止", tier: "optional", kind: "poem", files: ["蒙学/guwenguanzhi.json"] },

  // ---------- 唐诗宋词元曲 ----------
  {
    id: "quantangshi",
    name: "全唐诗",
    tier: "main",
    kind: "poem",
    files: range(0, 58000, 1000, "全唐诗/poet.tang.", ".json"),
  },
  {
    id: "songci",
    name: "宋词",
    tier: "main",
    kind: "poem",
    files: [...range(0, 22000, 1000, "宋词/ci.song.", ".json"), "宋词/ci.song.2019y.json"],
  },
  { id: "yuanqu", name: "元曲", tier: "main", kind: "poem", files: ["元曲/yuanqu.json"] },
  { id: "nalan", name: "纳兰词", tier: "optional", kind: "poem", files: ["纳兰性德/纳兰性德诗集.json"] },

  // ---------- 蒙学 ----------
  { id: "qianziwen", name: "千字文", tier: "main", kind: "poem", files: ["蒙学/qianziwen.json"] },
  { id: "shenglvqimeng", name: "声律启蒙", tier: "main", kind: "poem", files: ["蒙学/shenglvqimeng.json"] },
  { id: "sanzijing", name: "三字经", tier: "main", kind: "poem", files: ["蒙学/sanzijing-new.json"] },
  { id: "youxueqionglin", name: "幼学琼林", tier: "main", kind: "poem", files: ["蒙学/youxueqionglin.json"] },
  { id: "qianjiashi", name: "千家诗", tier: "main", kind: "poem", files: ["蒙学/qianjiashi.json"] },
  { id: "tangshi300", name: "唐诗三百首", tier: "main", kind: "poem", files: ["蒙学/tangshisanbaishou.json"] },
  { id: "zengguang", name: "增广贤文", tier: "optional", kind: "poem", files: ["蒙学/zengguangxianwen.json"] },
];

export const TIER_LABEL = {
  core: "核心",
  main: "主要",
  optional: "可选",
};
