import {
  ELEMENTS,
  SEASON_ELEMENT,
  elementOfGroup,
  isYangGan,
  producerOf,
  seasonState,
  type GodGroup,
} from "./ganzhi";
import type { Element, Pillar, PillarKey, Strength, StrengthLevel } from "./types";

/**
 * 日主强弱与喜忌：扶抑法的规则粗算，结果固定、可复现，不交给模型判断。
 *
 * 计分：
 * - 天干每字 1 分；地支按位置给分——月支 3（月令最重）、日支 1.5（日主坐下）、年支与时支各 1，
 *   再按藏干本气 / 中气 / 余气拆开（三藏 6:3:1，两藏 7:3，一藏全给本气）；
 * - 每一分再乘该五行在月令的旺相休囚死系数（1.5 / 1.2 / 1.0 / 0.8 / 0.6）；
 * - 日干本身是被衡量的对象，不计入强弱比较，只计入五行占比的展示。
 * 生扶日主的比劫与印占「日干以外全部力量」的比例决定强弱档。
 *
 * 系数和档位用四个常被引用的命例校过方向（见 tests/fortune.test.ts）。
 * 这只是近似：格局、合化都没进分数，界面上标明「粗算」，调候单独给一句，
 * 太弱太旺时提示可能是从格。
 */

const HIDDEN_WEIGHTS: Record<number, number[]> = { 1: [1], 2: [0.7, 0.3], 3: [0.6, 0.3, 0.1] };
const BRANCH_WEIGHT: Record<PillarKey, number> = { year: 1, month: 3, day: 1.5, time: 1 };
const SEASON_FACTOR = { 旺: 1.5, 相: 1.2, 休: 1, 囚: 0.8, 死: 0.6 } as const;
export const POSITION: Record<PillarKey, string> = { year: "年", month: "月", day: "日", time: "时" };

function levelOf(ratio: number): StrengthLevel {
  if (ratio < 0.15) return "极弱";
  if (ratio < 0.35) return "身弱";
  if (ratio < 0.45) return "偏弱";
  if (ratio < 0.55) return "中和";
  if (ratio < 0.65) return "偏强";
  if (ratio < 0.85) return "身强";
  return "极旺";
}

const zero = (): Record<Element, number> => ({ 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 });

