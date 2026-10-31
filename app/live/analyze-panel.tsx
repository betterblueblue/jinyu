"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitFullName } from "@/domain/analysis/split-name";
import type { FixOption, FixOutcome, NameScore, NextStep } from "@/domain/score/types";
import "./analyze.css";

/**
 * 名字分析面板：直播打分榜。
 *
 * 一行一位观众，往下累加——榜单本身就是吸引其他人报名字的东西。
 * 回车只按规则打分，几毫秒出分；观众想改，主播点「改字」才去挑同音字。榜单在这一场里一直留着，关掉面板也不清。
 * 以前的「详细解读」（模型另写一段分析）和后面的「整个换新名」已删（2026-10-31，用户定）：
 * 解读和规则打分对不上，当着观众很尴尬。
 */

type Gender = "male" | "female" | "unknown";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 打分榜「重新起名」：带着姓和性别去走直播用的精简版取名 */
  onRename: (input: { surname: string; gender: "male" | "female" }) => void;
}

interface FixState {
  phase: "idle" | "running" | "done" | "error";
  options: FixOption[];
  message?: string;
  /** 主播选中的改法，榜单上显示成「改为」 */
  chosen: number;
  /** 连着几次没挑出字（含报错）；到 MAX_MISSES 就不再让主播重试，直接给重新起名 */
  misses: number;
}

interface Row {
  id: number;
  input: { fullName: string; gender: Gender; splitSurname?: string };
  score?: NameScore;
  /** 下一步推什么，和分数一起由打分接口给 */
  next?: NextStep;
  error?: string;
  fix: FixState;
}

const IDLE_FIX: FixState = { phase: "idle", options: [], chosen: 0, misses: 0 };
/** 改字连着两次没结果，就别让主播再点了 */
const MAX_MISSES = 2;
const GENDERS: Gender[] = ["male", "female", "unknown"];
const G_LABEL: Record<Gender, string> = { male: "男", female: "女", unknown: "不填" };

/** 名里被扣分的字，在全名里的位置 */
function markedPositions(score: NameScore): Set<number> {
  const offset = [...score.surname].length;
  const set = new Set<number>();
  for (const d of score.deductions) for (const p of d.positions) set.add(offset + p);
  return set;
}

function verdictText(row: Row): string {
  if (row.error) return "没打出分";
  if (!row.score) return "…";
  const picked = row.fix.phase === "done" ? row.fix.options[row.fix.chosen] : undefined;
  return picked ? `改为：${picked.fullName}` : row.score.bandLabel;
}

