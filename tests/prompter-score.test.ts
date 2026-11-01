import { describe, expect, it } from "vitest";
import type { FixOption, NameScore } from "@/domain/score/types";
import { parsePrompterRound, type PrompterScoreRound } from "@/live/prompter";
import { prompterFromScore, type ScoreForPrompter } from "../app/live/prompter-sync";

const score: NameScore = {
  fullName: "文红艳",
  surname: "文",
  givenName: "红艳",
  alternatives: [],
  gender: "female",
  score: 75,
  band: "ok",
  bandLabel: "可以用",
  syllables: [],
  pinyin: "wén hóng yàn",
  deductions: [
    {
      rule: "eraName",
      chars: ["红", "艳"],
      positions: [0, 1],
      points: 25,
      line: "「红艳」两个字都是五六十到七十年代起名最常用的字，合在一起就是那个年代的名字。",
    },
  ],
  folk: [],
};

const option: FixOption = {
  fullName: "文红安",
  givenName: "红安",
  from: "艳",
  to: "安",
  index: 1,
  pinyin: "wén hóng ān",
  soundLine: "yàn → ān",
  score: 90,
  band: "great",
  bandLabel: "非常优秀",
  why: "安字稳当",
  meaning: "红是红火，安是平安。合起来是日子红红火火又平平安安，愿她一生顺遂。",
};

const round = (fix: ScoreForPrompter["fix"], kind: "none" | "fix" | "ask" = "fix") =>
  prompterFromScore({ no: 3, score, next: { kind, soundIssues: [] }, fix }) as PrompterScoreRound;

describe("提词页：打分稿", () => {
  it("打完分就推：分数和扣分理由，还没点改字时没有改法", () => {
    const r = round({ phase: "idle", options: [] });
    expect(r).toMatchObject({ state: "score", no: 3, full: "文红艳", pinyin: "wén hóng yàn", score: 75, bandLabel: "可以用" });
    expect(r.deductions).toEqual([{ points: 25, line: score.deductions[0]!.line }]);
    expect(r.fix).toBeUndefined();
    expect(r.say).toBeUndefined();
  });

  it("点了改字、改法还没到：先给主播一句过渡的话", () => {
    const r = round({ phase: "running", options: [] });
    expect(r.say).toContain("我看看换哪个字");
    expect(r.fix).toEqual({ running: true, options: [] });
  });

  it("改法到一条推一条：带读音变化、新分数和寓意", () => {
    const r = round({ phase: "running", options: [option] });
    expect(r.say).toBeUndefined();
    expect(r.fix!.options).toEqual([
      { full: "文红安", pinyin: "wén hóng ān", change: "艳 → 安 · yàn → ān", score: 90, meaning: option.meaning },
    ]);
  });

  it("改一个字解决不了：写明原因，建议重新起名", () => {
    const r = round({ phase: "done", options: [], unfixable: "红艳两个字合在一起才是那个年代的名字" });
    expect(r.fix!.note).toContain("改一个字解决不了：红艳");
    expect(r.fix!.note).toContain("重新起名");
  });

  it("90 分以上说不用改；有读音硬伤时先问观众", () => {
    expect(round({ phase: "idle", options: [] }, "none").say).toBe("这个名字已经很好，不用改。");
    expect(round({ phase: "idle", options: [] }, "ask").say).toContain("先问观众");
  });

  it("推上去的打分稿过得了同步接口的格式校验，坏的整份不收", () => {
    for (const r of [
      round({ phase: "idle", options: [] }),
      round({ phase: "running", options: [option] }),
      round({ phase: "done", options: [], unfixable: "改不了" }),
    ]) {
      expect(parsePrompterRound(JSON.parse(JSON.stringify(r)))).toEqual(r);
    }
    const good = round({ phase: "running", options: [option] });
    expect(parsePrompterRound({ ...good, score: 120 })).toBeNull();
    expect(parsePrompterRound({ ...good, fix: { running: false, options: [0, 1, 2, 3].map(() => good.fix!.options[0]) } })).toBeNull();
    expect(parsePrompterRound({ ...good, deductions: [{ points: 5, line: "长".repeat(301) }] })).toBeNull();
  });
});
