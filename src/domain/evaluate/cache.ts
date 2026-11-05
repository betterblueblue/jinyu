import { SCORING_REV } from "./scoring";
import type { EvaluateResult } from "./types";

/**
 * 同一场直播里，同一个名字同一个分（2026-11-05）。
 *
 * 原名评价有一半分数来自模型档位，temperature 0.4 下同一个名字每次可能差一档，跨过 80 / 90 线。
 * 这里按「全名 + 性别 + 拆出的姓」记住第一次完整评完的结果：
 *   - 再报同一个名字，直接重放，分数、理由、改法都一样；
 *   - 主播点「再试一次」，原名评价钉住不变，只让模型重新写改法。
 * 只在内存里，重启开发服务就清空。挂在 globalThis 上，热更新不会把一场的记录清掉。
 * 只在接口这一层用，evaluateName 本身不缓存，单测和评测脚本每次照常调模型。
 */

const MAX = 500;

const store: Map<string, EvaluateResult> =
  ((globalThis as Record<string, unknown>).__jinyuEvalCache as Map<string, EvaluateResult> | undefined) ??
  new Map<string, EvaluateResult>();
(globalThis as Record<string, unknown>).__jinyuEvalCache = store;

/** 带上打分口径的版本：改了算分规则，旧口径算的分不会被重放出来 */
export function cacheKey(surname: string, givenName: string, gender: string): string {
  return `${SCORING_REV}|${surname}|${givenName}|${gender}`;
}

export function getCached(key: string): EvaluateResult | undefined {
  return store.get(key);
}

/** 只记完整评完的：模型出错、超时、没给原名评价的不记，下次照常重评 */
export function setCached(key: string, result: EvaluateResult): void {
  if (!result.original || result.status === "error" || result.status === "timeout") return;
  if (store.has(key)) store.delete(key);
  store.set(key, result);
  while (store.size > MAX) store.delete(store.keys().next().value!);
}

export function clearEvalCache(): void {
  store.clear();
}
