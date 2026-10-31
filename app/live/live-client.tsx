"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NameDetail, ReportDocument } from "@/domain/types";
import type {
  FastCandidate,
  FastCitation,
  FastFailure,
  FastFormInput,
  FastSuccess,
} from "@/fast/types";
import { fullNamePinyin, nameSyllables, type NameSyllable } from "@/domain/pinyin-name";
import { AnalyzePanel } from "./analyze-panel";
import "./live.css";

type Skin = "paper" | "celadon" | "silver" | "bamboo";
type Gender = "male" | "female" | "unknown";
type Phase = "input" | "generating" | "reveal";


/** 引文证据：原文、篇名、两字在原文里是连着还是分取（后者是核验算出来的，不是文案） */
interface ShowCite {
  quote: string;
  piece: string;
  kind: "连出" | "分取";
}

interface ShowAlt {
  n: string;
  py: string;
  syl: NameSyllable[];
  one: string;
  cite?: ShowCite;
  rows: [string, string][];
}

interface ShowData {
  /** 本场第几个：屏幕和存图都要有，否则截图对不上是哪一轮 */
  no: number;
  /** 这一轮出场时，本场已经给过几个名字 */
  sessionGiven: number;
  surname: string;
  full: string;
  /** 全名拼音（含姓氏） */
  py: string;
  /** 多音姓氏或未收录字的核对提示 */
  pyHint?: string;
  /** 逐字音节 + 声调，直播大字下面那行用 */
  syl: NameSyllable[];
  one: string;
  tags: string[];
  /** 首推的引文证据；没有就是没核到，不用凑 */
  cite?: ShowCite;
  /** 解释行：读音、生辰这类。屏幕上和存图里同一份 */
  cardRows: [string, string][];
  alts: ShowAlt[];
  /** 开了生辰时带上四柱，直播页和存图都要显示 */
  bazi?: string;
  groups?: {
    male: ShowAlt[];
    female: ShowAlt[];
  };
}

const HAN_ONLY = /[\u4e00-\u9fa5]/g;

/** 两字在核过的原文里是连着的，还是同句分取——由引文算，不由文案写 */
function citeKind(givenName: string, quote: string): "连出" | "分取" {
  const folded = quote.match(HAN_ONLY)?.join("") ?? "";
  const [a, b] = [...givenName];
  if (!a || !b) return "分取";
  const i = folded.indexOf(a);
  return i >= 0 && folded[i + 1] === b ? "连出" : "分取";
}

function toCite(givenName: string, c?: FastCitation): ShowCite | undefined {
  if (!c?.quote) return undefined;
  // 引文按片段处理：结尾句号不放引号里，其余一字不改
  return { quote: `「${c.quote.replace(/[。！？；，、]\s*$/, "")}」`, piece: `${c.source}·${c.piece}`, kind: citeKind(givenName, c.quote) };
}


const SKIN_LABEL: Record<Skin, string> = { paper: "宣纸", celadon: "青瓷", silver: "刻版", bamboo: "竹兰" };
const SKINS: Skin[] = ["paper", "celadon", "silver", "bamboo"];
const G_LABEL: Record<Gender, string> = { male: "男", female: "女", unknown: "未知" };

const SKINC = {
  paper: { bg: "#F3EFE4", ink: "#191410", ink2: "#4A4238", ink3: "#6B6355", accent: "#A5382A", line: "rgba(35,28,20,.20)" },
  celadon: { bg: "#EAF2ED", ink: "#16211D", ink2: "#35504A", ink3: "#4B625A", accent: "#3A574E", line: "rgba(45,72,64,.22)" },
  silver: { bg: "#F0F0ED", ink: "#0E1013", ink2: "#34373C", ink3: "#5E6266", accent: "#9E2B25", line: "rgba(20,22,26,.18)" },
  bamboo: { bg: "#E0E7D6", ink: "#1C261A", ink2: "#3A4534", ink3: "#4E5945", accent: "#9C3A2B", line: "rgba(35,45,32,.20)" },
} as const;

const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,serif';
const SANS = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';


/** 等待时只给观众看真实阶段，不展示模型推理 */
function stageText(stage: string): string {
  if (stage === "filter") return "正在筛选";
  if (stage === "assemble") return "正在整理结果";
  return "正在准备名字";
}

