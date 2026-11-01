import type { Deduction, FixOption, GenderRisk, NameScore, NextStep, ScoreRuleId } from "@/domain/score/types";
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

/** 打分榜上选中的那位观众：提词页要的东西 */
export interface ScoreForPrompter {
  /** 打分榜上第几位 */
  no: number;
  score: NameScore;
  next: NextStep;
  fix: {
    phase: "idle" | "running" | "done" | "error";
    options: FixOption[];
    unfixable?: string;
    message?: string;
    /** 打完分在后台先改、主播还没点「改一个字」时为 false：提词页当没改过 */
    shown?: boolean;
  };
  /** 这个名字好在哪（/api/analyze/merit）；没请或者没写出来就不给。tip 是只给主播看的一句提醒 */
  merit?: { phase: "writing" | "done" | "error"; chars?: string; whole?: string; tip?: string };
  /** 没填性别时，换成男孩 / 女孩男女用字会扣多少（打分接口给的） */
  genderRisk?: GenderRisk[];
}

/** 没填性别、名字又偏一边：提醒主播先问男宝女宝 */
export function genderAskLine(risks: readonly GenderRisk[]): string | undefined {
  if (!risks.length) return undefined;
  const word = (g: GenderRisk["gender"]) => (g === "male" ? "男孩" : "女孩");
  const parts = risks.map((r) => `要是${word(r.gender)}，男女用字扣 ${r.points} 分，${r.score} 分${r.bandLabel}`);
  return `没填性别：${parts.join("；")}。先问一句「是男宝还是女宝？」，选好性别再打一次分。`;
}

/** 请模型写「这个名字好在哪」；写不出来返回 null，提词页只是少这一段 */
export async function fetchMerit(input: unknown): Promise<{ chars: string; whole: string; tip?: string } | null> {
  try {
    const res = await fetch("/api/analyze/merit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; merit?: { chars: string; whole: string; tip?: string } };
    return body.ok && body.merit ? body.merit : null;
  } catch {
    return null;
  }
}

/**
 * 打分规则查的十项（src/domain/score/score.ts），用观众听得懂的叫法。
 * 提词页上告诉主播「查了哪几项、哪几项有毛病」，主播能讲出这个分是怎么来的。
 */
const CHECKS = ["谐音", "和姓连读", "生僻字", "容易念错", "字义", "男女用字", "重名", "和反面人物同名", "年代感", "声调", "笔画"] as const;
type Check = (typeof CHECKS)[number];
const CHECK_OF: Record<ScoreRuleId, Check> = {
  homophone: "谐音",
  sameSound: "和姓连读",
  trap: "和姓连读",
  rare: "生僻字",
  misread: "容易念错",
  forbidden: "字义",
  swap: "字义",
  remind: "字义",
  style: "字义",
  gender: "男女用字",
  template: "重名",
  hot: "重名",
  singleName: "重名",
  era: "年代感",
  eraName: "年代感",
  flatTone: "声调",
  sandhi: "声调",
  strokes: "笔画",
  infamous: "和反面人物同名",
};
const checkOf = (d: Deduction): Check => (d.rule === "swap" && d.soundBound ? "谐音" : CHECK_OF[d.rule]);

/** 「按我们这套规则查了 10 项（谐音、……）；有毛病的是：年代感。」没填性别不查男女用字，照实说 */
export function checksLine(score: NameScore): string {
  const checked = CHECKS.filter((c) => c !== "男女用字" || score.gender !== "unknown");
  const bad = checked.filter((c) => score.deductions.some((d) => checkOf(d) === c));
  const head = `按我们这套规则查了 ${checked.length} 项（${checked.join("、")}）`;
  const tail = score.gender === "unknown" ? "没填性别，男女用字这一项没查。" : "";
  return `${head}；${bad.length ? `有毛病的是：${bad.join("、")}。` : `${checked.length} 项都过了。`}${tail}`;
}

function mathLine(score: NameScore): string {
  if (score.deductions.length === 0) return "100 分，一分没扣。";
  const total = score.deductions.reduce((s, d) => s + d.points, 0);
  if (total >= 100) return `一共扣了 ${total} 分，按 0 分算。`;
  return `100 − ${score.deductions.map((d) => d.points).join(" − ")} = ${score.score}`;
}

/**
 * 打分榜 → 提词页。一打完分就推：分数、查了哪几项、扣分理由先念起来（观众屏幕上只有分数和能不能用）；
 * 点了「改一个字」，先推一句过渡的话，模型每核过一个改法再推一次，主播不冷场。
 */
export function prompterFromScore(s: ScoreForPrompter): PrompterRound {
  const { score, next } = s;
  const fix: ScoreForPrompter["fix"] = s.fix.shown === false ? { phase: "idle", options: [] } : s.fix;
  const genderAsk = genderAskLine(s.genderRisk ?? []);
  const options = fix.options.slice(0, 3).map((o) => ({
    full: o.fullName,
    pinyin: o.pinyin,
    change: `${o.from} → ${o.to} · ${o.soundLine} · ${o.why}`,
    score: o.score,
    meaning: o.meaning,
  }));
  let say: string | undefined;
  // 没填性别、名字又偏一边时，「不用改」只对一个性别成立：不说，主播先按上面那句问清楚
  if (next.kind === "none") say = genderAsk ? undefined : "这个名字已经很好，不用改。";
  else if (fix.phase === "running" && options.length === 0) say = "可以先说：我看看换哪个字更合适，毛病要去掉，意思也要好。";
  else if (next.kind === "ask" && fix.phase === "idle") {
    say = "先问观众：毛病出在读音上，换个同音的写法还是这个音；只改一个字，读音会跟着变，能接受吗？不接受就重新起名。";
  }
  let note: string | undefined;
  if (fix.phase === "done" && options.length === 0) {
    note = fix.unfixable ? `改一个字解决不了：${fix.unfixable}。建议重新起名。` : (fix.message ?? "这次没挑出合适的字，可以再点一次。");
  } else if (fix.phase === "error") {
    note = fix.message ?? "改字没成功，可以再点一次。";
  }
  return {
    state: "score",
    no: s.no,
    full: score.fullName,
    pinyin: score.pinyin,
    score: score.score,
    bandLabel: score.bandLabel,
    math: mathLine(score),
    checks: checksLine(score),
    ...(s.merit?.phase === "writing" ? { merit: { writing: true, lines: [] } } : {}),
    ...(s.merit?.phase === "done" && s.merit.chars && s.merit.whole
      ? { merit: { writing: false, lines: [s.merit.chars, s.merit.whole], ...(s.merit.tip ? { tip: s.merit.tip } : {}) } }
      : {}),
    ...(genderAsk ? { genderAsk } : {}),
    deductions: score.deductions.slice(0, 12).map((d) => ({ points: d.points, line: d.line })),
    folk: score.folk.slice(0, 4).map((f) => f.line),
    ...(say ? { say } : {}),
    ...(fix.phase !== "idle" ? { fix: { running: fix.phase === "running", options, ...(note ? { note } : {}) } } : {}),
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
