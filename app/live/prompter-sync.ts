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

/** 模型写的稿子（/api/fast/talk），按名（不带姓）对应 */
export type TalkMap = Record<string, { chars: string; whole: string; tip?: string }>;

/** 首推的稿子：名字库的用库里的；模型起的先只有一句话和体检句，稿子写好了再补拆字、合起来 */
function primaryLines(data: FastSuccess, talks?: TalkMap): { lines: string[]; tip?: string; writing: boolean } {
  const p = data.primary;
  const talk = p.library?.talk;
  // 屏幕上是截短的那一小句（quote），主播念整句（line）；模型核出来的两者一样
  const citation = p.citation ? { from: citeFrom(p.citation), line: p.citation.line } : undefined;
  if (talk) return { lines: talkLines(data.surname, p.givenName, talk, citation), ...(talk.tip ? { tip: talk.tip } : {}), writing: false };
  const written = talks?.[p.givenName];
  return {
    lines: [
      sentence(`${p.fullName}，${p.why}`),
      ...(citation ? [`出自${citation.from}「${citation.line}」。`] : []),
      ...(written ? [written.chars, written.whole] : []),
      checkLine(data.surname),
    ],
    ...(written?.tip ? { tip: written.tip } : {}),
    writing: !talks,
  };
}

/** 备选：名字库补位的用库里的拆字、合起来；模型起的用写好的稿子 */
function alternativeName(c: FastCandidate, talks?: TalkMap): PrompterName {
  const base: PrompterName = { full: c.fullName, pinyin: c.pinyin, one: c.why };
  const talk = c.library?.talk ?? talks?.[c.givenName];
  if (talk) return { ...base, lines: [talk.chars, talk.whole], ...(talk.tip ? { tip: talk.tip } : {}) };
  return talks ? base : { ...base, writing: true };
}

/**
 * 精简版一轮 → 提词页。
 * talks 不传：刚出结果，模型起的名字标「稿子还在写」；传了（哪怕是空的）：写好了，或者写不出来、不再等。
 */
export function prompterFromFast(data: FastSuccess, no: number, talks?: TalkMap): PrompterRound {
  const p = data.primary;
  const { lines, tip, writing } = primaryLines(data, talks);
  return {
    state: "ready",
    no,
    surname: data.surname,
    gender: GENDER_WORD[data.gender],
    primary: {
      full: p.fullName,
      pinyin: p.pinyin,
      one: p.why,
      ...(p.pinyinHint ? { pinyinHint: p.pinyinHint } : {}),
      lines,
      ...(tip ? { tip } : {}),
      ...(writing ? { writing: true } : {}),
      source: p.library ? "library" : "model",
    },
    sections: data.alternatives.length
      ? [{ label: "备选", names: data.alternatives.map((c) => alternativeName(c, talks)) }]
      : [],
  };
}

/** 这一轮里要模型补写稿子的名字：首推和备选里没有库里稿子的 */
export function namesNeedingTalk(data: FastSuccess): { givenName: string; why: string }[] {
  return [data.primary, ...data.alternatives]
    .filter((c) => !c.library?.talk)
    .map((c) => ({ givenName: c.givenName, why: c.why }));
}

/** 请模型补写稿子；写不出来返回空表，提词页照旧只有一句话 */
export async function fetchTalks(data: FastSuccess, birthday?: string): Promise<TalkMap> {
  const names = namesNeedingTalk(data);
  if (!names.length) return {};
  try {
    const res = await fetch("/api/fast/talk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surname: data.surname, gender: data.gender, ...(birthday ? { birthday } : {}), names }),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { ok?: boolean; talks?: TalkMap };
    return body.ok && body.talks ? body.talks : {};
  } catch {
    return {};
  }
}
