import { extractJson, streamChat, type ChatClientOptions } from "@/providers/chat";
import { sayable } from "./fix";
import type { NameScore } from "./types";

/**
 * 提词页上「这个名字好在哪」：观众报的名字，每个字的意思、合起来的寓意（2026-11-01 用户定，总体方案 D9）。
 *
 * 打分规则只会挑毛病，讲不出好在哪，所以让模型写。10-31 删「详细解读」是因为模型的说法和规则打分对不上，
 * 当着观众尴尬；这一段只讲字义和寓意、不评好坏、不提扣分，而且只给主播看（提词页），观众屏幕上没有。
 * 扣分理由一起给模型看，只为让它别去夸被扣分的那一点（「宸」扣的是字太大，就不能夸它尊贵）。
 * 写法照提词页的口播稿（src/fast/talk.ts）：拆字、合起来，不讲出处、不说空话、不碰命理。
 */

export interface NameMerit {
  /** 拆字：每个字的意思 */
  chars: string;
  /** 合起来：画面和爸妈的心意 */
  whole: string;
}

const LINE_MIN = 8;
const LINE_MAX = 90;
/** 这一段只讲好在哪；评好坏、讲毛病是打分规则和主播的事，模型写了就整段不要 */
const JUDGING = ["扣分", "毛病", "缺点", "不足", "老气", "过时", "土气", "俗气", "谐音", "重名", "撞名", "烂大街", "不好", "好名字", "完美", "满分"];

export function buildMeritSystem(): string {
  return [
    "你是直播起名间的主播助理。观众报了自己孩子的名字，你写一段「这个名字好在哪」，主播照着念给观众听。只输出 JSON。",
    "推理只写怎么拆字，一两句。不要复述规则。",
    "",
    "写两样：",
    "- chars：拆字，一句话，说每个字是什么意思，用大白话，像「星是星星，远是远方。」。字义要准，用这个字在名字里最常见的意思。名是一个字的，可以连姓一起讲；名是两个字的，只讲名。",
    "- whole：合起来，一句话，以「合起来」开头，说这几个字拼成的画面或说法，再说一句爸妈起这个名字的心意，60 字以内。名字来自成语的，可以点出这个成语。",
    "",
    "只讲字义和寓意，不评这个名字好不好：不要写「好名字」「老气」「过时」「重名」「谐音」这类话，扣分是主播另外讲的。",
    "下面给的扣分理由只用来提醒你：被扣分的那一点不要夸。比如扣的是字太大，就只讲字的本义，不要夸它尊贵、大气；扣的是年代感，照常讲字义就行。",
    "不要写：五行、八字、命理、运势、旺；「寓意深远」「气质不凡」这类空话；诗句原文和出处（没核过的不能念）；分数。",
    "",
    "参考格式（只看格式，别照抄内容）：",
    '{"chars":"清是水清见底，禾是田里的禾苗。","whole":"合起来是一片清清亮亮的青苗，干干净净又有生气，爸妈盼孩子心地干净、踏踏实实往上长。"}',
    "",
    '输出：{"chars":"","whole":""}',
  ].join("\n");
}

export function buildMeritUser(score: NameScore): string {
  const who = score.gender === "male" ? "男孩" : score.gender === "female" ? "女孩" : "孩子，性别没说";
  const lines = [`名字：${score.fullName}（姓${score.surname}，名${score.givenName}，${who}）。`];
  if (score.deductions.length) {
    lines.push("打分规则扣分的地方（只是提醒你别夸这几点，不要写进稿子）：");
    for (const d of score.deductions) lines.push(`- ${d.line}`);
  } else {
    lines.push("打分规则没扣分。");
  }
  lines.push("只输出 JSON。");
  return lines.join("\n");
}

function meritLine(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, "").trim() : "";
  if (!sayable(text, LINE_MAX, LINE_MIN)) return null;
  if (JUDGING.some((w) => text.includes(w))) return null;
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

/** 两句都能念才收，有一句不行整段不要：提词页只是少这一段 */
export function parseMerit(content: string): NameMerit | null {
  const json = extractJson(content);
  if (!json) return null;
  let x: unknown;
  try {
    x = JSON.parse(json);
  } catch {
    return null;
  }
  if (!x || typeof x !== "object") return null;
  const raw = x as Record<string, unknown>;
  const chars = meritLine(raw.chars);
  const whole = meritLine(raw.whole);
  return chars && whole ? { chars, whole } : null;
}

export async function writeMerit(score: NameScore, client: ChatClientOptions, signal?: AbortSignal): Promise<NameMerit | null> {
  const r = await streamChat(
    { ...client, temperature: 0.5, reasoningEffort: "low" },
    {
      messages: [
        { role: "system", content: buildMeritSystem() },
        { role: "user", content: buildMeritUser(score) },
      ],
      maxTokens: 3072,
      timeoutMs: 25_000,
      ...(signal ? { signal } : {}),
    },
  );
  return parseMerit(r.content);
}
