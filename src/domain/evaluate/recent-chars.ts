/**
 * 改字时最近换上过的字，下一位让模型避开（2026-11-05 重做）。
 *
 * 女孩改字老落在晴、悦、妍上：提示词要「明亮」，验收又挡掉热门字和难认的字，剩下的几乎就是这几个。
 * 原来的避开表（evaluate.ts 里一个数组）模型是照着做的，但表本身有三个缺口：
 *   - 只记最近 18 个字、男女共用，男孩的字把女孩的挤出去，九个名字左右「晴」就回来了；
 *   - 普通模块变量，开发模式热更新就清空；
 *   - 原名自带的字也列进去（给刘晴改字时让它「别用晴」）。
 * 现在男女各一份、挂在 globalThis 上：
 *   同一个性别最近换上的 18 个字全避开，再加最近 20 个候选里出现在 2 位以上的字（最多 4 个，照 src/fast/seeds.ts），原名的字不列。
 * 只在内存里，重启开发服务清空。
 */

type G = "male" | "female";

/**
 * 同一个性别最近换上的多少个字全部避开。
 * 2026-11-05 实测（data/eval/fix-chars-*.json，26 个女孩名 × 2 遍）：只避开最近 3 位（6–10 个字）时，
 * 宁、晴回来得快，出现最多的 3 个字占 30%；原来男女共用 18 个字是 23%。所以每个性别留 18 个字。
 */
export const RECENT_CHARS = 18;
/** 「用多了」看最近多少个候选 */
export const TIRED_WINDOW = 20;
/** 在几位以上出现过算用多了 */
export const TIRED_MIN = 2;
export const TIRED_MAX = 4;
/** 一次最多列几个字 */
export const AVOID_MAX = 20;
/** 每个性别留多少位 */
const KEEP = 40;

/** 每一位：这一位的候选换上的字，一个候选一组 */
type Round = string[][];

interface Store {
  male: Round[];
  female: Round[];
}

const KEY = "__jinyuEvalRecentChars";
const store: Store = ((globalThis as Record<string, unknown>)[KEY] as Store | undefined) ?? { male: [], female: [] };
(globalThis as Record<string, unknown>)[KEY] = store;

/** 开始给一位观众改字：返回一个记录器，每核过一个候选调一次 */
export function startRound(gender: G): (addedChars: string[]) => void {
  let round: Round | null = null;
  return (addedChars) => {
    if (!addedChars.length) return;
    if (!round) {
      round = [];
      store[gender].push(round);
      if (store[gender].length > KEEP) store[gender].shift();
    }
    round.push([...new Set(addedChars)]);
  };
}

/** 这一位要避开的字：原名里本来有的字不列 */
export function avoidChars(gender: G, givenName: string): string[] {
  const own = new Set([...givenName]);
  const rounds = store[gender];
  const out: string[] = [];
  const add = (c: string) => {
    if (!own.has(c) && !out.includes(c)) out.push(c);
  };
  // 最近换上的 18 个字：新的在前
  outer: for (let i = rounds.length - 1; i >= 0; i--) {
    for (const cand of rounds[i]!) {
      for (const c of cand) {
        if (out.length >= RECENT_CHARS) break outer;
        add(c);
      }
    }
  }
  // 最近 20 个候选里出现在 2 位以上的字
  const recent: { round: number; chars: string[] }[] = [];
  for (let i = rounds.length - 1; i >= 0 && recent.length < TIRED_WINDOW; i--) {
    for (const cand of rounds[i]!) {
      if (recent.length >= TIRED_WINDOW) break;
      recent.push({ round: i, chars: cand });
    }
  }
  const seenIn = new Map<string, Set<number>>();
  for (const { round, chars } of recent) for (const c of chars) (seenIn.get(c) ?? seenIn.set(c, new Set()).get(c)!).add(round);
  const tired = [...seenIn.entries()]
    .filter(([, rs]) => rs.size >= TIRED_MIN)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, TIRED_MAX)
    .map(([c]) => c);
  for (const c of tired) add(c);
  return out.slice(0, AVOID_MAX);
}

/** 测试、评测脚本用：清空 */
export function resetRecentChars(): void {
  store.male.length = 0;
  store.female.length = 0;
}
