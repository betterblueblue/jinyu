import type { NameSyllable } from "@/domain/pinyin-name";
import type { ShowData, Skin } from "./show-data";

/* ---------- 存图：把一张卡画进 canvas，下载成 PNG ---------- */

const SKINC = {
  paper: { bg: "#F3EFE4", ink: "#191410", ink2: "#4A4238", ink3: "#6B6355", accent: "#A5382A", line: "rgba(35,28,20,.20)" },
  celadon: { bg: "#EAF2ED", ink: "#16211D", ink2: "#35504A", ink3: "#4B625A", accent: "#3A574E", line: "rgba(45,72,64,.22)" },
  silver: { bg: "#F0F0ED", ink: "#0E1013", ink2: "#34373C", ink3: "#5E6266", accent: "#9E2B25", line: "rgba(20,22,26,.18)" },
  bamboo: { bg: "#E0E7D6", ink: "#1C261A", ink2: "#3A4534", ink3: "#4E5945", accent: "#9C3A2B", line: "rgba(35,45,32,.20)" },
} as const;

const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,serif';
const SANS = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

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

/** 等字体最多等这么久：网络断了也不能让存图卡死，到点就用已经有的字体画 */
const FONT_WAIT_MS = 3000;

/**
 * 画之前先把要用到的字加载好（总体方案 A8）。
 *
 * Noto Serif SC 从 Google Fonts 按字切片加载，页面上没显示过的字、没用过的字重（大字 500、品牌 600）
 * 第一次存图时还没下下来，canvas 就拿替代字体画了那几个字，看着更粗；第二张起才正常。
 * 所以按这张卡上真要画的字，把用到的几个字重各 load 一遍，等齐了再量宽度、再画。
 * 黑体那几行用系统字体（Noto Sans SC 没有在线加载），不用等。
 */
async function ensureFonts(show: ShowData): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  const text = [
    "瑾瑜取名参考备选生辰",
    show.full,
    show.one,
    show.cite?.quote ?? "",
    show.cite?.piece ?? "",
    show.bazi ?? "",
    ...show.alts.flatMap((a) => [a.n, a.one, a.cite ? `${a.cite.quote} ${a.cite.piece}` : ""]),
  ].join("");
  const loads = [300, 400, 500, 600].map((w) => document.fonts.load(`${w} 40px "Noto Serif SC"`, text).catch(() => []));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, FONT_WAIT_MS))]);
}

/**
 * 按屏幕上同一份数据（ShowData）画卡并下载。竹兰皮肤要铺纸图，图由直播台预加载好传进来，
 * 还没加载完就用纯色底。
 */
export async function downloadCard(show: ShowData, skin: Skin, bg: HTMLImageElement | null): Promise<void> {
  await ensureFonts(show);
  const C = SKINC[skin];
  const W = 1080;
  const M = 120;
  // 备选最多三个，按三列排；两列会在第三个名字处溢出画布
  const altGap = 56;
  const altColW = (W - M * 2 - altGap * 2) / 3;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return;

  /* ---- 先量高度，再按光标往下排：屏幕和存图是同一份 spec，字段一项不少 ---- */
  probe.font = `400 30px ${SERIF}`;
  const whyLines = wrapText(probe, show.one, W - 360).slice(0, 2);

  // 引文证据，和屏幕上一样：原文 + 出处 + 核验戳；没有出处这一块就空着
  const evQuote = show.cite?.quote ?? "";
  const evPiece = show.cite?.piece ?? "";
  probe.font = `400 40px ${SERIF}`;
  const quoteLines = evQuote ? wrapText(probe, evQuote, W - 300).slice(0, 2) : [];

  probe.font = `400 21px ${SERIF}`;
  const altBlocks = show.alts.map((a) => {
    const oneLines = wrapText(probe, a.one, altColW).slice(0, 3);
    const citeLines = a.cite ? wrapText(probe, `${a.cite.quote} ${a.cite.piece}`, altColW).slice(0, 2) : [];
    const h = 150 + oneLines.length * 32 + 30 + citeLines.length * 30;
    return { a, oneLines, citeLines, h };
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
  // 体检一行压在「本场第几个」上面，屏幕上也是这个顺序
  const checkY = cy;
  if (show.check) cy += 40;
  const ledgerY = cy;
  const rowsTop = cy + 34;
  cy = rowsTop + 20;
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
  if (skin === "bamboo" && bg) {
    x.drawImage(bg, 0, 0, W, H);
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
  if (quoteLines.length) {
    x.fillStyle = C.ink;
    x.font = `400 40px ${SERIF}`;
    quoteLines.forEach((ln, i) => x.fillText(ln, W / 2, citeTop + 40 + i * 56));
    const pieceY = citeTop + 40 + quoteLines.length * 56 + 6;
    x.fillStyle = C.ink3;
    x.font = `300 22px ${SANS}`;
    x.fillText(evPiece, W / 2, pieceY);

    if (show.cite) {
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
  }

  if (show.check) {
    x.fillStyle = C.ink2;
    x.font = `400 22px ${SANS}`;
    x.fillText(show.check, W / 2, checkY + 24);
  }

  x.fillStyle = C.ink3;
  x.font = `300 20px ${SANS}`;
  x.fillText(
    `本场第 ${show.no} 个${show.sessionGiven ? ` · 此前已给过 ${show.sessionGiven} 个` : ""}`,
    W / 2,
    ledgerY + 24,
  );

  if (show.bazi) {
    x.textAlign = "center";
    x.fillStyle = C.ink3;
    x.font = `400 22px ${SERIF}`;
    x.fillText(`生辰 ${show.bazi}`, W / 2, rowsTop + 34);
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
    const ry = y + 72 + b.oneLines.length * 32 + 34;
    if (b.citeLines.length) {
      x.fillStyle = C.accent;
      x.font = `300 19px ${SERIF}`;
      b.citeLines.forEach((ln, j) => x.fillText(ln, cx, ry + j * 30));
    }
  });

  x.textAlign = "center";
  x.fillStyle = C.ink3;
  x.font = `300 20px ${SANS}`;
  x.fillText("名字由瑾瑜起草", W / 2, H - 86);

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
}
