import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { listReports } from "@/store/report-store";

export default async function HistoryPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  const items = await listReports();

  return (
    <AppShell authed>
      <main data-testid="history-page">
        <p className="reveal text-xs font-medium tracking-[0.22em] text-gold">历史</p>
        <h1 className="reveal mt-2 text-3xl font-bold tracking-[0.14em] text-paper sm:text-4xl">
          历史快照
        </h1>
        <p className="reveal mt-3 text-base text-outline">
          {items.length
            ? `共 ${items.length} 份快照 · 打开为生成时的全文，不重新跑模型。`
            : "打开为生成时的全文快照，不重新跑模型。"}
        </p>
        <div className="ink-divider my-7" />
        {items.length === 0 ? (
          <div className="py-8">
            <p className="max-w-[28ch] text-base leading-relaxed text-outline">
              还没有命名报告。填完姓氏与性别，一次即可生成可回看的正式报告。
            </p>
            <Link href="/name" className="btn-primary mt-5 inline-flex">
              开始取名
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant/40">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/reports/${item.id}`}
                  className="flex items-center justify-between gap-4 py-4 transition hover:bg-gold/[0.04]"
                >
                  <div>
                    <div className="text-xs tracking-wide text-outline">
                      {new Date(item.createdAt).toLocaleString("zh-CN")} · {item.surname} ·{" "}
                      {item.gender === "male" ? "男" : item.gender === "female" ? "女" : "未知"}
                    </div>
                    <div className="mt-1 text-lg tracking-wider text-paper">{item.nameSummary}</div>
                  </div>
                  <span className="shrink-0 border border-gold/50 px-3 py-1.5 text-xs tracking-widest text-gold">
                    打开
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
