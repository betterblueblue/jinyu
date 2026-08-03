import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { getReport } from "@/store/report-store";
import { renderSummaryCardPng } from "@/render/summary-card";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const report = await getReport(id);
  if (!report) {
    return NextResponse.json({ ok: false, message: "报告不存在" }, { status: 404 });
  }

  try {
    const png = await renderSummaryCardPng(report);
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="jinyu-summary-${id}.png"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成摘要图失败";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