function mathLine(score: NameScore): string {
  if (score.deductions.length === 0) return "一分没扣";
  const total = score.deductions.reduce((s, d) => s + d.points, 0);
  if (total >= 100) return `一共扣了 ${total} 分，按 0 分算`;
  return `100 − ${score.deductions.map((d) => d.points).join(" − ")} = ${score.score}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function AnalyzePanel({ open, onClose, onRename }: Props) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [surnameOverride, setSurnameOverride] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** 改字要调模型，一次只跑一个，主播连点也不会叠着发 */
  const [modelBusy, setModelBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const boardRef = useRef<HTMLOListElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  const modelLock = useRef(false);

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

  const takeModel = useCallback(() => {
    if (modelLock.current) return false;
    modelLock.current = true;
    setModelBusy(true);
    return true;
  }, []);

  const releaseModel = useCallback(() => {
    modelLock.current = false;
    setModelBusy(false);
  }, []);

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

  const submit = useCallback(async () => {
    const fullName = name.replace(/\s/g, "");
    if (fullName.length < 2 || fullName.length > 4) return;
    const id = nextId.current++;
    const input = { fullName, gender, ...(splitPreview ? { splitSurname: splitPreview.surname } : {}) };
    setRows((all) => [...all, { id, input, fix: IDLE_FIX }]);
    setSelectedId(id);
    // 直播是一位接一位：性别清回「不填」，免得上一位的性别带到下一位身上
    setName("");
    setGender("unknown");
    setSurnameOverride(null);
    inputRef.current?.focus();

    try {
      const out = await postJson<{ ok: boolean; result?: NameScore; next?: NextStep; message?: string }>(
        "/api/analyze/score",
        input,
      );
      if (!out.ok || !out.result) throw new Error(out.message ?? "打分失败");
      const { result, next } = out;
      patch(id, (r) => ({ ...r, score: result, ...(next ? { next } : {}) }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "打分失败";
      patch(id, (r) => ({ ...r, error: message }));
    }
  }, [name, gender, splitPreview, patch]);

  const runFix = useCallback(
    async (row: Row) => {
      if (!takeModel()) return;
      patch(row.id, (r) => ({ ...r, fix: { ...IDLE_FIX, phase: "running", misses: r.fix.misses } }));
      try {
        const out = await postJson<FixOutcome>("/api/analyze/fix", row.input);
        if (!out.ok) throw new Error(out.message);
        patch(row.id, (r) => ({
          ...r,
          fix: {
            phase: "done",
            options: out.options,
            chosen: 0,
            misses: out.options.length > 0 ? 0 : r.fix.misses + 1,
            ...(out.message ? { message: out.message } : {}),
          },
        }));
      } catch (e) {
        const message = e instanceof Error ? e.message : "改字没成功";
        patch(row.id, (r) => ({ ...r, fix: { ...IDLE_FIX, phase: "error", message, misses: r.fix.misses + 1 } }));
      } finally {
        releaseModel();
      }
    },
    [patch, takeModel, releaseModel],
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

  if (!open) return null;

  const trimmed = name.replace(/\s/g, "");
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 4;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <section className="ap" role="dialog" aria-label="名字打分榜">
      <header className="ap-top">
        <div className="ap-title">
          <span className="ap-seal">析</span>
          <span className="ap-name">名字打分</span>
          <span className="ap-sub">瑾瑜规则分 · 只看字义、读音、常用度，不算五格笔画</span>
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
          <span>填完整姓名，按 1 / 2 / 3 选男、女、不填，回车打分</span>
        )}
      </div>

      <ol className="ap-board" ref={boardRef}>
        {rows.length === 0 && <li className="ap-board-empty">评论区留下宝宝的名字，现场打分</li>}
        {rows.map((r, i) => {
          const marks = r.score ? markedPositions(r.score) : new Set<number>();
          return (
            <li
              key={r.id}
              className={`ap-row ${r.id === selectedId ? "on" : ""} ${r.score ? `b-${r.score.band}` : ""}`}
              onClick={() => setSelectedId(r.id)}
            >
              <span className="ap-row-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="ap-row-name">
                {[...(r.score?.fullName ?? r.input.fullName)].map((ch, j) =>
                  marks.has(j) ? <b key={j}>{ch}</b> : <span key={j}>{ch}</span>,
                )}
              </span>
              <span className="ap-row-score">{r.score?.score ?? ""}</span>
              <span className="ap-row-verdict">{verdictText(r)}</span>
            </li>
          );
        })}
      </ol>

      {selected && (
        <div className="ap-detail" ref={detailRef}>
          {selected.error && <p className="ap-error">{selected.error}</p>}
          {selected.score && (
            <Detail
              row={selected}
              score={selected.score}
              modelBusy={modelBusy}
              onFix={() => void runFix(selected)}
              onChoose={(i) => patch(selected.id, (r) => ({ ...r, fix: { ...r.fix, chosen: i } }))}
              onRename={onRename}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Detail({
  row,
  score,
  modelBusy,
  onFix,
  onChoose,
  onRename,
}: {
  row: Row;
  score: NameScore;
  modelBusy: boolean;
  onFix: () => void;
  onChoose: (i: number) => void;
  onRename: Props["onRename"];
}) {
  const { fix } = row;
  // 打分接口没给 next 时（面板更新前打的分）按老规矩：有可换的字就给改字，90 分以上不给
  const next: NextStep = row.next ?? {
    kind: score.band !== "great" && score.fixable.length > 0 ? "fix" : "none",
    fixable: score.fixable,
    soundIssues: [],
  };
  const swapChars = next.fixable
    .slice(0, 2)
    .map((f) => `「${f.char}」`)
    .join("");
  const fixLabel =
    fix.phase === "running"
      ? "正在挑同音字…"
      : fix.phase === "done"
        ? "再挑一次"
        : fix.phase === "error"
          ? "再试一次"
          : `改字 · 换${swapChars}`;

  // 改字没出结果：第一次给「再挑一次」和「重新起名」，连着两次就只留「重新起名」，不让主播干等
  const missed = (fix.phase === "done" && fix.options.length === 0) || fix.phase === "error";
  const givenUp = missed && fix.misses >= MAX_MISSES;
  const asking = next.kind === "ask" && fix.phase === "idle";
  const showFixButton = (next.kind === "fix" || (next.kind === "ask" && !asking)) && !givenUp;
  const soundLine = next.soundIssues[0]?.line;
  const rename = (ghost: boolean) => (
    <RenameButtons
      surname={score.surname}
      gender={row.input.gender}
      ghost={ghost}
      disabled={modelBusy}
      onRename={onRename}
    />
  );

  return (
    <>
      <div className="ap-detail-head">
        <p className="ap-detail-name">
          {score.fullName}
          <span className="ap-detail-py">
            {score.syllables.map((s, i) => (
              <span key={i}>
                {s.py}
                {s.tone ? <sup>{s.tone}</sup> : null}
              </span>
            ))}
          </span>
        </p>
        <p className={`ap-detail-score b-${score.band}`}>
          <b>{score.score}</b>
          <span>分 · {score.bandLabel}</span>
        </p>
        <p className="ap-detail-math">{mathLine(score)}</p>
      </div>

      {score.deductions.length > 0 && (
        <ul className="ap-deds">
          {score.deductions.map((d, i) => (
            <li key={i}>
              <b>−{d.points}</b>
              <span>{d.line}</span>
            </li>
          ))}
        </ul>
      )}

      {score.folk.length > 0 && (
        <details className="ap-folk">
          <summary>民间说法 · 不扣分</summary>
          {score.folk.map((f) => (
            <p key={f.char}>{f.line}</p>
          ))}
        </details>
      )}

      {next.kind === "rename" && (
        <div className="ap-next">
          <p className="ap-next-why">
            {soundLine ? "毛病出在读音上，换同音字还是这个音，建议直接重新起名。" : "没有能单独换掉的字，建议直接重新起名。"}
          </p>
          <div className="ap-actions">{rename(false)}</div>
        </div>
      )}

      {asking && (
        <div className="ap-next">
          <p className="ap-next-why">
            换{swapChars}能去掉一部分扣分，但这一条换同音字去不掉：{soundLine}
          </p>
          <p className="ap-next-ask">只改字能接受吗？不接受就重新起名。</p>
          <div className="ap-actions">
            <button type="button" className="ap-act" onClick={onFix} disabled={modelBusy}>
              只改字
            </button>
            {rename(true)}
          </div>
        </div>
      )}

      {showFixButton && (
        <div className="ap-actions">
          <button type="button" className="ap-act" onClick={onFix} disabled={modelBusy}>
            {fixLabel}
          </button>
          {missed && rename(true)}
        </div>
      )}

      {fix.phase === "running" && <p className="ap-wait">正在从同音字里挑，两三秒……</p>}
      {missed && !givenUp && fix.message && <p className="ap-wait">{fix.message}</p>}
      {givenUp && (
        <div className="ap-next">
          <p className="ap-next-why">同音字里挑了两次都没有合适的，建议直接重新起名。</p>
          <div className="ap-actions">{rename(false)}</div>
        </div>
      )}
      {fix.phase === "done" && fix.options.length > 0 && (
        <ul className="ap-fixes">
          {fix.options.map((o, i) => (
            <li key={o.fullName}>
              <button type="button" className={i === fix.chosen ? "on" : ""} onClick={() => onChoose(i)}>
                <span className="ap-fix-name">{o.fullName}</span>
                <span className="ap-fix-score">{o.score}</span>
                <span className="ap-fix-change">
                  {o.from} → {o.to}
                </span>
                <span className="ap-fix-why">{o.why}</span>
              </button>
            </li>
          ))}
        </ul>
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
