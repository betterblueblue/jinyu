import seedChars from "@/config/seed-chars.json";
import seedLines from "@/config/seed-lines.json";
import { buildBaziSummary } from "@/domain/bazi";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { citeFromLine, locateCitation } from "./cite";
import { checkFastCandidate } from "./gate";
import { normalizeFastInput } from "./normalize";
import { createFastProvider } from "./provider";
import { pickSeeds } from "./seeds";
import {
  FAST_RECENT_MAX,
  type FastCandidate,
  type FastCharSource,
  type FastFormInput,
  type FastResult,
  type FastStageEvent,
} from "./types";

/**
 * 精简版主流程：校验 → 排盘（可选）→ 抽起手字 → 一次生成 → 闸门 → 核出处（模型给了才核）→ 配字出（查表）→ 排序。
 *
 * 不落盘：直播结果是即时产物，存图即交付。写进 data/reports 会污染历史页。
 */

const KEEP_MIN = 3;
const ALTERNATIVES_MAX = 3;
/**
 * 排序时回看最近多少个名字的用字。名字不重样以后，配字仍爱落在禾、宁、棠、晴上
 * （同一姓 20 轮实测，100 个候选里这四个字占 41 个），最近没用过的字排前面。
 */
const STALE_WINDOW = 40;

/** 只收两字汉字名字，去重；超出上限时保留**最近**的，先给过的先忘 */
function sanitizeRecent(recent: unknown): string[] {
  if (!Array.isArray(recent)) return [];
  const out: string[] = [];
  for (const item of recent) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!/^[\u4e00-\u9fff]{2}$/.test(name)) continue;
    if (out.includes(name)) continue;
    out.push(name);
  }
  // 客户端按旧→新传上来，这里必须留尾部：留头部会先把这一场刚念过的名字丢掉
  return out.length > FAST_RECENT_MAX ? out.slice(-FAST_RECENT_MAX) : out;
}

/** 仅供测试：这一场已给过的名字，超上限时留最近的 */
export const __sanitizeRecent = sanitizeRecent;

/**
 * 模型偶尔把姓也写进 givenName（王时雨）。去掉姓再过闸，不让整轮作废——
 * 实测放开推理的那几版里，一轮 5 个全带姓、整轮「可用名字不足」出现过 3 次。
 */
function stripSurname(name: string, surname: string): string {
  const chars = [...name];
  const s = [...surname];
  return chars.length === s.length + 2 && name.startsWith(surname) ? chars.slice(s.length).join("") : name;
}

/** 仅供测试 */
export const __stripSurname = stripSurname;

/**
 * 名字用字表：男女两张起手字表合起来。
 *
 * 起手字那个字一定在表里，模型配的另一个字不一定。同一场实测 152 个名字里有 13 个用了表外的字，
 * 正好是别扭的那批（琛白、冬实、熙泰、芊蔚、如葵）和用烂的那批（予安类、晨汐），
 * 只有少数可惜（屿程、佳凝）。所以表外字的名字排到最后，不硬删：一轮仍尽量出满 4 个。
 */
const NAME_CHARS = new Set([...seedChars.female, ...seedChars.male]);

/**
 * 排序：有出处优先 → 非热门字 → 两个字都在名字用字表里 → 最近没用过的字 → 模型原序。
 * 一轮只出前 4 个，排在后面的就是被挤掉的。
 */
