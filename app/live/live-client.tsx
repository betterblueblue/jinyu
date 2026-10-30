"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NameDetail, ReportDocument } from "@/domain/types";
import { fullNamePinyin } from "@/domain/pinyin-name";
import { AnalyzePanel } from "./analyze-panel";
import "./live.css";

type Skin = "paper" | "celadon" | "silver" | "bamboo";
type Gender = "male" | "female" | "unknown";
type Phase = "input" | "generating" | "reveal";

interface Extra {
  len: "two" | "one";
  genChar: string;
  genPos: "first" | "second" | "any";
  taboo: string;
  bazi: boolean;
  birthDate: string;
  birthHour: string;
}

interface ShowAlt {
  n: string;
  py: string;
  one: string;
  rows: [string, string][];
}

interface ShowData {
  surname: string;
  full: string;
  /** 全名拼音（含姓氏） */
  py: string;
  /** 多音姓氏或未收录字的核对提示 */
  pyHint?: string;
  one: string;
  tags: string[];
  /** 直播页详解：寓意 / 出处（+ 八字） */
  rows: [string, string][];
  /** 存图详解：首推给足六项，家人拿回去慢慢看 */
  cardRows: [string, string][];
  alts: ShowAlt[];
  /** 开了生辰时带上四柱，直播页和存图都要显示 */
  bazi?: string;
  groups?: {
    male: ShowAlt[];
    female: ShowAlt[];
  };
}

const EMPTY_EXTRA: Extra = {
  len: "two",
  genChar: "",
  genPos: "first",
  taboo: "",
  bazi: false,
  birthDate: "",
  birthHour: "",
};

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

function extraText(e: Extra): string {
  const p: string[] = [];
  if (e.genChar) p.push(`辈分「${e.genChar}」`);
  if (e.taboo) p.push(`避讳「${e.taboo}」`);
  if (e.len === "one") p.push("单字名");
  if (e.bazi) p.push("看生辰");
  return p.join(" · ");
}

/** 等待时只给观众看真实阶段，不展示模型推理 */
function stageText(stage: string): string {
  if (stage === "filter") return "正在筛选";
  if (stage === "assemble") return "正在整理结果";
  return "正在准备名字";
}

