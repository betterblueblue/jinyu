import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { NameDetail, ReportDocument } from "@/domain/types";

/** Minimal latin fallback font via system is not available in satori; use built-in load */
async function loadFont(): Promise<ArrayBuffer> {
  const url =
    "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.0.0/files/noto-serif-sc-chinese-simplified-900-normal.woff";
  try {
    const res = await fetch(url);
    if (res.ok) return await res.arrayBuffer();
  } catch {
    // ignore
  }
  const res2 = await fetch(
    "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.0.0/files/noto-serif-sc-chinese-simplified-700-normal.woff",
  );
  if (res2.ok) return await res2.arrayBuffer();
  const res3 = await fetch(
    "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.0.0/files/noto-serif-sc-chinese-simplified-400-normal.woff",
  );
  return await res3.arrayBuffer();
}

/** 卡片逻辑宽度（px）；导出 PNG 按 PNG_SCALE 矢量放大，文字保持清晰 */
const CARD_WIDTH = 720;
/** 导出 PNG 相对逻辑宽度的缩放倍数 */
const PNG_SCALE = 2;

/** 青玉冷调浅色卡（可转发 PNG，固定浅色，不随主题切换） */
const C = {
  bg: "#F4F7F5",
  paper: "#223A32",
  dim: "#7A8781",
  gold: "#3D6B5E",
  goldSoft: "rgba(61,107,94,0.45)",
  text: "#46544F",
  seal: "#C84C3C",
  onSeal: "#FDFDF8",
};

export interface SummaryDetailRow {
  term: string;
  def: string;
}

/** 逐名详情行：空字段过滤；八字契合仅在开启八字且有值时保留 */
export function detailRows(n: NameDetail, showBazi: boolean): SummaryDetailRow[] {
  const rows: SummaryDetailRow[] = [
    { term: "音韵", def: n.phonology },
    { term: "字形", def: n.glyph },
    { term: "寓意", def: n.meaning },
    { term: "出处", def: n.origin },
    { term: "避坑", def: n.pitfalls },
    { term: "风格", def: n.styleFit },
  ].filter((r) => r.def && r.def.trim());
  if (showBazi && n.baziFit && n.baziFit.trim()) {
    rows.push({ term: "八字契合", def: n.baziFit.trim() });
  }
  return rows;
}

interface CardNode {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: unknown;
  };
}

function text(children: unknown, style: Record<string, unknown>): CardNode {
  return { type: "div", props: { style, children } };
}

function detailBlock(rows: SummaryDetailRow[]): CardNode {
  return {
    type: "div",
    props: {
      style: {
        marginTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      },
      children: rows.map((r) => ({
        type: "div",
        props: {
          style: {
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            fontSize: 14,
            lineHeight: 1.65,
            color: C.text,
          },
          children: [
            text(r.term, {
              flexShrink: 0,
              width: 64,
              fontSize: 13,
              color: C.gold,
              letterSpacing: 2,
            }),
            text(r.def, { flex: 1, letterSpacing: 0.4 }),
          ],
        },
      })),
    },
  };
}

/** 单个名字块：首推用更大的金字 + 金色左边线，备选稍小 */
function nameBlock(
  n: NameDetail,
  opts: { isPrimary: boolean; showBazi: boolean; oneLiner?: string },
): CardNode {
  const { isPrimary, showBazi, oneLiner } = opts;
  const children: unknown[] = [
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "baseline", gap: 10 },
        children: [
          text(n.fullName, {
            fontSize: isPrimary ? 44 : 24,
            color: isPrimary ? C.gold : C.paper,
            letterSpacing: isPrimary ? 14 : 6,
            fontWeight: 700,
            lineHeight: 1.2,
            textIndent: isPrimary ? "0.14em" : "0.06em",
          }),
          isPrimary
            ? text("首推", {
                fontSize: 13,
                color: C.onSeal,
                backgroundColor: C.seal,
                letterSpacing: 6,
                fontWeight: 500,
                padding: "3px 8px 3px 12px",
                borderRadius: 2,
              })
            : null,
        ],
      },
    },
  ];
  if (isPrimary && oneLiner) {
    children.push(
      text(oneLiner, {
        marginTop: 10,
        fontSize: 15,
        color: C.dim,
        lineHeight: 1.55,
        letterSpacing: 1,
      }),
    );
  }
  children.push(detailBlock(detailRows(n, showBazi)));
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        borderLeft: isPrimary ? "3px solid #3D6B5E" : `2px solid ${C.goldSoft}`,
        paddingLeft: isPrimary ? 18 : 14,
      },
      children,
    },
  };
}

