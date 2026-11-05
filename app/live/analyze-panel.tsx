"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitFullName } from "@/domain/analysis/split-name";
import type { EvalCandidate, EvalStatus, NameFacts, OriginalEvaluation } from "@/domain/evaluate/types";
import type { PrompterDictEntry } from "@/live/prompter";
import { readEvaluateStream } from "./evaluate-stream";
import { logLive } from "./live-log-client";
import { prompterFromEvaluation, pushPrompter } from "./prompter-sync";
import "./analyze.css";

/**
 * 名字分析面板：直播打分榜（2026-11-04 换成统一评价接口）。
 *
 * 一行一位观众，往下累加——榜单本身就是吸引其他人报名字的东西。
 * 回车只发一个请求：/api/analyze/evaluate?stream=1。
 *   facts    几毫秒到：拆名、拼音、命中的规则，先让主播知道在评谁；
 *   analysis 原名评价，核过、算过分的，先上屏；
 *   option   改法，后台已经生成，观众屏幕和提词页都先不显示，主播点「改一个字」才亮出来。
 * 性别没填不出分，只提示先问男宝女宝（2026-11-04 用户定）。
 * 面板开着时，提词页跟着选中的那位观众走：优点、问题、改法、得失（prompter-sync.ts 的 prompterFromEvaluation）。
 */

type Gender = "male" | "female" | "unknown";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 打分榜「重新起名」：带着姓和性别去走直播用的精简版取名 */
  onRename: (input: { surname: string; gender: "male" | "female" }) => void;
}

interface Row {
  id: number;
  input: { fullName: string; gender: Gender; splitSurname?: string };
  /** 规则确认的材料，几毫秒就到 */
  facts?: NameFacts;
  /** 本地字典初检，先给主播念 */
  dictionary?: PrompterDictEntry[];
  /** 核过、算过分的原名评价 */
  original?: OriginalEvaluation;
  /** 核过的改法；后台先到，主播点了才亮 */
  candidates: EvalCandidate[];
  /** 模型推理里正在看的判断，一句一条，推给提词页让主播有东西念 */
  thoughts: string[];
  status?: EvalStatus;
  note?: string;
  /** 主播点过「改一个字」没有 */
  fixShown: boolean;
  /** 点的时候改法已经在了（日志用） */
  prefetched?: boolean;
  clickedAt?: number;
  /** 主播选中的改法（givenName） */
  chosen?: string;
  error?: string;
  startedAt: number;
}

const GENDERS: Gender[] = ["male", "female", "unknown"];
const G_LABEL: Record<Gender, string> = { male: "男", female: "女", unknown: "不填" };

/** 名里被规则点名的字，在全名里的位置 */
function markedPositions(row: Row): Set<number> {
  const set = new Set<number>();
  if (!row.facts) return set;
  const offset = [...row.facts.surname].length;
  for (const it of row.facts.issues) {
    for (const ch of it.chars) {
      const idx = row.facts.givenName.indexOf(ch);
      if (idx >= 0) set.add(offset + idx);
    }
  }
  return set;
}

function verdictText(row: Row): string {
  if (row.error) return "没评完";
  if (!row.original) return row.status === "needs_gender" ? "先问性别" : "…";
  const picked = row.fixShown ? (row.candidates.find((c) => c.givenName === row.chosen) ?? row.candidates[0]) : undefined;
  return picked ? `改为：${picked.fullName}` : row.original.scores.bandLabel;
}

