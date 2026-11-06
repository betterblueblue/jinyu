"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitFullName } from "@/domain/analysis/split-name";
import { isSensitiveName, SENSITIVE_NOTE } from "@/domain/evaluate/sensitive";
import type { NameFacts } from "@/domain/evaluate/types";
import type { PrompterDictEntry } from "@/live/prompter";
import type { SimpleAnalysis, SimpleFix, SimpleStatus } from "@/simple/evaluate";
import { SCORE_TABLE_ROWS } from "../../../live/score-table";
import { ScoreView } from "../../../live/prompter/score-view";
import { logLive, prompterFromSimple, readSimpleEvaluateStream } from "../simple-client";

/**
 * 简化版提词页「打分」页签（2026-11-06，照抄 app/live/prompter/score-desk.tsx，换成简化版接口）。
 * 观众屏幕上只有主播手填的三列表格，系统的分析只在这一页：主播照着念，再抄过去。
 *
 * 回车同时发两个请求：
 *   GET  /api/dictionary         本地字典（起名字典 qmz，没收的字用新华字典补一句），和现在的系统同一个接口，几毫秒，先念；
 *   POST /api/simple/evaluate    一个流：facts（拆名、拼音、规则查到的问题）→ 模型推理里的判断 →
 *                                analysis（先只有八维分，写完再补点评）→ fix（改法）→ result。
 * 显示走 prompterFromSimple + 现在的 ScoreView。
 */

type Gender = "male" | "female" | "unknown";
const GENDERS: Gender[] = ["male", "female", "unknown"];
const G_LABEL: Record<Gender, string> = { male: "男", female: "女", unknown: "不填" };

interface Row {
  id: number;
  input: { fullName: string; gender: Gender; splitSurname?: string };
  facts?: NameFacts;
  dictionary?: PrompterDictEntry[];
  original?: SimpleAnalysis;
  candidates: SimpleFix[];
  thoughts: string[];
  status?: SimpleStatus;
  note?: string;
  /** 主播选的改法（全名）；"none" = 不改；不填 = 用首选 */
  chosen?: string;
  error?: string;
}

/** 选中的改法：主播点过的，没点就是首选 */
function pickedOf(row: Row): string {
  if (row.chosen === "none") return "none";
  return row.candidates.find((c) => c.fullName === row.chosen)?.fullName ?? row.candidates[0]?.fullName ?? "none";
}

/** 直播台表格第三格写什么，和原来打分榜「结论」那一列一样 */
function tableNote(row: Row): { text: string; waiting: boolean } {
  if (row.status === "needs_gender") return { text: "先问性别", waiting: false };
  if (!row.original) {
    if (row.error || row.status) return { text: "没评完", waiting: false };
    return { text: "评价中…", waiting: true };
  }
  const picked = pickedOf(row);
  if (picked !== "none") return { text: `改为：${picked}`, waiting: false };
  const running = !row.status && !row.error;
  if (running && row.chosen !== "none") return { text: `${row.original.bandLabel}（改法还在写）`, waiting: true };
  return { text: row.original.bandLabel, waiting: false };
}

