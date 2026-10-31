"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Grade, ReviewBatch, ReviewItem, Suggestion, Verdict, VerdictMap, VerdictRecord } from "@/library/review-types";
import { talkLines } from "@/library/talk";

/** 口播稿示意用的姓；直播时换成观众报的姓 */
const TALK_SURNAME = "王";

const AS_VERDICT: Record<Suggestion, Verdict> = { 要: "yes", 不要: "no", 拿不准: "unsure" };
const GENDER_LABEL: Record<ReviewItem["gender"], string> = { male: "男孩", female: "女孩", neutral: "男女都可" };

interface Choice {
  key: string;
  label: string;
  verdict: Verdict;
  grade?: Grade;
}

/** 试评时用户在备注里自己打 70 / 80 / 90 分，所以「要」拆成三档，一下点完 */
const CHOICES: Choice[] = [
  { key: "1", label: "很好", verdict: "yes", grade: 90 },
  { key: "2", label: "可以", verdict: "yes", grade: 80 },
  { key: "3", label: "一般", verdict: "yes", grade: 70 },
  { key: "4", label: "不要", verdict: "no" },
  { key: "5", label: "拿不准", verdict: "unsure" },
];

function labelOf(r: VerdictRecord): string {
  if (r.verdict === "yes") return r.grade === 90 ? "很好" : r.grade === 80 ? "可以" : r.grade === 70 ? "一般" : "要";
  return r.verdict === "no" ? "不要" : "拿不准";
}

function isChosen(r: VerdictRecord | undefined, c: Choice): boolean {
  return Boolean(r && r.verdict === c.verdict && (c.verdict !== "yes" || r.grade === c.grade));
}

/** 要 = 天青，不要 = 铁足，拿不准 = 灰：和全站的强调色一致 */
function tone(v: Verdict | Suggestion): string {
  const k = typeof v === "string" && v in AS_VERDICT ? AS_VERDICT[v as Suggestion] : (v as Verdict);
  if (k === "yes") return "border-gold text-gold";
  if (k === "no") return "border-cinnabar text-cinnabar";
  return "border-outline-variant text-outline";
}

function nextOpen(items: ReviewItem[], verdicts: VerdictMap, from: number): number {
  const after = items.findIndex((it, i) => i > from && !verdicts[it.id]);
  if (after >= 0) return after;
  return items.findIndex((it) => !verdicts[it.id]);
}