export function buildSummaryCardElement(report: ReportDocument): CardNode {
  const primary = report.overview.primaryName;
  const primaryEntry = report.names.find((n) => n.fullName === primary) ?? report.names[0];
  const alts = report.names.filter((n) => n.fullName !== primary).slice(0, 4);
  const showBazi = Boolean(report.bazi);
  const oneLiner = oneLine(report.overview.oneLiner || primaryEntry?.meaning || "", 60);
  const gender =
    report.request.gender === "male"
      ? "男"
      : report.request.gender === "female"
        ? "女"
        : "未知";
  const meta = `${report.request.surname} · ${gender} · ${new Date(report.createdAt).toLocaleString("zh-CN")}`;

  const children: unknown[] = [
    // inner paper frame
    {
      type: "div",
      props: {
        style: {
          position: "absolute",
          top: 24,
          left: 24,
          right: 24,
          bottom: 24,
          border: "1px solid rgba(61,107,94,0.35)",
        },
        children: "",
      },
    },
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        },
        children: [
          text("瑾瑜", { fontSize: 22, color: C.gold, letterSpacing: 10, fontWeight: 700 }),
          text("精选摘要", { fontSize: 14, color: C.gold, letterSpacing: 6, fontWeight: 500 }),
        ],
      },
    },
    {
      type: "div",
      props: {
        style: {
          marginTop: 18,
          height: 1,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(61,107,94,0.5) 20%, rgba(61,107,94,0.5) 80%, transparent 100%)",
        },
        children: "",
      },
    },
    text(meta, { marginTop: 16, fontSize: 13, color: C.dim, letterSpacing: 3 }),
  ];

  if (report.request.gender === "unknown") {
    const male = (report.overview.maleNames ?? []).join("、") || "—";
    const female = (report.overview.femaleNames ?? []).join("、") || "—";
    children.push(
      text(`男向：${male}　女向：${female}`, {
        marginTop: 12,
        fontSize: 13,
        color: C.dim,
        letterSpacing: 1,
        lineHeight: 1.6,
      }),
    );
  }

  children.push(
    {
      type: "div",
      props: {
        style: { marginTop: 24, display: "flex", flexDirection: "column", gap: 26 },
        children: [
          nameBlock(primaryEntry, { isPrimary: true, showBazi, oneLiner }),
          ...alts.map((n) => nameBlock(n, { isPrimary: false, showBazi })),
        ],
      },
    },
    {
      type: "div",
      props: {
        style: {
          marginTop: 32,
          paddingTop: 18,
          borderTop: "1px solid rgba(61,107,94,0.4)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        },
        children: [
          text("以上为精选摘要，完整命理与候选对比见在线报告与历史快照", {
            fontSize: 13,
            color: C.dim,
            lineHeight: 1.5,
          }),
          text("瑾瑜 · 一次正式命名报告", {
            fontSize: 13,
            color: C.gold,
            letterSpacing: 4,
            fontWeight: 500,
          }),
        ],
      },
    },
  );

  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: C.bg,
        color: C.paper,
        padding: "56px 52px 48px",
        fontFamily: "Noto Serif SC",
        position: "relative",
      },
      children,
    },
  };
}

export async function renderSummaryCardPng(report: ReportDocument): Promise<Buffer> {
  const fontData = await loadFont();
  const element = buildSummaryCardElement(report);

  // 只传 width，高度由内容自动撑开
  const svg = await satori(element as never, {
    width: CARD_WIDTH,
    fonts: [
      {
        name: "Noto Serif SC",
        data: fontData,
        weight: 900,
        style: "normal",
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH * PNG_SCALE },
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

function oneLine(text: string, max = 36): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
