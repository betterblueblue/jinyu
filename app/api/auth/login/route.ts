import { NextResponse } from "next/server";
import { createSession, verifyCredentials } from "@/auth/session";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    if (!username || !password) {
      return NextResponse.json({ ok: false, message: "请填写用户名和密码" }, { status: 400 });
    }
    if (!verifyCredentials(username, password)) {
      return NextResponse.json({ ok: false, message: "用户名或密码不正确" }, { status: 401 });
    }
    await createSession();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, message: "登录失败" }, { status: 500 });
  }
}
