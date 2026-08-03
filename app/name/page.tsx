import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { NamingForm } from "./naming-form";

export default async function NamePage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  return (
    <AppShell authed>
      <main>
        <p className="text-xs font-medium tracking-[0.22em] text-outline">取名</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[0.14em] text-primary sm:text-4xl">
          为宝宝取名
        </h1>
        <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-outline">
          写下姓氏与心意，生成一份可细读、可回看的正式命名报告。
        </p>
        <div className="ink-divider my-7" />
        <NamingForm />
      </main>
    </AppShell>
  );
}
