"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitFullName } from "@/domain/analysis/split-name";
import type { FixOption, NameScore, NextStep } from "@/domain/score/types";
import { readFixStream } from "./fix-stream";
import { fetchMerit, prompterFromScore, pushPrompter, type ScoreForPrompter } from "./prompter-sync";
import "./analyze.css";

/**
 * 名字分析面板：直播打分榜。
 *
 * 一行一位观众，往下累加——榜单本身就是吸引其他人报名字的东西。
 * 回车只按规则打分，几毫秒出分。改一个字由模型看扣分理由定，服务端逐条核验，核过一条推一条（2026-11-01 用户定）。
 * 90 分以下的，打完分改字就在后台开始写，观众屏幕和提词页都先不显示；主播点「改一个字」才亮出来，
 * 主播讲扣分理由那几秒模型已经在写了（11-01 提速）。榜单在这一场里一直留着，关掉面板也不清。
 * 面板开着时，提词页跟着选中的那位观众走：分数、扣分理由、改法和寓意（prompter-sync.ts 的 prompterFromScore）。
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
  /**
   * 打完分就在后台改（11-01 加，提速）：shown 为 false 时观众屏幕和提词页都当没改过；
   * 主播点「改一个字」只是亮出来，主播讲扣分理由那几秒模型已经在写了
   */
  shown: boolean;
  /** 第几次改：再改一次时，上一次晚到的结果认得出来、丢掉 */
  run: number;
  phase: "idle" | "running" | "done" | "error";
  /** 模型写好、核过的改法，边收边加 */
  options: FixOption[];
  /** 模型判断改一个字解决不了时的原因 */
  unfixable?: string;
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
  /** 提词页上「这个名字好在哪」：打完分就去请，只给主播看 */
  merit?: ScoreForPrompter["merit"];
}

const IDLE_FIX: FixState = { shown: false, run: 0, phase: "idle", options: [], chosen: 0, misses: 0 };
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
  const picked = row.fix.shown && row.fix.phase === "done" ? row.fix.options[row.fix.chosen] : undefined;
  return picked ? `改为：${picked.fullName}` : row.score.bandLabel;
}

/** 改法按写好的先后排；榜单上「改为」默认用分最高的那个（同分取先到的），主播可以点别的 */
function bestIndex(options: FixOption[]): number {
  return options.reduce((best, o, i) => (o.score > options[best]!.score ? i : best), 0);
}

