import { pinyin } from "pinyin-pro";
import type { FastRequest } from "./types";

/**
 * 精简版提示词（2026-10-31 第四轮：起手字）。
 *
 * 要解决的问题：旧版每轮都回到模型最熟的那十几个名字（知夏、令仪、予安、景行……）。
 * 只用 DeepSeek v4.1 Flash 实测，每版 9 轮（沈女 / 王男 / 林女各 3 轮）：
 *   - 放开推理（想 6–8 个挑 5 个）  中位 23.2s，推理中位 7851 字，知夏、予安、清禾照样跨轮重复
 *   - 把本场给过的名字整串告诉它    中位 12.5s，知夏、予安还是重复
 *   - 只留规则、什么起点都不给      中位 3.0s，女宝 6 轮里 5 轮有知夏，男宝 3 轮全有知远
 *   - 规则 + 起手字（本版）          中位 2.2s、最慢 6.6s，36 个名字 35 个不同
 * 同一姓连续 20 轮：起手字轮回时再提醒「这几个名字给过」，80 个名字 0 重复。
 * 结论：重复不是推理不够，是没有每轮变化的起点。起点由 seeds.ts 每轮抽 5 个字给出。
 *
 * 这一版刻意不放的东西，每一样都实测过会拖慢或带偏：
 *   - 示例名、标尺：模型会原样复述（旧版 12 个标尺里的景行、观澜、修远，男宝几乎每轮都是它们）
 *   - 任何带具体名字的例句（「莫不令仪」「安知宜不宜」）：会被当成候选反复出现
 *   - 出处要求：中位多 3 秒，36 个名字只核到 1 条。直播出名字不再要出处；
 *     模型若自己给了 source/piece/line，run.ts 照旧逐字核
 *   - 字表、热门名、谐音、同音这类能机械判断的规则：模型会逐条自查。交给 gate.ts 和起手字表
 *   - 「推理不超过 N 字」：DeepSeek 不理；只有「推理里只写候选名字」压得住
 */

export const FAST_JSON_SHAPE = '{"candidates":[{"givenName":"","why":""}]}';

/** 姓氏读音，多音姓按姓的读法（曾 zēng、解 xiè、单 shàn） */
function surnamePinyin(surname: string): string {
  const raw = pinyin(surname, { toneType: "symbol", type: "array", surname: "head" });
  return (Array.isArray(raw) ? raw : [raw]).map(String).join(" ");
}

export function buildFastSystem(): string {
  return [
    "你是中文起名助手，正在直播里给观众的孩子起名。只输出 JSON，不输出任何解释文字。",
    "推理里只写候选名字（一行一个，最多 5 个）。不要写理由、不要写分析、不要复述规则。",
    "",
    "名字要求（字表、热门名、谐音、和姓同音这些系统会查，你不用查）：",
    "- givenName 只填名，两个汉字，不带姓。",
    "- 两个现代常用字，念一遍就懂，叫起来顺口。像 2026 年认真起名的家长会写进出生证明的名字；不要诗词鉴赏里的名，也不要网红爆款名。",
    "- 一个名字讲一件事：一个画面，或者一个愿望。两个字要搭得上，别硬凑。",
    "- 连着姓念要有起伏，不拗口。",
    "- 男宝别过分柔美，女宝别过分硬朗。",
    "- 古人字号（进德、守志）、景物拼贴（水天、江声）、动宾短语（开轩、枕石）、诗句原样搬来的，都不要。",
    "",
    "why：一句话，20 字以内，主播直接念给观众听。说两个字合起来是什么画面或愿望；不要写成「某字是……，某字是……」，不写「寓意深远」「气质不凡」这类空话。",
    "",
    `输出：${FAST_JSON_SHAPE}`,
  ].join("\n");
}

/** 每轮变的那部分：起手字、要避开的名字、可选的四柱 */
export interface FastPromptRound {
  /** 这一轮的起手字，5 个名字各用一个 */
  seeds: string[];
  /** 起手字轮回时，本场已经用这些字配出过的名字 */
  avoid: string[];
  /** 最近几轮配得太多的字（宁、禾这类），这一轮另一个字别用 */
  tired?: string[];
  baziPillars?: string;
}

export function buildFastUser(req: FastRequest, round: FastPromptRound): string {
  const sex = req.gender === "male" ? "男宝宝" : "女宝宝";
  const lines = [`给${req.surname}姓${sex}起 5 个双字名。姓读 ${surnamePinyin(req.surname)}。`];
  if (round.seeds.length) {
    lines.push(
      `起手字：${round.seeds.join("、")}。每个名字用其中一个，另一个字你来配；一个起手字只用一次，两个起手字别放进同一个名字。`,
    );
  }
  // 只列含这一轮起手字的名字，最多 12 个（seeds.ts）。整串报给它会逐个比对，实测 12.5 秒
  if (round.avoid.length) {
    lines.push(`这几个名字这一场已经给过，别再出：${round.avoid.join(" ")}。`);
  }
  if (round.tired?.length) {
    lines.push(`另一个字这一场用多了，这轮别用：${round.tired.join("、")}。`);
  }
  if (round.baziPillars) {
    lines.push(
      `这个宝宝的四柱是：${round.baziPillars}。名字可以顺带呼应，但不要说天干地支、五行用神这类词，也别说「一定」「注定」——只作温和参考。`,
    );
  }
  lines.push("只输出 JSON。");
  return lines.join("\n");
}
