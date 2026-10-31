import { extractJson, type ChatMessage } from "@/providers/chat";
import { formatLocal } from "./solar-time";
import type { FortuneChart } from "./types";

/**
 * 八字解读的提示词。
 *
 * 排盘、五行占比、强弱、喜忌、大运流年都由程序算好，模型只负责把盘面讲成人话。
 * 给模型的事实一律用中文键名写——写成英文字段名，模型会把字段名原样抄进正文。
 * 出生地不发给模型：经度已经折进真太阳时，模型用不上，少传一项个人信息。
 */

export interface RawSection {
  basis?: unknown;
  text?: unknown;
}

export interface RawReading {
  overview?: unknown;
  personality?: RawSection;
  career?: RawSection;
  wealth?: RawSection;
  relationship?: RawSection;
  health?: RawSection;
  luck?: unknown;
  years?: unknown;
  advice?: unknown;
}

const pct = (n: number) => `${n}%`;

export function describeChart(chart: FortuneChart): Record<string, unknown> {
  const s = chart.strength;
  const t = chart.time;
  const current = chart.luck.steps.find((x) => x.current);
  const nowAge = chart.years[0]?.age;

  return {
    命主: chart.name,
    性别: chart.gender === "male" ? "男（乾造）" : "女（坤造）",
    出生: {
      公历: formatLocal(t.standard, false),
      真太阳时: `${formatLocal(t.trueSolar).slice(11)}（${t.shichen}）`,
      农历: chart.lunarDate,
      生肖: chart.zodiac,
      节令: `${chart.jie.prev.name}之后、${chart.jie.next.name}之前`,
    },
    当前虚岁: nowAge,
    四柱: chart.pillars.map((p) => ({
      柱: p.label,
      干支: p.ganzhi,
      天干: `${p.gan}${p.ganElement}（${p.tenGod}）`,
      地支: `${p.zhi}${p.zhiElement}`,
      藏干: p.hidden.map((h) => `${h.gan}${h.element}${h.tenGod}（${h.qi}）`).join("、"),
      纳音: p.naYin,
      星运: p.diShi,
    })),
    日主: `${s.dayMaster.gan}${s.dayMaster.element}（${s.dayMaster.yinYang}${s.dayMaster.element}）`,
    月令: `${s.season.monthZhi}月，日主五行在这个月为「${s.season.state}」，${s.season.deLing ? "得令" : "不得令"}`,
    五行占比: (Object.entries(s.shares) as [string, number][]).map(([e, n]) => `${e} ${pct(n)}`).join("、"),
    强弱: `${s.level}（规则粗算：${s.method}）`,
    通根: s.roots.length ? s.roots : "无",
    天干帮扶: s.helpers.length ? s.helpers : "无",
    喜用: s.favorable.join("、") || "不明显",
    忌: s.unfavorable.join("、") || "不明显",
    ...(s.tiaoHou ? { 调候: s.tiaoHou.text } : {}),
    ...(s.caution ? { 提醒: s.caution } : {}),
    原局干支关系: chart.relations.length ? chart.relations.map((r) => r.text) : "无明显合冲刑害",
    空亡: `日柱旬空${chart.pillars[2].xunKong}`,
    起运: `${chart.luck.startText}，${chart.luck.startDate} 交运，${chart.luck.forward ? "顺" : "逆"}排`,
    大运: chart.luck.steps.map((x) => ({
      干支: x.ganzhi,
      年份: `${x.startYear}–${x.endYear}`,
      虚岁: `${x.startAge}–${x.endAge}`,
      十神: `天干${x.ganTenGod}、地支${x.zhiTenGod}`,
      ...(x.current ? { 当前: true } : {}),
    })),
    当前大运: current ? `${current.ganzhi}（${current.startYear}–${current.endYear}）` : "尚未起运",
    流年: chart.years.map((y) => ({
      年份: y.year,
      干支: y.ganzhi,
      虚岁: y.age,
      十神: `天干${y.ganTenGod}、地支${y.zhiTenGod}`,
      所在大运: y.luckGanzhi || "起运前",
      与原局: y.relations.length ? y.relations.map((r) => r.text) : "无明显合冲刑害",
    })),
    ...(chart.uncertain.length ? { 不确定: chart.uncertain } : {}),
  };
}

