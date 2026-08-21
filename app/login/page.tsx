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
        <LoginForm />
      </main>
    </AppShell>
  );
}