function toShow(report: ReportDocument): ShowData {
  const primary =
    report.names.find((n) => n.fullName === report.overview.primaryName) ?? report.names[0];
  const alts = report.names.filter((n) => n.fullName !== primary.fullName).slice(0, 2);
  const surname = report.request.surname;
  const givenOf = (full: string) => (full.startsWith(surname) ? full.slice(surname.length) : full);

  // 直播页：只留观众几秒能看懂的。大字那句已经是寓意，这里换成「为什么推荐」避免重复；
  // 出处留给主播口头讲或存图，直播画面纵向空间不够
  const rowsFor = (n: NameDetail): [string, string][] => {
    const all: [string, string][] = [
      ["为什么推荐", n.composition || n.meaning],
      // 开了生辰才给这一项，模型/兜底都会写 baziFit
      ...(n.baziFit ? ([["八字", n.baziFit]] as [string, string][]) : []),
    ];
    return all.filter((r) => Boolean(r[1]));
  };
  // 存图：首推详解，家人拿回去慢慢看
  const cardRowsFor = (n: NameDetail): [string, string][] => {
    const all: [string, string][] = [
      ["寓意", n.meaning],
      ["读音", n.phonology],
      ["书写", n.glyph],
      ["出处", n.origin],
      ["留意", n.pitfalls],
      ...(n.baziFit ? ([["生辰", n.baziFit]] as [string, string][]) : []),
    ];
    return all.filter((r) => Boolean(r[1]));
  };
  const toAlt = (n: NameDetail): ShowAlt => ({
    n: n.fullName,
    py: fullNamePinyin(surname, givenOf(n.fullName)).text,
    one: n.meaning,
    // 备选简解：一句话已经写了寓意，这里只补一句特点（没有特点就退到注意事项）
    // 备选只留一句：有核验出处就给出处，没有就退到避坑提醒
    rows: [["特点", n.origin || n.pitfalls]].filter((r) => Boolean(r[1])) as [string, string][],
  });
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
    surname,
    full: primary.fullName,
    py: primaryPy.text,
    ...(primaryPy.hint ? { pyHint: primaryPy.hint } : {}),
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
    rows: rowsFor(primary),
    cardRows: cardRowsFor(primary),
    alts: alts.map(toAlt),
    // 直播观众看不懂干支：只说属相和出生季节
    ...(report.bazi?.readable
      ? { bazi: `属${report.bazi.readable.zodiac} · ${report.bazi.readable.season}出生` }
      : {}),
    groups,
  };
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
  const [extra, setExtra] = useState<Extra>(EMPTY_EXTRA);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stage, setStage] = useState<string>("");
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
    setProgress(0);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "live",
          surname,
          gender: override?.gender ?? gender,
          nameLength: extra.len,
          generationChar: extra.genChar || undefined,
          generationPosition: extra.genPos,
          tabooChars: override?.taboo || extra.taboo || undefined,
          requirements: override?.requirements || undefined,
          baziEnabled: extra.bazi && Boolean(extra.birthDate),
          birthDate: extra.birthDate || undefined,
          birthHour: extra.birthHour || undefined,
        }),
      });
        if (!res.ok || !res.body) {
          const msg = await res.json().catch(() => ({ message: "生成失败" }));
          throw new Error(msg.message || "生成失败");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let reportId: string | null = null;
        let acc = "";

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
              // 原始推理里有英文、有还没定的名字，不给观众看；只留进度
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

        setShow(toShow(json.report));
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
    [draft, gender, extra],
  );

  /** 分析完直接把结论当约束送进取名：姓氏带过去，问题转成避讳和定向要求 */
  const regenFromAnalysis = useCallback(
    (brief: { surname: string; gender: Gender; tabooChars: string[]; requirements: string; avoidPopular: boolean }) => {
      setAnalyzeOpen(false);
      setDraft(brief.surname);
      setGender(brief.gender);
      void generate({
        surname: brief.surname,
        gender: brief.gender,
        taboo: brief.tabooChars.join(""),
        requirements: brief.requirements,
      });
    },
    [generate],
  );

  const resetToInput = useCallback(() => {
    setShow(null);
    setReady(false);
    setStage("");
    setProgress(0);
    setDraft("");
    // 直播是连续换观众：性别与补充条件（字数/辈分/避讳/生辰）一起清零，
    // 否则上一位的条件会静默带到下一位身上，画面里只显示成一行小字
    setGender("unknown");
    setExtra({ ...EMPTY_EXTRA });
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
        setDrawerOpen(false);
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
    const altColW = (W - M * 2 - 80) / 2;
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return;

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
      const oneLines = wrapText(probe, a.one, altColW).slice(0, 2);
      const rows = a.rows.map((r) => ({ label: r[0], lines: wrapText(probe, r[1], altColW) }));
      let h = 150 + oneLines.length * 32 + 30;
      rows.forEach((r) => {
        h += 28 + r.lines.length * 32 + 18;
      });
      return { a, oneLines, rows, h };
    });
    const altMax = altBlocks.reduce((m, b) => Math.max(m, b.h), 0);

    const nameY = 470;
    const baziExtra = show.bazi ? 56 : 0;
    // 存图不画大字那句（和「寓意」重复），所以标签和详解整体上移
    const tagsY = show.pyHint ? 648 : 612;
    const dividerY = tagsY + 46;
    const rowsTop = dividerY + 56;
    const H = Math.max(1440, Math.ceil(rowsTop + mainH + 60 + baziExtra + 54 + altMax + 140));
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
    x.fillStyle = C.ink3;
    // 全名拼音（含姓氏）比原来长，超宽就缩
    let pySize = 32;
    x.font = `200 ${pySize}px ${SANS}`;
    while (pySize > 20 && x.measureText(show.py).width > W - 320) {
      pySize -= 2;
      x.font = `200 ${pySize}px ${SANS}`;
    }
    x.fillText(show.py, W / 2, 546);
    if (show.pyHint) {
      x.fillStyle = C.ink3;
      x.font = `300 18px ${SANS}`;
      x.fillText(show.pyHint, W / 2, 586);
    }
    // 存图里「寓意」已经作为独立一段，这里不再重复大字那句
    x.fillStyle = C.ink2;
    x.font = `300 24px ${SANS}`;
    x.fillText(show.tags.join("   ·   "), W / 2, tagsY);

    x.strokeStyle = C.line;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(M, dividerY);
    x.lineTo(W - M, dividerY);
    x.stroke();

    const cy = [rowsTop, rowsTop];
    mainRows.forEach((r, i) => {
      const col = i % 2;
      const cx = M + col * (colW + 70);
      const y = cy[col];
      x.textAlign = "left";
      x.fillStyle = C.accent;
      x.font = `400 21px ${SERIF}`;
      x.fillText(r.label, cx, y);
      x.fillStyle = C.ink2;
      x.font = `400 26px ${SERIF}`;
      r.lines.forEach((ln, j) => x.fillText(ln, cx, y + 38 + j * 44));
      cy[col] = y + 40 + r.lines.length * 44 + 26;
    });

    const div2 = rowsTop + mainH + (show.bazi ? 60 : 20);
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

    const altTop = div2 + 104;
    altBlocks.forEach((b, i) => {
      const cx = M + i * (altColW + 80);
      const y = altTop;
      x.textAlign = "left";
      x.fillStyle = C.ink;
      x.font = `500 40px ${SERIF}`;
      x.fillText(b.a.n, cx, y);
      x.fillStyle = C.ink3;
      x.font = `300 21px ${SANS}`;
      x.fillText(b.a.py, cx, y + 34);
      x.fillStyle = C.ink2;
      x.font = `400 22px ${SERIF}`;
      b.oneLines.forEach((ln, j) => x.fillText(ln, cx, y + 72 + j * 32));
      let ry = y + 72 + b.oneLines.length * 32 + 40;
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

          <main className={`sheet ${drawerOpen ? "dim" : ""}`}>
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

              <button type="button" className="extra-bar" onClick={() => setDrawerOpen(true)}>
                <span>补充信息（可选）</span>
                <span className={`extra-sum ${extraText(extra) ? "" : "empty"}`}>
                  {extraText(extra) || "辈分字 · 避讳 · 字数 · 生辰"}
                </span>
              </button>

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
                {extraText(extra) || "默认档：双字名 · 避开网红名"}
              </p>
              <p className="gen-stage">{stageText(stage)}</p>
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
                        {show.py}
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

                    <section className="details reveal" style={{ ["--d" as string]: "850ms" }}>
                      {show.rows.map(([label, text]) => (
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
                            <span className="alt-py">{a.py}</span>
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

          {/* 补充面板 */}
          <div className={`drawer ${drawerOpen ? "open" : ""}`}>
            <div className="drawer-head">
              <span className="drawer-title">补充信息</span>
              <button type="button" className="drawer-close" aria-label="关闭" onClick={() => setDrawerOpen(false)}>
                ×
              </button>
            </div>
            <div className="drawer-body">
              <div className="frow">
                <span className="flabel">名字字数</span>
                <div className="seg">
                  <button
                    type="button"
                    className={extra.len === "two" ? "on" : ""}
                    onClick={() => setExtra((p) => ({ ...p, len: "two" }))}
                  >
                    双字名
                  </button>
                  <button
                    type="button"
                    className={extra.len === "one" ? "on" : ""}
                    onClick={() => setExtra((p) => ({ ...p, len: "one", genChar: "" }))}
                  >
                    单字名
                  </button>
                </div>
              </div>

              <div className="frow">
                <span className="flabel">辈分字</span>
                <div className="two">
                  <input
                    className="inp"
                    maxLength={1}
                    disabled={extra.len === "one"}
                    placeholder={extra.len === "one" ? "单字名不能再填辈分字" : "单个汉字，如 知"}
                    value={extra.genChar}
                    onChange={(e) => setExtra((p) => ({ ...p, genChar: e.target.value }))}
                  />
                  <div className="seg">
                    {(
                      [
                        ["first", "名首"],
                        ["second", "名次"],
                        ["any", "任意"],
                      ] as [Extra["genPos"], string][]
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={extra.genPos === k ? "on" : ""}
                        onClick={() => setExtra((p) => ({ ...p, genPos: k }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="frow">
                <span className="flabel">避讳字（不会出现在推荐里）</span>
                <input
                  className="inp"
                  placeholder="可填多个，如 明、华"
                  value={extra.taboo}
                  onChange={(e) => setExtra((p) => ({ ...p, taboo: e.target.value }))}
                />
              </div>

              <div className="frow">
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={extra.bazi}
                    onChange={(e) => setExtra((p) => ({ ...p, bazi: e.target.checked }))}
                  />
                  按生辰参考（需已出生）
                </label>
                {extra.bazi && (
                  <div className="two">
                    <input
                      className="inp"
                      type="date"
                      value={extra.birthDate}
                      onChange={(e) => setExtra((p) => ({ ...p, birthDate: e.target.value }))}
                    />
                    <select
                      className="inp"
                      value={extra.birthHour}
                      onChange={(e) => setExtra((p) => ({ ...p, birthHour: e.target.value }))}
                    >
                      <option value="">时辰不确定</option>
                      {[
                        "子时 23–1",
                        "丑时 1–3",
                        "寅时 3–5",
                        "卯时 5–7",
                        "辰时 7–9",
                        "巳时 9–11",
                        "午时 11–13",
                        "未时 13–15",
                        "申时 15–17",
                        "酉时 17–19",
                        "戌时 19–21",
                        "亥时 21–23",
                      ].map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="drawer-done"
              onClick={() => {
                setExtra((p) => (p.bazi && !p.birthDate ? { ...p, bazi: false } : p));
                setDrawerOpen(false);
                inputRef.current?.focus();
              }}
            >
              完成，回到取名
            </button>
          </div>

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
