import { extractJson, streamChat, type ChatClientOptions } from "@/providers/chat";
import { BANNED_TALK_WORDS } from "@/library/talk";
import { birthTimeOf, seasonSeeds } from "./birth";
import type { FastGender } from "./types";

/**
 * 模型起的名字（首推和备选）补写口播稿：拆字、合起来、只给主播看的提醒。
 *
 * 名字库里的名字有用户评过的现成稿子（src/library/talk.ts）；模型现起的没有。
 * 直播台出结果以后再单独调一次（/api/fast/talk），观众屏幕不用等它：
 * 2026-11-01 实测 3–4 个名字一次 2.9–8.2 秒，中位 5 秒左右，主播讲首推那段的工夫就补上了。
 *
 * 稿子没人审过，所以只让模型写它最有把握的东西：常用字的字义、合起来的画面和祝福、读音提醒。
 * 不让它引诗句（没核过的出处不能念），成语可以点。命理词一律不许出现，和名字库的稿子同一张禁词表。
 */

export interface FastTalk {
  /** 拆字：两个字各是什么意思 */
  chars: string;
  /** 合起来：画面或说法，加对孩子的祝福 */
  whole: string;
  /** 只给主播看：读音、谐音联想；没有就不给 */
  tip?: string;
}

export interface FastTalkRequest {
  surname: string;
  gender: FastGender;
  birthday?: string;
  names: { givenName: string; why: string }[];
}

export const TALK_NAMES_MAX = 4;
const LINE_MAX = 80;
const TIP_MAX = 60;
/** 引号里超过这么多字，多半是诗句原文：没核过，不念 */
const QUOTE_MAX = 6;

export function buildTalkSystem(): string {
  return [
    "你是直播起名间的主播助理。名字已经起好了，你给每个名字写一段口播稿，主播照着念给观众听。只输出 JSON。",
    "推理里只写名字，一行一个。不要写理由、不要写分析、不要复述规则。",
    "",
    "每个名字写三样：",
    "- chars：拆字，一句话，说两个字各是什么意思，用大白话，像「星是星星，远是远方。」。字义要准，用这个字在名字里最常见的意思。",
    "- whole：合起来，一句话，以「合起来」开头，说两个字拼成的画面或说法，再说对孩子的祝福，40 字以内。名字来自成语的，可以点出这个成语。",
    "- tip：只给主播看的提醒，没有就留空字符串。只写两种：容易念错的字的读音；观众可能拿来开玩笑的谐音或联想。没把握就留空，不要编。",
    "",
    "不要写：五行、八字、生辰、命理、运势、旺、补什么缺什么；「寓意深远」「气质不凡」这类空话；诗句原文和出处（没核过的不能念）。",
    "",
    "参考格式（只看格式，别照抄内容）：",
    '{"givenName":"景川","chars":"景是景色，本义是日光，川是河流。","whole":"合起来是阳光照在大河上，又亮又开阔，希望孩子眼界宽，一路往前走。","tip":""}',
    '{"givenName":"舒晴","chars":"舒是舒展、舒心，晴是晴朗。","whole":"合起来就是舒舒服服的晴天，希望女儿一辈子过得舒心，性格开朗。","tip":"舒晴和「抒情」同音，有观众可能会拿来开玩笑。"}',
    "",
    '输出：{"talks":[{"givenName":"","chars":"","whole":"","tip":""}]}',
  ].join("\n");
}

export function buildTalkUser(req: FastTalkRequest): string {
  const who = req.gender === "male" ? "男孩" : "女孩";
  const time = req.birthday ? birthTimeOf(req.birthday) : null;
  // 名字里有按出生季节挑的字（birth.ts）：让稿子顺着讲一句时节，主播能说「春天出生，名字里这个煦字……」
  const timely = time ? seasonSeeds(time, req.gender) : [];
  const echoOf = (name: string) => [...name].find((ch) => timely.includes(ch));
  const lines = [
    `${req.surname}姓${who}${time ? `，生在${time.season}` : ""}。下面 ${req.names.length} 个名字，屏幕上每个名字下面已经有一句话：`,
    ...req.names.map((n) => {
      const ch = echoOf(n.givenName);
      return `${req.surname}${n.givenName}：${n.why}${ch ? `（「${ch}」字是照着${time!.season}出生挑的）` : ""}`;
    }),
  ];
  if (time && req.names.some((n) => echoOf(n.givenName))) {
    lines.push(`标了「照着${time.season}出生挑的」名字，合起来那句先顺着说一句时节，比如「${time.season}出生，……」。`);
  }
  lines.push("按顺序每个名字写一段，givenName 只填名。只输出 JSON。");
  return lines.join("\n");
}

function sentence(s: string): string {
  const t = s.trim();
  return !t || /[。！？]$/.test(t) ? t : `${t}。`;
}

/** 一句稿子能不能念：不空、不超长、没有命理词、没有大段引文 */
function usable(text: string, max: number): boolean {
  if (!text || [...text].length > max) return false;
  if (BANNED_TALK_WORDS.some((w) => text.includes(w))) return false;
  // 「补水」「缺木」这类五行说法，禁词表按整词查不到
  if (/[补缺][金木水火土]/.test(text)) return false;
  for (const m of text.matchAll(/[「“"]([^」”"]*)[」”"]/g)) if ([...(m[1] ?? "")].length > QUOTE_MAX) return false;
  return true;
}

/** 模型的返回整理成每个名字一份稿子；拆字或合起来不能用的，这个名字就不给稿子 */
export function parseTalks(content: string, wanted: readonly string[]): Record<string, FastTalk> {
  const json = extractJson(content);
  if (!json) return {};
  let list: unknown;
  try {
    list = (JSON.parse(json) as { talks?: unknown }).talks;
  } catch {
    return {};
  }
  if (!Array.isArray(list)) return {};
  const out: Record<string, FastTalk> = {};
  for (const item of list) {
    const x = item as Record<string, unknown> | null;
    if (!x || typeof x !== "object") continue;
    const name = String(x.givenName ?? "").trim();
    if (!wanted.includes(name) || out[name]) continue;
    const chars = sentence(String(x.chars ?? ""));
    const whole = sentence(String(x.whole ?? ""));
    if (!usable(chars, LINE_MAX) || !usable(whole, LINE_MAX)) continue;
    const tip = String(x.tip ?? "").trim();
    out[name] = { chars, whole, ...(tip && usable(tip, TIP_MAX) ? { tip } : {}) };
  }
  return out;
}

export async function writeTalks(
  req: FastTalkRequest,
  client: ChatClientOptions,
  signal?: AbortSignal,
): Promise<Record<string, FastTalk>> {
  const names = req.names.slice(0, TALK_NAMES_MAX);
  if (!names.length) return {};
  const r = await streamChat(
    { ...client, temperature: 0.5, reasoningEffort: "low" },
    {
      messages: [
        { role: "system", content: buildTalkSystem() },
        { role: "user", content: buildTalkUser({ ...req, names }) },
      ],
      maxTokens: 4096,
      timeoutMs: 30_000,
      ...(signal ? { signal } : {}),
    },
  );
  return parseTalks(
    r.content,
    names.map((n) => n.givenName),
  );
}

export function talkClient(): ChatClientOptions | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash",
  };
}
