import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { getReport } from "@/store/report-store";

/** 直播页取报告 JSON 用；/api/generate 只回 reportId，不回正文 */
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
