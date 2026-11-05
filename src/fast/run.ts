import seedChars from "@/config/seed-chars.json";
import { buildBaziSummary } from "@/domain/bazi";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { loadLibrary, matchLibrary, pickLibraryCandidate, pickLibraryCandidates } from "@/library/live-pick";
import { citeFromLine, locateCitation } from "./cite";
import { checkFastCandidate } from "./gate";
import { normalizeFastInput } from "./normalize";
import { createFastProvider, type DraftSummary, type FastPromptBuilders, type RawFast } from "./provider";
import { birthTimeOf, seasonSeeds, zodiacOf } from "./birth";
import { pickSeeds } from "./seeds";
import { tasteProblems } from "./taste";
import {
  FAST_RECENT_MAX,
  type FastCandidate,
  type FastDebug,
  type FastFormInput,
  type FastGender,
  type FastRequest,
  type FastResult,
  type FastStageEvent,
  type FastSuccess,
} from "./types";

/**
 * 精简版主流程：校验 → 抽起手字（填了生日，第一个按出生季节抽）→ 一次生成 → 闸门 → 撞上名字库的换成库里那条
 * → 口味过滤（taste.ts）→ 核出处（模型给了才核）→ 排序 → 首推取排第一的，备选取后三个。
 * 首推默认是模型起的（2026-11-01 起）；FAST_PRIMARY=library 时先从名字库挑（src/library/live-pick.ts）。
 *
 * 不落盘：直播结果是即时产物，存图即交付。写进 data/reports 会污染历史页。
 */

const KEEP_MIN = 3;
/** 备选 2 个：一轮一共出 3 个名字（首推 + 2 个备选） */
const ALTERNATIVES_MAX = 2;
/**
 * 排序时回看最近多少个名字的用字。名字不重样以后，配字仍爱落在禾、宁、棠、晴上
 * （同一姓 20 轮实测，100 个候选里这四个字占 41 个），最近没用过的字排前面。
 */
const STALE_WINDOW = 40;
/**
 * 最近 16 个名字（现在一轮 3 个，约 5 轮）用过的字排在最前面考虑，比有出处、比呼应出生时节都靠前：观众连着看到「博远」「澄远」，
 * 会觉得又是同一个字（用户 11-01：一场里挨得近的不能重复）。2026-11-01 评测里，起手字表收窄以后，
 * 60 轮有 4–6 轮首推和前几轮共用字；其中一轮是名字库里的「怀瑾」紧跟在「瑾言」后面，因为有出处的排在最前。
 */
const NEAR_WINDOW = 16;

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
 * 排序：两个字都在名字用字表里 → 最近 16 个名字没用过的字 → 呼应出生时节（填了生日才有）→ 有出处 → 非热门字
 * → 最近 40 个名字没用过的字 → 模型原序。一轮出前 3 个（首推 + 2 个备选），排在后面的就是被挤掉的。
 * 2026-11-01 评测：呼应时节排在「有出处」后面时，有生日的轮次只有三四成首推带上季节的字。
 */
