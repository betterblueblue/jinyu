import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";

export default async function AboutPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  return (
    <AppShell authed>
      <article className="max-w-2xl">
        <p className="reveal text-xs font-medium tracking-[0.22em] text-gold">理念</p>
        <h1 className="reveal mt-2 text-3xl font-bold tracking-[0.14em] text-paper sm:text-4xl">
          命名理念
        </h1>
        <div className="ink-divider my-7" />
        <p className="reveal max-w-[28ch] text-lg leading-relaxed tracking-wide text-gold sm:text-xl">
          名字，是相伴一生的称呼。
        </p>
        <div className="mt-6 max-w-[42ch] space-y-4 text-base leading-8 text-on-surface-variant">
          <p>
            瑾瑜希望这封信具体、好念、好写、经得起家人传阅——而不是聊天式三行推荐，也不是假大空报告。
          </p>
          <p>
            使用很简单：填写与取名有关的信息，一次生成正式报告。全文可在本页与历史中回看；需要分享时，可下载精选摘要图。
          </p>
          <p>
            八字与五行为可选项，默认关闭，表述克制。系统会留意过于同质的流行取名，并尊重你填写的辈分与避讳。
          </p>
          <p>
            本产品为固定单账号：无开放注册、无多轮精修主路径。气质与文案延续瑾瑜文化表达，运行时独立。
          </p>
        </div>
      </article>
    </AppShell>
  );
}
