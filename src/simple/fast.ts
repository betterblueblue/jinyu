import { buildBaziSummary } from "@/domain/bazi";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { zodiacOf } from "@/fast/birth";
import { citeFromLine } from "@/fast/cite";
import { normalizeFastInput } from "@/fast/normalize";
import { tasteProblems } from "@/fast/taste";
import type { FastCandidate, FastFailure, FastFormInput, FastSuccess } from "@/fast/types";
import { loadLibrary, pickLibraryCandidates } from "@/library/live-pick";
import { hardProblems } from "./checks";
import { arrayItemReader, failText, simpleCall, str } from "./llm";

/**
 * 简化版直播起名（2026-11-06）。一段短提示词、low、调一次模型；写好一个名字就交出去一个（直播台等待页先放出来）。
 * 程序只做：两个字、这一场没给过、没有硬伤、出处逐字核（核不过就不显示）。
 * 名字库只在模型出错或者能用的不到三个时补位（用户定），平时不用。
 * 盲选 0:6:2（现在 : 简化 : 差不多）；本地网关上中位 25 秒，现在的系统 3.9 秒。慢在模型自己想，这一版不拿起手字收窄。
 */

const KEEP = 3;
/** 给模型的「这一场给过的」最多列多少个：列长了模型逐个比，变慢 */
const RECENT_IN_PROMPT = 15;

export function fastPrompt(surname: string, gender: "male" | "female", season: string | undefined, recent: readonly string[]): string {
  return [
    `直播间里给观众起名：姓${surname}，${gender === "male" ? "男孩" : "女孩"}${season ? `，${season}（按出生季节挑字，不讲八字）` : ""}。`,
    `起 3 个名字：名是两个字，连姓一共三个字（姓${surname}加两个字）。第一个是首推。`,
    "不要网红名、烂大街名，不要生僻字和多音字，三个名不要用同一个字，别用谁都能配的万能字（悦宁晴安然清知舒昭澜）。",
    ...(recent.length ? [`这一场已经给过这些名，不要重复：${recent.slice(-RECENT_IN_PROMPT).join("、")}。`] : []),
    "每个名一句话讲清楚这两个字为什么放在一起、是什么画面；有靠得住的古诗文出处就写原句，没有就不写，不要编。",
    'JSON：{"names":[{"givenName":"两个字的名（不带姓）","why":"一句话","source":"书名","piece":"篇名或作者","quote":"原句"}]}',
  ].join("\n");
}

export interface SimpleFastStage {
  /** 留下的一个名字（直播台等待页先放出来） */
  kept?: FastCandidate;
  /** 去掉的一个名字和原因 */
  dropped?: { name: string; reasons: string[] };
}

export async function runSimpleFast(input: FastFormInput, onStage?: (s: SimpleFastStage) => void): Promise<FastSuccess | FastFailure> {
  const t0 = Date.now();
  const norm = normalizeFastInput(input);
  if (!norm.ok) return norm;
  const req = norm.value;
  const recent = (input.recent ?? []).filter((n) => typeof n === "string" && /^[一-鿿]{2}$/.test(n)).slice(-500);

  // 生日：屏幕上只给属相和季节（照现在的系统），给模型的也只到季节
  let baziLine: string | undefined;
  let season: string | undefined;
  if (req.birthday) {
    const bazi = buildBaziSummary({ baziEnabled: true, birthStatus: "born", birthDate: req.birthday, birthHour: undefined });
    if (bazi.ok && bazi.summary) {
      const zodiac = zodiacOf(req.birthday) ?? bazi.summary.readable?.zodiac;
      season = bazi.summary.readable?.season ? `生在${bazi.summary.readable.season}` : undefined;
      baziLine = [zodiac ? `属${zodiac}` : "", season ?? ""].filter(Boolean).join("，") || undefined;
    }
  }

  const kept: FastCandidate[] = [];
  const notes: string[] = [];
  const take = (raw: Record<string, unknown>) => {
    if (kept.length >= KEEP) return;
    const name = str(raw.givenName, 4).replace(new RegExp(`^${req.surname}`), "");
    const reasons: string[] = [];
    if (!/^[一-鿿]{2}$/.test(name)) reasons.push("名不是两个字");
    else if (recent.includes(name)) reasons.push("这一场给过了");
    else if (kept.some((k) => k.givenName === name)) reasons.push("重复");
    else if (kept.some((k) => [...k.givenName].some((c) => name.includes(c)))) reasons.push("和前面的名字用了同一个字");
    let hotChar = false;
    if (!reasons.length) {
      const p = hardProblems(req.surname, name, req.gender);
      // 用户在评审页评过不要的名字、挡掉的字（疏影、晚晴这一路）：和现在的系统同一份口味表，只读
      reasons.push(...p.reasons, ...tasteProblems(name));
      hotChar = p.hotChar;
    }
    if (reasons.length) {
      onStage?.({ dropped: { name: name || "（空）", reasons } });
      return;
    }
    const quote = str(raw.quote, 60);
    const citation = quote ? citeFromLine(str(raw.source, 20) || undefined, str(raw.piece, 30) || undefined, name, quote) : null;
    const py = fullNamePinyin(req.surname, name);
    const c: FastCandidate = {
      givenName: name,
      fullName: `${req.surname}${name}`,
      pinyin: py.text,
      ...(py.hint ? { pinyinHint: py.hint } : {}),
      why: str(raw.why, 120),
      hotChar,
      ...(citation ? { citation } : {}),
    };
    kept.push(c);
    onStage?.({ kept: c });
  };

  let failure: string | null = null;
  try {
    const r = await simpleCall(fastPrompt(req.surname, req.gender, season, recent), {
      onContent: arrayItemReader("names", take),
      timeoutMs: 60_000,
    });
    // 流里没拆出来（模型没按 names 写），整段再拆一次
    if (!kept.length && r.json && Array.isArray(r.json.names)) for (const n of r.json.names as Record<string, unknown>[]) take(n);
    if (!r.json && !kept.length) failure = failText(r.finishReason);
  } catch (err) {
    failure = err instanceof Error ? err.message : "生成失败";
  }

  // 名字库只补缺口：模型出错或者能用的不到三个
  if (kept.length < KEEP) {
    const lib = pickLibraryCandidates(loadLibrary(), req.surname, req.gender, [...recent, ...kept.map((k) => k.givenName)], KEEP - kept.length, Math.random, kept.flatMap((k) => [...k.givenName]));
    if (lib.length) notes.push(`模型${failure ? `出错（${failure}）` : `只写出 ${kept.length} 个能用的`}，名字库补了 ${lib.length} 个`);
    for (const c of lib) {
      kept.push(c);
      onStage?.({ kept: c });
    }
  }
  if (!kept.length) {
    return { ok: false, code: failure ? "UPSTREAM" : "NO_CANDIDATE", message: failure ? `起名没成功：${failure}，请再试一次` : "这一轮没起出合适的名字，请再试一次" };
  }
  return {
    ok: true,
    surname: req.surname,
    gender: req.gender,
    primary: kept[0]!,
    alternatives: kept.slice(1, KEEP),
    ...(baziLine ? { baziLine } : {}),
    tookMs: Date.now() - t0,
    notes,
  };
}
