import { describe, expect, it } from "vitest";
import { buildMeritSystem, buildMeritUser, parseMerit } from "@/domain/score/merit";
import type { NameScore } from "@/domain/score/types";

const score: NameScore = {
  fullName: "马梓宸",
  surname: "马",
  givenName: "梓宸",
  alternatives: [],
  gender: "male",
  score: 62,
  band: "change",
  bandLabel: "建议改",
  syllables: [],
  pinyin: "mǎ zǐ chén",
  deductions: [
    { rule: "homophone", chars: ["梓"], positions: [0], points: 15, line: "「马梓」连起来念像「马子」，上学容易被起外号。", soundBound: true },
    { rule: "swap", chars: ["宸"], positions: [1], points: 15, line: "宸本来是深宅大屋，后来专指皇帝住的地方，名字起大了。" },
  ],
  folk: [],
};

const json = (chars: string, whole: string) => JSON.stringify({ chars, whole });

describe("提词页：这个名字好在哪", () => {
  it("给模型的：名字、性别，扣分理由只当提醒（别夸被扣分的那一点）", () => {
    const user = buildMeritUser(score);
    expect(user).toContain("马梓宸（姓马，名梓宸，男孩）");
    expect(user).toContain("只是提醒你别夸这几点");
    expect(user).toContain("名字起大了");
    expect(buildMeritUser({ ...score, deductions: [], gender: "unknown" })).toContain("打分规则没扣分");
    expect(buildMeritSystem()).toContain("不要夸它尊贵");
  });

  it("两句都能念才收，补上句号；代码块能剥掉", () => {
    const ok = parseMerit("```json\n" + json("梓是梓树，宸是屋宇", "合起来是老家院子里的一棵梓树，爸妈盼孩子记得根在哪") + "\n```");
    expect(ok).toEqual({ chars: "梓是梓树，宸是屋宇。", whole: "合起来是老家院子里的一棵梓树，爸妈盼孩子记得根在哪。" });
  });

  it("评好坏、讲毛病、碰命理、太短的整段不要：提词页只是少这一段", () => {
    const whole = "合起来是老家院子里的一棵梓树，爸妈盼孩子记得根在哪。";
    expect(parseMerit(json("梓是梓树，宸是屋宇，这是个好名字。", whole))).toBeNull();
    expect(parseMerit(json("梓是梓树，宸是屋宇。", "合起来有点老气，不过意思还行，爸妈的心意是好的。"))).toBeNull();
    expect(parseMerit(json("梓是梓树，宸是屋宇。", "合起来五行属木，八字喜木，爸妈盼孩子一生好运。"))).toBeNull();
    expect(parseMerit(json("梓是树", whole))).toBeNull();
    expect(parseMerit("不是 JSON")).toBeNull();
  });

  it("只给主播看的那句提醒：有就带上，空的不要，碰禁词只丢这一句", () => {
    const base = { chars: "菲是花草芳香，王是姓。", whole: "合起来是一片芬芳，爸妈盼孩子日子香甜。" };
    expect(parseMerit(JSON.stringify({ ...base, tip: "和歌手王菲同名，观众可能会提。" }))!.tip).toBe("和歌手王菲同名，观众可能会提。");
    expect(parseMerit(JSON.stringify({ ...base, tip: "" }))).not.toHaveProperty("tip");
    const banned = parseMerit(JSON.stringify({ ...base, tip: "五行缺木，补一个草字头。" }))!;
    expect(banned).not.toHaveProperty("tip");
    expect(banned.chars).toBe(base.chars);
    expect(buildMeritSystem()).toContain("tip：只给主播看的一句提醒");
  });
});
