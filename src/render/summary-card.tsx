import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReportDocument } from "@/domain/types";

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

export async function renderSummaryCardPng(report: ReportDocument): Promise<Buffer> {
  const fontData = await loadFont();
  const primary = report.overview.primaryName;
  const primaryEntry = report.names.find((n) => n.fullName === primary) ?? report.names[0];
  const alts = report.names.filter((n) => n.fullName !== primary).slice(0, 4);
  const gender =
    report.request.gender === "male"
      ? "男"
      : report.request.gender === "female"
        ? "女"
        : "未知";
  const meta = `${report.request.surname} · ${gender}`;
  const oneLiner = oneLine(report.overview.oneLiner || primaryEntry?.meaning || "", 42);

  const element = {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0e1714",
        color: "#f2ede3",
        padding: "56px 52px 48px",
        fontFamily: "Noto Serif SC",
        position: "relative",
      },
      children: [
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
              border: "1px solid rgba(201,162,39,0.35)",
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
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 22,
                    color: "#c9a227",
                    letterSpacing: 10,
                    fontWeight: 700,
                  },
                  children: "瑾瑜",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 14,
                    color: "#c9a227",
                    letterSpacing: 6,
                    fontWeight: 500,
                  },
                  children: "精选摘要",
                },
              },
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
                "linear-gradient(90deg, transparent 0%, rgba(201,162,39,0.5) 20%, rgba(201,162,39,0.5) 80%, transparent 100%)",
            },
            children: "",
          },
        },
        {
          type: "div",
          props: {
            style: {
              marginTop: 16,
              fontSize: 13,
              color: "#a8a29a",
              letterSpacing: 3,
            },
            children: meta,
          },
        },
        // primary hero
        {
          type: "div",
          props: {
            style: {
              marginTop: 28,
              display: "flex",
              flexDirection: "column",
              borderLeft: "3px solid #c9a227",
              paddingLeft: 18,
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 13,
                    color: "#c9a227",
                    letterSpacing: 6,
                    fontWeight: 500,
                  },
                  children: "首推",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    marginTop: 8,
                    fontSize: 44,
                    color: "#c9a227",
                    letterSpacing: 14,
                    fontWeight: 700,
                    lineHeight: 1.15,
                  },
                  children: primary,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    marginTop: 12,
                    fontSize: 16,
                    color: "#c6bfb2",
                    lineHeight: 1.55,
                    letterSpacing: 1,
                  },
                  children: oneLiner,
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              marginTop: 36,
              fontSize: 12,
              color: "#a8a29a",
              letterSpacing: 5,
            },
            children: "备选",
          },
        },
        {
          type: "div",
          props: {
            style: {
              marginTop: 14,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              flex: 1,
            },
            children: alts.map((n) => ({
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "2px solid rgba(201,162,39,0.45)",
                  paddingLeft: 14,
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        fontSize: 22,
                        color: "#f2ede3",
                        letterSpacing: 6,
                        fontWeight: 500,
                      },
                      children: n.fullName,
                    },
                  },
                  {
                    type: "div",
                    props: {
                      style: {
                        marginTop: 4,
                        fontSize: 14,
                        color: "#a8a29a",
                        lineHeight: 1.45,
                      },
                      children: oneLine(n.meaning, 28),
                    },
                  },
                ],
              },
            })),
          },
        },
        {
          type: "div",
          props: {
            style: {
              marginTop: "auto",
              paddingTop: 20,
              borderTop: "1px solid rgba(201,162,39,0.4)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { fontSize: 13, color: "#a8a29a", lineHeight: 1.5 },
                  children: "完整音韵、出处与避坑见在线报告与历史快照",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 13,
                    color: "#c9a227",
                    letterSpacing: 4,
                    fontWeight: 500,
                  },
                  children: "瑾瑜 · 一次正式命名报告",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(element as never, {
    width: 720,
    height: 960,
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
    fitTo: { mode: "width", value: 720 },
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

function oneLine(text: string, max = 36): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
