import seedChars from "@/config/seed-chars.json";
import { firstCharConflict } from "./gate";
import type { FastGender } from "./types";

/**
 * 每轮的起手字：从 config/seed-chars.json 抽 5 个字，5 个名字各用一个，另一个字模型按规则配。
 *
 * 为什么要它（2026-10-31，只用 DeepSeek v4.1 Flash 实测）：不给每轮变化的起点，
 * 模型每轮都回到自己最熟的那十几个名字，放开推理也一样（中位 23 秒，知夏、予安照样重复）。
 * 给了起手字，9 轮 36 个名字 35 个不同，中位 2.2 秒。
 *
 * 同一姓连续 20 轮的教训，决定了这里的两条规矩：
 *   - 字表用完要轮回时，不能按固定顺序补：整组原样再来，模型就配出同一组名字（晏宁、荷月、昭宁各出 3 次）。
 *     所以从「最久没出现」的那一批里随机挑。
 *   - 同一个字再被抽到，模型常给同一个搭配（青 → 青禾）。所以把本场用这些字配出过的名字
 *     放进 avoid，在提示词里提醒一句。加了这两条，20 轮 80 个名字 0 重复。
 */

export const SEEDS_PER_ROUND = 5;
/** 提醒模型的名字最多几个：只列含这一轮起手字的，列长了模型会逐个比对、变慢 */
export const AVOID_MAX = 12;
/**
 * 「配字用多了」看最近多少个名字、出现几次算多、最多报几个字。
 *
 * 起手字让整名不重样以后，模型配的另一个字仍然扎堆：沈姓 20 轮实测，80 个名字里
 * 17 个带「宁」、12 个带「禾」，名字都不一样，观众听着还是「又是 X 宁」。
 * 最近 5 轮（20 个名字）里出现 2 次以上的字，这一轮在提示词里提醒它别用。
 *
 * 代价是实测过的：同一批请求交替各跑 10 次，带这一句的 50 个名字里含宁禾晴棠的从 24 个降到 4 个，
 * 耗时中位从 3.7 秒升到 4.9 秒。改由代码事后过滤省时间，但常常只剩 3 个名字可出，没采用。
 */
export const TIRED_WINDOW = 20;
export const TIRED_MIN = 2;
export const TIRED_MAX = 4;

const POOL: Record<FastGender, readonly string[]> = {
  female: seedChars.female,
  male: seedChars.male,
};

export interface SeedPick {
  seeds: string[];
  avoid: string[];
  /** 最近配得太多的字，这一轮另一个字别用 */
  tired: string[];
}

/**
 * @param recent 本场已经给过的名字，旧 → 新
 * @param rand   可注入的随机数，测试用
 */
export function pickSeeds(
  gender: FastGender,
  surname: string,
  recent: readonly string[],
  rand: () => number = Math.random,
  /** 这些字这次不抽：补发那一路要换一组起手字，不能和第一路一样 */
  exclude: ReadonlySet<string> = new Set(),
): SeedPick {
  const shuffle = <T>(list: readonly T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  // 跟姓撞的字不抽：王姓不抽「望」，沈姓不抽「思」
  const pool = POOL[gender].filter((ch) => !exclude.has(ch) && !firstCharConflict(ch, surname));

  // 每个字在本场最后一次出现的位置（名字里任一位置都算）
  const lastSeen = new Map<string, number>();
  recent.forEach((name, i) => {
    for (const ch of name) lastSeen.set(ch, i);
  });

  // 先抽本场还没出现过的字
  const seeds = shuffle(pool.filter((ch) => !lastSeen.has(ch))).slice(0, SEEDS_PER_ROUND);

  // 不够就轮回：从最久没出现的那一批里随机补，不按固定顺序
  if (seeds.length < SEEDS_PER_ROUND) {
    const used = pool.filter((ch) => lastSeen.has(ch)).sort((a, b) => lastSeen.get(a)! - lastSeen.get(b)!);
    const oldest = used.slice(0, Math.max(SEEDS_PER_ROUND * 2, Math.ceil(used.length / 2)));
    seeds.push(...shuffle(oldest).slice(0, SEEDS_PER_ROUND - seeds.length));
  }

  // 本场用这几个字配出过的名字，从最近的往前收
  const avoid: string[] = [];
  for (let i = recent.length - 1; i >= 0 && avoid.length < AVOID_MAX; i--) {
    const name = recent[i]!;
    if (!avoid.includes(name) && seeds.some((s) => name.includes(s))) avoid.push(name);
  }

  // 最近几轮扎堆的配字（起手字本身不算，它这一轮就是要用的）
  const counts = new Map<string, number>();
  for (const name of recent.slice(-TIRED_WINDOW)) {
    for (const ch of name) if (!seeds.includes(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const tired = [...counts.entries()]
    .filter(([, n]) => n >= TIRED_MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TIRED_MAX)
    .map(([ch]) => ch);

  return { seeds, avoid, tired };
}