function rankCandidates(pool: FastCandidate[], recent: readonly string[]): FastCandidate[] {
  const recentChars = new Set(recent.slice(-STALE_WINDOW).flatMap((n) => [...n]));
  const staleOf = (c: FastCandidate) => [...c.givenName].filter((ch) => recentChars.has(ch)).length;
  const offTableOf = (c: FastCandidate) => [...c.givenName].filter((ch) => !NAME_CHARS.has(ch)).length;
  return pool
    .map((c, i) => ({ c, i, stale: staleOf(c), off: offTableOf(c) }))
    .sort((a, b) => {
      const ca = a.c.citation ? 0 : 1;
      const cb = b.c.citation ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (a.c.hotChar !== b.c.hotChar) return a.c.hotChar ? 1 : -1;
      if (a.off !== b.off) return a.off - b.off;
      if (a.stale !== b.stale) return a.stale - b.stale;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

/** 仅供测试 */
export const __rankCandidates = rankCandidates;

/**
 * 字出原句表：164 个起手字各配一句经典原文，scripts/check-seed-lines.ts 逐字核过。
 * 直播不再让模型给出处（多 3 秒、36 个名字只核到 1 条），名字里的起手字却一定在表里，
 * 查表就能给出一句真原文，不花模型时间。
 */
const CHAR_LINES: Record<string, { from: string; line: string }> = seedLines.lines;

/** 先看这一轮的起手字，再看另一个字（模型配的字也可能在表里）；都没有就不出字出 */
function charSourceOf(givenName: string, seeds: readonly string[]): FastCharSource | undefined {
  const chars = [...givenName];
  const order = [...chars.filter((ch) => seeds.includes(ch)), ...chars.filter((ch) => !seeds.includes(ch))];
  for (const ch of order) {
    const hit = CHAR_LINES[ch];
    if (hit) return { char: ch, from: hit.from, line: hit.line };
  }
  return undefined;
}

/** 同一批候选之间不重复用字；重复的丢掉，除非丢到不够 KEEP_MIN */
function dedupeChars(list: FastCandidate[]): FastCandidate[] {
  const used = new Set<string>();
  const out: FastCandidate[] = [];
  for (const c of list) {
    const chars = [...c.givenName];
    if (chars.some((ch) => used.has(ch))) continue;
    for (const ch of chars) used.add(ch);
    out.push(c);
  }
  return out;
}

export async function runFast(
  input: FastFormInput,
  onStage?: (e: FastStageEvent) => void,
): Promise<FastResult> {
  const started = Date.now();
  const normalized = normalizeFastInput(input);
  if (!normalized.ok) return normalized;
  const req = normalized.value;
  const recent = sanitizeRecent(input.recent);

  // 生日可选：有才排盘，四柱交给模型当参考，句子由模型写
  let baziPillars: string | undefined;
  let baziLine: string | undefined;
  if (req.birthday) {
    const bazi = buildBaziSummary({
      baziEnabled: true,
      birthStatus: "born",
      birthDate: req.birthday,
      birthHour: undefined,
    });
    if (bazi.ok && bazi.summary) {
      baziPillars = bazi.summary.pillarsText;
      const readable = bazi.summary.readable;
      const parts = [readable?.zodiac ? `属${readable.zodiac}` : "", readable?.season ? `生在${readable.season}` : ""];
      baziLine = parts.filter(Boolean).join("，") || undefined;
    }
  }

  // 这一轮从哪几个字起手：本场没出现过的字优先，轮回时把配过的名字提醒给模型，
  // 最近扎堆的配字（宁、禾）也提醒一句。补发那一路换一组字（provider.ts 的 HEDGE_MS 注释）
  const main = pickSeeds(req.gender, req.surname, recent);
  const backup = pickSeeds(req.gender, req.surname, recent, Math.random, new Set(main.seeds));
  const bazi = baziPillars ? { baziPillars } : {};

  const provider = createFastProvider();
  let raw;
  try {
    raw = await provider.draft(req, { ...main, ...bazi }, { ...backup, ...bazi });
  } catch (err) {
    return {
      ok: false,
      code: "UPSTREAM",
      message: err instanceof Error ? err.message : "生成失败",
    };
  }
  onStage?.({ stage: "draft", drafted: raw.length });
  const { seeds, avoid, tired } = provider.lastDraft.hedgeWon ? backup : main;

  const seen = new Set<string>();
  const kept: FastCandidate[] = [];
  const dropped: { name: string; reasons: string[] }[] = [];
  let withLine = 0;
  let citeTried = 0;

  for (const c of raw) {
    const name = stripSurname(c.givenName.trim(), req.surname);
    if (seen.has(name)) continue;
    const verdict = checkFastCandidate(name, req.surname);
    if (!verdict.keep) {
      dropped.push({ name, reasons: verdict.reasons });
      continue;
    }
    seen.add(name);
    if (c.line) withLine++;
    if (c.source || c.piece) citeTried++;

    const py = fullNamePinyin(req.surname, name);
    const charSource = charSourceOf(name, seeds);
    kept.push({
      givenName: name,
      fullName: `${req.surname}${name}`,
      pinyin: py.text,
      ...(py.hint ? { pinyinHint: py.hint } : {}),
      why: c.why ?? "",
      hotChar: verdict.hotChar,
      ...(charSource ? { charSource } : {}),
      ...((): { citation?: FastCandidate["citation"] } => {
        // 提示词不再要出处；模型自己给了，照旧逐字核，核不过就当没有
        if (!c.source && !c.piece) return {};
        const byLine = c.line ? citeFromLine(c.source, c.piece, name, c.line) : null;
        const hit = byLine ?? locateCitation(c.source, c.piece, name);
        return hit ? { citation: hit } : {};
      })(),
    });
  }

  const debugInfo = {
    drafted: raw.length,
    kept: kept.length,
    withLine,
    reasoningChars: provider.lastDraft.reasoningChars,
    firstTokenMs: provider.lastDraft.firstTokenMs,
    retried: provider.lastDraft.retried,
    hedged: provider.lastDraft.hedged,
    hedgeWon: provider.lastDraft.hedgeWon,
    dropped,
    seeds,
    avoid,
    tired,
  };
  onStage?.({ stage: "gate", drafted: raw.length, kept: kept.length, dropped });

  if (kept.length < KEEP_MIN) {
    return {
      ok: false,
      code: "NO_CANDIDATE",
      message: `可用名字不足（只剩 ${kept.length} 个），请再点一次`,
      debug: debugInfo,
    };
  }

  // 这一场给过的名字不再出（整场都记）。过滤后不够 3 个就不敢过滤了，
  // 直播里宁可重复一次，也不能没名字可念。
  const distinct = dedupeChars(kept);
  const base = distinct.length >= KEEP_MIN ? distinct : kept;
  const fresh = recent.length ? base.filter((c) => !recent.includes(c.givenName)) : base;
  const pool = fresh.length >= KEEP_MIN ? fresh : base;

  const ranked = rankCandidates(pool, recent);
  const [primary, ...rest] = ranked as [FastCandidate, ...FastCandidate[]];
  const alternatives = rest.slice(0, ALTERNATIVES_MAX);

  // 出处这一帧只在模型真给了出处时才推，否则加载页每轮都会写「原文核验 0 条」
  const notes: string[] = [];
  if (citeTried) {
    const shown = [primary, ...alternatives];
    const missing = shown.filter((c) => !c.citation).length;
    if (missing) notes.push(`${missing} 个名字没核到可引的古籍原文，出处留白`);
    onStage?.({ stage: "cite", withLine: shown.length - missing, missing });
  }

  return {
    ok: true,
    surname: req.surname,
    gender: req.gender,
    primary,
    alternatives,
    ...(baziLine ? { baziLine } : {}),
    tookMs: Date.now() - started,
    notes,
    debug: debugInfo,
  };
}
