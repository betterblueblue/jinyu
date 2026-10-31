import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { listBatches, loadBatch, loadVerdicts } from "@/library/review-store";
import { ReviewClient } from "./review-client";

export const metadata = { title: "瑾瑜 · 名字评审" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  const { batch: wanted } = await searchParams;
  const names = await listBatches();
  // 没指定批次时打开第一批还没评完的；都评完了就打开最后一批
  let name = wanted && names.includes(wanted) ? wanted : undefined;
  if (!name) {
    for (const n of names) {
      const b = await loadBatch(n);
      const v = await loadVerdicts(n);
      if (b && b.items.some((i) => !v[i.id])) {
        name = n;
        break;
      }
    }
    name ??= names[names.length - 1];
  }

  const batch = name ? await loadBatch(name) : null;
  if (!batch) {
    return (
      <AppShell authed>
        <main>
          <p className="text-xs font-medium tracking-[0.22em] text-gold">名字评审</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[0.14em] text-paper">还没有要评的名字</h1>
        </main>
      </AppShell>
    );
  }

  const verdicts = await loadVerdicts(batch.batch);
  return (
    <AppShell authed>
      <ReviewClient batch={batch} initialVerdicts={verdicts} batchNames={names} />
    </AppShell>
  );
}
