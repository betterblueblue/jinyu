import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { getReport } from "@/store/report-store";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  return (
    <AppShell authed>
      <article data-testid="report-page">
        <p className="reveal text-xs font-medium tracking-[0.22em] text-gold">正式命名报告</p>
        <h1 className="reveal mt-2 text-3xl font-bold tracking-[0.12em] text-paper sm:text-4xl">
          命名结果
        </h1>
        <p className="mt-2 text-sm tracking-wide text-outline">
          {new Date(report.createdAt).toLocaleString("zh-CN")} · {report.request.surname} ·{" "}
          {genderLabel(report.request.gender)}
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <a
            href={`/api/reports/${report.id}/summary`}
            className="btn-gold"
            data-testid="download-summary"
          >
            下载精选摘要图
          </a>
          <Link href="/history" className="btn-ghost">
            历史列表
          </Link>
          <Link href="/name" className="btn-ghost">
            再取一次
          </Link>
        </div>
        <div className="ink-divider my-8" />

        <section data-testid="report-overview">
          <h2 className="text-xs font-medium tracking-[0.22em] text-outline">总览</h2>
          <div className="mt-4">
            <p
              className="name-hero text-[clamp(3.5rem,11vw,7.5rem)] font-black leading-none tracking-[0.16em] text-gold"
              data-testid="primary-name"
              style={{ textIndent: "0.16em" }}
            >
              {report.overview.primaryName}
            </p>
            <p className="mt-4 border-l-2 border-gold pl-3 text-sm font-semibold tracking-[0.24em] text-gold">
              首推
            </p>
          </div>
          <p className="mt-5 max-w-[38ch] text-lg leading-relaxed text-paper-dim">
            {report.overview.oneLiner}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {report.overview.names.map((n) => {
              const isPrimary = n === report.overview.primaryName;
              return (
                <span
                  key={n}
                  className={
                    isPrimary
                      ? "inline-flex min-h-10 items-center border border-gold/70 bg-gold/10 px-3.5 py-1.5 text-base tracking-wider text-gold shadow-[inset_3px_0_0_0_#C9A227]"
                      : "inline-flex min-h-10 items-center border border-outline-variant bg-surface/60 px-3.5 py-1.5 text-base tracking-wider text-paper-dim"
                  }
                >
                  {n}
                  {isPrimary ? " · 首推" : ""}
                </span>
              );
            })}
          </div>

          {report.request.gender === "unknown" ? (
            <div className="mt-5 border-l-2 border-outline-variant pl-4 text-sm text-outline">
              <p>男向：{(report.overview.maleNames ?? []).join("、") || "—"}</p>
              <p className="mt-1">女向：{(report.overview.femaleNames ?? []).join("、") || "—"}</p>
              <p className="mt-2">性别未知：出生后可按实际性别从对应分组收窄。</p>
            </div>
          ) : null}
          {report.preparationNote ? (
            <p className="mt-4 text-sm text-gold">{report.preparationNote}</p>
          ) : null}
          {report.relaxations.length ? (
            <p className="mt-3 text-sm text-outline">已放宽：{report.relaxations.join("、")}</p>
          ) : null}
        </section>

        <div className="ink-divider my-10" />

        <section data-testid="report-names">
          <h2 className="text-xs font-medium tracking-[0.22em] text-outline">逐名详解</h2>
          <div className="mt-6 space-y-8">
            {report.names.map((n) => (
              <div
                key={n.fullName}
                className={
                  n.isPrimary
                    ? "border-l-[3px] border-gold bg-gradient-to-r from-gold/[0.07] to-transparent pl-4"
                    : "border-l-2 border-outline-variant/60 pl-4"
                }
              >
                <h3 className="text-2xl font-semibold tracking-[0.2em] text-paper">
                  {n.fullName}
                  {n.isPrimary ? (
                    <span className="ml-2 text-sm font-medium tracking-normal text-gold">
                      首推
                    </span>
                  ) : null}
                  {n.l2Hot ? (
                    <span className="ml-2 text-sm tracking-normal text-outline">偏热门</span>
                  ) : null}
                </h3>
                <dl className="mt-4 grid gap-3 text-sm leading-relaxed">
                  <Item term="音韵" def={n.phonology} />
                  <Item term="字形" def={n.glyph} />
                  <Item term="寓意" def={n.meaning} />
                  <Item term="出处" def={n.origin} />
                  <Item term="避坑" def={n.pitfalls} />
                  <Item term="风格" def={n.styleFit} />
                  {report.bazi && n.baziFit ? <Item term="八字契合" def={n.baziFit} /> : null}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-outline">{report.originDisclaimer}</p>
        </section>

        <div className="ink-divider my-10" />

        <section data-testid="report-not-recommended">
          <h2 className="text-xs font-medium tracking-[0.22em] text-outline">不推荐说明</h2>
          <ul className="mt-4 space-y-3">
            {report.notRecommended.map((e, i) => (
              <li
                key={`${e.givenName}-${i}`}
                className="border-l-2 border-outline-variant/50 pl-3 text-sm leading-relaxed text-on-surface-variant"
              >
                <span className="font-semibold tracking-wide text-gold line-through decoration-gold/60">{e.givenName}</span>
                <span className="text-outline"> — {e.reasons.join("；")}</span>
              </li>
            ))}
          </ul>
        </section>

        {report.bazi ? (
          <>
            <div className="ink-divider my-10" />
            <section data-testid="report-bazi">
              <h2 className="text-xs font-medium tracking-[0.22em] text-outline">命理摘要（可选）</h2>
              <p className="mt-4 text-lg tracking-widest text-gold">{report.bazi.pillarsText}</p>
              <p className="mt-2 text-xs text-outline">
                精度：{report.bazi.precision === "six_limited" ? "六字 · 精度有限" : "八字示意"}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-on-surface-variant">
                {report.bazi.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-outline">{report.bazi.restrainedAdvice}</p>
            </section>
          </>
        ) : null}

        <div className="ink-divider my-10" />

        <section data-testid="report-decision">
          <h2 className="text-xs font-medium tracking-[0.22em] text-outline">决策建议</h2>
          <p className="mt-4 max-w-[42ch] whitespace-pre-line text-base leading-8 text-on-surface-variant">
            {report.decisionAdvice}
          </p>
        </section>
      </article>
    </AppShell>
  );
}

function Item({ term, def }: { term: string; def: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[3.5rem_1fr] sm:gap-3 sm:items-baseline">
      <dt className="text-xs tracking-[0.14em] text-outline">{term}</dt>
      <dd className="text-on-surface-variant">{def}</dd>
    </div>
  );
}

function genderLabel(g: string): string {
  if (g === "male") return "男";
  if (g === "female") return "女";
  return "未知";
}
