import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { normalizeRequest } from "@/domain/normalizer";
import { runGeneration } from "@/domain/orchestrator";
import { createCandidateProvider } from "@/providers";
import { saveReport } from "@/store/report-store";
import type { NamingFormInput } from "@/domain/types";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as NamingFormInput;
    const normalized = normalizeRequest(body);
    if (!normalized.ok) {
      return NextResponse.json(
        { ok: false, message: normalized.message, fieldErrors: normalized.fieldErrors },
        { status: 400 },
      );
    }

    const provider = createCandidateProvider();
    const result = await runGeneration(normalized.value, provider);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: result.message,
          errorCode: result.errorCode,
          stage: result.stage,
          relaxations: result.relaxations,
        },
        { status: 422 },
      );
    }

    await saveReport(result.report);
    return NextResponse.json({ ok: true, reportId: result.report.id, report: result.report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器错误";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