export function computeStrength(pillars: Pillar[]): Strength {
  const day = pillars.find((p) => p.key === "day")!;
  const month = pillars.find((p) => p.key === "month")!;
  const dayEl = day.ganElement;
  const seasonEl = SEASON_ELEMENT[month.zhi];
  const factor = (e: Element) => SEASON_FACTOR[seasonState(seasonEl, e)];

  /** 全盘力量（含日干），用于展示五行占比 */
  const all = zero();
  /** 日干以外的力量，用于判强弱 */
  const others = zero();
  const counts = zero();
  for (const p of pillars) {
    const stemScore = factor(p.ganElement);
    all[p.ganElement] += stemScore;
    if (p.key !== "day") others[p.ganElement] += stemScore;
    counts[p.ganElement] += 1;
    counts[p.zhiElement] += 1;
    const weights = HIDDEN_WEIGHTS[p.hidden.length] ?? [];
    p.hidden.forEach((h, i) => {
      const score = BRANCH_WEIGHT[p.key] * (weights[i] ?? 0) * factor(h.element);
      all[h.element] += score;
      others[h.element] += score;
    });
  }

  const sum = (r: Record<Element, number>) => ELEMENTS.reduce((s, e) => s + r[e], 0);
  const allTotal = sum(all);
  const shares = zero();
  for (const e of ELEMENTS) shares[e] = Math.round((all[e] / allTotal) * 100);

  const of = (g: GodGroup) => others[elementOfGroup(dayEl, g)];
  const ratio = (of("比劫") + of("印")) / sum(others);
  const pct = Math.round(ratio * 100);
  const state = seasonState(seasonEl, dayEl);

  const roots: string[] = [];
  let solidRoot = false;
  for (const p of pillars) {
    p.hidden.forEach((h, i) => {
      if (h.element !== dayEl) return;
      roots.push(`${POSITION[p.key]}支${p.zhi}藏${h.gan}（${h.qi}）`);
      if (i < 2) solidRoot = true;
    });
  }
  // 「有根不从」：地支里有本气或中气根，再弱也只算身弱，不往从格上提
  let level = levelOf(ratio);
  if (level === "极弱" && solidRoot) level = "身弱";
  const helpers = pillars
    .filter((p) => p.key !== "day" && (p.ganElement === dayEl || p.ganElement === producerOf(dayEl)))
    .map((p) => `${POSITION[p.key]}干${p.gan}（${p.tenGod}）`);

  let favorable: Element[];
  let unfavorable: Element[];
  let method: string;
  const byStrengthDesc = (list: Element[]) => [...list].sort((a, b) => others[b] - others[a]);
  const name = (g: GodGroup) => `${g}（${elementOfGroup(dayEl, g)}）`;

  if (ratio >= 0.55) {
    const yinHeavy = of("印") > of("比劫");
    const base: GodGroup[] = yinHeavy ? ["财", "食伤", "官杀"] : ["官杀", "食伤", "财"];
    // 「有力者为用」：盘里几乎没有的那一类往后放，免得把原局一个字都没有的五行排成第一喜用
    const present = (g: GodGroup) => of(g) >= 0.5;
    const order = [...base.filter(present), ...base.filter((g) => !present(g))];
    favorable = order.map((g) => elementOfGroup(dayEl, g));
    unfavorable = byStrengthDesc([elementOfGroup(dayEl, "印"), dayEl]);
    const first = order[0];
    const how = first === "财" ? "制印" : first === "官杀" ? "制身" : "泄秀";
    method =
      `日干以外，生扶日主的比劫与印占 ${pct}%，日主偏旺，宜克、泄、耗。` +
      `${yinHeavy ? "印星" : "比劫"}偏重，先取${name(first)}${how}，${order
        .slice(1)
        .map(name)
        .join("、")}次之。`;
  } else if (ratio < 0.45) {
    const opposing: GodGroup[] = ["食伤", "财", "官杀"];
    const heaviest = opposing.reduce((a, b) => (of(b) > of(a) ? b : a));
    favorable = heaviest === "财" ? [dayEl, producerOf(dayEl)] : [producerOf(dayEl), dayEl];
    unfavorable = byStrengthDesc(opposing.map((g) => elementOfGroup(dayEl, g)));
    const why =
      heaviest === "官杀"
        ? `${name("官杀")}最重，先取${name("印")}化杀生身`
        : heaviest === "食伤"
          ? `${name("食伤")}最重，先取${name("印")}制伤生身`
          : `${name("财")}最重，先取${name("比劫")}帮身任财`;
    method = `日干以外，生扶日主的比劫与印只占 ${pct}%，日主偏弱，宜生扶。${why}。`;
  } else {
    const asc = [...ELEMENTS].sort((a, b) => all[a] - all[b]);
    favorable = asc.slice(0, 2);
    const strongest = asc[asc.length - 1];
    unfavorable = shares[strongest] >= 30 ? [strongest] : [];
    method = `日干以外，生扶与克泄耗大致相当（生扶占 ${pct}%），日主中和，喜忌不算明显，以补足偏弱的五行、让五行流通为宜。`;
  }

  let caution: string | undefined;
  if (level === "极弱") {
    caution = "日主极弱：若命局构成从格（从财、从杀、从儿），喜忌会与上面相反，需要结合大运应验再定。";
  } else if (level === "极旺") {
    caution = "日主极旺：若成专旺格，宜顺其旺势，喜忌会与上面相反，需要结合大运应验再定。";
  }

  let tiaoHou: Strength["tiaoHou"];
  if ("亥子丑".includes(month.zhi) && shares["火"] < 15) {
    tiaoHou = { element: "火", text: `生在冬月，命局偏寒，火只占 ${shares["火"]}%，从调候看宜火暖局。` };
  } else if ("巳午未".includes(month.zhi) && shares["水"] < 15) {
    tiaoHou = { element: "水", text: `生在夏月，命局偏燥，水只占 ${shares["水"]}%，从调候看宜水润局。` };
  }

  return {
    dayMaster: { gan: day.gan, element: dayEl, yinYang: isYangGan(day.gan) ? "阳" : "阴" },
    shares,
    counts,
    supportRatio: Math.round(ratio * 1000) / 1000,
    level,
    season: { monthZhi: month.zhi, state, deLing: state === "旺" || state === "相" },
    roots,
    helpers,
    favorable,
    unfavorable,
    method,
    ...(tiaoHou ? { tiaoHou } : {}),
    ...(caution ? { caution } : {}),
  };
}
