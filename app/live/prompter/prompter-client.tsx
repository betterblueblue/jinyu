"use client";

import { useEffect, useState } from "react";
import type { PrompterPrimary, PrompterRound, PrompterSnapshot } from "@/live/prompter";

/** 一秒问一次：直播页出结果到这里换稿，最多晚一秒 */
const POLL_MS = 1000;

const SOURCE_NOTE: Record<PrompterPrimary["source"], string> = {
  library: "名字库 · 照着念",
  model: "库外名字 · 模型临时起的，没有现成稿子，两个字的意思自己讲两句",
  report: "完整版结果",
};

function Meta({ round }: { round: Extract<PrompterRound, { state: "pending" | "ready" }> }) {
  return (
    <p className="text-lg tracking-wider text-neutral-400 sm:text-xl">
      本场第 {round.no} 个 · {round.surname}姓 · {round.gender}
    </p>
  );
}

function Ready({ round }: { round: Extract<PrompterRound, { state: "ready" }> }) {
  const p = round.primary;
  return (
    <>
      <Meta round={round} />
      {p ? (
        <section className="mt-5" data-testid="prompter-primary">
          <p className="text-6xl font-semibold tracking-[0.2em] text-white sm:text-7xl">{p.full}</p>
          <p className="mt-3 text-2xl tracking-widest text-neutral-300 sm:text-3xl">{p.pinyin}</p>
          {p.pinyinHint ? <p className="mt-2 text-lg text-amber-300">{p.pinyinHint}</p> : null}
          <p className="mt-4 inline-block rounded border border-neutral-600 px-3 py-1 text-base text-neutral-300">
            {SOURCE_NOTE[p.source]}
          </p>
          <ol className="mt-6 space-y-4" data-testid="prompter-lines">
            {p.lines.map((line, i) => (
              <li key={`${i}-${line}`} className="flex gap-4 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-neutral-50">
                <span className="w-8 shrink-0 text-right text-neutral-500">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          {p.tip ? (
            <p
              className="mt-6 rounded border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-[clamp(18px,2.4vw,26px)] leading-relaxed text-amber-200"
              data-testid="prompter-tip"
            >
              只给主播看：{p.tip}
            </p>
          ) : null}
        </section>
      ) : null}
      {round.sections.map((s) => (
        <section key={s.label} className="mt-8 border-t border-neutral-700 pt-5">
          <p className="text-lg tracking-widest text-neutral-400">{s.label}</p>
          <ul className="mt-3 space-y-3">
            {s.names.map((n) => (
              <li key={n.full} className="text-[clamp(20px,2.8vw,30px)] leading-relaxed">
                <span className="font-semibold text-white">{n.full}</span>
                <span className="ml-3 text-neutral-400">{n.pinyin}</span>
                {n.one ? <span className="ml-3 text-neutral-200">{n.one}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function PrompterClient() {
  const [snap, setSnap] = useState<PrompterSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [authLost, setAuthLost] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch("/api/live/prompter", { cache: "no-store" });
        if (res.status === 401) {
          setAuthLost(true);
        } else if (res.ok) {
          const data = (await res.json()) as PrompterSnapshot & { ok: boolean };
          // 同一份就不换，免得每秒重画一次
          setSnap((prev) => (prev && prev.boot === data.boot && prev.seq === data.seq ? prev : data));
          setAuthLost(false);
          setOffline(false);
        } else {
          setOffline(true);
        }
      } catch {
        setOffline(true);
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const round = snap?.round;

  return (
    <main className="fixed inset-0 overflow-y-auto bg-neutral-950 font-sans text-neutral-100" data-testid="prompter-page">
      <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between text-sm tracking-wider text-neutral-500">
          <span>主播提词 · 观众看不到这一页</span>
          <span className={offline || authLost ? "text-red-400" : "text-emerald-400"}>
            {authLost ? "登录过期" : offline ? "连接中断，正在重连" : "已连接"}
          </span>
        </header>

        <div className="mt-6">
          {authLost ? (
            <p className="text-2xl leading-relaxed">
              登录过期了，
              <a className="text-amber-300 underline" href="/login?next=/live/prompter">
                点这里重新登录
              </a>
              。
            </p>
          ) : !round ? (
            <p className="text-2xl text-neutral-400">连接中…</p>
          ) : round.state === "idle" ? (
            <div data-testid="prompter-idle">
              <p className="text-5xl font-semibold tracking-widest text-white">等下一位观众</p>
              <p className="mt-4 text-xl text-neutral-400">直播台点「开始取名」以后，这里会自动出稿。</p>
            </div>
          ) : round.state === "pending" ? (
            <div data-testid="prompter-pending">
              <Meta round={round} />
              <p className="mt-6 text-5xl font-semibold tracking-widest text-white">正在起名…</p>
              <p className="mt-6 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-neutral-100">
                可以先说：稍等，我按{round.surname}姓把谐音和字义都过一遍。
              </p>
            </div>
          ) : (
            <Ready round={round} />
          )}
        </div>
      </div>
    </main>
  );
}