export function AnalyzePanel({ open, onClose, onRename }: Props) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [surnameOverride, setSurnameOverride] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** 输入法还在组字：这时候点「打分」会提交拼音，先挡住 */
  const [composing, setComposing] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const boardRef = useRef<HTMLOListElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
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
    async (id: number, input: Row["input"], retry = false) => {      if (retry) {
        patch(id, (r) => ({
          ...r,
          error: undefined,
          status: undefined,
          note: undefined,
          candidates: [],
          startedAt: Date.now(),
          fixShown: true,
          thoughts: [],
        }));
      }
      try {
        const res = await fetch("/api/analyze/evaluate?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (res.status === 401) throw new Error("登录过期，刷新页面重新登录");
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? "评价失败");
        }
        const result = await readEvaluateStream(res, {
          onFacts: (facts) => patch(id, (r) => ({ ...r, facts })),
          onAnalysis: (original) => patch(id, (r) => ({ ...r, original })),
          onOption: (option) =>
            patch(id, (r) =>
              r.candidates.some((c) => c.givenName === option.givenName)
                ? r
                : { ...r, candidates: [...r.candidates, option] },
            ),
          onThought: (text) =>
            patch(id, (r) => (r.thoughts.includes(text) ? r : { ...r, thoughts: [...r.thoughts, text] })),
        });
        if (!result) throw new Error("评价没完成");
        patch(id, (r) => ({
          ...r,
          facts: result.facts,
          original: result.original ?? r.original,
          candidates: result.candidates,
          status: result.status,
          note: result.note,
        }));

        logLive({
          kind: "score",
          fullName: result.facts.fullName,
          gender: input.gender,
          score: result.original?.scores.total ?? 0,
          bandLabel: result.original?.scores.bandLabel ?? "待评价",
          rules: [...new Set(result.facts.issues.map((it) => it.rule))],
          next: result.status === "options" ? "fix" : result.status === "one_char_insufficient" ? "ask" : "none",
          genderAsk: result.status === "needs_gender",
        });
        logLive({
          kind: "merit",
          fullName: result.facts.fullName,
          ok: Boolean(result.original?.strengths.length),
          tip: Boolean(result.original?.reminders.length),
          ms: result.tookMs,
        });
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
        if (body.ok && body.entries) {
          patch(id, (r) => ({ ...r, dictionary: body.entries }));
        }
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
    const id = nextId.current++;
    const input = { fullName, gender, ...(splitPreview ? { splitSurname: splitPreview.surname } : {}) };
    setRows((all) => [...all, { id, input, candidates: [], thoughts: [], fixShown: false, startedAt: Date.now() }]);
    setSelectedId(id);
    // 直播是一位接一位：性别清回「不填」，免得上一位的性别带到下一位身上
    setName("");
    setGender("unknown");
    setSurnameOverride(null);
    inputRef.current?.focus();
    void loadDictionary(id, fullName, input.splitSurname);
    await runEvaluate(id, input);
  }, [name, gender, splitPreview, runEvaluate, composing, loadDictionary]);

  /** 主播点「改一个字」：后台已经生成好了就亮出来；没有就再请求一次 */
  const onFixClick = useCallback(
    (row: Row) => {
      if (row.error) {
        void runEvaluate(row.id, row.input, true);
        return;
      }
      if (!row.fixShown) {
        const clickedAt = Date.now();
        patch(row.id, (r) => ({ ...r, fixShown: true, clickedAt, prefetched: r.candidates.length > 0 }));
        logLive({
          kind: "fix",
          fullName: row.facts?.fullName ?? row.input.fullName,
          waitMs: 0,
          prefetched: row.candidates.length > 0,
          options: row.candidates.map((c) => ({ fullName: c.fullName, score: c.scores.total })),
        });
        return;
      }
      if (row.status !== undefined && row.status !== "needs_gender" && !row.candidates.length) {
        void runEvaluate(row.id, row.input, true);
      }
    },
    [patch, runEvaluate],
  );

  const moveSelection = useCallback(
    (step: number) => {
      if (rows.length === 0) return;
      const at = rows.findIndex((r) => r.id === selectedId);
      const next = at < 0 ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + step));
      setSelectedId(rows[next]!.id);
    },
    [rows, selectedId],
  );

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const selectedNo = selected ? rows.indexOf(selected) + 1 : 0;

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // 新观众进榜时滚到最底下，和评论区一样往下长
  useEffect(() => {
    const el = boardRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // 提词页跟着选中的那位观众走：事实、原名评价、亮出来的改法
  useEffect(() => {
    if (!open || !selected?.facts) return;
    pushPrompter(
      prompterFromEvaluation({
        no: selectedNo,
        facts: selected.facts,
        original: selected.original ?? null,
        candidates: selected.candidates,
        status: selected.status,
        note: selected.note,
        fixShown: selected.fixShown,
        thoughts: selected.thoughts,
        dictionary: selected.dictionary,
      }),
    );
  }, [open, selected, selectedNo]);

  if (!open) return null;

  const trimmed = name.replace(/\s/g, "");
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 4 && !composing;

  return (
    <section className="ap" role="dialog" aria-label="名字打分榜">
      <header className="ap-top">
        <div className="ap-title">
          <span className="ap-name">名字打分</span>
          <span className="ap-sub">瑾瑜综合分 · 读音、字义、气质、识读、流行、谐音</span>
        </div>
        <div className="ap-top-actions">
          {rows.length > 0 && (
            <button
              type="button"
              className="ap-close"
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
            >
              {confirmClear ? "再点一次清空" : "清空榜单"}
            </button>
          )}
          <button type="button" className="ap-close" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>
      </header>

      <div className="ap-entry">
        <input
          ref={inputRef}
          className="ap-entry-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSurnameOverride(null);
          }}
          onKeyDown={(e) => {
            // 输入法选字时数字键和回车都归输入法，不能当成快捷键
            if (e.nativeEvent.isComposing || e.key === "Process") return;
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
              return;
            }
            if (e.key === "1" || e.key === "2" || e.key === "3") {
              e.preventDefault();
              setGender(GENDERS[Number(e.key) - 1]!);
              return;
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              moveSelection(e.key === "ArrowUp" ? -1 : 1);
            }
          }}
          placeholder="观众的名字"
          maxLength={4}
          autoComplete="off"
          aria-label="姓名"
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        <div className="ap-entry-genders">
          {GENDERS.map((g, i) => (
            <button key={g} type="button" className={gender === g ? "on" : ""} onClick={() => setGender(g)}>
              {G_LABEL[g]}
              <em>{i + 1}</em>
            </button>
          ))}
        </div>
        <button type="button" className="ap-entry-go" onClick={() => void submit()} disabled={!canSubmit}>
          打分
        </button>
      </div>

      <div className="ap-split">
        {splitPreview ? (
          <>
            <span>
              姓 <b>{splitPreview.surname}</b> · 名 <b>{splitPreview.givenName}</b> · 回车打分
            </span>
            {splitPreview.alternatives.length > 0 && (
              <span className="ap-split-alt">
                拆法不对？
                {splitPreview.alternatives.map((a) => (
                  <button key={a.surname} type="button" onClick={() => setSurnameOverride(a.surname)}>
                    {a.surname} / {a.givenName}
                  </button>
                ))}
              </span>
            )}
          </>
        ) : (
          <span>
            {trimmed.length === 1
              ? "再填一个字 · 姓名要两个字以上才能打分"
              : "填完整姓名，按 1 / 2 / 3 选男、女、不填，回车打分"}
          </span>
        )}
      </div>

      <ol className="ap-board" ref={boardRef}>
        {rows.length === 0 && (
          <li className="ap-board-empty">
            送「墨镜」分析名字
            <br />
            送「比心兔兔」起名
          </li>
        )}
        {rows.map((r, i) => {
          const marks = markedPositions(r);
          return (
            <li
              key={r.id}
              className={`ap-row ${r.id === selectedId ? "on" : ""} ${r.original ? `b-${r.original.scores.band}` : ""}`}
              onClick={() => setSelectedId(r.id)}
            >
              <span className="ap-row-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="ap-row-name">
                {[...(r.facts?.fullName ?? r.input.fullName)].map((ch, j) =>
                  marks.has(j) ? <b key={j}>{ch}</b> : <span key={j}>{ch}</span>,
                )}
              </span>
              <span className="ap-row-score">{r.original?.scores.total ?? ""}</span>
              <span className="ap-row-verdict">{verdictText(r)}</span>
            </li>
          );
        })}
      </ol>

      {selected && (
        <div className="ap-detail" ref={detailRef}>
          {selected.error && <p className="ap-error">{selected.error}</p>}
          <Detail
            row={selected}
            onFix={() => onFixClick(selected)}
            onChoose={(c) => {
              patch(selected.id, (r) => ({ ...r, chosen: c.givenName }));
              logLive({
                kind: "choose",
                fullName: selected.facts?.fullName ?? selected.input.fullName,
                chosen: c.fullName,
              });
            }}
            onRename={onRename}
          />
        </div>
      )}
    </section>
  );
}

