"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, setTheme, type Theme } from "@/lib/theme";

export function AppShell({
  children,
  authed,
}: {
  children: React.ReactNode;
  authed?: boolean;
}) {
  const pathname = usePathname() || "";
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    applyTheme(getStoredTheme());
    setThemeState(getStoredTheme());
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  function navClass(href: string) {
    const active =
      pathname === href || (href !== "/name" && pathname.startsWith(href));
    return [
      "relative min-h-10 px-3 text-sm tracking-widest transition",
      active ? "font-semibold text-paper" : "text-outline hover:text-gold",
    ].join(" ");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-outline-variant/50 bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href={authed ? "/name" : "/login"}
            className="text-[1.05rem] font-semibold tracking-[0.36em] text-paper"
          >
            瑾瑜
          </Link>
          <div className="flex items-center gap-1">
            {authed ? (
              <nav className="flex flex-wrap items-center justify-end gap-0.5" aria-label="主导航">
                <Link href="/name" className={navClass("/name")} aria-current={pathname.startsWith("/name") || pathname.startsWith("/reports") ? "page" : undefined}>
                  取名
                  {(pathname.startsWith("/name") || pathname.startsWith("/reports")) && (
                    <span className="absolute bottom-1 left-3 right-3 h-px bg-gold" aria-hidden />
                  )}
                </Link>
                <Link href="/history" className={navClass("/history")} aria-current={pathname.startsWith("/history") ? "page" : undefined}>
                  历史
                  {pathname.startsWith("/history") && (
                    <span className="absolute bottom-1 left-3 right-3 h-px bg-gold" aria-hidden />
                  )}
                </Link>
                <Link href="/about" className={navClass("/about")} aria-current={pathname.startsWith("/about") ? "page" : undefined}>
                  理念
                  {pathname.startsWith("/about") && (
                    <span className="absolute bottom-1 left-3 right-3 h-px bg-gold" aria-hidden />
                  )}
                </Link>
                <form action="/api/auth/logout" method="post">
                  <button type="submit" className="min-h-10 px-3 text-sm tracking-widest text-outline transition hover:text-gold">
                    登出
                  </button>
                </form>
              </nav>
            ) : null}
            <button
              type="button"
              onClick={toggle}
              className="ml-2 flex min-h-9 w-9 items-center justify-center border text-base leading-none transition"
              style={{ borderColor: "var(--border-strong)", color: "var(--accent)" }}
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-8 sm:pt-10">{children}</div>
    </div>
  );
}