function toShow(report: ReportDocument, no = 1, sessionGiven = 0): ShowData {
  const primary =
    report.names.find((n) => n.fullName === report.overview.primaryName) ?? report.names[0];
  const alts = report.names.filter((n) => n.fullName !== primary.fullName).slice(0, 2);
  const surname = report.request.surname;
  const givenOf = (full: string) => (full.startsWith(surname) ? full.slice(surname.length) : full);

  // 详解一项：屏幕上和存图里是同一份。寓意放在大字下面那句，这里不再重复
  const cardRowsFor = (n: NameDetail): [string, string][] => {
    const all: [string, string][] = [
      ["读音", n.phonology],
      ["书写", n.glyph],
      ["出处", n.origin],
      ["留意", n.pitfalls],
      ...(n.baziFit ? ([["生辰", n.baziFit]] as [string, string][]) : []),
    ];
    return all.filter((r) => Boolean(r[1]));
  };
  const toAlt = (n: NameDetail): ShowAlt => {
    const given = givenOf(n.fullName);
    const py = fullNamePinyin(surname, given);
    return {
      n: n.fullName,
      py: py.text,
      syl: nameSyllables(n.fullName),
      one: n.meaning,
      // 一句话已经写了寓意，这一行只补出处：有核验出处就标「出处」，没有才标「留意」。
      // 标签必须跟内容一致——不能拿「特点」当筐去装出处。
      rows: (n.origin
        ? [["出处", n.origin]]
        : n.pitfalls
          ? [["留意", n.pitfalls]]
          : []) as [string, string][],
    };
  };
  const groupFor = (fullNames?: string[]): ShowAlt[] =>
    (fullNames ?? [])
      .map((full) => report.names.find((n) => n.fullName === full))
      .filter((n): n is NameDetail => Boolean(n))
      .map(toAlt);
  const groups =
    report.source === "live" && report.request.gender === "unknown"
      ? {
          male: groupFor(report.overview.maleNames),
          female: groupFor(report.overview.femaleNames),
        }
      : undefined;

  const primaryPy = fullNamePinyin(surname, givenOf(primary.fullName));

  return {
    no,
    sessionGiven,
    surname,
    full: primary.fullName,
    py: primaryPy.text,
    ...(primaryPy.hint ? { pyHint: primaryPy.hint } : {}),
    syl: nameSyllables(primary.fullName),
    // 用名字本身的寓意做"一句"，oneLiner 更像摘要标题，不适合当主标语
    one: (primary.meaning || report.overview.oneLiner || "").replace(/\s+/g, ""),
    tags: [
      report.request.nameLength === "one" ? "单字名" : "双字名",
      primary.l2Hot ? "偏热门" : "避开网红名",
      groups
        ? "男女各三"
        : report.request.gender === "male"
          ? "男向"
          : report.request.gender === "female"
            ? "女向"
            : "中性",
    ],
    cardRows: cardRowsFor(primary),
    alts: alts.map(toAlt),
    // 直播观众看不懂干支：只说属相和出生季节
    ...(report.bazi?.readable
      ? { bazi: `属${report.bazi.readable.zodiac} · ${report.bazi.readable.season}出生` }
      : {}),
    groups,
  };
}

/**
 * 精简版结果 → 这张卡的数据规格。
 *
 * 屏幕和存图都只吃这一份，不再各挑各的字段（以前 DOM 用 rows、canvas 用 cardRows，
 * 备选在屏幕上只有名字、在图里却带 why 和出处，两边对不上）。
 * 规矩：要加字段，两个渲染器一起加，否则一致性就破了。
 */
function fastToShow(data: FastSuccess, no: number, sessionGiven: number): ShowData {
  const toAlt = (c: FastCandidate): ShowAlt => ({
    n: c.fullName,
    py: c.pinyin,
    syl: nameSyllables(c.fullName),
    one: c.why,
    cite: toCite(c.givenName, c.citation),
    rows: [],
  });

  const primary = data.primary;
  const tags = [
    "双字名",
    primary.hotChar ? "偏热门" : "避开网红名",
    data.gender === "male" ? "男向" : "女向",
  ];

  return {
    no,
    sessionGiven,
    surname: data.surname,
    full: primary.fullName,
    py: primary.pinyin,
    ...(primary.pinyinHint ? { pyHint: primary.pinyinHint } : {}),
    syl: nameSyllables(primary.fullName),
    one: primary.why,
    tags,
    cite: toCite(primary.givenName, primary.citation),
    // 出处单独做成证据块（引文 + 篇名 + 核验方式），拼音在大字下面那行，
    // 所以这里没有重复项；开生辰时才有内容
    cardRows: [] as [string, string][],
    alts: data.alternatives.map(toAlt),
    ...(data.baziLine ? { bazi: data.baziLine } : {}),
  };
}

