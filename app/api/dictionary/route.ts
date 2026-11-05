import { NextResponse } from "next/server";
import { isAuthenticated } from "@/auth/session";
import { validateAnalysisInput } from "@/domain/analysis/analyze";
import { resolveSplit } from "@/domain/score/score";
import { logMissingChars } from "@/dictionary/missing-log";
import { getQmzChar, spokenBasicMeaning } from "@/dictionary/qmz";
import { isSensitiveName, SENSITIVE_NOTE } from "@/domain/evaluate/sensitive";

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
  if (isSensitiveName(checked.input.fullName)) {
    return NextResponse.json({ ok: false, message: SENSITIVE_NOTE }, { status: 400 });
  }
  const split = resolveSplit(checked.input.fullName, checked.input.surnameOverride);
  if (!split) return NextResponse.json({ ok: false, message: "姓名无法拆分" }, { status: 400 });

  const entries = [...split.givenName].map((char) => {
    const info = getQmzChar(char);
    if (!info) return { char, missing: true };
    const basic = clip(spokenBasicMeaning(info.basicMeaning), 220);
    return {
      char,
      ...(info.pinyin ? { pinyin: info.pinyin } : {}),
      // 只给基本含义（去掉讲五行的话）和拆字。站点的「起名寓意」不给提词页：11-05 抽查 26 个字，
      // 5 个有写错或编的（梓涵说成男孩名、炜说成上火下为），899 个里 11 个写财运、官运、五行，
      // 宸还夸「天子宫殿、权威尊严」，和打分扣「字太大」对着干；寓意交给随后到的模型分析
      ...(basic ? { basicMeaning: basic } : {}),
      ...(clip(info.decomposition, 100) ? { decomposition: clip(info.decomposition, 100) } : {}),
    };
  });
  // 查不到的字记下来，下次抓取补上；写失败不影响返回
  const missed = entries.filter((e) => "missing" in e && e.missing).map((e) => e.char);
  if (missed.length) void logMissingChars(missed).catch(() => {});
  return NextResponse.json(
    { ok: true, surname: split.surname, givenName: split.givenName, entries },
    { headers: { "Cache-Control": "no-store" } },
  );
}