export function buildReadingMessages(chart: FortuneChart): ChatMessage[] {
  const system: ChatMessage = {
    role: "system",
    content: [
      "你是懂子平八字的命理师，按传统子平法给人看八字。排盘、五行占比、日主强弱、喜忌、大运流年都已由程序按规则算好，写在用户消息里；你只负责解读。",
      "最终回复的 content 必须是且仅是一个 JSON 对象，不要 markdown、不要解释、不要前后缀。",
      "",
      "【效率】推理不超过 300 字：直接按给定盘面写，不要重新排盘，不要逐柱复核，不要列提纲。",
      "",
      "【依据】",
      "四柱、十神、藏干、强弱、喜忌、大运、流年一律以给定数据为准，不得改动，不得自己推算干支或岁数。",
      "不要引入没给出的神煞（桃花、驿马、天乙贵人、羊刃之类都不要提）。",
      "每段都要落到盘面：说清是哪一柱、哪个十神、哪种五行生克让你这么判断。basis 写依据，不超过 40 字。",
      "强弱和喜忌是规则粗算。若你认为调候或格局另有说法，只能在 overview 里补一句「从调候看……」或「若论格局……」，不要推翻给定喜忌。",
      "给了「不确定」时，涉及那一柱（时柱管子女与晚年，日柱管自身与配偶）的判断要点明另一种可能。",
      "结合「当前虚岁」说话：年纪小就多讲性情、身体、学业，少讲婚姻钱财；已成年就讲事业、财运、感情的实际情形。",
      "",
      "【说话方式】",
      "白话、具体、短句，像当面讲给本人听，称呼用「你」。",
      "用「倾向」「容易」「多半」「命书上说」这类说法，不说「注定」「必然」「一定会」。",
      "禁止谈：寿命、死亡、重病、意外灾祸、血光、牢狱官非、克父母、克夫、克妻、刑克六亲、离婚断言、生育断言、改运、化解、开光、法事、风水摆件。",
      "健康只说五行偏颇对应的保养方向，不诊断疾病，不替代体检。",
      "财运不给具体金额，不推荐具体投资品种。",
      "不写放之四海皆准的星座式空话（如「你心地善良」），不写「总体来说」「综合来看」这类套话，不用 #、*、- 这类符号。",
      "",
      "【各字段】",
      "overview：命局总论，150–220 字。第一句点出这个命的主要特点（日主、强弱、格局倾向），再说喜忌落在哪里、原局最关键的一两处干支关系。",
      "personality / career / wealth / relationship / health：每项 {\"basis\":\"…\",\"text\":\"…\"}，text 100–180 字；五项一项都不能少，也不要另加别的字段。",
      "relationship：男命以财星为妻星、女命以官星为夫星，结合日支（夫妻宫）来说。",
      "luck：按给定大运逐步写，每步 {\"ganzhi\":\"…\",\"text\":\"…\"}，text 40–80 字，说这十年的主题和该留意的事；给了几步就写几步，一步不漏，ganzhi 照抄给定的干支，顺序不变。",
      "years：按给定流年逐年写，每年 {\"year\":2026,\"text\":\"…\"}，text 60–100 字，结合所在大运和与原局的关系。",
      "advice：3–5 条能照做的建议（择业方向、习惯、相处），每条不超过 40 字；可以结合喜用五行说颜色、方位、行业，但要说明是传统说法。",
      "",
      "JSON 格式：",
      '{"overview":"…","personality":{"basis":"…","text":"…"},"career":{"basis":"…","text":"…"},"wealth":{"basis":"…","text":"…"},"relationship":{"basis":"…","text":"…"},"health":{"basis":"…","text":"…"},"luck":[{"ganzhi":"…","text":"…"}],"years":[{"year":2026,"text":"…"}],"advice":["…"]}',
    ].join("\n"),
  };

  const user: ChatMessage = {
    role: "user",
    content: JSON.stringify({
      命盘: describeChart(chart),
      instruction: "按系统消息的规则解读这个命盘。只依据给定数据，最终只输出 JSON。",
    }),
  };

  return [system, user];
}

export function parseReadingOutput(content: string): RawReading | null {
  const json = extractJson(content);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RawReading) : null;
  } catch {
    return null;
  }
}
