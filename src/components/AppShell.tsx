"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppShell({
  children,
  authed,
}: {
  children: React.ReactNode;
  authed?: boolean;
}) {
  const pathname = usePathname() || "";

  function navClass(href: string) {
    const active =
      pathname === href || (href !== "/name" && pathname.startsWith(href));
    return [
      "relative min-h-10 px-3 text-sm tracking-widest transition",
      active ? "font-semibold text-primary" : "text-outline hover:text-primary",
    ].join(" ");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-outline-variant/40 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href={authed ? "/name" : "/login"}
            className="text-[1.05rem] font-semibold tracking-[0.36em] text-primary"
          >
            瑾瑜
          </Link>
          {authed ? (
            <nav className="flex flex-wrap items-center justify-end gap-0.5" aria-label="主导航">
              <Link href="/name" className={navClass("/name")} aria-current={pathname.startsWith("/name") || pathname.startsWith("/reports") ? "page" : undefined}>
                取名
                {(pathname.startsWith("/name") || pathname.startsWith("/reports")) && (
                  <span className="absolute bottom-1 left-3 right-3 h-px bg-secondary" aria-hidden />
                )}
              </Link>
              <Link href="/history" className={navClass("/history")} aria-current={pathname.startsWith("/history") ? "page" : undefined}>
                历史
                {pathname.startsWith("/history") && (
                  <span className="absolute bottom-1 left-3 right-3 h-px bg-secondary" aria-hidden />
                )}
              </Link>
              <Link href="/about" className={navClass("/about")} aria-current={pathname.startsWith("/about") ? "page" : undefined}>
                理念
                {pathname.startsWith("/about") && (
                  <span className="absolute bottom-1 left-3 right-3 h-px bg-secondary" aria-hidden />
                )}
              </Link>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="min-h-10 px-3 text-sm tracking-widest text-outline transition hover:text-primary">
                  登出
                </button>
              </form>
            </nav>
          ) : null}
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-8 sm:pt-10">{children}</div>
    </div>
  );
}
