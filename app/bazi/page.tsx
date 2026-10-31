import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { BaziClient } from "./bazi-client";

export default async function BaziPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  return (
    <AppShell authed>
      <main>
        <p className="reveal text-xs font-medium tracking-[0.22em] text-gold">八字</p>
        <h1 className="reveal mt-2 text-3xl font-bold tracking-[0.14em] text-paper sm:text-4xl">八字排盘与解读</h1>
        <p className="reveal mt-3 max-w-[38ch] text-base leading-relaxed text-outline">
          按出生地校正真太阳时排出四柱，再看五行强弱、喜忌和大运流年。
        </p>
        <div className="ink-divider my-7" />
        <BaziClient />
      </main>
    </AppShell>
  );
}