export function ReviewClient({
  batch,
  initialVerdicts,
  batchNames,
}: {
  batch: ReviewBatch;
  initialVerdicts: VerdictMap;
  batchNames: string[];
}) {
  const items = batch.items;
  const [verdicts, setVerdicts] = useState<VerdictMap>(initialVerdicts);
  const [index, setIndex] = useState(() => {
    const open = items.findIndex((i) => !initialVerdicts[i.id]);
    return open >= 0 ? open : 0;
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = items[index]!;
  const mine = verdicts[item.id];
  const done = items.filter((i) => verdicts[i.id]).length;

  // 换到另一个名字时，备注框显示那个名字已存的备注
  useEffect(() => {
    setNote(verdicts[item.id]?.note ?? "");
    setError(null);
    // 只在换名字时同步，存完备注不要被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const vote = useCallback(
    async (choice: Choice) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batch: batch.batch,
            id: item.id,
            verdict: choice.verdict,
            ...(choice.grade ? { grade: choice.grade } : {}),
            note,
          }),
        });
        const out = (await res.json()) as { ok: boolean; record?: VerdictRecord; message?: string };
        if (!res.ok || !out.ok || !out.record) throw new Error(out.message || "没存上，再点一次");
        const next = { ...verdicts, [item.id]: out.record };
        setVerdicts(next);
        const target = nextOpen(items, next, index);
        if (target >= 0) setIndex(target);
      } catch (e) {
        setError(e instanceof Error ? e.message : "没存上，再点一次");
      } finally {
        setSaving(false);
      }
    },
    [saving, batch.batch, item.id, note, verdicts, items, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const hit = CHOICES.find((k) => k.key === e.key);
      if (hit) {
        e.preventDefault();
        void vote(hit);
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(items.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vote, items.length]);

  const compare = useMemo(() => {
    const reviewed = items.filter((i) => verdicts[i.id]);
    const differ = reviewed.filter((i) => AS_VERDICT[i.suggestion] !== verdicts[i.id]!.verdict);
    return { reviewed: reviewed.length, same: reviewed.length - differ.length, differ };
  }, [items, verdicts]);

  return (
    <main data-testid="review-page">
      <p className="text-xs font-medium tracking-[0.22em] text-gold">名字评审</p>
      <h1 className="mt-2 text-2xl font-bold tracking-[0.1em] text-paper sm:text-3xl">{batch.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-body-text">{batch.note}</p>
      <p className="mt-3 text-sm leading-relaxed text-body-text">
        你只回答一个问题：<b className="text-paper">如果是你的孩子，你愿意用这个名字吗？</b>
        按 1 很好、2 可以、3 一般、4 不要、5 拿不准，← → 翻页。「很好」「可以」的才进直播名字库。下面的原因只是参考，你的直觉就是观众的直觉。
        「直播怎么讲」是主播要念的稿子，念一遍，别扭的地方写在备注里。
      </p>

      {batchNames.length > 1 ? (
        <nav className="mt-4 flex flex-wrap gap-2 text-xs">
          {batchNames.map((n) => (
            <Link
              key={n}
              href={`/review?batch=${n}`}
              className={`border px-2.5 py-1 tracking-wider ${n === batch.batch ? "border-gold text-gold" : "border-outline-variant/60 text-outline"}`}
            >
              {n}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mt-5 flex items-center gap-3 text-sm text-outline">
        <div className="h-1.5 flex-1 overflow-hidden bg-surface-low">
          <div className="h-full bg-gold transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        <span data-testid="review-progress">
          已评 {done} / {items.length}
        </span>
      </div>

      <section className="mt-6 border border-outline-variant/60 bg-surface/70 p-5 shadow-card sm:p-7" data-testid="review-card">
        <div className="flex flex-wrap items-center gap-2 text-xs tracking-wider text-outline">
          <span>
            第 {index + 1} / {items.length} 个
          </span>
          <span className="border border-outline-variant/60 px-1.5 py-0.5">{GENDER_LABEL[item.gender]}</span>
          <span className="border border-outline-variant/60 px-1.5 py-0.5">{item.origin}</span>
          {mine ? <span className={`border px-1.5 py-0.5 ${tone(mine.verdict)}`}>你选了：{labelOf(mine)}</span> : null}
        </div>

        <div className="mt-5 text-center">
          <p className="text-5xl font-semibold tracking-[0.35em] text-paper sm:text-6xl" data-testid="review-name">
            {item.givenName}
          </p>
          <p className="mt-3 text-base tracking-[0.2em] text-outline">{item.pinyin}</p>
        </div>

        <div className="mt-6 border-l-2 border-gold/60 pl-4">
          {item.citation ? (
            <>
              <p className="text-lg leading-relaxed text-paper">「{item.citation.line}」</p>
              <p className="mt-1 text-sm text-outline">
                {item.citation.from}
                {item.order === "reversed" ? " · 两个字在原句里是倒着取的" : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-outline">没有出处</p>
          )}
          {item.talk ? null : <p className="mt-3 text-base leading-relaxed text-body-text">{item.meaning}</p>}
        </div>

        {item.talk ? (
          <div className="mt-6" data-testid="review-talk">
            <p className="text-xs tracking-widest text-gold">直播怎么讲</p>
            <p className="mt-2 text-sm text-outline">
              观众屏幕上只有一句：<span className="text-base text-paper">{item.talk.one}</span>
            </p>
            <p className="mt-3 text-sm text-outline">主播照着念（以{TALK_SURNAME}姓为例）：</p>
            <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-base leading-relaxed text-body-text">
              {talkLines(TALK_SURNAME, item.givenName, item.talk, item.citation).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            {item.talk.tip ? <p className="mt-3 text-sm leading-relaxed text-outline">只给主播看：{item.talk.tip}</p> : null}
          </div>
        ) : null}

        <div className="mt-6">
          <p className="text-sm text-outline">
            我的建议：
            <span className={`ml-1 border px-2 py-0.5 text-sm font-semibold ${tone(item.suggestion)}`}>{item.suggestion}</span>
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs tracking-widest text-gold">好在哪</p>
              <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-body-text">
                {item.pros.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs tracking-widest text-cinnabar">问题在哪</p>
              <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-body-text">
                {item.cons.map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <details className="mt-5 text-sm text-body-text">
          <summary className="cursor-pointer text-outline">配上姓看看（规则打分）</summary>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            规则只查谐音、忌字、热门字、年代字、笔画这类硬伤，查不出土不土、怪不怪，所以分数高不代表名字好。
          </p>
          <ul className="mt-2 space-y-2">
            {item.samples.map((s) => (
              <li key={s.fullName}>
                <span className="text-paper">{s.fullName}</span>
                <span className="ml-2 text-outline">{s.pinyin}</span>
                <span className="ml-2">{s.score} 分</span>
                {s.deductions.length ? (
                  <ul className="mt-0.5 pl-3 text-xs text-outline">
                    {s.deductions.map((d) => (
                      <li key={d.line}>
                        −{d.points} {d.line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </details>

        <textarea
          className="field-input mt-5 min-h-[3.2rem] resize-y text-sm"
          placeholder="想补一句理由可以写在这里（可不填，比如「太老气」「读着拗口」）"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={saving}
              onClick={() => void vote(c)}
              data-testid={`review-${c.key}`}
              className={`min-h-12 border text-base tracking-widest transition disabled:opacity-50 ${
                isChosen(mine, c)
                  ? `${tone(c.verdict)} bg-gold-soft font-semibold`
                  : "border-outline-variant text-body-text hover:border-gold hover:text-gold"
              }`}
            >
              {c.label}
              <span className="ml-1.5 text-xs text-faint">{c.key}</span>
            </button>
          ))}
        </div>
        {error ? <p className="mt-3 text-sm text-cinnabar">{error}</p> : null}

        <div className="mt-4 flex justify-between text-sm">
          <button type="button" className="btn-ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            ← 上一个
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={index === items.length - 1}
            onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
          >
            下一个 →
          </button>
        </div>
      </section>

      <section className="mt-8">
        <p className="text-xs tracking-widest text-outline">全部名字（点一下跳过去；框的颜色是你选的）</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {items.map((it, i) => {
            const v = verdicts[it.id];
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`min-h-9 border px-2.5 text-sm tracking-wider ${
                    v ? tone(v.verdict) : "border-outline-variant/50 text-faint"
                  } ${i === index ? "bg-gold-soft" : ""}`}
                >
                  {it.givenName}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {compare.reviewed > 0 ? (
        <section className="mt-8" data-testid="review-compare">
          <div className="ink-divider mb-5" />
          <p className="text-base text-paper">
            已评 {compare.reviewed} 个，和我的建议一致 {compare.same} 个，不一致 {compare.differ.length} 个。
          </p>
          {compare.differ.length ? (
            <ul className="mt-3 space-y-1.5 text-sm text-body-text">
              {compare.differ.map((it) => (
                <li key={it.id}>
                  <button type="button" className="text-paper underline-offset-4 hover:underline" onClick={() => setIndex(items.indexOf(it))}>
                    {it.givenName}
                  </button>
                  ：我建议「{it.suggestion}」，你选「{labelOf(verdicts[it.id]!)}」
                  {verdicts[it.id]!.note ? `（${verdicts[it.id]!.note}）` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
