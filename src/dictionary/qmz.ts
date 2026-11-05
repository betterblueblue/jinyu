import fs from "node:fs";
import path from "node:path";

/**
 * 起名字典（zd.qmz.in）的本地适配层。
 *
 * 站点没有 JSON API，抓取脚本把单字页解析成 data/qmz-dict/chars.json；
 * 运行时只读本地文件，不访问外站，直播链路不会被外部延迟拖住。
 */

export interface QmzChar {
  char: string;
  pinyin?: string;
  /** 简体笔画 */
  simplifiedStrokes?: number;
  /** 康熙笔画，和简体笔画分开存 */
  kangxiStrokes?: number;
  /** 站点标注的五行；直播不用，只作离线参考 */
  wuxing?: string;
  radical?: string;
  basicMeaning?: string;
  nameMeaning?: string;
  /** 站点的「起名参考」，只是通用建议，不当硬规则 */
  reference?: string;
  decomposition?: string;
  idioms?: string[];
  sourceUrl: string;
  fetchedAt: string;
}

export interface QmzDictionary {
  generatedAt: string;
  source: string;
  chars: Record<string, QmzChar>;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  middot: "·",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function cleanText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function infoValue(html: string, label: string): string | undefined {
  const re = new RegExp(
    `<div class="info-label">\\s*${escapeRegExp(label)}\\s*</div>\\s*<div class="info-value">([\\s\\S]*?)</div>`,
  );
  const m = re.exec(html);
  const value = m ? cleanText(m[1] ?? "") : "";
  return value || undefined;
}

function sectionHtml(html: string, title: string): string | undefined {
  const re = new RegExp(
    `<section class="section">\\s*<h2 class="section-title">\\s*${escapeRegExp(title)}\\s*</h2>([\\s\\S]*?)</section>`,
  );
  return re.exec(html)?.[1];
}

function descText(section: string | undefined): string | undefined {
  if (!section) return undefined;
  const m = /<div class="desc-text"[^>]*>([\s\S]*?)<\/div>/.exec(section);
  const text = m ? cleanText(m[1] ?? "") : "";
  return text || undefined;
}

function tags(section: string | undefined): string[] {
  if (!section) return [];
  const out: string[] = [];
  for (const m of section.matchAll(/<span class="tag">([\s\S]*?)<\/span>/g)) {
    const text = cleanText(m[1] ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /\d+/.exec(value);
  return m ? Number(m[0]) : undefined;
}

/** 从单字页 HTML 解析出字段；页面结构变了就返回 null，不猜 */
export function parseQmzCharHtml(char: string, html: string, sourceUrl: string, fetchedAt: string): QmzChar | null {
  const pinyin = infoValue(html, "拼音");
  const basicMeaning = descText(sectionHtml(html, "基本含义"));
  const nameMeaning = descText(sectionHtml(html, "起名寓意"));
  if (!pinyin && !basicMeaning && !nameMeaning) return null;

  const decomposition = tags(sectionHtml(html, "拆字方案")).join(" ");
  const idioms = tags(sectionHtml(html, "相关成语"));
  return {
    char,
    ...(pinyin ? { pinyin } : {}),
    ...(toInt(infoValue(html, "简体笔画")) !== undefined
      ? { simplifiedStrokes: toInt(infoValue(html, "简体笔画")) }
      : {}),
    ...(toInt(infoValue(html, "康熙笔画")) !== undefined
      ? { kangxiStrokes: toInt(infoValue(html, "康熙笔画")) }
      : {}),
    ...(infoValue(html, "五行") ? { wuxing: infoValue(html, "五行") } : {}),
    ...(infoValue(html, "部首") ? { radical: infoValue(html, "部首") } : {}),
    ...(basicMeaning ? { basicMeaning } : {}),
    ...(nameMeaning ? { nameMeaning } : {}),
    ...(descText(sectionHtml(html, "起名参考")) ? { reference: descText(sectionHtml(html, "起名参考")) } : {}),
    ...(decomposition ? { decomposition } : {}),
    ...(idioms.length ? { idioms } : {}),
    sourceUrl,
    fetchedAt,
  };
}

export function qmzDictionaryPath(): string {
  return path.join(process.env.JINYU_DATA_DIR ?? path.join(process.cwd(), "data"), "qmz-dict", "chars.json");
}

let cached: QmzDictionary | null = null;
/** 上次读时文件的修改时间；补抓后文件变了就重读，开着的直播台不用重启（2026-11-05） */
let loadedMtime: number | null = null;

export function loadQmzDictionary(): QmzDictionary | null {
  let mtime: number;
  try {
    mtime = fs.statSync(qmzDictionaryPath()).mtimeMs;
  } catch {
    cached = null;
    loadedMtime = null;
    return null;
  }
  if (loadedMtime === mtime) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(qmzDictionaryPath(), "utf8")) as QmzDictionary;
    loadedMtime = mtime;
  } catch {
    // 抓取脚本正在写、读到半截：这次不换，下次再试
    if (!cached) loadedMtime = null;
  }
  return cached;
}

export function getQmzChar(ch: string): QmzChar | null {
  return loadQmzDictionary()?.chars[ch] ?? null;
}

/**
 * 基本含义里能当众念的部分（2026-11-05）：去掉讲五行的分句。
 * 直播不讲八字、五行（合规），站点有 10 来个字的基本含义混了「是金五行很强的姓名用字」这类话，
 * 还有雷「补水生木」这种五行生克。只去这些分句，其余照旧；去完没剩东西就当没有基本含义。
 */
const FIVE_ELEMENTS = /五行|[金木水火土][生克中][含金木水火土]|[金木水火土]旺|两(个)?[“"]?火/;

export function spokenBasicMeaning(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const kept = text
    .split(/(?<=[。；！？])/)
    .flatMap((sentence) => {
      if (!FIVE_ELEMENTS.test(sentence)) return [sentence];
      // 只去讲五行的那个分句；剩下的说不成一句话（「另外。」「做为连词或副词使用时。」）就整句去掉
      const end = /[。；！？]$/.exec(sentence)?.[0] ?? "";
      const parts = sentence
        .replace(/[。；！？]$/, "")
        .split(/[，,]/)
        // 「结合字义（来看）」「因木生火」只是给五行说法铺垫，去掉五行以后单独留着没意思
        .filter((p) => !FIVE_ELEMENTS.test(p) && !/^(结合字义(来看)?|因[金木水火土]生[金木水火土])$/.test(p.trim()));
      const enough = parts.length >= 2 || (parts.length === 1 && [...parts[0]!].length >= 8 && !/时$|看$|外$/.test(parts[0]!));
      return enough ? [`${parts.join("，")}${end}`] : [];
    })
    .join("")
    .trim();
  return kept || undefined;
}

/** 仅测试用 */
export function resetQmzDictionaryCache(): void {
  cached = null;
  loadedMtime = null;
}
