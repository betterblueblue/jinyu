import { buildBaziSummary } from "@/domain/bazi";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { citeFromLine, locateCitation } from "./cite";
import { checkFastCandidate } from "./gate";
import { normalizeFastInput } from "./normalize";
import { createFastProvider } from "./provider";
import type { FastCandidate, FastFormInput, FastResult, FastStageEvent } from "./types";

/**
 * 精简版主流程：校验 → 排盘（可选）→ 一次生成 → 闸门 → 截出处 → 排序。
 *
 * 不落盘：直播结果是即时产物，存图即交付。写进 data/reports 会污染历史页。
 */

const KEEP_MIN = 3;
const ALTERNATIVES_MAX = 3;
/** 这一场最多带多少个「已经给过」的名字（每轮最多记 4 个，20 个≈最近 5 轮） */
const RECENT_MAX = 20;

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
  return out.length > RECENT_MAX ? out.slice(-RECENT_MAX) : out;
}

/** 仅供测试：这一场已给过的名字，超上限时留最近的 */
export const __sanitizeRecent = sanitizeRecent;

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

  const provider = createFastProvider();
  let raw;
  try {
    raw = await provider.draft(req, baziPillars);
  } catch (err) {
    return {
      ok: false,
      code: "UPSTREAM",
      message: err instanceof Error ? err.message : "生成失败",
    };
  }
  onStage?.({ stage: "draft", drafted: raw.length });

  const notes: string[] = [];
  const seen = new Set<string>();
  const kept: FastCandidate[] = [];
  const dropped: { name: string; reasons: string[] }[] = [];
  let withLine = 0;

  for (const c of raw) {
    const name = c.givenName.trim();
    if (seen.has(name)) continue;
    const verdict = checkFastCandidate(name, req.surname);
    if (!verdict.keep) {
      dropped.push({ name, reasons: verdict.reasons });
      continue;
    }
    seen.add(name);
    if (c.line) withLine++;

    const py = fullNamePinyin(req.surname, name);
    kept.push({
      givenName: name,
      fullName: `${req.surname}${name}`,
      pinyin: py.text,
      ...(py.hint ? { pinyinHint: py.hint } : {}),
      why: c.why ?? "",
      hotChar: verdict.hotChar,
      ...((): { citation?: FastCandidate["citation"] } => {
        if (!c.source && !c.piece) return {};
        // 模型给了原句就逐字核那一句，不给（或核不过）才回原文去截
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
    dropped,
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

  // 这一场给过的名字不再出（提示词说了模型偶尔还会给）。过滤后不够 3 个就不敢过滤了，
  // 直播里宁可重复一次，也不能没名字可念。
  const distinct = dedupeChars(kept);
  const base = distinct.length >= KEEP_MIN ? distinct : kept;
  const fresh = recent.length ? base.filter((c) => !recent.includes(c.givenName)) : base;
  const pool = fresh.length >= KEEP_MIN ? fresh : base;

  // 排序：有出处优先，其次非热门字，最后保模型原序
  const ranked = pool
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ca = a.c.citation ? 0 : 1;
      const cb = b.c.citation ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (a.c.hotChar !== b.c.hotChar) return a.c.hotChar ? 1 : -1;
      return a.i - b.i;
    })
    .map((x) => x.c);

  const withoutCitation = ranked.filter((c) => !c.citation).length;
  if (withoutCitation) notes.push(`${withoutCitation} 个名字没核到可引的古籍原文，出处留白`);

  const [head, ...rest] = ranked as [FastCandidate, ...FastCandidate[]];

  // 首推没出处：让模型补一次，核过才用。核不过就留白——
  // 本地「两字相邻」兜底已删：它截出来的句子近一半不能当众念（隔逗号、跨词、缺字方块）。
  let primary = head;
  if (!primary.citation) {
    try {
      const guess = await provider.citeOne(primary.givenName);
      if (guess) {
        const byLine = guess.line
          ? citeFromLine(guess.source, guess.piece, primary.givenName, guess.line)
          : null;
        const hit = byLine ?? locateCitation(guess.source, guess.piece, primary.givenName);
        if (hit) primary = { ...primary, citation: hit };
      }
    } catch {
      /* 补不到继续往下走 */
    }
  }

  const finalAll = [primary, ...rest];
  const missing = finalAll.filter((c) => !c.citation).length;
  notes.length = 0;
  if (missing) notes.push(`${missing} 个名字没核到可引的古籍原文，出处留白`);
  onStage?.({ stage: "cite", withLine: finalAll.length - missing, missing });

  return {
    ok: true,
    surname: req.surname,
    gender: req.gender,
    primary,
    alternatives: rest.slice(0, ALTERNATIVES_MAX),
    ...(baziLine ? { baziLine } : {}),
    tookMs: Date.now() - started,
    notes,
    debug: debugInfo,
  };
}