export function ScoreDesk({ active }: { active: boolean }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [surnameOverride, setSurnameOverride] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** 输入法还在组字：这时候点「打分」会提交拼音，先挡住 */
  const [composing, setComposing] = useState(false);
  /** 上一次回车的是不打分的名字，输入框下面说一句；再输入就清掉 */
  const [blocked, setBlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextId = useRef(1);

  const splitPreview = useMemo(() => {
    const trimmed = name.replace(/\s/g, "");
    if (trimmed.length < 2) return null;
    const base = splitFullName(trimmed);
    if (!base.ok || !base.split) return null;
    if (surnameOverride && trimmed.startsWith(surnameOverride) && trimmed.length > surnameOverride.length) {
      return {
        surname: surnameOverride,
        givenName: trimmed.slice(surnameOverride.length),
        alternatives: [
          { surname: base.split.surname, givenName: base.split.givenName },
          ...base.split.alternatives,
        ].filter((a, i, all) => a.surname !== surnameOverride && all.findIndex((x) => x.surname === a.surname) === i),
      };
    }
    return base.split;
  }, [name, surnameOverride]);

  const patch = useCallback((id: number, fn: (r: Row) => Row) => {
    setRows((all) => all.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  const runEvaluate = useCallback(
    async (id: number, input: Row["input"], retry = false) => {
      if (retry) {
        patch(id, (r) => ({ ...r, error: undefined, status: undefined, note: undefined, candidates: [], thoughts: [], chosen: undefined }));
      }
      try {
        const res = await fetch("/api/simple/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // retry：原名分按上次的钉住，只重写改法，分数不会变
          body: JSON.stringify(retry ? { ...input, retry: true } : input),
        });
        if (res.status === 401) throw new Error("登录过期，刷新页面重新登录");
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? "评价失败");
        }
        const result = await readSimpleEvaluateStream(res, {
          onFacts: (facts) => patch(id, (r) => ({ ...r, facts })),
          onAnalysis: (original) => patch(id, (r) => ({ ...r, original })),
          onFix: (fix) =>
            patch(id, (r) => (r.candidates.some((c) => c.givenName === fix.givenName) ? r : { ...r, candidates: [...r.candidates, fix] })),
          onThought: (text) => patch(id, (r) => (r.thoughts.includes(text) ? r : { ...r, thoughts: [...r.thoughts, text] })),
        });
        if (!result || !result.status) throw new Error("评价没完成");
        const status = result.status;
        patch(id, (r) => ({
          ...r,
          ...(result.facts ? { facts: result.facts } : {}),
          original: result.analysis ?? r.original,
          candidates: result.fixes ?? r.candidates,
          status,
          note: result.note,
        }));
        const facts = result.facts;
        if (!facts) return;
        const a = result.analysis;
        logLive({
          kind: "score",
          fullName: facts.fullName,
          gender: input.gender,
          score: a?.total ?? 0,
          bandLabel: a?.bandLabel ?? "待评价",
          rules: [...new Set(facts.issues.map((it) => it.rule))],
          next: status === "options" ? "fix" : "none",
          genderAsk: status === "needs_gender",
        });
        logLive({ kind: "merit", fullName: facts.fullName, ok: Boolean(a?.strengths.length), tip: Boolean(a?.reminders.length), ms: result.tookMs ?? 0 });
        if (status !== "needs_gender") {
          logLive({
            kind: "fix",
            fullName: facts.fullName,
            waitMs: result.tookMs ?? 0,
            prefetched: true,
            options: (result.fixes ?? []).map((c) => ({ fullName: c.fullName, score: c.score })),
            // 日志接口超过 120 字整条不收
            ...((status === "error" || status === "timeout") && result.note ? { error: result.note.slice(0, 120) } : {}),
          });
        }
      } catch (e) {
        patch(id, (r) => ({ ...r, error: e instanceof Error ? e.message : "评价失败" }));
      }
    },
    [patch],
  );

  const loadDictionary = useCallback(
    async (id: number, fullName: string, surname?: string) => {
      try {
        const params = new URLSearchParams({ name: fullName });
        if (surname) params.set("surname", surname);
        const res = await fetch(`/api/dictionary?${params.toString()}`);
        if (!res.ok) return;
        const body = (await res.json()) as { ok?: boolean; entries?: PrompterDictEntry[] };
        if (body.ok && body.entries) patch(id, (r) => ({ ...r, dictionary: body.entries }));
      } catch {
        /* 字典查不到不影响打分 */
      }
    },
    [patch],
  );

  const submit = useCallback(async () => {
    if (composing) return;
    const fullName = name.replace(/\s/g, "");
    if (fullName.length < 2 || fullName.length > 4) return;
    // 敏感人物：不打分、不记日志，只清掉输入框（2026-11-05）
    if (isSensitiveName(fullName)) {
      setName("");
      setGender("unknown");
      setSurnameOverride(null);
      setBlocked(true);
      inputRef.current?.focus();
      return;
    }
    const id = nextId.current++;
    const input = { fullName, gender, ...(splitPreview ? { splitSurname: splitPreview.surname } : {}) };
    setRows((all) => [...all, { id, input, candidates: [], thoughts: [] }]);
    setSelectedId(id);
    // 直播是一位接一位：性别清回「不填」，免得上一位的性别带到下一位身上
    setName("");
    setGender("unknown");
    setSurnameOverride(null);
    inputRef.current?.focus();
    void loadDictionary(id, fullName, input.splitSurname);
    await runEvaluate(id, input);
  }, [name, gender, splitPreview, runEvaluate, composing, loadDictionary]);

  const moveSelection = useCallback(
    (step: number) => {
      if (rows.length === 0) return;
      const at = rows.findIndex((r) => r.id === selectedId);
      const next = at < 0 ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + step));
      setSelectedId(rows[next]!.id);
    },
    [rows, selectedId],
  );

  // 切回「打分」页签时光标回到名字框
  useEffect(() => {
    if (active) requestAnimationFrame(() => inputRef.current?.focus());
  }, [active]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const selectedNo = selected ? rows.indexOf(selected) + 1 : 0;
  const trimmed = name.replace(/\s/g, "");
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 4 && !composing;

  return (
    <div data-testid="score-desk">
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          value={name}
          maxLength={4}
          placeholder="观众的名字"
          autoComplete="off"
          aria-label="姓名"
          onChange={(e) => {
            setName(e.target.value);
            setSurnameOverride(null);
            setBlocked(false);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            // 输入法选字时数字键和回车都归输入法，不能当成快捷键
            if (e.nativeEvent.isComposing || e.key === "Process") return;
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "1" || e.key === "2" || e.key === "3") {
              e.preventDefault();
              setGender(GENDERS[Number(e.key) - 1]!);
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              moveSelection(e.key === "ArrowUp" ? -1 : 1);
            }
          }}
          className="w-56 rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-3xl tracking-widest text-white outline-none focus:border-amber-400"
        />
        {GENDERS.map((g, i) => (
          <button
            key={g}
            type="button"
            onClick={() => setGender(g)}
            className={`rounded border px-4 py-2 text-xl ${
              gender === g ? "border-amber-400 bg-amber-400/15 text-amber-200" : "border-neutral-700 text-neutral-300"
            }`}
          >
            {G_LABEL[g]}
            <span className="ml-1 text-sm opacity-60">{i + 1}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="rounded bg-amber-500 px-6 py-2 text-xl font-semibold text-neutral-950 disabled:opacity-30"
        >
          打分
        </button>
      </div>
      <div className="mt-2 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 text-lg text-neutral-400">
        {splitPreview ? (
          <>
            <span>
              姓 <b className="text-amber-200">{splitPreview.surname}</b> · 名{" "}
              <b className="text-amber-200">{splitPreview.givenName}</b> · 回车打分
            </span>
            {splitPreview.alternatives.length > 0 && (
              <span className="flex flex-wrap items-center gap-2">
                拆法不对？
                {splitPreview.alternatives.map((a) => (
                  <button
                    key={a.surname}
                    type="button"
                    onClick={() => setSurnameOverride(a.surname)}
                    className="rounded border border-dashed border-neutral-600 px-3 py-0.5 hover:border-amber-400 hover:text-amber-200"
                  >
                    {a.surname} / {a.givenName}
                  </button>
                ))}
              </span>
            )}
          </>
        ) : blocked ? (
          <span>{SENSITIVE_NOTE}</span>
        ) : trimmed.length === 1 ? (
          <span>再填一个字 · 姓名要两个字以上才能打分</span>
        ) : null}
      </div>

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="本场打过的">
          <span className="text-base text-neutral-500">本场：</span>
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`rounded border px-3 py-1 text-lg ${
                r.id === selectedId ? "border-amber-400 text-amber-200" : "border-neutral-700 text-neutral-300"
              }`}
            >
              {String(i + 1).padStart(2, "0")} {r.facts?.fullName ?? r.input.fullName}{" "}
              {r.original ? r.original.total : r.status === "needs_gender" ? "?" : r.error ? "×" : "…"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              setRows([]);
              setSelectedId(null);
              setConfirmClear(false);
              inputRef.current?.focus();
            }}
            className="ml-2 rounded border border-neutral-700 px-3 py-1 text-base text-neutral-400 hover:border-rose-400 hover:text-rose-200"
          >
            {confirmClear ? "再点一次清空" : "清空本场"}
          </button>
        </div>
      )}

      {selected ? (
        <Selected
          row={selected}
          no={selectedNo}
          onPick={(full) => {
            patch(selected.id, (r) => ({ ...r, chosen: full }));
            if (full !== "none") {
              logLive({ kind: "choose", fullName: selected.facts?.fullName ?? selected.input.fullName, chosen: full });
            }
          }}
          onRetry={() => void runEvaluate(selected.id, selected.input, true)}
        />
      ) : (
        <p className="mt-10 text-3xl leading-relaxed text-neutral-400">输入观众的名字，选男女，回车打分。</p>
      )}
    </div>
  );
}

