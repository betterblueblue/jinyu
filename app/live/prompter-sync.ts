import type { FastCandidate, FastSuccess } from "@/fast/types";
import { checkLine, talkLines } from "@/library/talk";
import type { PrompterName, PrompterRound } from "@/live/prompter";
import { citeFrom, type Gender } from "./show-data";

/* ---------- 主播提词页（/live/prompter） ---------- */

export const GENDER_WORD: Record<Gender, string> = { male: "男孩", female: "女孩", unknown: "性别未定" };

/** 句子结尾补句号，口播稿每行都是整句 */
function sentence(s: string): string {
  const t = s.trim();
  return !t || /[。！？]$/.test(t) ? t : `${t}。`;
}

/**
 * 提词页只是辅助：推不上不影响直播台，不等结果、不报错。
 * 直播伴侣只采集直播台这个窗口，稿子推到另一个页面，观众看不到。
 */
export function pushPrompter(round: PrompterRound): void {
  void fetch("/api/live/prompter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(round),
    keepalive: true,
  }).catch(() => undefined);
}

/** 精简版一轮 → 提词页：名字库的名字给整段口播稿，模型临时起的只有一句话和体检那句 */
export function prompterFromFast(data: FastSuccess, no: number): PrompterRound {
  const p = data.primary;
  const talk = p.library?.talk;
  // 屏幕上是截短的那一小句（quote），主播念整句（line）；模型核出来的两者一样
  const citation = p.citation ? { from: citeFrom(p.citation), line: p.citation.line } : undefined;
  const lines = talk
    ? talkLines(data.surname, p.givenName, talk, citation)
    : [
        sentence(`${p.fullName}，${p.why}`),
        ...(citation ? [`出自${citation.from}「${citation.line}」。`] : []),
        checkLine(data.surname),
      ];
  const toName = (c: FastCandidate): PrompterName => ({ full: c.fullName, pinyin: c.pinyin, one: c.why });
  return {
    state: "ready",
    no,
    surname: data.surname,
    gender: GENDER_WORD[data.gender],
    primary: {
      ...toName(p),
      ...(p.pinyinHint ? { pinyinHint: p.pinyinHint } : {}),
      lines,
      ...(talk?.tip ? { tip: talk.tip } : {}),
      source: p.library ? "library" : "model",
    },
    sections: data.alternatives.length ? [{ label: "备选", names: data.alternatives.map(toName) }] : [],
  };
}
