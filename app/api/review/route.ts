import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { saveVerdict } from "@/library/review-store";

/** 名字评审：存一条「要 / 不要 / 拿不准」，可带一句备注。只写 data/name-library/v2/review/ 下的评审结果 */
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

  const { batch, id, verdict, note } = body;
  if (typeof batch !== "string" || typeof id !== "string" || typeof verdict !== "string") {
    return NextResponse.json({ ok: false, message: "缺少批次、编号或评审结果" }, { status: 400 });
  }

  const out = await saveVerdict(batch, id, verdict, typeof note === "string" ? note : undefined);
  if (!out.ok) return NextResponse.json(out, { status: 400 });
  return NextResponse.json({ ok: true, record: out.record });
}
