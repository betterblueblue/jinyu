import type { NormalizedRequest, RawCandidate } from "@/domain/types";
import type { CandidateProvider } from "./types";

/**
 * Deterministic Fake LLM for tests and local happy-path without network.
 * attempt>0 returns extra names so retry/A+ can be exercised.
 */
export class FakeProvider implements CandidateProvider {
  readonly name = "fake";

  constructor(
    private readonly scenario: "default" | "insufficient" | "all_l1" | "with_taboo" = "default",
  ) {}

  async generateCandidates(
    req: NormalizedRequest,
    attempt: number,
    onThinking?: (chunk: string) => void,
  ): Promise<RawCandidate[]> {
    const g = req.generationChar ?? "";
    const two = req.nameLength !== "one";

    onThinking?.(
      `（模拟思考）为「${req.surname}」${
        req.gender === "unknown" ? "性别未定" : req.gender === "male" ? "男宝" : "女宝"
      }起名，${req.generationChar ? `辈分字「${req.generationChar}」` : "辈分无要求"}，优先常用字、避生僻。`,
    );
    onThinking?.("（模拟思考）初步倾向「清」「明」「怀」等清朗字眼，避免网红模板。");

    const mk = (
      a: string,
      b: string,
      lean: RawCandidate["genderLean"],
      extra?: Partial<RawCandidate>,
    ): RawCandidate => {
      const givenName = two ? (g && req.generationPosition === "first" ? `${g}${b}` : g && req.generationPosition === "second" ? `${a}${g}` : `${a}${b}`) : g || a;
      // if generation first and two-char: g+b; if no generation: a+b
      let name = givenName;
      if (two && g) {
        if (req.generationPosition === "first") name = `${g}${b}`;
        else if (req.generationPosition === "second") name = `${a}${g}`;
        else name = `${g}${b}`;
      } else if (two && !g) {
        name = `${a}${b}`;
      } else if (!two && g) {
        name = g;
      } else {
        name = a;
      }
      return {
        givenName: name,
        genderLean: lean,
        pinyin: `${name} 拼音示例`,
        phonology: `${name} 读音顺口，声调宜试念。`,
        glyph: `${name} 字形端正，笔画适中。`,
        meaning: `${name} 寓意端庄耐看，具体可结合家风理解。`,
        origin: `提示生成示例出处，与「书卷」「清朗」等方向可呼应。`,
        pitfalls: "无明显谐音硬伤（示例）。",
        styleFit: "端庄耐看",
        ...extra,
      };
    };

    if (this.scenario === "all_l1") {
      return [
        { givenName: "子轩", genderLean: "male", meaning: "L1" },
        { givenName: "梓涵", genderLean: "female", meaning: "L1" },
        { givenName: "浩宇", genderLean: "male", meaning: "L1" },
      ];
    }

    if (this.scenario === "with_taboo" && req.tabooChars[0]) {
      const t = req.tabooChars[0];
      return [
        mk("清", t, "neutral"),
        mk("明", "远", "male"),
        mk("怀", "瑾", "female"),
        mk("书", "白", "male"),
        mk("清", "和", "female"),
      ];
    }

    if (this.scenario === "insufficient" && attempt === 0) {
      return [mk("清", "远", "male")];
    }

    const base: RawCandidate[] = [
      mk("清", "远", "male", { meaning: "清远：清朗致远，书卷气息。" }),
      mk("怀", "瑾", "female", { meaning: "怀瑾：怀持美玉，温润自持。" }),
      mk("明", "澈", "male", { meaning: "明澈：明净清澈。" }),
      mk("清", "和", "female", { meaning: "清和：温润清和。" }),
      mk("书", "白", "neutral", { meaning: "书白：简洁书卷。" }),
      mk("安", "然", "neutral", { meaning: "安然：端庄安稳。" }),
      // L2-ish optional
      mk("梓", "清", "female", { meaning: "示例偏热门用字组合供 L2 标记。" }),
      // L1 should be filtered
      { givenName: "子轩", genderLean: "male", meaning: "应被 L1 拦" },
      { givenName: "浩宇", genderLean: "male", meaning: "应被 L1 拦" },
    ];

    if (attempt > 0) {
      base.push(
        mk("景", "行", "male", { meaning: "景行：景仰高行。", pitfalls: "「行」多音，需确认读音。" }),
        mk("若", "水", "female", { meaning: "若水：上善若水意象（克制表述）。" }),
      );
    }

    // gender-unknown needs both leans
    if (req.gender === "unknown") {
      return base;
    }
    if (req.gender === "male") {
      return base.filter((c) => c.genderLean !== "female");
    }
    return base.filter((c) => c.genderLean !== "male");
  }
}
