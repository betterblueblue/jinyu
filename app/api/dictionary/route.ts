import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { resolveSplit } from "@/domain/score/score";
import { getQmzChar } from "@/dictionary/qmz";

/**
 * 名字的字典初检：只读本地 data/qmz-dict/chars.json，几毫秒就回。
 * 分析面板在请求模型之前先调它，提词页可以先让主播念字义；模型分析随后再补。
 */
export const dynamic = "force-dynamic";

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return undefined;
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}

export async function GET(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  const url = new URL(req.url);
  const checked = validateAnalysisInput({
    fullName: url.searchParams.get("name") ?? "",
    splitSurname: url.searchParams.get("surname") ?? undefined,
  });
  if (!checked.ok) return NextResponse.json({ ok: false, message: checked.message }, { status: 400 });
  const split = resolveSplit(checked.input.fullName, checked.input.surnameOverride);
  if (!split) return NextResponse.json({ ok: false, message: "姓名无法拆分" }, { status: 400 });

  const entries = [...split.givenName].map((char) => {
    const info = getQmzChar(char);
    if (!info) return { char, missing: true };
    return {
      char,
      ...(info.pinyin ? { pinyin: info.pinyin } : {}),
      ...(clip(info.basicMeaning, 100) ? { basicMeaning: clip(info.basicMeaning, 100) } : {}),
      ...(clip(info.nameMeaning, 160) ? { nameMeaning: clip(info.nameMeaning, 160) } : {}),
      ...(clip(info.decomposition, 80) ? { decomposition: clip(info.decomposition, 80) } : {}),
    };
  });
  return NextResponse.json(
    { ok: true, surname: split.surname, givenName: split.givenName, entries },
    { headers: { "Cache-Control": "no-store" } },
  );
}
