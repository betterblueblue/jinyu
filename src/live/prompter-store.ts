import type { PrompterRound, PrompterSnapshot } from "./prompter";

/**
 * 提词页的最新一轮，只放在服务进程内存里：不写文件、不进历史页，服务重启就清空（下一轮直播页会再推）。
 *
 * 挂在 globalThis 上：开发模式改代码热更新会重新执行模块，放在模块变量里会被清掉。
 */

const g = globalThis as typeof globalThis & { __jinyuPrompter?: PrompterSnapshot };

function current(): PrompterSnapshot {
  g.__jinyuPrompter ??= {
    boot: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    round: { state: "idle" },
  };
  return g.__jinyuPrompter;
}

export function readPrompter(): PrompterSnapshot {
  return current();
}

export function writePrompter(round: PrompterRound): PrompterSnapshot {
  const prev = current();
  g.__jinyuPrompter = { boot: prev.boot, seq: prev.seq + 1, round };
  return g.__jinyuPrompter;
}
