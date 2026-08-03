"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message || "登录失败");
        return;
      }
      router.push("/name");
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="login-form">
      <label className="flex flex-col gap-2 text-xs tracking-[0.12em] text-outline">
        用户名
        <input
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="field-input"
          autoComplete="username"
          required
        />
      </label>
      <label className="flex flex-col gap-2 text-xs tracking-[0.12em] text-outline">
        密码
        <input
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field-input"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <p className="border border-cinnabar/40 bg-cinnabar/5 px-3 py-2 text-sm text-cinnabar" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={loading} className="btn-primary mt-1 w-full disabled:cursor-not-allowed">
        {loading ? "登录中…" : "进入"}
      </button>
      <p className="text-center text-xs tracking-wide text-outline">固定账号 · 不开放注册</p>
    </form>
  );
}
