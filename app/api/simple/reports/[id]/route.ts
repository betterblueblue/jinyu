import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { getSimpleReport as getReport } from "@/simple/report-store";

/** 简化版：取报告 JSON（照抄 /api/reports/[id]，读 data/simple/） */
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

  return NextResponse.json(
    { ok: true, report },
    { headers: { "Cache-Control": "no-store" } },
  );
}
