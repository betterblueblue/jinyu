"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NamingFormInput, StylePrototypeId } from "@/domain/types";
import { STYLE_PROTOTYPES } from "@/config/style-prototypes";

const STAGES = ["斟酌名字", "核对约束", "整理成文"] as const;

export function NamingForm() {
  const router = useRouter();
  const [surname, setSurname] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unknown">("unknown");
  const [birthStatus, setBirthStatus] = useState<"born" | "unborn">("born");
  const [dueDate, setDueDate] = useState("");
  const [nameLength, setNameLength] = useState<"two" | "one">("two");
  const [baziEnabled, setBaziEnabled] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [birthHour, setBirthHour] = useState("");
  const [generationChar, setGenerationChar] = useState("");
  const [generationPosition, setGenerationPosition] = useState<"first" | "second" | "any">(
    "first",
  );
  const [tabooChars, setTabooChars] = useState("");
  const [avoidPopular, setAvoidPopular] = useState(true);
  const [stylePrototypeId, setStylePrototypeId] = useState<StylePrototypeId>("default_dignified");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [thinking, setThinking] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const thinkingBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = thinkingBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thinking]);

  const baziBlockedByUnborn = birthStatus === "unborn";

  const payload: NamingFormInput = useMemo(
    () => ({
      surname,
      gender,
      birthStatus,
      dueDate: dueDate || undefined,
      nameLength,
      baziEnabled: baziBlockedByUnborn ? false : baziEnabled,
      birthDate: birthDate || undefined,
      birthHour: birthHour || undefined,
      generationChar: generationChar || undefined,
      generationPosition,
      tabooChars: tabooChars || undefined,
      stylePrototypeId,
      avoidPopular,
    }),
    [
      surname,
      gender,
      birthStatus,
      dueDate,
      nameLength,
      baziEnabled,
      baziBlockedByUnborn,
      birthDate,
      birthHour,
      generationChar,
      generationPosition,
      tabooChars,
      stylePrototypeId,
      avoidPopular,
    ],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    setStageIdx(0);
    setThinking("");
    setThinkingOpen(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 300_000);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // 流开启前的错误（400/401）仍是普通 JSON
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message || `生成失败（HTTP ${res.status}），请重试`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";
      let dataLines: string[] = [];
      let sawDoneOrError = false;

      const flushEvent = () => {
        if (!eventName) return;
        const raw = dataLines.join("\n");
        let data: Record<string, unknown> = {};
        try {
          data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          /* 忽略坏帧 */
        }
        if (eventName === "thinking" && typeof data.text === "string") {
          setThinking((prev) => prev + data.text);
        } else if (eventName === "stage") {
          if (data.stage === "filter") setStageIdx(1);
          else if (data.stage === "assemble") setStageIdx(2);
        } else if (eventName === "done" && typeof data.reportId === "string") {
          sawDoneOrError = true;
          router.push(`/reports/${data.reportId}`);
          router.refresh();
        } else if (eventName === "error") {
          sawDoneOrError = true;
          setError((data.message as string) || "生成失败，请稍后重试");
        }
        eventName = "";
        dataLines = [];
      };

      while (!sawDoneOrError) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          flushEvent();
          if (sawDoneOrError) break;
        }
      }
      // 处理流结束但无 \n\n 收尾的残留帧
      if (!sawDoneOrError && buffer.trim()) {
        for (const line of buffer.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        flushEvent();
      }

      if (!sawDoneOrError) {
        setError("生成中断，请重试");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("生成超时，请重试");
      } else {
        setError("网络异常，请重试");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="naming-form">
      <section className="mt-0 rounded-sm border border-outline-variant/50 bg-surface/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-paper">基本信息 · 必填</h2>
        <p className="mb-4 mt-1 text-sm text-outline">本区填妥后即可生成报告。</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="姓氏">
            <input
              required
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              className="field-input"
              name="surname"
              data-testid="surname"
            />
          </Field>
          <Field label="性别">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as typeof gender)}
              className="field-input"
              name="gender"
              data-testid="gender"
            >
              <option value="male">男</option>
              <option value="female">女</option>
              <option value="unknown">未知</option>
            </select>
          </Field>
          <Field label="名字字数">
            <select
              value={nameLength}
              onChange={(e) => setNameLength(e.target.value as typeof nameLength)}
              className="field-input"
              name="nameLength"
            >
              <option value="two">两个字的名</option>
              <option value="one">一个字的名</option>
            </select>
          </Field>
          <Field label="出生状态">
            <select
              value={birthStatus}
              onChange={(e) => setBirthStatus(e.target.value as typeof birthStatus)}
              className="field-input"
              name="birthStatus"
            >
              <option value="born">已出生</option>
              <option value="unborn">未出生</option>
            </select>
          </Field>
          {birthStatus === "unborn" ? (
            <Field label="预产期（可选）">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="field-input"
              />
            </Field>
          ) : null}
        </div>
      </section>

      <section className="mt-6 rounded-sm border border-outline-variant/50 bg-surface/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-paper">命理 · 可选</h2>
        <p className="mb-3 mt-1 text-sm text-outline">默认关闭。已出生且填生日即可排盘；未出生（预产期）场景不可开精确八字。</p>
        <label className="flex items-start gap-2 text-sm text-on-surface-variant">
          <input
            type="checkbox"
            className="mt-1 accent-gold"
            checked={baziEnabled && !baziBlockedByUnborn}
            disabled={baziBlockedByUnborn}
            onChange={(e) => setBaziEnabled(e.target.checked)}
            data-testid="bazi-enabled"
          />
          <span>开启八字 / 五行参考（表述克制，不作定论）</span>
        </label>
        {baziBlockedByUnborn ? (
          <p className="mt-2 text-xs text-outline">未出生时不能开启精确八字排盘。</p>
        ) : null}
        {baziEnabled && !baziBlockedByUnborn ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="公历生日（开启后请填写）">
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="field-input"
                data-testid="birth-date"
              />
            </Field>
            <Field label="时辰（0–23，可选）">
              <input
                type="number"
                min={0}
                max={23}
                value={birthHour}
                onChange={(e) => setBirthHour(e.target.value)}
                className="field-input"
                placeholder="不填则精度有限"
              />
            </Field>
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-sm border border-outline-variant/50 bg-surface/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-paper">命名风格 · 可选</h2>
        <p className="mb-4 mt-1 text-sm text-outline">
          选定名字的气质方向；不选则默认端庄耐看。
        </p>
        <Field label="风格">
          <select
            value={stylePrototypeId}
            onChange={(e) => setStylePrototypeId(e.target.value as StylePrototypeId)}
            className="field-input"
            name="stylePrototypeId"
            data-testid="style-prototype"
          >
            {STYLE_PROTOTYPES.filter((p) => p.id !== "default_dignified").map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.subtitle}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="mt-6 rounded-sm border border-outline-variant/50 bg-surface/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-paper">家族与禁忌 · 可选</h2>
        <p className="mb-4 mt-1 text-sm text-outline">
          避讳字不会进入推荐；辈分字会强制出现在每个推荐名中。
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="辈分字">
            <input
              value={generationChar}
              onChange={(e) => setGenerationChar(e.target.value)}
              className="field-input"
              maxLength={2}
              placeholder="可选"
              data-testid="generation-char"
            />
          </Field>
          <Field label="辈分位置">
            <select
              value={generationPosition}
              onChange={(e) => setGenerationPosition(e.target.value as typeof generationPosition)}
              className="field-input"
            >
              <option value="first">名第一字</option>
              <option value="second">名第二字</option>
              <option value="any">不限位置</option>
            </select>
          </Field>
          <Field label="避讳字（逗号分隔）" className="sm:col-span-2">
            <input
              value={tabooChars}
              onChange={(e) => setTabooChars(e.target.value)}
              className="field-input"
              placeholder="如：明,强"
              data-testid="taboo-chars"
            />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-on-surface-variant">
          <input
            type="checkbox"
            className="mt-1 accent-gold"
            checked={avoidPopular}
            onChange={(e) => setAvoidPopular(e.target.checked)}
            data-testid="avoid-popular"
          />
          <span>尽量避开过于常见的流行取名</span>
        </label>
      </section>

      {loading ? (
        <div
          className="mt-8 rounded-sm border border-outline-variant/50 bg-surface/40 px-5 py-6 text-center"
          data-testid="generating"
        >
          <p className="text-base font-semibold tracking-[0.18em] text-gold">正在落笔</p>
          <p className="mt-2 text-sm text-outline">
            首次生成可能要等一会儿（几十秒到 2 分钟），请勿关闭页面。思考过程实时更新中。
          </p>
          <ul className="mx-auto mt-6 max-w-[14rem] space-y-3 text-left text-sm">
            {STAGES.map((s, i) => (
              <li
                key={s}
                className={`ink-drop ${
                  i < stageIdx
                    ? "text-gold"
                    : i === stageIdx
                      ? "font-semibold text-paper"
                      : "text-outline/50"
                }`}
                style={{ animationDelay: `${i * 0.12}s` }}
              >
                <span className="mr-2 inline-block h-2 w-2 rounded-full border border-current align-middle" />
                {s}
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-sm border border-outline-variant/50 bg-surface/40 text-left">
            <button
              type="button"
              onClick={() => setThinkingOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-2 text-sm text-outline hover:text-paper"
            >
              <span>思考过程（实时）</span>
              <span>{thinkingOpen ? "收起" : "展开"}</span>
            </button>
            {thinkingOpen ? (
              <div
                ref={thinkingBoxRef}
                className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-outline-variant/30 px-4 py-3 text-xs leading-relaxed text-outline"
              >
                {thinking || "正在思考…"}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 border border-cinnabar/40 bg-cinnabar/5 px-3 py-2 text-sm text-cinnabar" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 mt-8 bg-gradient-to-t from-bg via-bg to-transparent pb-1 pt-4">
        <button
          type="submit"
          disabled={loading}
          data-testid="submit-generate"
          className="btn-primary w-full disabled:cursor-not-allowed"
        >
          {loading ? "生成中，请勿重复提交…" : "一次生成正式报告"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-2 text-xs tracking-[0.12em] text-outline ${className}`}>
      {label}
      {children}
    </label>
  );
}