function Selected({
  row,
  no,
  onPick,
  onRetry,
}: {
  row: Row;
  no: number;
  onPick: (full: string) => void;
  onRetry: () => void;
}) {
  const note = tableNote(row);
  const score = row.original?.total;
  const canRetry = Boolean(row.error) || (row.status !== undefined && row.status !== "needs_gender" && !row.candidates.length);
  return (
    <section className="mt-6">
      {/* 抄到直播台：三格对应直播台表格三列，第二列在直播台上是红字 */}
      <div className="rounded-lg border-2 border-amber-400/70 bg-amber-400/5 px-5 py-4" data-testid="score-copy">
        <p className="text-base tracking-widest text-amber-300">
          抄到直播台 · {no <= SCORE_TABLE_ROWS ? `表格第 ${no} 行` : `本场第 ${no} 位（表格满了，清空后从第一行填）`}
        </p>
        <div className="mt-2 grid grid-cols-[2fr_1.1fr_4.4fr] gap-3 text-[clamp(28px,4vw,44px)] font-semibold">
          <span className="text-white">{row.facts?.fullName ?? row.input.fullName}</span>
          <span className="tabular-nums text-rose-400">{score ?? (row.status === "needs_gender" ? "—" : "…")}</span>
          <span className={note.waiting ? "text-neutral-500" : "text-white"}>{note.text}</span>
        </div>
      </div>

      {row.error && !row.facts ? (
        <div className="mt-6">
          <p className="text-2xl text-rose-300">{row.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded border border-neutral-600 px-5 py-2 text-xl text-neutral-200 hover:border-amber-400 hover:text-amber-200"
          >
            再试一次
          </button>
        </div>
      ) : row.facts ? (
        <div className="mt-6">
          {row.error ? <p className="mb-4 text-2xl text-rose-300">{row.error}</p> : null}
          <ScoreView
            round={prompterFromSimple({
              no,
              facts: row.facts,
              analysis: row.original ?? null,
              fixes: row.candidates,
              ...(row.status ? { status: row.status } : row.error ? { status: "error" as const } : {}),
              ...(row.note ? { note: row.note } : {}),
              thoughts: row.thoughts,
              ...(row.dictionary ? { dictionary: row.dictionary } : {}),
            })}
            pick={{ picked: pickedOf(row), onPick, ...(canRetry ? { onRetry } : {}) }}
          />
        </div>
      ) : (
        <p className="mt-6 text-2xl text-neutral-500">正在拆名、查字典……</p>
      )}
    </section>
  );
}