function rankCandidates(
  pool: FastCandidate[],
  recent: readonly string[],
  nameChars: ReadonlySet<string> = NAME_CHARS,
  /** 填了生日时按出生季节抽的起手字（birth.ts）：带这个字的名字排在同档的前面。几路合起来用时每路各一个 */
  echo?: string | readonly string[],
): FastCandidate[] {
  const echoes = echo === undefined ? [] : typeof echo === "string" ? [echo] : echo;
  const recentChars = new Set(recent.slice(-STALE_WINDOW).flatMap((n) => [...n]));
  const nearChars = new Set(recent.slice(-NEAR_WINDOW).flatMap((n) => [...n]));
  const staleOf = (c: FastCandidate) => [...c.givenName].filter((ch) => recentChars.has(ch)).length;
  const nearOf = (c: FastCandidate) => [...c.givenName].filter((ch) => nearChars.has(ch)).length;
  const offTableOf = (c: FastCandidate) => [...c.givenName].filter((ch) => !nameChars.has(ch)).length;
  const echoOf = (c: FastCandidate) => (echoes.some((e) => e && c.givenName.includes(e)) ? 0 : 1);
  return pool
    .map((c, i) => ({ c, i, stale: staleOf(c), near: nearOf(c), off: offTableOf(c), echo: echoOf(c) }))
    .sort((a, b) => {
      // 用了起手字表以外的字（野、舟、茉这类模型爱拿来凑的）先压后面：放到「挨得近不重复」后面考虑时，
      // 评测里首推「不要」的从 8% 涨到 18%
      if (a.off !== b.off) return a.off - b.off;
      if (a.near !== b.near) return a.near - b.near;
      // 填了生日就让呼应出生时节的那个名字当首推（用户 11-01：走模型的话生日一定要考虑）
      if (a.echo !== b.echo) return a.echo - b.echo;
      const ca = a.c.citation ? 0 : 1;
      const cb = b.c.citation ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (a.c.hotChar !== b.c.hotChar) return a.c.hotChar ? 1 : -1;
      if (a.stale !== b.stale) return a.stale - b.stale;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

/** 仅供测试 */
export const __rankCandidates = rankCandidates;
export const __fillFromLibrary = fillFromLibrary;

/**
 * 首推换成名字库里的那个以后，备选去掉和它同名的；和它撞字的排到后面，不够三个才用上。
 */
function alternativesBeside(primary: FastCandidate, ranked: readonly FastCandidate[]): FastCandidate[] {
  const taken = new Set([...primary.givenName]);
  const others = ranked.filter((c) => c.givenName !== primary.givenName);
  const apart = others.filter((c) => ![...c.givenName].some((ch) => taken.has(ch)));
  return [...apart, ...others.filter((c) => !apart.includes(c))].slice(0, ALTERNATIVES_MAX);
}

/**
 * 模型这一轮没出来（报错、超时、没配好钥匙），或者过了闸的不够三个时，用名字库补齐，不让这一轮白等。
 * 模型过了闸的名字排前面（首推仍是模型起的），缺几个从库里补几个；模型一个都没过才用库名当首推。这一场给过的都不再出。
 * 加起来还不够三个，返回 null，照旧报失败。
 */
function fillFromLibrary(
  req: FastRequest,
  recent: readonly string[],
  modelKept: readonly FastCandidate[],
  options: RunFastOptions = {},
): { primary: FastCandidate; alternatives: FastCandidate[] } | null {
  // 库只补缺口，省着用
  const model = modelKept.filter((c) => !recent.includes(c.givenName)).slice(0, ALTERNATIVES_MAX);
  const fromLib = pickLibraryCandidates(
    loadLibrary(),
    req.surname,
    req.gender,
    [...recent, ...model.map((c) => c.givenName)],
    1 + ALTERNATIVES_MAX - model.length,
    Math.random,
    model.flatMap((c) => [...c.givenName]),
  );
  /*
   * 首推由模型起（用户 11-01 定）：模型有过闸的就排前面，库名只补备选；模型一个都没过才用库名当首推。
   * 原来补位时首推一律换成库名（「首推从库里挑」那一版留下的），上屏线提到 90 以后补位变多，
   * 首推由模型起的轮次只剩约 77%，这样改回到约 97%（2026-11-05 独立评审回放），库名消耗不变。
   * FAST_PRIMARY=library 时照旧库名在前。
   */
  const libraryFirst = primarySource(options) === "library";
  const ordered = libraryFirst && fromLib.length ? [fromLib[0]!, ...model, ...fromLib.slice(1)] : [...model, ...fromLib];
  if (ordered.length < KEEP_MIN) return null;
  const primary = ordered[0]!;
  return { primary, alternatives: alternativesBeside(primary, ordered) };
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

export interface RunFastOptions {
  /**
   * 首推从哪来。model：用模型排第一的（2026-11-01 起的默认，用户定）；
   * library：先从名字库挑，挑不到才用模型的（10-31 到 11-01 的做法）。
   * 不传看环境变量 FAST_PRIMARY，设成 library 就切回名字库。
   * 两种都一样：模型出错或能用的不够三个时，从名字库补；模型起出库里的名字时，换成库里那一条。
   */
  primary?: "library" | "model";
  /** 评测脚本用：换一套提示词、起手字表或几路一起发来比，线上不传 */
  variant?: {
    prompt?: FastPromptBuilders;
    seedTable?: Readonly<Record<FastGender, readonly string[]>>;
    lanes?: number;
  };
}

/**
 * 一轮一共发几路（每路一组不同的起手字，回来的都合起来用）。不设是 2（2026-11-05 用户定，原来 3）；FAST_LANES=3 发三路。
 * 11-01 定三路时是「谁先回用谁、其余扔掉」，三路取最快的那一路。现在回来的几路都合起来用，
 * 独立评审实测（本地网关，各 20 轮交替）：三路合并中位 5.4 / p90 8.2 秒，两路合并 5.7 / 9.7 秒，补位都是 0；
 * 两路请求少三分之一。用户说三路并发对 API 要求太高、扔两路浪费，定两路。
 */
function laneCount(options: RunFastOptions): number {
  const n = options.variant?.lanes ?? Number(process.env.FAST_LANES);
  return Number.isInteger(n) && n >= 2 && n <= 3 ? n : 2;
}

function primarySource(options: RunFastOptions): "library" | "model" {
  if (options.primary) return options.primary;
  return process.env.FAST_PRIMARY?.trim() === "library" ? "library" : "model";
}

export async function runFast(
  input: FastFormInput,
  onStage?: (e: FastStageEvent) => void,
  options: RunFastOptions = {},
): Promise<FastResult> {
  const started = Date.now();
  const normalized = normalizeFastInput(input);
  if (!normalized.ok) return normalized;
  const req = normalized.value;
  const recent = sanitizeRecent(input.recent);
  const seedTable = options.variant?.seedTable;
  const nameChars = seedTable ? new Set([...seedTable.female, ...seedTable.male]) : NAME_CHARS;

  // 生日可选：屏幕上那行只给属相和季节；给模型的只到出生时节（prompt.ts 用 birth.ts 算），不给四柱
  let baziLine: string | undefined;
  if (req.birthday) {
    const bazi = buildBaziSummary({
      baziEnabled: true,
      birthStatus: "born",
      birthDate: req.birthday,
      birthHour: undefined,
    });
    if (bazi.ok && bazi.summary) {
      const readable = bazi.summary.readable;
      // 属相按春节换年（zodiacOf），不用八字年柱的立春换年：直播讲的是老百姓说的属相
      const zodiac = zodiacOf(req.birthday) ?? readable?.zodiac;
      const parts = [zodiac ? `属${zodiac}` : "", readable?.season ? `生在${readable.season}` : ""];
      baziLine = parts.filter(Boolean).join("，") || undefined;
    }
  }

  // 这一轮从哪几个字起手：本场没出现过的字优先，轮回时把配过的名字提醒给模型，
  // 最近扎堆的配字（宁、禾）也提醒一句。补发那一路换一组字（provider.ts 的 HEDGE_MS 注释）
  // 填了生日：第一个起手字按出生季节抽（birth.ts），首推优先用带这个字的名字
  const birthTime = req.birthday ? birthTimeOf(req.birthday) : null;
  const timely = birthTime ? seasonSeeds(birthTime, req.gender) : [];
  const main = pickSeeds(req.gender, req.surname, recent, Math.random, new Set(), seedTable, timely);
  // 补发的每一路换一组起手字，和前面几路都不重
  const backups: typeof main[] = [];
  for (let i = 1; i < laneCount(options); i++) {
    const taken = new Set([main, ...backups].flatMap((s) => s.seeds));
    backups.push(pickSeeds(req.gender, req.surname, recent, Math.random, taken, seedTable, timely));
  }

  const fallback = (
    filled: { primary: FastCandidate; alternatives: FastCandidate[] },
    note: string,
    debug?: FastDebug,
  ): FastSuccess => ({
    ok: true,
    surname: req.surname,
    gender: req.gender,
    ...filled,
    ...(baziLine ? { baziLine } : {}),
    tookMs: Date.now() - started,
    notes: [note],
    ...(debug ? { debug } : {}),
  });

  const rounds = [main, ...backups];
  const library = loadLibrary();
  const seen = new Set<string>();
  const kept: FastCandidate[] = [];
  const dropped: { name: string; reasons: string[] }[] = [];
  let drafted = 0;
  let withLine = 0;
  let citeTried = 0;
  /** 名字真用上的那几路（按回来的先后），排序时呼应时节、debug 里的起手字都按这几路算 */
  const usedLanes: number[] = [];

  // 一路回来的名字：过闸、换成库里那条、口味过滤，留下的进 kept。几路都走同一套
  const take = (raw: RawFast[], laneIndex: number) => {
    const before = kept.length;
    drafted += raw.length;
    for (const c of raw) {
      const name = stripSurname(c.givenName.trim(), req.surname);
      if (seen.has(name)) continue;
      const verdict = checkFastCandidate(name, req.surname, req.gender, c.scores);
      if (!verdict.keep) {
        dropped.push({ name, reasons: verdict.reasons });
        continue;
      }
      // 模型起出了名字库里的名字（用户评过的）：换成库里那一条，带上核过的出处和整段口播稿
      const fromLibrary = matchLibrary(library, name, req.surname, req.gender, verdict.hotChar);
      if (fromLibrary) {
        seen.add(name);
        kept.push(fromLibrary);
        continue;
      }
      const taste = tasteProblems(name);
      if (taste.length) {
        dropped.push({ name, reasons: taste });
        continue;
      }
      seen.add(name);
      if (c.line) withLine++;
      if (c.source || c.piece) citeTried++;

      const py = fullNamePinyin(req.surname, name);
      kept.push({
        givenName: name,
        fullName: `${req.surname}${name}`,
        pinyin: py.text,
        ...(py.hint ? { pinyinHint: py.hint } : {}),
        why: c.why ?? "",
        hotChar: verdict.hotChar,
        ...((): { citation?: FastCandidate["citation"] } => {
          // 提示词不再要出处；模型自己给了，照旧逐字核，核不过就当没有
          if (!c.source && !c.piece) return {};
          const byLine = c.line ? citeFromLine(c.source, c.piece, name, c.line) : null;
          const hit = byLine ?? locateCitation(c.source, c.piece, name);
          return hit ? { citation: hit } : {};
        })(),
      });
    }
    if (kept.length > before) usedLanes.push(laneIndex);
  };

  /**
   * 这一轮能上屏的：同轮撞字去重、去掉这一场给过的。「够不够」按这个数，不按模型给了几个、过闸几个
   * （用户 11-01 定：一场里不能重复。评测里出过起手字轮回时模型又配出徽音、昭宁）
   */
  const usableOf = (list: readonly FastCandidate[]) => {
    const distinct = dedupeChars([...list]);
    const base = distinct.length >= KEEP_MIN ? distinct : [...list];
    return { base, fresh: recent.length ? base.filter((c) => !recent.includes(c.givenName)) : base };
  };

  let summary: DraftSummary;
  try {
    const provider = createFastProvider(options.variant?.prompt);
    // 每一路回来就过一遍；凑够 3 个能上屏的就不等其余几路（其余取消）
    summary = await provider.draftLanes(req, rounds, (lane) => {
      take(lane.list, lane.index);
      return usableOf(kept).fresh.length >= KEEP_MIN;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成失败";
    const filled = fillFromLibrary(req, recent, [], options);
    if (filled) return fallback(filled, `模型这一轮没出来（${message}），名字都来自名字库`);
    return { ok: false, code: "UPSTREAM", message };
  }
  onStage?.({ stage: "draft", drafted });

  const firstUsed = rounds[usedLanes[0] ?? summary.lanes[0]?.index ?? 0] ?? main;
  const { seeds, avoid, tired } = firstUsed;
  const head = summary.lanes[0]!;
  const debugInfo: FastDebug = {
    drafted,
    kept: kept.length,
    withLine,
    reasoningChars: summary.lanes.reduce((n, l) => n + l.stats.reasoningChars, 0),
    firstTokenMs: head.stats.firstTokenMs,
    retried: summary.lanes.some((l) => l.stats.retried),
    hedged: summary.launched > 1,
    hedgeWon: head.index > 0,
    dropped,
    seeds,
    avoid,
    tired,
    lanes: summary.lanes.map((l) => ({
      index: l.index,
      seeds: rounds[l.index]?.seeds ?? [],
      drafted: l.list.length,
      // 模型这一路给的名字：对上屏的库名能分清是模型起出来的（换成库里那条）还是从名字库补的
      names: l.list.map((c) => stripSurname(c.givenName.trim(), req.surname)),
      ms: l.ms,
      used: usedLanes.includes(l.index),
    })),
  };
  onStage?.({ stage: "gate", drafted, kept: kept.length, dropped });

  if (kept.length < KEEP_MIN) {
    const filled = fillFromLibrary(req, recent, kept, options);
    if (filled) return fallback(filled, `模型这一轮只有 ${kept.length} 个能用，其余从名字库补`, debugInfo);
    return {
      ok: false,
      code: "NO_CANDIDATE",
      message: `可用名字不足（只剩 ${kept.length} 个），请再点一次`,
      debug: debugInfo,
    };
  }

  // 这一场给过的名字不再出（整场都记）。过滤后不够 3 个，先从名字库补没给过的；还不够就少出几个备选；
  // 一个新名字都没有才放行重复。几路都合起来过以后还不够，才走到这里
  const { base, fresh } = usableOf(kept);
  let pool = fresh;
  if (pool.length < KEEP_MIN) {
    const extra = pickLibraryCandidates(
      library,
      req.surname,
      req.gender,
      [...recent, ...pool.map((c) => c.givenName)],
      KEEP_MIN - pool.length,
      Math.random,
      pool.flatMap((c) => [...c.givenName]),
    );
    pool = [...pool, ...extra];
  }
  if (pool.length === 0) pool = base;

  // 名字真用上的那几路，各自第一个起手字是按季节抽的（birth.ts）；带它的名字排前面
  const timelyChars = usedLanes
    .map((i) => rounds[i]?.seeds[0])
    .filter((ch): ch is string => Boolean(ch) && timely.includes(ch!));
  const ranked = rankCandidates(pool, recent, nameChars, timelyChars);
  const fromLibrary =
    primarySource(options) === "library" ? pickLibraryCandidate(loadLibrary(), req.surname, req.gender, recent) : null;
  const primary = fromLibrary ?? ranked[0]!;
  const alternatives = fromLibrary ? alternativesBeside(fromLibrary, ranked) : ranked.slice(1, 1 + ALTERNATIVES_MAX);

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
