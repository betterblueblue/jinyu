import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { suggestFixes } from "@/domain/score/fix";
import { resolveSplit, scoreName } from "@/domain/score/score";
import { createFixProvider } from "@/providers";

/**
 * 打分榜的「改字」：主播点了按钮才调。只换一个字、只换同音字。
 *
 * 分数在服务端重新算，不信前端传来的；模型挑的字在服务端核验后才返回。
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

  const score = scoreName(split, checked.input.gender);
  const outcome = await suggestFixes(score, split, createFixProvider());
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}