/** 画一行带调拼音：声调是上标数字，和屏幕上的 <sup> 一致 */
function drawSyllables(
  ctx: CanvasRenderingContext2D,
  syls: NameSyllable[],
  x: number,
  y: number,
  o: { size: number; weight: number; color: string; align: "left" | "center"; maxW?: number },
): void {
  const base = o.size;
  const gap = base * 0.45;
  const toneGap = base * 0.3;
  ctx.font = `${o.weight} ${base}px ${SANS}`;
  const widths = syls.map((s) => ctx.measureText(s.py).width);
  let total = 0;
  syls.forEach((s, i) => {
    total += widths[i]! + (s.tone ? toneGap : 0);
  });
  total += gap * Math.max(0, syls.length - 1);
  const k = o.maxW && total > o.maxW ? o.maxW / total : 1;
  const size = base * k;
  let cur = o.align === "center" ? x - (total * k) / 2 : x;
  ctx.textAlign = "left";
  syls.forEach((s, i) => {
    ctx.font = `${o.weight} ${size}px ${SANS}`;
    ctx.fillStyle = o.color;
    ctx.fillText(s.py, cur, y);
    cur += widths[i]! * k;
    if (s.tone) {
      ctx.font = `400 ${size * 0.55}px ${SANS}`;
      ctx.fillText(String(s.tone), cur + 1, y - size * 0.4);
      cur += toneGap * k;
    }
    if (i < syls.length - 1) cur += gap * k;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {

  const NO_START = "」』】），。、；：！？》”’·…％%";
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    const t = cur + ch;
    if (ctx.measureText(t).width > maxW && cur && NO_START.indexOf(ch) < 0) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function downloadCanvas(cv: HTMLCanvasElement, filename: string): void {
  cv.toBlob((b) => {
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

/** 未知性别的直播卡片不再突出单个首推，而是完整带走男向 3 名与女向 3 名。 */
function buildGroupedCard(show: ShowData, skin: Skin, bgImage: HTMLImageElement | null): HTMLCanvasElement {
  const C = SKINC[skin];
  const W = 1080;
  const M = 90;
  const gap = 60;
  const colW = (W - M * 2 - gap) / 2;
  const groups = show.groups!;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `400 23px ${SERIF}`;
  const columns = [groups.male, groups.female].map((group) =>
    group.map((a) => ({ a, lines: wrapText(probe, a.one, colW).slice(0, 3) })),
  );
  const rowHeights = [0, 1, 2].map((index) =>
    Math.max(...columns.map((group) => 215 + (group[index]?.lines.length ?? 1) * 34)),
  );
  const startY = 450;
  const H = Math.max(1440, startY + rowHeights.reduce((sum, h) => sum + h, 0) + 130);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d")!;

  if (skin === "bamboo" && bgImage) x.drawImage(bgImage, 0, 0, W, H);
  else {
    x.fillStyle = C.bg;
    x.fillRect(0, 0, W, H);
  }
  x.strokeStyle = C.line;
  x.lineWidth = 2;
  x.strokeRect(48, 48, W - 96, H - 96);
  x.lineWidth = 1;
  x.strokeRect(56, 56, W - 112, H - 112);

  const sx = 90;
  const sy = 90;
  x.textAlign = "left";
  x.textBaseline = "alphabetic";
  x.fillStyle = C.ink;
  x.font = `600 40px ${SERIF}`;
  x.fillText("瑾瑜", sx, sy + 58);
  x.fillStyle = C.ink3;
  x.font = `300 21px ${SANS}`;
  x.fillText("取名参考 · 男女各三", sx + 136, sy + 58);

  x.textAlign = "center";
  x.fillStyle = C.ink2;
  x.font = `400 31px ${SERIF}`;
  x.fillText(`${show.surname}姓 · 性别未知 · 男女各三`, W / 2, 294);
  x.strokeStyle = C.line;
  x.beginPath();
  x.moveTo(M, 332);
  x.lineTo(W - M, 332);
  x.stroke();

  columns.forEach((group, col) => {
    const gx = M + col * (colW + gap);
    x.textAlign = "left";
    x.fillStyle = C.accent;
    x.font = `500 34px ${SERIF}`;
    x.fillText(col === 0 ? "男向推荐" : "女向推荐", gx, 398);
    x.textAlign = "right";
    x.fillStyle = C.ink3;
    x.font = `300 20px ${SANS}`;
    x.fillText("03 NAMES", gx + colW, 396);

    let y = startY;
    group.forEach((item, index) => {
      x.strokeStyle = C.line;
      x.beginPath();
      x.moveTo(gx, y);
      x.lineTo(gx + colW, y);
      x.stroke();
      x.textAlign = "left";
      x.fillStyle = C.ink3;
      x.font = `300 18px ${SANS}`;
      x.fillText(String(index + 1).padStart(2, "0"), gx, y + 34);
      x.fillStyle = C.ink;
      x.font = `500 58px ${SERIF}`;
      x.fillText(item.a.n, gx, y + 104);
      x.fillStyle = C.ink3;
      x.font = `300 20px ${SANS}`;
      x.fillText(item.a.py, gx, y + 142);
      x.fillStyle = C.ink2;
      x.font = `400 23px ${SERIF}`;
      item.lines.forEach((line, lineIndex) => x.fillText(line, gx, y + 184 + lineIndex * 34));
      y += rowHeights[index]!;
    });
  });

  x.textAlign = "center";
  x.fillStyle = C.ink3;
  x.font = `300 20px ${SANS}`;
  x.fillText("瑾瑜 · 中文取名 · 取名参考 · 男女各三", W / 2, H - 72);
  return cv;
}

export function LiveClient() {
  // 默认开竹兰；S 键仍按 paper → celadon → silver → bamboo 循环
  const [skin, setSkin] = useState<Skin>("bamboo");
  const [phase, setPhase] = useState<Phase>("input");
  const [gender, setGender] = useState<Gender>("unknown");
  const [draft, setDraft] = useState("");
  /** 精简版唯一的可选项：生日。填了才排盘，不填不提八字 */
  const [birthday, setBirthday] = useState("");
  const [stage, setStage] = useState<string>("");
  /** 加载页的真实阶段：候选几个、拦了谁、核到几条。内容全部来自服务端事件 */
  const [frames, setFrames] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [show, setShow] = useState<ShowData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardNo, setCardNo] = useState(1);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = useRef(false);
  const bgImage = useRef<HTMLImageElement | null>(null);
  /** 这一场已经给过的名字（最多 20 个，约最近 5 轮），随请求带给精简版去重 */
  const recentRef = useRef<string[]>([]);

  /* 竹兰背景图预加载：导出卡片时要同步画进 canvas */
  useEffect(() => {
    const img = new Image();
    const done = () => {
      bgImage.current = img;
    };
    img.addEventListener("load", done, { once: true });
    img.src = "/skins/bamboo-paper.webp";
    if (img.complete) done();
    return () => img.removeEventListener("load", done);
  }, []);

  /* ---------- 缩放适配 ---------- */
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920, 1);
      rootRef.current?.style.setProperty("--s", String(s));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /**
   * hydrate 之前打进输入框的字符只存在于 DOM，React 收不到 onChange（指针/点击事件要等 hydrate 才绑上）。
   * 这类字符会让「开始取名」一直 disabled，之后继续打字还会和它拼在一起（「苏」+「李」=「李苏」）。
   * 挂载后把 DOM 里的现值同步回状态，双方就一致了。
   */
  useEffect(() => {
    const el = inputRef.current;
    if (el && el.value) setDraft((prev) => (prev ? prev : el.value));
  }, []);

  /** 从名字分析带过来的约束：姓氏已定、要避开的字、定向要求 */
  const generate = useCallback(
    async (override?: { surname?: string; gender?: Gender; taboo?: string; requirements?: string }) => {
    if (busy.current) return;
    const surname = (override?.surname ?? draft).trim();
    if (!surname) {
      inputRef.current?.focus();
      return;
    }
    busy.current = true;
    setPhase("generating");
    setStage("");
    setFrames(["正在征名"]);
    setProgress(12);
    setError(null);

    const pushFrame = (text: string, p: number) => {
      setFrames((f) => (f[f.length - 1] === text ? f : [...f.slice(-3), text]));
      setProgress((q) => Math.max(q, p));
    };

    try {
      const picked = override?.gender ?? gender;
      if (picked === "unknown") {
        throw new Error("先选性别：按 1 男 / 2 女，再点开始取名");
      }
      const body: FastFormInput = {
        surname,
        gender: picked,
        ...(birthday ? { birthday } : {}),
        ...(recentRef.current.length ? { recent: recentRef.current } : {}),
      };
      const res = await fetch("/api/fast?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let payload: FastSuccess | FastFailure | null = null;
      /** 服务端推过来的真实阶段，先收着，结果到了再按节奏放出来 */
      const staged: string[] = [];
      if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
        // 非流式返回（未登录、参数错误）照旧按 JSON 处理
        payload = (await res.json()) as FastSuccess | FastFailure;
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (msg.type === "stage") {
              // 每一帧都是 run.ts 真算出来的：给了几个、拦了谁、核到几条。
              // 这些步骤本身只花几毫秒，全在模型返回之后才发生，所以先收着，
              // 等结果到了再逐帧放——放的是刚发生的事实，不是编的进度。
              if (msg.stage === "draft") staged.push(`候选 ${String(msg.drafted)} 个`);
              else if (msg.stage === "gate") {
                const dropped = (msg.dropped ?? []) as { name: string; reasons: string[] }[];
                if (dropped.length === 0) staged.push(`${String(msg.kept)} 个全部通过闸门`);
                else for (const d of dropped.slice(0, 2)) staged.push(`排除 ${d.name} · ${d.reasons.join("、")}`);
              } else if (msg.stage === "cite") {
                const missing = Number(msg.missing ?? 0);
                staged.push(`原文核验 ${String(msg.withLine)} 条${missing ? `，${missing} 个留白` : ""}`);
              }
            } else if (msg.type === "result") {
              payload = msg.result as FastSuccess | FastFailure;
            }
          }
        }
      }
      if (!payload) throw new Error("生成失败");
      if (!payload.ok) throw new Error(payload.message || "生成失败");

      // 逐帧放出来，每帧 260ms；没有帧就直接揭晓
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < staged.length; i++) {
        pushFrame(staged[i]!, 35 + Math.round(((i + 1) / (staged.length + 1)) * 55));
        await sleep(260);
      }

      setShow(fastToShow(payload, cardNo, recentRef.current.length));
      // 记下这一场已经给过哪些名字：下一轮带着去重，观众不会连着看到同一个名。
      // 重复出现的名字必须挪到队尾再截断——直接 Set + slice(-N) 会让它停在最早的位置，
      // 于是最常出现的那个名字反而最先被挤出去，下一轮又合法了。
      const justGiven = [payload.primary.givenName, ...payload.alternatives.map((a) => a.givenName)].filter(
        (n) => /^[\u4e00-\u9fff]{2}$/.test(n),
      );
      const keepOld = recentRef.current.filter((n) => !justGiven.includes(n));
      recentRef.current = [...keepOld, ...justGiven].slice(-20);
      setCardNo((n) => n + 1);
      setProgress(100);
      setReady(false);
      setPhase("reveal");
      requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setPhase("input");
      setShow(null);
    } finally {
      busy.current = false;
    }
    },
    [draft, gender, birthday],
  );

  /**
   * 完整版链路：走 /api/generate + 报告快照。
   *
   * 只有「名字分析 → 一键改名」用这条：那份约束里有避讳字和定向要求，
   * 精简版的三个字段装不下。直播手输姓氏仍然走上面的精简版。
   */
  const generateFull = useCallback(
    async (input: { surname: string; gender: Gender; taboo?: string; requirements?: string }) => {
      if (busy.current) return;
      busy.current = true;
      setPhase("generating");
      setStage("");
      setProgress(0);
      setError(null);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "live",
            surname: input.surname,
            gender: input.gender,
            nameLength: "two",
            tabooChars: input.taboo || undefined,
            requirements: input.requirements || undefined,
            avoidPopular: true,
          }),
        });
        if (!res.ok || !res.body) {
          const msg = (await res.json().catch(() => ({ message: "生成失败" }))) as { message?: string };
          throw new Error(msg.message || "生成失败");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let reportId: string | null = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let evt = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (evt === "thinking") {
              setProgress((p) => Math.min(60, p + 0.4));
            } else if (evt === "stage") {
              const next = String(payload.stage ?? "");
              setStage(next);
              setProgress((p) => Math.max(p, next === "assemble" ? 85 : 55));
            } else if (evt === "done") {
              reportId = String(payload.reportId ?? "");
            } else if (evt === "error") {
              throw new Error(String(payload.message ?? "生成失败"));
            }
          }
        }
        if (!reportId) throw new Error("没有拿到报告");
        const r = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
        const json = (await r.json()) as { ok: boolean; report?: ReportDocument; message?: string };
        if (!json.ok || !json.report) throw new Error(json.message ?? "读取报告失败");

        setShow(toShow(json.report, cardNo, recentRef.current.length));
        setCardNo((n) => n + 1);
        setProgress(100);
        setReady(false);
        setPhase("reveal");
        requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "生成失败");
        setPhase("input");
        setShow(null);
      } finally {
        busy.current = false;
      }
    },
    [],
  );
  /** 分析完直接把结论当约束送进取名：姓氏带过去，问题转成避讳和定向要求 */
  const regenFromAnalysis = useCallback(
    (brief: { surname: string; gender: Gender; tabooChars: string[]; requirements: string; avoidPopular: boolean }) => {
      setAnalyzeOpen(false);
      setDraft(brief.surname);
      setGender(brief.gender);
      void generateFull({
        surname: brief.surname,
        gender: brief.gender,
        taboo: brief.tabooChars.join(""),
        requirements: brief.requirements,
      });
    },
    [generateFull],
  );

  const resetToInput = useCallback(() => {
    setShow(null);
    setReady(false);
    setStage("");
    setProgress(0);
    setDraft("");
    // 直播是连续换观众：性别与生日一起清零，
    // 否则上一位的条件会静默带到下一位身上，画面里只显示成一行小字
    setGender("unknown");
    setBirthday("");
    setPhase("input");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const cycleSkin = useCallback(() => {
    setSkin((s) => SKINS[(SKINS.indexOf(s) + 1) % SKINS.length]);
  }, []);

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (analyzeOpen) {
          setAnalyzeOpen(false);
          return;
        }
        return;
      }
      // 分析面板开着的时候不吃其它快捷键，免得在输入框外按空格就把取名触发了
      if (analyzeOpen) return;
      if (e.key === "a" || e.key === "A") {
        setAnalyzeOpen(true);
        return;
      }
      if (e.key === "s" || e.key === "S") {
        cycleSkin();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // 揭晓态：空格/回车回输入；输入态：空格开始取名
      if (phase === "reveal" && (e.code === "Space" || e.key === "Enter")) {
        e.preventDefault();
        resetToInput();
        return;
      }
      if (phase === "input" && e.code === "Space") {
        e.preventDefault();
        void generate();
        return;
      }
      if (e.key === "1") setGender("male");
      if (e.key === "2") setGender("female");
      if (e.key === "3") setGender("unknown");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, resetToInput, generate, cycleSkin, analyzeOpen]);

  /* ---------- 存图 ---------- */
  const exportCard = useCallback(() => {
    if (!show) return;
    if (show.groups) {
      const cv = buildGroupedCard(show, skin, bgImage.current);
      downloadCanvas(cv, `瑾瑜-${show.surname}-男女各三.png`);
      return;
    }
    const C = SKINC[skin];
    const W = 1080;
    const M = 120;
    const colW = (W - M * 2 - 70) / 2;
    // 备选最多三个，按三列排；两列会在第三个名字处溢出画布
    const altGap = 56;
    const altColW = (W - M * 2 - altGap * 2) / 3;
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return;

    /* ---- 先量高度，再按光标往下排：屏幕和存图是同一份 spec，字段一项不少 ---- */
    probe.font = `400 30px ${SERIF}`;
    const whyLines = wrapText(probe, show.one, W - 360).slice(0, 2);

    probe.font = `400 40px ${SERIF}`;
    const quoteLines = show.cite ? wrapText(probe, show.cite.quote, W - 300).slice(0, 2) : [];

    probe.font = `400 26px ${SERIF}`;
    const mainRows = show.cardRows.map((r) => ({ label: r[0], lines: wrapText(probe, r[1], colW) }));
    let lh = 0;
    let rh = 0;
    mainRows.forEach((r, i) => {
      const h = 40 + r.lines.length * 44 + 26;
      if (i % 2 === 0) lh += h;
      else rh += h;
    });
    const mainH = Math.max(lh, rh);

    probe.font = `400 21px ${SERIF}`;
    const altBlocks = show.alts.map((a) => {
      const oneLines = wrapText(probe, a.one, altColW).slice(0, 3);
      const citeLines = a.cite ? wrapText(probe, `${a.cite.quote} ${a.cite.piece}`, altColW).slice(0, 2) : [];
      const rows = a.rows.map((r) => ({ label: r[0], lines: wrapText(probe, r[1], altColW) }));
      let h = 150 + oneLines.length * 32 + 30 + citeLines.length * 30;
      rows.forEach((r) => {
        h += 28 + r.lines.length * 32 + 18;
      });
      return { a, oneLines, citeLines, rows, h };
    });
    const altMax = altBlocks.reduce((m, b) => Math.max(m, b.h), 0);

    const nameY = 470;
    let cy = nameY + 76;
    cy += show.pyHint ? 76 : 40;
    const whyTop = cy + 18;
    cy = whyTop + whyLines.length * 44;
    const tagsY = cy + 6;
    cy = tagsY + 34;
    const div1 = cy; // 第一道横线
    cy = div1 + 54;
    const citeTop = cy;
    if (show.cite) cy = citeTop + quoteLines.length * 56 + 42 + 86;
    const ledgerY = cy;
    const rowsTop = cy + 34;
    cy = rowsTop + mainH + 20;
    if (show.bazi) cy += 56;
    const div2 = cy;
    const altTop = div2 + 96;
    const H = Math.max(1440, Math.ceil(altTop + altMax + 150));

    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const x = cv.getContext("2d");
    if (!x) return;

    x.textBaseline = "alphabetic";
    // 竹兰皮肤直接铺那张纸图（比例接近，轻微纵向拉伸看不出来）
    if (skin === "bamboo" && bgImage.current) {
      x.drawImage(bgImage.current, 0, 0, W, H);
    } else {
      x.fillStyle = C.bg;
      x.fillRect(0, 0, W, H);
    }
    x.strokeStyle = C.line;
    x.lineWidth = 2;
    x.strokeRect(48, 48, W - 96, H - 96);
    x.lineWidth = 1;
    x.strokeRect(56, 56, W - 112, H - 112);

    const sx = 104;
    const sy = 104;
    x.textAlign = "left";
    x.textBaseline = "alphabetic";
    x.fillStyle = C.ink;
    x.font = `600 40px ${SERIF}`;
    x.fillText("瑾瑜", sx, sy + 58);
    x.fillStyle = C.ink3;
    x.font = `300 21px ${SANS}`;
    x.fillText("取名参考", sx + 136, sy + 58);

    x.textAlign = "center";
    x.fillStyle = C.ink;
    x.font = `500 172px ${SERIF}`;
    x.fillText(show.full, W / 2, nameY);

    // 逐字音节 + 声调（声调是上标，和屏幕上一致）
    x.textAlign = "center";
    drawSyllables(x, show.syl, W / 2, nameY + 76, {
      size: 32,
      weight: 200,
      color: C.ink3,
      align: "center",
      maxW: W - 320,
    });
    x.textAlign = "center";
    if (show.pyHint) {
      x.font = `300 18px ${SANS}`;
      x.fillText(show.pyHint, W / 2, nameY + 116);
    }

    // 大字下面那句（why），屏幕上同一个位置
    x.fillStyle = C.ink2;
    x.font = `400 30px ${SERIF}`;
    whyLines.forEach((ln, i) => x.fillText(ln, W / 2, whyTop + 30 + i * 44));

    x.fillStyle = C.ink3;
    x.font = `300 24px ${SANS}`;
    x.fillText(show.tags.join("   ·   "), W / 2, tagsY + 24);

    x.strokeStyle = C.line;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(M, div1);
    x.lineTo(W - M, div1);
    x.stroke();

    // 引文证据：原文凸排 + 篇名 + 核验戳
    if (show.cite) {
      x.fillStyle = C.ink;
      x.font = `400 40px ${SERIF}`;
      quoteLines.forEach((ln, i) => x.fillText(ln, W / 2, citeTop + 40 + i * 56));
      const pieceY = citeTop + 40 + quoteLines.length * 56 + 6;
      x.fillStyle = C.ink3;
      x.font = `300 22px ${SANS}`;
      x.fillText(show.cite.piece, W / 2, pieceY);

      const sealText = `核验 · 原文逐字核过 · 两字${show.cite.kind}`;
      x.font = `300 20px ${SANS}`;
      const tw = x.measureText(sealText).width + 64;
      const bx = W / 2 - tw / 2;
      const by = pieceY + 22;
      x.strokeStyle = C.accent;
      x.lineWidth = 1.5;
      x.strokeRect(bx, by, tw, 48);
      x.fillStyle = C.accent;
      x.textAlign = "left";
      x.fillText(sealText, bx + 32, by + 32);
      x.textAlign = "center";
    }

    x.fillStyle = C.ink3;
    x.font = `300 20px ${SANS}`;
    x.fillText(
      `本场第 ${show.no} 个${show.sessionGiven ? ` · 此前已给过 ${show.sessionGiven} 个` : ""}`,
      W / 2,
      ledgerY + 24,
    );

    const cy2 = [rowsTop, rowsTop];
    mainRows.forEach((r, i) => {
      const col = i % 2;
      const cx = M + col * (colW + 70);
      const y = cy2[col];
      x.textAlign = "left";
      x.fillStyle = C.accent;
      x.font = `400 21px ${SERIF}`;
      x.fillText(r.label, cx, y);
      x.fillStyle = C.ink2;
      x.font = `400 26px ${SERIF}`;
      r.lines.forEach((ln, j) => x.fillText(ln, cx, y + 38 + j * 44));
      cy2[col] = y + 40 + r.lines.length * 44 + 26;
    });

    if (show.bazi) {
      x.textAlign = "center";
      x.fillStyle = C.ink3;
      x.font = `400 22px ${SERIF}`;
      x.fillText(`生辰 ${show.bazi}`, W / 2, rowsTop + mainH + 34);
    }
    x.strokeStyle = C.line;
    x.beginPath();
    x.moveTo(M, div2);
    x.lineTo(W - M, div2);
    x.stroke();

    x.textAlign = "center";
    x.fillStyle = C.ink3;
    x.font = `400 21px ${SERIF}`;
    x.fillText("备选", W / 2, div2 + 44);

    altBlocks.forEach((b, i) => {
      const cx = M + i * (altColW + altGap);
      const y = altTop;
      x.textAlign = "left";
      x.fillStyle = C.ink;
      x.font = `500 40px ${SERIF}`;
      x.fillText(b.a.n, cx, y);
      drawSyllables(x, b.a.syl, cx, y + 34, {
        size: 21,
        weight: 300,
        color: C.ink3,
        align: "left",
        maxW: altColW,
      });
      x.textAlign = "left";
      x.fillStyle = C.ink2;
      x.font = `400 22px ${SERIF}`;
      b.oneLines.forEach((ln, j) => x.fillText(ln, cx, y + 72 + j * 32));
      let ry = y + 72 + b.oneLines.length * 32 + 34;
      if (b.citeLines.length) {
        x.fillStyle = C.accent;
        x.font = `300 19px ${SERIF}`;
        b.citeLines.forEach((ln, j) => x.fillText(ln, cx, ry + j * 30));
        ry += b.citeLines.length * 30 + 10;
      }
      b.rows.forEach((r) => {
        x.fillStyle = C.accent;
        x.font = `400 19px ${SERIF}`;
        x.fillText(r.label, cx, ry);
        x.fillStyle = C.ink2;
        x.font = `400 21px ${SERIF}`;
        r.lines.forEach((ln, j) => x.fillText(ln, cx, ry + 28 + j * 32));
        ry += 28 + r.lines.length * 32 + 18;
      });
    });

    x.textAlign = "center";
    x.fillStyle = C.ink3;
    x.font = `300 20px ${SANS}`;
    x.fillText("瑾瑜 · 中文取名 · 取名参考", W / 2, H - 86);

    cv.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `瑾瑜-${show.full}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }, [show, skin]);

  const curSurname = draft.trim();

  return (
    <div className="live-root" ref={rootRef} data-skin={skin}>
      <div className="live-viewport">
        <div className={`live-stage ${ready ? "ready" : ""} ${show?.bazi ? "has-bazi" : ""}`}>
          <div className="sheen" />
          <div className="toplight" />
          <div className="fiber" />
          <div className="crackle" />
          <div className="crackle b" />
          <div className="crackle c" />
          <div className="glow" />
          <div className="wash" />
          <div className="watermark">{curSurname || "瑾"}</div>
          <div className="rules" />
          <div className="vignette" />
          <div className="frame" />
          <div className="rim" />
          <div className="rail">JINYU · NAMING STUDIO</div>

          <main className="sheet">
            {/* 品牌不再放顶部：抖音头像和榜单会压住它，挪到底部左下角的小标 */}

            {/* 输入态 */}
            <section className={`pane pane-input ${phase === "input" ? "on" : ""}`}>
              <p className="hint">想分析名字，留姓名；想取名，留姓氏和性别</p>
              <div className="field">
                <input
                  ref={inputRef}
                  className="surname-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void generate();
                      return;
                    }
                    if (e.key === "1") {
                      e.preventDefault();
                      setGender("male");
                    }
                    if (e.key === "2") {
                      e.preventDefault();
                      setGender("female");
                    }
                    if (e.key === "3") {
                      e.preventDefault();
                      setGender("unknown");
                    }
                  }}
                  placeholder="姓氏"
                  maxLength={3}
                  autoComplete="off"
                  aria-label="姓氏"
                />
              </div>
              <div className="genders">
                {(["male", "female", "unknown"] as Gender[]).map((g, i) => (
                  <button
                    key={g}
                    type="button"
                    className={gender === g ? "on" : ""}
                    onClick={() => setGender(g)}
                  >
                    {G_LABEL[g]}
                    <em>{i + 1}</em>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`go ${curSurname ? "" : "is-empty"}`}
                onClick={() => void generate()}
                disabled={!curSurname}
              >
                <span className="go-main">开始取名</span>
              </button>

              <label className="extra-bar">
                <span>生日（可选）</span>
                <input
                  type="date"
                  className="extra-sum"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  aria-label="宝宝生日，可不填"
                />
              </label>

              <button type="button" className="entry-bar" onClick={() => setAnalyzeOpen(true)}>
                <span>名字分析</span>
                <span>已经有名字？看看读音、字义和使用体验 · A</span>
              </button>

              {error && <p className="gen-error">{error}</p>}
            </section>

            {/* 生成态 */}
            <section className={`pane pane-gen ${phase === "generating" ? "on" : ""}`}>
              <p className="gen-title">
                正在为 <em>{curSurname}</em> 取名
              </p>
              <p className="gen-extra">
                {birthday ? `双字名 · 避开网红名 · 生辰 ${birthday}` : "双字名 · 避开网红名"}
              </p>
              {frames.length ? (
                <ul className="gen-log">
                  {frames.map((f, i) => (
                    <li key={`${f}-${i}`} className={i === frames.length - 1 ? "on" : ""}>
                      {f}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gen-stage">{stageText(stage)}</p>
              )}
              <div className="bar">
                <i style={{ width: `${progress}%` }} />
              </div>
            </section>

            {/* 揭晓态 */}
            <section className={`pane ${phase === "reveal" ? "on" : ""}`}>
              <div className="kicker">
                <i />
                REVEAL / No.{String(cardNo).padStart(3, "0")}
              </div>
              {show &&
                (show.groups ? (
                  <section
                    className="gender-groups reveal"
                    style={{ ["--d" as string]: "250ms" }}
                    data-testid="live-unknown-groups"
                  >
                    <header className="groups-head">
                      <p>{show.surname}姓 · 性别未知</p>
                      <h2>男女各三</h2>
                    </header>
                    <div className="group-columns">
                      {(["male", "female"] as const).map((key) => (
                        <section className="gender-group" key={key} data-testid={`live-${key}-group`}>
                          <h3>{key === "male" ? "男向推荐" : "女向推荐"}<span>03</span></h3>
                          <div className="group-list">
                            {show.groups![key].map((a, index) => (
                              <article className="group-item" key={a.n}>
                                <span className="group-index">{String(index + 1).padStart(2, "0")}</span>
                                <h4 className="group-name">{a.n}</h4>
                                <p className="group-py">{a.py}</p>
                                <p className="group-one">{a.one}</p>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </section>
                ) : (
                  <>
                    <div className="hero">
                      <h1 className="name" aria-label={show.full}>
                        {show.full.split("").map((ch, i) => (
                          <span key={`${ch}-${i}`} className="ch" style={{ ["--i" as string]: i }}>
                            {ch}
                          </span>
                        ))}
                      </h1>
                      <p className="pinyin reveal" style={{ ["--d" as string]: "200ms" }}>
                        {show.syl.map((s, i) => (
                          <span className="syl" key={`${s.ch}-${i}`}>
                            {s.py}
                            {s.tone ? <i className="tone">{s.tone}</i> : null}
                          </span>
                        ))}
                      </p>
                      {show.pyHint && (
                        <p className="pinyin-hint reveal" style={{ ["--d" as string]: "300ms" }}>
                          {show.pyHint}
                        </p>
                      )}
                      <p className="meaning reveal" style={{ ["--d" as string]: "600ms" }}>
                        {show.one}
                      </p>
                      <ul className="tags reveal" style={{ ["--d" as string]: "700ms" }}>
                        {show.tags.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>

                    {show.cite && (
                      <blockquote className="evidence reveal" style={{ ["--d" as string]: "780ms" }}>
                        <p className="ev-quote">{show.cite.quote}</p>
                        <p className="ev-piece">{show.cite.piece}</p>
                        <p className="ev-seal">
                          <span>核验</span>
                          原文逐字核过 · 两字{show.cite.kind}
                        </p>
                      </blockquote>
                    )}

                    <p className="ledger reveal" style={{ ["--d" as string]: "820ms" }}>
                      本场第 {show.no} 个
                      {show.sessionGiven ? ` · 此前已给过 ${show.sessionGiven} 个` : ""}
                    </p>

                    <section className="details reveal" style={{ ["--d" as string]: "850ms" }}>
                      {show.cardRows.map(([label, text]) => (
                        <div
                          className={`detail${label === "八字" ? " wide" : ""}`}
                          key={label}
                        >
                          <span className="label">{label}</span>
                          <p>{text}</p>
                        </div>
                      ))}
                    </section>

                    {show.bazi && (
                      <p className="bazi reveal" style={{ ["--d" as string]: "900ms" }}>
                        <span className="bazi-label">生辰</span>
                        {show.bazi}
                      </p>
                    )}

                    <section className="alt reveal" style={{ ["--d" as string]: "1000ms" }}>
                      <span className="alt-label">备选</span>
                      <div className="alt-list">
                        {show.alts.map((a) => (
                          <div className="alt-item" key={a.n}>
                            <span className="alt-name">{a.n}</span>
                            <span className="alt-py">
                              {a.syl.map((s, i) => (
                                <span className="syl" key={`${s.ch}-${i}`}>
                                  {s.py}
                                  {s.tone ? <i className="tone">{s.tone}</i> : null}
                                </span>
                              ))}
                            </span>
                            <span className="alt-one">{a.one}</span>
                            {a.cite && (
                              <span className="alt-cite">
                                {a.cite.quote} {a.cite.piece}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  </>
                ))}
            </section>

            <footer className="bottom">
              <div className="marquee" aria-hidden="true">
                <div className="marquee-track">
                  {[0, 1, 2].map((i) => (
                    <span key={i}>
                      评论区留姓名可分析，留姓氏可取名，主播挑选讲解<em>◆</em>
                    </span>
                  ))}
                </div>
              </div>
              <div className="cta-row">
                {phase === "reveal" && (
                  <>
                    <button type="button" className="next" onClick={resetToInput}>
                      下一个
                    </button>
                    <button type="button" className="save" onClick={exportCard}>
                      存图
                    </button>
                  </>
                )}
              </div>
            </footer>
          </main>

          <span className="brand-mini" aria-hidden="true">瑾瑜</span>

          <button type="button" className="skin-btn" onClick={cycleSkin}>
            换肤 · {SKIN_LABEL[skin]} · S
          </button>

          <AnalyzePanel open={analyzeOpen} onClose={() => setAnalyzeOpen(false)} onRegenerate={regenFromAnalysis} />
        </div>
      </div>
    </div>
  );
}
