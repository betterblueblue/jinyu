import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/name");
  }

  return (
    <AppShell>
      <main className="mx-auto mt-12 max-w-md sm:mt-20">
        <h1 className="reveal text-center text-5xl font-black tracking-[0.42em] text-gold sm:text-6xl [text-shadow:0_0_36px_rgba(201,162,39,0.35)]">
          瑾瑜
        </h1>
        <p className="mt-5 text-center text-sm leading-relaxed tracking-wide text-outline">
          一次生成正式命名报告
          <br />
          可细读 · 可回看 · 可分享
        </p>
        <div className="ink-divider my-8" />
        <LoginForm />
      </main>
    </AppShell>
  );
}
