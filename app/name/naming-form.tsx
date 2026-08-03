"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { NamingFormInput } from "@/domain/types";

const STAGES = ["斟酌名字", "核对约束", "整理成文"] as const;

export function NamingForm() {
  const router = useRouter();
  const [surname, setSurname] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unknown">("unknown");
  const [birthStatus, setBirthStatus] = useState<"born" | "unborn" | "uncertain">("uncertain");
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);

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
      // 产品默认：端庄耐看；表单不再暴露风格选择
      stylePrototypeId: "default_dignified",
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
      avoidPopular,
    ],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    setStageIdx(0);

    const timers = [
      window.setTimeout(() => setStageIdx(1), 400),
      window.setTimeout(() => setStageIdx(2), 900),
    ];

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        reportId?: string;
      };
      if (!res.ok || !data.ok || !data.reportId) {
        setError(data.message || "生成失败，请检查表单后重试");
        return;
      }
      router.push(`/reports/${data.reportId}`);
      router.refresh();
    } catch {
      setError("网络异常或超时，请重试");
    } finally {
      timers.forEach(clearTimeout);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="naming-form">
      <section className="mt-0">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-primary">宝宝信息 · 必填</h2>
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
              <option value="uncertain">不确定</option>
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

      <section className="mt-8 border-l-2 border-outline-variant pl-4">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-primary">命理 · 可选</h2>
        <p className="mb-3 mt-1 text-sm text-outline">默认关闭。未出生时不可开精确八字。</p>
        <label className="flex items-start gap-2 text-sm text-on-surface-variant">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
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

      <section className="mt-8 border-l-2 border-outline-variant pl-4">
        <h2 className="text-sm font-semibold tracking-[0.16em] text-primary">家族与禁忌 · 可选</h2>
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
            className="mt-1 accent-primary"
            checked={avoidPopular}
            onChange={(e) => setAvoidPopular(e.target.checked)}
            data-testid="avoid-popular"
          />
          <span>尽量避开过于常见的流行取名</span>
        </label>
      </section>

      {loading ? (
        <div
          className="mt-8 border border-outline-variant/50 bg-surface px-5 py-6 text-center"
          data-testid="generating"
        >
          <p className="text-base font-semibold tracking-[0.18em] text-primary">正在落笔</p>
          <p className="mt-2 text-sm text-outline">请稍候。正在为你斟酌名字、核对约束并整理报告。</p>
          <ul className="mx-auto mt-6 max-w-[14rem] space-y-3 text-left text-sm">
            {STAGES.map((s, i) => (
              <li
                key={s}
                className={
                  i < stageIdx
                    ? "text-secondary"
                    : i === stageIdx
                      ? "font-semibold text-primary"
                      : "text-outline/50"
                }
              >
                <span className="mr-2 inline-block h-2 w-2 rounded-full border border-current align-middle" />
                {s}
              </li>
            ))}
          </ul>
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