function Detail({
  row,
  onFix,
  onChoose,
  onRename,
}: {
  row: Row;
  onFix: () => void;
  onChoose: (candidate: EvalCandidate) => void;
  onRename: Props["onRename"];
}) {
  const facts = row.facts;
  const original = row.original;
  const status = row.status;
  const running = !status && !row.error;
  const retry = row.fixShown && !row.candidates.length && status !== "needs_gender";
  const showButton = !row.fixShown || retry;
  const fixLabel = !row.fixShown ? (running ? "正在评价…" : "改一个字") : "再试一次";
  const rename = (ghost: boolean) => (
    <RenameButtons
      surname={facts?.surname ?? row.input.fullName.slice(0, 1)}
      gender={row.input.gender}
      ghost={ghost}
      disabled={running}
      onRename={onRename}
    />
  );

  return (
    <>
      <div className="ap-detail-head">
        <p className="ap-detail-name">
          {facts?.fullName ?? row.input.fullName}
          {facts ? (
            <span className="ap-detail-py">
              {facts.syllables.map((s, i) => (
                <span key={i}>
                  {s.py}
                  {s.tone ? <sup>{s.tone}</sup> : null}
                </span>
              ))}
            </span>
          ) : null}
        </p>
        <p className={`ap-detail-score b-${original?.scores.band ?? "ok"}`}>
          <b>{original ? original.scores.total : "…"}</b>
          <span>{original ? `分 · ${original.scores.bandLabel}` : status === "needs_gender" ? "先确认性别" : "评价中"}</span>
        </p>
      </div>

      {status === "needs_gender" && (
        <div className="ap-next">
          <p className="ap-next-ask">先问一句是男宝还是女宝，选好性别再打一次分。</p>
        </div>
      )}
      {(status === "error" || status === "timeout") && <p className="ap-error">{row.note ?? "评价没完成"}</p>}
      {row.error && (
        <div className="ap-actions">
          <button type="button" className="ap-act" onClick={onFix}>
            再试一次
          </button>
        </div>
      )}

      {original && status !== "needs_gender" && (
        <>
          <div className="ap-actions">
            {showButton && (
              <button type="button" className="ap-act" onClick={onFix} disabled={running}>
                {fixLabel}
              </button>
            )}
            {retry && rename(true)}
          </div>
          {running && <p className="ap-wait">正在看换哪个字更合适，几秒钟……</p>}
          {row.fixShown && !running && !row.candidates.length && (
            <p className="ap-wait">{row.note ?? "这次没有更好的改法，可以再试一次。"}</p>
          )}
          {row.fixShown && row.candidates.length > 0 && (
            <ul className="ap-fixes">
              {row.candidates.map((c, i) => (
                <li key={c.fullName}>
                  <button type="button" className={c.givenName === row.chosen ? "on" : ""} onClick={() => onChoose(c)}>
                    <span className="ap-fix-name">
                      {i === 0 ? "首选 · " : "备选 · "}
                      {c.fullName}
                    </span>
                    <span className="ap-fix-change">
                      {c.from} → {c.to}
                      {c.soundLine === "读音不变" ? "" : " · 读音变了"}
                    </span>
                    <span className="ap-fix-why">{c.why}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** 重新起名走精简版，精简版要先定男女：性别没填就给男孩、女孩两个按钮 */
function RenameButtons({
  surname,
  gender,
  ghost,
  disabled,
  onRename,
}: {
  surname: string;
  gender: Gender;
  ghost: boolean;
  disabled: boolean;
  onRename: Props["onRename"];
}) {
  const cls = ghost ? "ap-act ghost" : "ap-act";
  if (gender === "unknown") {
    return (
      <>
        <button type="button" className={cls} disabled={disabled} onClick={() => onRename({ surname, gender: "male" })}>
          重新起名 · 男孩
        </button>
        <button type="button" className={cls} disabled={disabled} onClick={() => onRename({ surname, gender: "female" })}>
          重新起名 · 女孩
        </button>
      </>
    );
  }
  return (
    <button type="button" className={cls} disabled={disabled} onClick={() => onRename({ surname, gender })}>
      按{surname}姓重新起名
    </button>
  );
}
