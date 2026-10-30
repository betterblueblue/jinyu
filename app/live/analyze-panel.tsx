"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult } from "@/domain/analysis/types";
import { splitFullName } from "@/domain/analysis/split-name";
import "./analyze.css";

/**
 * 名字分析面板。
 *
 * 三层：输入 → 分析中 → 结论。结论页只做一件事：把名字的实际情况说清楚，
 * 底下一个按钮把人送去取名。诊断不负责结案，负责让人看清现状。
 */

type Gender = "male" | "female" | "unknown";
type Phase = "input" | "analyzing" | "done";

interface Props {
  open: boolean;
  onClose: () => void;
  onRegenerate: (payload: {
    surname: string;
    gender: Gender;
    tabooChars: string[];
    styleNotes: string;
    avoidPopular: boolean;
  }) => void;
}

const STAGE_LABEL: Record<string, string> = {
  reading: "正在读这个名字",
  verifying: "正在核对出处",
};

export function AnalyzePanel({ open, onClose, onRegenerate }: Props) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [birthDate, setBirthDate] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [thinking, setThinking] = useState<string[]>([]);
  const [stageLabel, setStageLabel] = useState("正在读这个名字");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surnameOverride, setSurnameOverride] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);

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

  useEffect(() => {
    if (!open) return;
    setPhase("input");
    setThinking([]);
    setResult(null);
    setError(null);
    setProgress(0);
    setSurnameOverride(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (phase === "done") scrollRef.current?.scrollTo({ top: 0 });
  }, [phase]);

  const submit = useCallback(async () => {
    const trimmed = name.replace(/\s/g, "");
    if (busy.current || trimmed.length < 2) return;
    busy.current = true;
    setPhase("analyzing");
    setThinking([]);
    setProgress(0);
    setError(null);
    setResult(null);
    setStageLabel(STAGE_LABEL.reading!);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: trimmed,
          gender,
          birthDate: birthDate || undefined,
          splitSurname: splitPreview?.surname ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const msg = (await res.json().catch(() => ({ message: "分析失败" }))) as { message?: string };
        throw new Error(msg.message ?? "分析失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let done: AnalysisResult | null = null;

      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let evt = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) evt = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (evt === "thinking") {
            acc += String(payload.text ?? "");
            const zh = acc
              .split(/[。！？\n]+/)
              .map((s) => s.trim())
              .filter((s) => s.length > 3 && /[\u4e00-\u9fa5]/.test(s));
            setThinking(zh.slice(-5));
            setProgress((p) => Math.min(88, p + 1.2));
          } else if (evt === "stage") {
            const label = STAGE_LABEL[String(payload.stage)];
            if (label) setStageLabel(label);
            setProgress((p) => Math.max(p, String(payload.stage) === "verifying" ? 92 : 40));
          } else if (evt === "error") {
            throw new Error(String(payload.message ?? "分析失败"));
          } else if (evt === "done") {
            const r = payload.result as AnalysisResult | undefined;
            if (r) done = r;
          }
        }
      }

      if (!done) throw new Error("没有拿到分析结果");
      setResult(done);
      setProgress(100);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
      setPhase("input");
    } finally {
      busy.current = false;
    }
  }, [name, gender, birthDate, splitPreview]);

  if (!open) return null;

  const trimmed = name.replace(/\s/g, "");
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 4;

  return (
    <section className="ap" role="dialog" aria-label="名字分析">
      <header className="ap-top">
        <div className="ap-title">
          <span className="ap-seal">析</span>
          <span className="ap-name">名字分析</span>
          <span className="ap-sub">看看名字的读音、字义和使用体验</span>
        </div>
        <button type="button" className="ap-close" onClick={onClose} aria-label="关闭">
          关闭
        </button>
      </header>

      {phase === "input" && (
        <div className="ap-body ap-input">
          <label className="ap-label">姓名</label>
          <input
            ref={inputRef}
            className="ap-name-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSurnameOverride(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="完整姓名"
            maxLength={4}
            autoComplete="off"
            aria-label="姓名"
          />

          {splitPreview && (
            <div className="ap-split">
              <span>
                姓 <b>{splitPreview.surname}</b> · 名 <b>{splitPreview.givenName}</b>
              </span>
              {splitPreview.alternatives.length > 0 && (
                <div className="ap-split-alt">
                  <span>拆法不对？</span>
                  {splitPreview.alternatives.map((a) => (
                    <button
                      key={a.surname}
                      type="button"
                      onClick={() => setSurnameOverride(a.surname)}
                    >
                      {a.surname} / {a.givenName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="ap-label">性别</label>
          <div className="ap-genders">
            {(["male", "female", "unknown"] as Gender[]).map((g) => (
              <button
                key={g}
                type="button"
                className={gender === g ? "on" : ""}
                onClick={() => setGender(g)}
              >
                {g === "male" ? "男" : g === "female" ? "女" : "不填"}
              </button>
            ))}
          </div>

          <label className="ap-label">
            生日 <em>可选，填了才看生辰</em>
          </label>
          <input
            type="date"
            className="ap-date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            aria-label="生日"
          />

          {error && <p className="ap-error">{error}</p>}

          <button
            type="button"
            className={`ap-go ${canSubmit ? "" : "is-empty"}`}
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            <span className="ap-go-main">开始分析</span>
            <span className="ap-go-hint">
              {canSubmit ? `看「${trimmed}」有哪些地方值得动 · 回车` : "先填完整姓名"}
            </span>
          </button>
        </div>
      )}

      {phase === "analyzing" && (
        <div className="ap-body ap-analyzing">
          <p className="ap-stage">{stageLabel}</p>
          <div className="ap-bar">
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="ap-think">
            {thinking.length === 0 ? (
              <p>正在读这个名字的读音、字形和意思……</p>
            ) : (
              thinking.map((line, i) => <p key={i}>{line}</p>)
            )}
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <>
          <div className="ap-body ap-result" ref={scrollRef}>
            <p className={`ap-headline v-${result.verdict}`}>{result.headline}</p>

            {result.goodPoints.length > 0 && (
              <section className="ap-block">
                <h4>站得住的地方</h4>
                <ul className="ap-good">
                  {result.goodPoints.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </section>
            )}

            {result.issues.length > 0 && (
              <section className="ap-block">
                <h4>值得看看的地方</h4>
                {result.issues.map((issue, i) => (
                  <div key={i} className={`ap-issue ${issue.severity}`}>
                    <p className="ap-issue-text">{issue.text}</p>
                    {issue.hint && <p className="ap-issue-hint">{issue.hint}</p>}
                  </div>
                ))}
              </section>
            )}

            {result.fitAngle && (
              <section className="ap-block">
                <h4>还能往哪走一步</h4>
                <p className="ap-fit">{result.fitAngle}</p>
              </section>
            )}

            {result.citations.length > 0 && (
              <section className="ap-block">
                <h4>出处</h4>
                {result.citations.map((c, i) => (
                  <div key={i} className="ap-cite">
                    <p className="ap-cite-quote">「{c.quote}」</p>
                    <p className="ap-cite-src">
                      {c.source} · {c.piece}
                    </p>
                    <p className="ap-cite-line">{c.line}</p>
                    {c.gloss && <p className="ap-cite-gloss">{c.gloss}</p>}
                  </div>
                ))}
              </section>
            )}

            <p className="ap-closing">{result.closing}</p>
          </div>

          <footer className="ap-foot">
            <button
              type="button"
              className="ap-go"
              onClick={() =>
                onRegenerate({
                  surname: result.split.surname,
                  gender: result.input.gender,
                  tabooChars: result.regenBrief.tabooChars,
                  styleNotes: result.regenBrief.styleNotes,
                  avoidPopular: result.regenBrief.avoidPopular,
                })
              }
            >
              <span className="ap-go-main">试试取新名字</span>
              <span className="ap-go-hint">想看看其他选择？姓氏「{result.split.surname}」已经带过去</span>
            </button>
            <button
              type="button"
              className="ap-again"
              onClick={() => {
                setPhase("input");
                setResult(null);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
            >
              分析另一个名字
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
