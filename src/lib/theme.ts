"use client";

export type Theme = "light" | "dark";

const STORAGE_KEY = "jinyu-theme";

/** 读取当前主题（localStorage 优先，否则系统偏好） */
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 应用主题到 <html data-theme> 与 color-scheme */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
}

/** 设置并持久化主题 */
export function setTheme(theme: Theme): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }
  applyTheme(theme);
}

/** 切换主题，返回新主题 */
export function toggleTheme(): Theme {
  const next = getStoredTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
