/**
 * 主播提词页的数据：直播页每一轮开始、出结果、回到输入时推一份，提词页每秒取一次最新的。
 * 只给主播看，观众屏幕上不出现（直播伴侣只采集直播台那个窗口）。
 *
 * 这个文件不碰 node 模块：直播页、提词页（浏览器）和同步接口（服务端）都引它。
 */

export interface PrompterName {
  full: string;
  pinyin: string;
  /** 一句话寓意，观众屏幕上那一句 */
  one: string;
  /** 备选的稿子（拆字、合起来），一句一行；还没写好就没有 */
  lines?: string[];
  /** 只给主播看：读音、谐音联想 */
  tip?: string;
  /** 稿子还在写（模型起的名字，出结果后几秒内补上） */
  writing?: boolean;
}

export interface PrompterPrimary extends PrompterName {
  pinyinHint?: string;
  /** 主播照着念的稿子，一句一行 */
  lines: string[];
  /** library 名字库里用户评过的；model 模型现起的，稿子也是模型写的；report 完整版报告 */
  source: "library" | "model" | "report";
}

export interface PrompterSection {
  label: string;
  names: PrompterName[];
}

export type PrompterRound =
  | { state: "idle" }
  | { state: "pending"; no: number; surname: string; gender: string }
  | {
      state: "ready";
      no: number;
      surname: string;
      gender: string;
      primary?: PrompterPrimary;
      sections: PrompterSection[];
    };

export interface PrompterSnapshot {
  /** 服务启动时生成；服务重启后 seq 从头数，提词页靠它认出来 */
  boot: string;
  seq: number;
  round: PrompterRound;
}

const TEXT_MAX = 300;
const LINES_MAX = 12;
const SECTIONS_MAX = 4;
const NAMES_MAX = 6;

function text(v: unknown, max = TEXT_MAX): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return [...s].length <= max ? s : null;
}

function optText(v: unknown): string | undefined | null {
  if (v === undefined) return undefined;
  return text(v);
}

function parseLines(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > LINES_MAX) return null;
  const lines: string[] = [];
  for (const l of v) {
    const t = text(l);
    if (t === null) return null;
    if (t) lines.push(t);
  }
  return lines;
}

function parseName(v: unknown): PrompterName | null {
  const x = v as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  const full = text(x.full, 8);
  const pinyin = text(x.pinyin, 60);
  const one = text(x.one);
  if (!full || pinyin === null || one === null) return null;
  const lines = x.lines === undefined ? undefined : parseLines(x.lines);
  const tip = optText(x.tip);
  if (lines === null || tip === null) return null;
  return {
    full,
    pinyin,
    one,
    ...(lines?.length ? { lines } : {}),
    ...(tip ? { tip } : {}),
    ...(x.writing === true ? { writing: true } : {}),
  };
}

function parsePrimary(v: unknown): PrompterPrimary | null {
  const base = parseName(v);
  if (!base) return null;
  const x = v as Record<string, unknown>;
  const source = x.source;
  if (source !== "library" && source !== "model" && source !== "report") return null;
  const lines = parseLines(x.lines);
  const pinyinHint = optText(x.pinyinHint);
  if (lines === null || pinyinHint === null) return null;
  return { ...base, lines, source, ...(pinyinHint ? { pinyinHint } : {}) };
}

/** 接口收到的东西按这里的形状收，多余字段丢掉、超长或不对就整份不收 */
export function parsePrompterRound(input: unknown): PrompterRound | null {
  const x = input as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  if (x.state === "idle") return { state: "idle" };
  if (x.state !== "pending" && x.state !== "ready") return null;

  const no = x.no;
  const surname = text(x.surname, 4);
  const gender = text(x.gender, 8);
  if (typeof no !== "number" || !Number.isInteger(no) || no < 1 || no > 100_000 || !surname || gender === null) return null;
  if (x.state === "pending") return { state: "pending", no, surname, gender };

  let primary: PrompterPrimary | undefined;
  if (x.primary !== undefined) {
    const p = parsePrimary(x.primary);
    if (!p) return null;
    primary = p;
  }
  if (!Array.isArray(x.sections) || x.sections.length > SECTIONS_MAX) return null;
  const sections: PrompterSection[] = [];
  for (const s of x.sections) {
    const sec = s as Record<string, unknown> | null;
    const label = text(sec?.label, 12);
    if (!sec || !label || !Array.isArray(sec.names) || sec.names.length > NAMES_MAX) return null;
    const names: PrompterName[] = [];
    for (const n of sec.names) {
      const parsed = parseName(n);
      if (!parsed) return null;
      names.push(parsed);
    }
    sections.push({ label, names });
  }
  return { state: "ready", no, surname, gender, ...(primary ? { primary } : {}), sections };
}
