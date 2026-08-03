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
      <main className="mx-auto mt-12 max-w-md sm:mt-16">
        <h1 className="text-center text-4xl font-semibold tracking-[0.42em] text-primary sm:text-5xl">
          瑾瑜
        </h1>
        <p className="mt-4 text-center text-sm leading-relaxed tracking-wide text-outline">
          一次生成正式命名报告
          <br />
          像一份可交付的说明书
        </p>
        <div className="ink-divider my-8" />
        <LoginForm />
      </main>
    </AppShell>
  );
}