/** 打分接口没给 next 时（面板更新前打的分）：90 分以上不用改，其余给改一个字 */
function nextOf(row: Row, score: NameScore): NextStep {
  return row.next ?? { kind: score.band === "great" ? "none" : "fix", soundIssues: [] };
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
  const [confirmClear, setConfirmClear] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const boardRef = useRef<HTMLOListElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  const fixRun = useRef(0);

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

  /**
   * 改一个字：shown 为 false 是打完分在后台先改（观众屏幕、提词页都不显示），主播点了才亮出来。
   * 每一行各改各的，不再一次只许一个：后台先改的那一行不能挡住主播在别的行上点改字。
   */
  const runFix = useCallback(
    async (id: number, input: Row["input"], shown: boolean) => {
      const run = ++fixRun.current;
      patch(id, (r) => ({ ...r, fix: { ...IDLE_FIX, shown, run, phase: "running", misses: r.fix.misses } }));
      const mine = (r: Row) => r.fix.run === run;
      // 模型每核过一个改法，服务端推一帧：马上收下，亮着的话观众屏幕和提词页也跟着更新
      const addOption = (option: FixOption) =>
        patch(id, (r) => (mine(r) ? { ...r, fix: { ...r.fix, options: [...r.fix.options, option] } } : r));
      try {
        const res = await fetch("/api/analyze/fix?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const out = await readFixStream(res, addOption);
        if (!out) throw new Error("改字没成功");
        if (!out.ok) throw new Error(out.message);
        patch(id, (r) =>
          mine(r)
            ? {
                ...r,
                fix: {
                  ...r.fix,
                  phase: "done",
                  options: out.options,
                  chosen: bestIndex(out.options),
                  // 没亮出来的不算「没改出来」：主播点了、看到了才算
                  misses: out.options.length > 0 ? 0 : r.fix.misses + (r.fix.shown ? 1 : 0),
                  ...(out.unfixable ? { unfixable: out.unfixable } : {}),
                  ...(out.message ? { message: out.message } : {}),
                },
              }
            : r,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "改字没成功";
        // 已经收到的改法留着用，只是不再等后面的
        patch(id, (r) =>
          !mine(r)
            ? r
            : r.fix.options.length > 0
              ? { ...r, fix: { ...r.fix, phase: "done", chosen: bestIndex(r.fix.options), misses: 0 } }
              : { ...r, fix: { ...r.fix, phase: "error", message, misses: r.fix.misses + (r.fix.shown ? 1 : 0) } },
        );
      }
    },
    [patch],
  );

  /** 主播点「改一个字」：后台已经在改或改完了就亮出来；没改过、后台出错了、或者是「再改一次」就重新改 */
  const onFixClick = useCallback(
    (row: Row) => {
      const f = row.fix;
      if (!f.shown && (f.phase === "running" || f.phase === "done")) {
        const missed = f.phase === "done" && f.options.length === 0;
        patch(row.id, (r) => ({ ...r, fix: { ...r.fix, shown: true, misses: missed ? r.fix.misses + 1 : r.fix.misses } }));
        return;
      }
      if (f.shown && f.phase === "running") return;
      void runFix(row.id, row.input, true);
    },
    [patch, runFix],
  );

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
      patch(id, (r) => ({ ...r, score: result, ...(next ? { next } : {}), merit: { phase: "writing" } }));
      // 「这个名字好在哪」要调模型，几秒后才到：不等它，也不占改字那把锁，主播先念分数和查了哪几项
      void fetchMerit(input).then((merit) =>
        patch(id, (r) => ({ ...r, merit: merit ? { phase: "done", ...merit } : { phase: "error" } })),
      );
      // 90 分以下的，改字也马上在后台开始写（不亮出来）：主播讲分数、扣分理由那几秒，模型已经在写了
      if (result.band !== "great") void runFix(id, input, false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "打分失败";
      patch(id, (r) => ({ ...r, error: message }));
    }
  }, [name, gender, splitPreview, patch, runFix]);

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

  // 提词页跟着选中的那位观众走：打完分、点了改字、每核过一个改法都推一次。
  // 只看选中的这一行：别的行在改字也不推，免得盖掉主播正在念的稿子
  useEffect(() => {
    if (!open || !selected?.score) return;
    pushPrompter(
      prompterFromScore({
        no: selectedNo,
        score: selected.score,
        next: nextOf(selected, selected.score),
        fix: selected.fix,
        ...(selected.merit ? { merit: selected.merit } : {}),
      }),
    );
  }, [open, selected, selectedNo]);

  if (!open) return null;

  const trimmed = name.replace(/\s/g, "");
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 4;

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
              running={selected.fix.shown && selected.fix.phase === "running"}
              onFix={() => onFixClick(selected)}
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
  running,
  onFix,
  onChoose,
  onRename,
}: {
  row: Row;
  score: NameScore;
  /** 主播点了、模型还在写 */
  running: boolean;
  onFix: () => void;
  onChoose: (i: number) => void;
  onRename: Props["onRename"];
}) {
  // 后台先改、还没亮出来的，观众屏幕上当没改过
  const fix: FixState = row.fix.shown ? row.fix : { ...IDLE_FIX, misses: row.fix.misses };
  const next = nextOf(row, score);
  const fixLabel =
    fix.phase === "running"
      ? "正在改…"
      : fix.phase === "done"
        ? "再改一次"
        : fix.phase === "error"
          ? "再试一次"
          : "改一个字";

  // 改字没出结果：第一次给「再改一次」和「重新起名」，连着两次就只留「重新起名」，不让主播干等
  const missed = (fix.phase === "done" && fix.options.length === 0) || fix.phase === "error";
  const givenUp = missed && fix.misses >= MAX_MISSES;
  const asking = next.kind === "ask" && fix.phase === "idle";
  const showFixButton = (next.kind === "fix" || (next.kind === "ask" && !asking)) && !givenUp;
  const rename = (ghost: boolean) => (
    <RenameButtons
      surname={score.surname}
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
      </div>

      {/* 扣分理由、算式、民间说法只放提词页，由主播讲（2026-11-01 用户定）：观众屏幕上只有分数和能不能用 */}
      {asking && (
        <div className="ap-next">
          <p className="ap-next-ask">只改一个字（读音会跟着变）能接受吗？不接受就重新起名。</p>
          <div className="ap-actions">
            <button type="button" className="ap-act" onClick={onFix} disabled={running}>
              只改一个字
            </button>
            {rename(true)}
          </div>
        </div>
      )}

      {showFixButton && (
        <div className="ap-actions">
          <button type="button" className="ap-act" onClick={onFix} disabled={running}>
            {fixLabel}
          </button>
          {missed && rename(true)}
        </div>
      )}

      {fix.phase === "running" && fix.options.length === 0 && (
        <p className="ap-wait">正在看换哪个字更合适，几秒钟……</p>
      )}
      {missed && !givenUp && (fix.unfixable || fix.message) && (
        <p className="ap-wait">{fix.unfixable ? `改一个字解决不了：${fix.unfixable}。建议重新起名。` : fix.message}</p>
      )}
      {givenUp && (
        <div className="ap-next">
          <p className="ap-next-why">
            {fix.unfixable ? `改一个字解决不了：${fix.unfixable}。` : "改了两次都没有合适的，"}建议直接重新起名。
          </p>
          <div className="ap-actions">{rename(false)}</div>
        </div>
      )}
      {fix.options.length > 0 && (
        <ul className="ap-fixes">
          {fix.options.map((o, i) => (
            <li key={o.fullName}>
              <button type="button" className={fix.phase === "done" && i === fix.chosen ? "on" : ""} onClick={() => onChoose(i)}>
                <span className="ap-fix-name">{o.fullName}</span>
                <span className="ap-fix-score">{o.score}</span>
                <span className="ap-fix-change">
                  {o.from} → {o.to}
                  {o.soundLine === "读音不变" ? "" : " · 读音变了"}
                </span>
                <span className="ap-fix-why">{o.why}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {fix.phase === "running" && fix.options.length > 0 && <p className="ap-wait">还在写下一个……</p>}
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
