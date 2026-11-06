import type { PrompterRound, PrompterSnapshot } from "@/live/prompter";

/**
 * 简化版直播台推给简化版提词页的最新一轮，和现在的系统那一份分开（src/live/prompter-store.ts 不动）：
 * 两套直播台同时开着也不会互相盖。只在内存里，挂 globalThis，热更新不清空。
 */
const g = globalThis as typeof globalThis & { __jinyuSimplePrompter?: PrompterSnapshot };

function current(): PrompterSnapshot {
  g.__jinyuSimplePrompter ??= {
    boot: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    round: { state: "idle" },
  };
  return g.__jinyuSimplePrompter;
}

export function readSimplePrompter(): PrompterSnapshot {
  return current();
}

export function writeSimplePrompter(round: PrompterRound): PrompterSnapshot {
  const prev = current();
  g.__jinyuSimplePrompter = { boot: prev.boot, seq: prev.seq + 1, round };
  return g.__jinyuSimplePrompter;
}
