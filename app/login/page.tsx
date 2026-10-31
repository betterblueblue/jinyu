import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { LoginForm } from "./login-form";

/** 登录后回到哪：只认站内的简单路径（提词页用 /login?next=/live/prompter），别的一律回 /name */
function safeNext(raw: string | undefined): string {
  return raw && /^\/(?![/\\])[A-Za-z0-9/_-]*$/.test(raw) ? raw : "/name";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await isAuthenticated()) {
    redirect(next);
  }

  return (
    <AppShell>
      <main className="mx-auto mt-12 max-w-md sm:mt-20">
        <h1 className="reveal text-center text-5xl font-black tracking-[0.42em] text-gold sm:text-6xl [text-shadow:0_0_36px_var(--accent-soft)]">
          瑾瑜
        </h1>
        <p className="mt-6 text-center text-lg leading-relaxed tracking-[0.2em] text-paper">
          一个名字，一生的祝福
        </p>
        <p className="mt-3 text-center text-xs leading-relaxed tracking-[0.14em] text-outline">
          可细读 · 可回看 · 可分享
        </p>
        <div className="ink-divider my-8" />
        <LoginForm next={next} />
      </main>
    </AppShell>
  );
}
