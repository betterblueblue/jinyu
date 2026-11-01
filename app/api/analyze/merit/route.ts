import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { writeMerit } from "@/domain/score/merit";
import { resolveSplit, scoreName } from "@/domain/score/score";
import { talkClient } from "@/fast/talk";

/**
 * 提词页上「这个名字好在哪」（src/domain/score/merit.ts）：打完分直播台就来请，只推给提词页，观众屏幕上没有。
 * 分数在服务端重新算，不信前端传来的；写不出来就返回失败，提词页只是少这一段。
 */
export const dynamic = "force-dynamic";

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
  const client = talkClient();
  if (!client) return NextResponse.json({ ok: false, message: "没有配模型钥匙" }, { status: 503 });
  try {
    const merit = await writeMerit(scoreName(split, checked.input.gender), client, req.signal);
    if (!merit) return NextResponse.json({ ok: false, message: "这次没写出来" }, { status: 502 });
    return NextResponse.json({ ok: true, merit });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "没写出来" }, { status: 502 });
  }
}
