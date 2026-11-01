import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { TALK_NAMES_MAX, talkClient, writeTalks } from "@/fast/talk";

/**
 * 直播台出结果以后，给模型起的名字补写口播稿（src/fast/talk.ts），只推给提词页。
 * 观众屏幕不等它；写不出来就返回失败，提词页照旧只有一句话和体检句。
 */
export const dynamic = "force-dynamic";

const HAN = /^[\u4e00-\u9fff]+$/;

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

  const surname = typeof body.surname === "string" ? body.surname.trim() : "";
  const gender = body.gender === "male" || body.gender === "female" ? body.gender : null;
  const birthday = typeof body.birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday) ? body.birthday : undefined;
  const raw = Array.isArray(body.names) ? body.names : [];
  const names = raw
    .map((n) => n as Record<string, unknown> | null)
    .filter((n): n is Record<string, unknown> => Boolean(n) && typeof n === "object")
    .map((n) => ({ givenName: String(n.givenName ?? "").trim(), why: String(n.why ?? "").trim().slice(0, 40) }))
    .filter((n) => /^[\u4e00-\u9fff]{2}$/.test(n.givenName));
  if (!surname || !HAN.test(surname) || [...surname].length > 2 || !gender || !names.length || names.length > TALK_NAMES_MAX) {
    return NextResponse.json({ ok: false, message: "参数不对" }, { status: 400 });
  }

  const client = talkClient();
  if (!client) return NextResponse.json({ ok: false, message: "没有配模型钥匙" }, { status: 503 });
  try {
    const talks = await writeTalks({ surname, gender, ...(birthday ? { birthday } : {}), names }, client, req.signal);
    return NextResponse.json({ ok: true, talks });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "写稿失败" }, { status: 502 });
  }
}
