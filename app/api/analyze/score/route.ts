import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { nextStep } from "@/domain/score/next-step";
import { resolveSplit, scoreName } from "@/domain/score/score";

/**
 * 打分榜：按规则打分，不调模型，几毫秒返回。
 *
 * 输入和名字分析同一套校验（2–4 个汉字、性别可不填、可指定拆法）。结果不落盘。
 * next 是主播下一步推什么（改字 / 先问 / 重新起名），见 domain/score/next-step.ts。
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体解析失败" }, { status: 400 });
  }

  const checked = validateAnalysisInput(body);
  if (!checked.ok) {
    return NextResponse.json({ ok: false, message: checked.message }, { status: 400 });
  }
  const split = resolveSplit(checked.input.fullName, checked.input.surnameOverride);
  if (!split) {
    return NextResponse.json({ ok: false, message: "姓名无法拆分" }, { status: 400 });
  }

  const result = scoreName(split, checked.input.gender);
  return NextResponse.json({ ok: true, result, next: nextStep(result, split) });
}
