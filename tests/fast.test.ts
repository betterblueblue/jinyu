import { describe, expect, it } from "vitest";
import seedChars from "@/config/seed-chars.json";
import { normalizeFastInput } from "@/fast/normalize";
import { checkFastCandidate, firstCharConflict } from "@/fast/gate";
import { __displayableQuote, citeFromLine, locateCitation } from "@/fast/cite";
import { buildFastSystem, buildFastUser } from "@/fast/prompt";
import { __rankCandidates, __sanitizeRecent, __stripSurname } from "@/fast/run";
import type { FastCandidate } from "@/fast/types";
import { AVOID_MAX, SEEDS_PER_ROUND, pickSeeds } from "@/fast/seeds";
import { FAST_RECENT_MAX } from "@/fast/types";

/** 可复现的随机数（mulberry32），让抽字测试每次结果一样 */
function seeded(n: number): () => number {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("精简版输入校验", () => {
  it("只填姓和性别就能过，不补任何默认值", () => {
    const r = normalizeFastInput({ surname: "苏", gender: "female" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ surname: "苏", gender: "female" });
  });

  it("生日可选，填了必须是真日期", () => {
    expect(normalizeFastInput({ surname: "苏", gender: "male", birthday: "2026-03-15" }).ok).toBe(true);
    const bad = normalizeFastInput({ surname: "苏", gender: "male", birthday: "2026-02-31" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("生日");
  });

  it("姓氏必填、性别必选、复姓允许", () => {
    expect(normalizeFastInput({ surname: "", gender: "male" }).ok).toBe(false);
    expect(normalizeFastInput({ surname: "苏", gender: "unknown" }).ok).toBe(false);
    expect(normalizeFastInput({ surname: "欧阳", gender: "female" }).ok).toBe(true);
    expect(normalizeFastInput({ surname: "欧阳锋", gender: "female" }).ok).toBe(false);
  });
});

describe("精简版闸门", () => {
  it("撞名、忌字、非双字都拦", () => {
    expect(checkFastCandidate("子涵", "苏").keep).toBe(false);
    expect(checkFastCandidate("冥鸿", "高").keep).toBe(false);
    expect(checkFastCandidate("苏清禾", "苏").keep).toBe(false);
  });

  it("干净的名字放行，一个热门字只标记不拦", () => {
    const ok = checkFastCandidate("静姝", "林");
    expect(ok.keep).toBe(true);
    expect(ok.hotChar).toBe(false);

    // 林清瑶：只有「瑶」是热门字，扣 8 分还有 92
    const hot = checkFastCandidate("清瑶", "林");
    expect(hot.keep).toBe(true);
    expect(hot.hotChar).toBe(true);
  });

  it("和打分榜同一套规则：打分会扣到 90 以下的直播不出", () => {
    // 林书瑶：热门字 8 + 笔画差 5（书 4 画、瑶 14 画），87 分。以前只标热门、照样出
    const low = checkFastCandidate("书瑶", "林");
    expect(low.keep).toBe(false);
    expect(low.score).toBe(87);
    expect(low.reasons[0]).toContain("打分不到 90");
    // 宸、懿这类换字档的字，打分扣 15，以前直播闸门不拦
    expect(checkFastCandidate("宸熙", "张", "male").keep).toBe(false);
    // 两个热门字
    expect(checkFastCandidate("梓萱", "陈", "female").keep).toBe(false);
    // 男孩名里两个字都偏女孩
    expect(checkFastCandidate("婉婷", "王", "male").keep).toBe(false);
  });

  it("连姓谐音按「姓 + 名首字」拦，正常词不误伤", () => {
    // 吴德明 → wu de… 念作「无德」
    expect(checkFastCandidate("德明", "吴").keep).toBe(false);
    // 沈静姝 → shen jing… 念作「神经」
    expect(checkFastCandidate("静姝", "沈").keep).toBe(false);
    // 雷云帆 → lei yun… 「雷雨」不算坏词，不能误伤
    expect(checkFastCandidate("云帆", "雷").keep).toBe(true);
  });

  it("姓与名首字连读成常用词的也拦（拼音不同音，只能按字判）", () => {
    // 沈 是「沉」的异体：shěn / chén 拼音不一样，坏词表抓不到
    expect(checkFastCandidate("默然", "沈").keep).toBe(false);
    expect(checkFastCandidate("思远", "沈").keep).toBe(false);
    // 同姓但没撞上那几个字，照常放行
    expect(checkFastCandidate("清和", "沈").keep).toBe(true);
  });

  it("姓与名首字同音直接拦，不依赖坏词表", () => {
    // 王望舒 → wang wang…，林临风 → lin lin…
    expect(checkFastCandidate("望舒", "王").keep).toBe(false);
    expect(checkFastCandidate("临风", "林").keep).toBe(false);
    // 复姓看末字：欧阳 + 阳
    expect(checkFastCandidate("阳春", "欧阳").keep).toBe(false);
    // 不同音照常放行
    expect(checkFastCandidate("望舒", "苏").keep).toBe(true);
  });
});

describe("这一场已给过的名字", () => {
  it("整场都记，超过上限时保留最近的，最早给过的先忘", () => {
    const names = Array.from({ length: FAST_RECENT_MAX + 5 }, (_, i) => `名${String.fromCharCode(0x4e00 + i)}`);
    const kept = __sanitizeRecent(names);
    expect(kept).toHaveLength(FAST_RECENT_MAX);
    expect(kept[0]).toBe(names[5]);
    expect(kept.at(-1)).toBe(names[FAST_RECENT_MAX + 4]);
  });

  it("不是两个汉字的、重复的都剔掉", () => {
    expect(__sanitizeRecent(["清和", "清和", "苏清和", "a", 42])).toEqual(["清和"]);
    expect(__sanitizeRecent("不是数组")).toEqual([]);
  });
});

describe("候选排序", () => {
  const cand = (givenName: string, hotChar = false): FastCandidate => ({
    givenName,
    fullName: `王${givenName}`,
    pinyin: "",
    why: "",
    hotChar,
  });

  it("用了名字字表以外的字排后面，热门字更靠后", () => {
    // 琛白：「白」不在字表；沐宸：热门字；清朗、知远：两个字都在表里
    const ranked = __rankCandidates([cand("琛白"), cand("沐宸", true), cand("清朗"), cand("知远")], []);
    expect(ranked.map((c) => c.givenName)).toEqual(["清朗", "知远", "琛白", "沐宸"]);
  });

  it("同样在表里时，最近用过的字排后面", () => {
    const ranked = __rankCandidates([cand("清朗"), cand("知远")], ["明朗"]);
    expect(ranked.map((c) => c.givenName)).toEqual(["知远", "清朗"]);
  });
});

describe("名字里误带了姓", () => {
  it("三个字且以姓开头就去掉姓，其余原样", () => {
    expect(__stripSurname("王时雨", "王")).toBe("时雨");
    expect(__stripSurname("欧阳明远", "欧阳")).toBe("明远");
    expect(__stripSurname("时雨", "王")).toBe("时雨");
    // 名字本身以姓那个字开头（王 + 王晴）不能误剥：只有两个字时不动
    expect(__stripSurname("王晴", "王")).toBe("王晴");
  });
});

describe("起手字", () => {
  it("每轮 5 个不同的字，都来自对应性别的字表", () => {
    for (const gender of ["female", "male"] as const) {
      const { seeds } = pickSeeds(gender, "苏", [], seeded(1));
      expect(seeds).toHaveLength(SEEDS_PER_ROUND);
      expect(new Set(seeds).size).toBe(SEEDS_PER_ROUND);
      for (const ch of seeds) expect(seedChars[gender]).toContain(ch);
    }
  });

  it("本场出现过的字先不抽，这时也不用提醒", () => {
    const recent = ["初晴", "念安", "清禾", "书宁"];
    const used = new Set(recent.join(""));
    for (let i = 0; i < 50; i++) {
      const { seeds, avoid } = pickSeeds("female", "苏", recent, seeded(i));
      expect(seeds.some((ch) => used.has(ch))).toBe(false);
      expect(avoid).toEqual([]);
    }
  });

  it("跟姓撞的字不抽：王姓不抽「望」（同音），沈姓不抽「思」（沈思→沉思）", () => {
    expect(seedChars.male).toContain("望");
    expect(seedChars.female).toContain("思");
    for (let i = 0; i < 200; i++) {
      expect(pickSeeds("male", "王", [], seeded(i)).seeds).not.toContain("望");
      expect(pickSeeds("female", "沈", [], seeded(i)).seeds).not.toContain("思");
    }
  });

  it("字表用完后从最久没出现的字里补，并把用这些字配过的名字放进提醒", () => {
    // 把女宝字表两两配成名字，模拟一场里字已经全出现过
    const pool = seedChars.female;
    const recent: string[] = [];
    for (let i = 0; i + 1 < pool.length; i += 2) recent.push(`${pool[i]}${pool[i + 1]}`);
    const { seeds, avoid } = pickSeeds("female", "苏", recent, seeded(7));
    expect(seeds).toHaveLength(SEEDS_PER_ROUND);
    expect(avoid.length).toBeGreaterThan(0);
    expect(avoid.length).toBeLessThanOrEqual(AVOID_MAX);
    for (const name of avoid) expect(seeds.some((s) => name.includes(s))).toBe(true);
    // 补进来的字来自更早的那一半，不会是刚出现过的
    const lastHalf = new Set(recent.slice(-Math.floor(recent.length / 4)).join(""));
    expect(seeds.every((ch) => !lastHalf.has(ch))).toBe(true);
  });

  it("补发那一路换一组起手字，和第一路不重叠", () => {
    for (let i = 0; i < 50; i++) {
      const main = pickSeeds("male", "王", [], seeded(i));
      const backup = pickSeeds("male", "王", [], seeded(i + 1000), new Set(main.seeds));
      expect(backup.seeds).toHaveLength(SEEDS_PER_ROUND);
      expect(backup.seeds.some((ch) => main.seeds.includes(ch))).toBe(false);
    }
  });

  it("最近扎堆的配字报出来，起手字本身不算", () => {
    // 最近 4 个名字里「宁」出现 3 次、「禾」2 次、其余各 1 次
    const recent = ["纾宁", "遥宁", "秋禾", "芊宁", "南禾", "依然"];
    const { seeds, tired } = pickSeeds("female", "苏", recent, seeded(3));
    expect(tired).toContain("宁");
    expect(tired).toContain("禾");
    expect(tired).not.toContain("然");
    for (const ch of tired) expect(seeds).not.toContain(ch);
    expect(pickSeeds("female", "苏", [], seeded(3)).tired).toEqual([]);
  });

  it("名字首字和姓的三种撞法都判得出", () => {
    expect(firstCharConflict("望", "王")).toBe(true); // 同音
    expect(firstCharConflict("静", "沈")).toBe(true); // 沈静 → 神经
    expect(firstCharConflict("默", "沈")).toBe(true); // 沈默 → 沉默
    expect(firstCharConflict("望", "苏")).toBe(false);
  });
});

describe("精简版提示词", () => {
  it("系统提示词里不出现具体名字和名句（会被模型当成候选反复出现）", () => {
    const sys = buildFastSystem();
    for (const leak of ["令仪", "莫不令仪", "未晞", "景行", "观澜", "知宜", "书宁", "望舒", "时雨"]) {
      expect(sys).not.toContain(leak);
    }
  });

  it("用户消息带上起手字；有要避开的名字才加那一句", () => {
    const req = { surname: "沈", gender: "female" as const };
    const plain = buildFastUser(req, { seeds: ["禾", "舟", "言", "晏", "澄"], avoid: [] });
    expect(plain).toContain("起手字：禾、舟、言、晏、澄");
    expect(plain).toContain("姓读 shěn");
    expect(plain).not.toContain("别再出");

    const again = buildFastUser(req, { seeds: ["晏", "荷"], avoid: ["晏宁", "荷月"], tired: ["宁", "禾"] });
    expect(again).toContain("别再出：晏宁 荷月");
    expect(again).toContain("这轮别用：宁、禾");
  });
});

describe("篇名 → 原文", () => {
  it("圣俞单篇能截出含两字的句子", () => {
    const hit = locateCitation("诗经", "邶风·静女", "静姝");
    expect(hit).not.toBeNull();
    expect(hit!.quote).toContain("静女其姝");
    expect(hit!.source).toBe("诗经");
  });

  it("篇名对不上就返回 null，让调用方留白", () => {
    expect(locateCitation("诗经", "不存在的篇名", "静姝")).toBeNull();
    expect(locateCitation("宋词", "山园小梅", "疏影")).toBeNull();
  });
});

describe("模型给的原句核验", () => {
  it("原句逐字在原文里、名字挨着 → 直接用模型这一句", () => {
    const hit = citeFromLine("诗经", "邶风·静女", "静姝", "静女其姝");
    expect(hit).not.toBeNull();
    expect(hit!.quote).toBe("静女其姝");
    expect(hit!.piece).toContain("静女");
  });

  it("编出来的句子驳回：同篇但没有这一句", () => {
    expect(citeFromLine("诗经", "邶风·静女", "静姝", "静女其姝，美人在侧")).toBeNull();
  });

  it("句子真在原文里，但名字两个字没按顺序出现 → 驳回", () => {
    // 「静女其娈」是原文，但这句里没有「姝」
    expect(citeFromLine("诗经", "邶风·静女", "静姝", "静女其娈")).toBeNull();
  });

  it("篇名留空时不下场，交回原截句逻辑", () => {
    expect(citeFromLine("诗经", "", "静姝", "静女其姝")).toBeNull();
  });
});

describe("引文展示闸门", () => {
  it("淫靡、贫贱、丧亡这类句子不给观众看", () => {
    expect(__displayableQuote("声噭兮清和，音晏衍兮要婬")).toBe(false);
    expect(__displayableQuote("名位未霑身欲老，诗书宁救眼前贫")).toBe(false);
    expect(__displayableQuote("孰两东门之可芜")).toBe(true); // 不含禁字，靠人判
  });

  it("语料缺字方块、表外生僻字也不给观众看", () => {
    expect(__displayableQuote("□万卷诗书宁愤穷")).toBe(false);
    expect(__displayableQuote("郡带女𡡓名，民康境亦宁")).toBe(false);
    expect(__displayableQuote("四月清和雨乍晴")).toBe(true);
  });

  it("正常句子照常放行", () => {
    expect(__displayableQuote("岂弟君子，莫不令仪")).toBe(true);
    expect(__displayableQuote("白露未晞")).toBe(true);
  });
});
