"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FAST_RECENT_MAX, type FastFormInput } from "@/fast/types";
import { AnalyzePanel } from "./analyze-panel";
import { downloadCard } from "./card-export";
import { readFastResponse } from "./fast-stream";
import { GENDER_WORD, fetchTalks, prompterFromFast, pushPrompter } from "./prompter-sync";
import { RevealView } from "./reveal-view";
import { fastToShow, type Gender, type Phase, type ShowData, type Skin } from "./show-data";
import { useLiveKeys } from "./use-live-keys";
import "./live.css";

/**
 * 直播台 /live：这里只放状态和页面骨架。
 * 一张卡的数据在 show-data.ts，揭晓画面在 reveal-view.tsx，存图在 card-export.ts，
 * 提词页同步在 prompter-sync.ts，读结果流在 fast-stream.ts，快捷键在 use-live-keys.ts。
 */

const SKIN_LABEL: Record<Skin, string> = { paper: "宣纸", celadon: "青瓷", silver: "刻版", bamboo: "竹兰" };
const SKINS: Skin[] = ["paper", "celadon", "silver", "bamboo"];
const G_LABEL: Record<Gender, string> = { male: "男", female: "女", unknown: "未知" };

export function LiveClient() {
  // 默认开竹兰；S 键仍按 paper → celadon → silver → bamboo 循环
  const [skin, setSkin] = useState<Skin>("bamboo");
  const [phase, setPhase] = useState<Phase>("input");
  const [gender, setGender] = useState<Gender>("unknown");
  const [draft, setDraft] = useState("");
  /** 精简版唯一的可选项：生日。填了才排盘，不填不提八字 */
  const [birthday, setBirthday] = useState("");
  /** 加载页的真实阶段：候选几个、拦了谁、核到几条。内容全部来自服务端事件 */
  const [frames, setFrames] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [show, setShow] = useState<ShowData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardNo, setCardNo] = useState(1);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = useRef(false);
  /** 第几轮：补写的稿子回来时用它认是不是还是这一轮 */
  const roundToken = useRef(0);
  const bgImage = useRef<HTMLImageElement | null>(null);
  /** 这一场已经给过的名字（整场都记，最多 FAST_RECENT_MAX 个），随请求带给精简版：去重、抽起手字都靠它 */
  const recentRef = useRef<string[]>([]);

  /* 竹兰背景图预加载：导出卡片时要同步画进 canvas */
  useEffect(() => {
    const img = new Image();
    const done = () => {
      bgImage.current = img;
    };
    img.addEventListener("load", done, { once: true });
    img.src = "/skins/bamboo-paper.webp";
    if (img.complete) done();
    return () => img.removeEventListener("load", done);
  }, []);

  /* ---------- 缩放适配 ---------- */
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920, 1);
      rootRef.current?.style.setProperty("--s", String(s));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /**
   * hydrate 之前打进输入框的字符只存在于 DOM，React 收不到 onChange（指针/点击事件要等 hydrate 才绑上）。
   * 这类字符会让「开始取名」一直 disabled，之后继续打字还会和它拼在一起（「苏」+「李」=「李苏」）。
   * 挂载后把 DOM 里的现值同步回状态，双方就一致了。
   */
  useEffect(() => {
    const el = inputRef.current;
    if (el && el.value) setDraft((prev) => (prev ? prev : el.value));
  }, []);

  /** 从名字分析带过来的约束：姓氏已定、要避开的字、定向要求 */
  const generate = useCallback(
    async (override?: { surname?: string; gender?: Gender; birthday?: string; taboo?: string; requirements?: string }) => {
    if (busy.current) return;
    const surname = (override?.surname ?? draft).trim();
    if (!surname) {
      inputRef.current?.focus();
      return;
    }
    busy.current = true;
    const token = ++roundToken.current;
    setPhase("generating");
    setFrames(["正在征名"]);
    setProgress(12);
    setError(null);

    const pushFrame = (text: string, p: number) => {
      setFrames((f) => (f[f.length - 1] === text ? f : [...f.slice(-3), text]));
      setProgress((q) => Math.max(q, p));
    };

    try {
      const picked = override?.gender ?? gender;
      if (picked === "unknown") {
        throw new Error("先选性别：按 1 男 / 2 女，再点开始取名");
      }
      // 打分榜「重新起名」会传空串：那位观众没报生日，不能带上直播台上一位的
      const bday = override?.birthday ?? birthday;
      const body: FastFormInput = {
        surname,
        gender: picked,
        ...(bday ? { birthday: bday } : {}),
        ...(recentRef.current.length ? { recent: recentRef.current } : {}),
      };
      pushPrompter({ state: "pending", no: cardNo, surname, gender: GENDER_WORD[picked] });
      const res = await fetch("/api/fast?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const { payload, staged } = await readFastResponse(res);
      if (!payload) throw new Error("生成失败");
      if (!payload.ok) throw new Error(payload.message || "生成失败");

      // 逐帧放出来，每帧 260ms；没有帧就直接揭晓
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < staged.length; i++) {
        pushFrame(staged[i]!, 35 + Math.round(((i + 1) / (staged.length + 1)) * 55));
        await sleep(260);
      }

      setShow(fastToShow(payload, cardNo, recentRef.current.length));
      pushPrompter(prompterFromFast(payload, cardNo));
      // 模型起的名字没有现成稿子：再请模型写拆字、合起来，写好了补推一次提词页。
      // 观众屏幕不等它；主播已经点了「下一个」的话（token 变了）就不推，免得盖掉下一位
      void fetchTalks(payload, bday || undefined).then((talks) => {
        if (roundToken.current === token) pushPrompter(prompterFromFast(payload, cardNo, talks));
      });
      // 记下这一场已经给过哪些名字：下一轮带着去重，观众不会连着看到同一个名。
      // 重复出现的名字必须挪到队尾再截断——直接 Set + slice(-N) 会让它停在最早的位置，
      // 于是最常出现的那个名字反而最先被挤出去，下一轮又合法了。
      const justGiven = [payload.primary.givenName, ...payload.alternatives.map((a) => a.givenName)].filter(
        (n) => /^[\u4e00-\u9fff]{2}$/.test(n),
      );
      const keepOld = recentRef.current.filter((n) => !justGiven.includes(n));
      recentRef.current = [...keepOld, ...justGiven].slice(-FAST_RECENT_MAX);
      setCardNo((n) => n + 1);
      setProgress(100);
      setReady(false);
      setPhase("reveal");
      requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setPhase("input");
      setShow(null);
      pushPrompter({ state: "idle" });
    } finally {
      busy.current = false;
    }
    },
    [draft, gender, birthday, cardNo],
  );

  /** 打分榜「重新起名」：姓和性别带过去，走直播用的精简版（3–5 秒） */
  const renameFromScore = useCallback(
    (input: { surname: string; gender: "male" | "female" }) => {
      setAnalyzeOpen(false);
      setDraft(input.surname);
      setGender(input.gender);
      setBirthday("");
      void generate({ surname: input.surname, gender: input.gender, birthday: "" });
    },
    [generate],
  );

  const resetToInput = useCallback(() => {
    roundToken.current++;
    pushPrompter({ state: "idle" });
    setShow(null);
    setReady(false);
    setProgress(0);
    setDraft("");
    // 直播是连续换观众：性别与生日一起清零，
    // 否则上一位的条件会静默带到下一位身上，画面里只显示成一行小字
    setGender("unknown");
    setBirthday("");
    setPhase("input");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const cycleSkin = useCallback(() => {
    setSkin((s) => SKINS[(SKINS.indexOf(s) + 1) % SKINS.length]);
  }, []);

  useLiveKeys({ phase, analyzeOpen, setAnalyzeOpen, cycleSkin, resetToInput, generate, setGender });

  /* ---------- 存图 ---------- */
  const exportCard = useCallback(() => {
    if (!show) return;
    void downloadCard(show, skin, bgImage.current);
  }, [show, skin]);

  const curSurname = draft.trim();

  return (
    <div className="live-root" ref={rootRef} data-skin={skin}>
      <div className="live-viewport">
        <div className={`live-stage ${ready ? "ready" : ""} ${show?.bazi ? "has-bazi" : ""}`}>
          <div className="sheen" />
          <div className="toplight" />
          <div className="fiber" />
          <div className="crackle" />
          <div className="crackle b" />
          <div className="crackle c" />
          <div className="glow" />
          <div className="wash" />
          <div className="watermark">{curSurname || "瑾"}</div>
          <div className="rules" />
          <div className="vignette" />
          <div className="frame" />
          <div className="rim" />
          <div className="rail">JINYU · NAMING STUDIO</div>

          <main className="sheet">
            {/* 品牌不再放顶部：抖音头像和榜单会压住它，挪到底部左下角的小标 */}

            {/* 输入态 */}
            <section className={`pane pane-input ${phase === "input" ? "on" : ""}`}>
              <p className="hint">想分析名字，留姓名；想取名，留姓氏和性别</p>
              <div className="field">
                <input
                  ref={inputRef}
                  className="surname-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void generate();
                      return;
                    }
                    if (e.key === "1") {
                      e.preventDefault();
                      setGender("male");
                    }
                    if (e.key === "2") {
                      e.preventDefault();
                      setGender("female");
                    }
                    if (e.key === "3") {
                      e.preventDefault();
                      setGender("unknown");
                    }
                  }}
                  placeholder="姓氏"
                  maxLength={3}
                  autoComplete="off"
                  aria-label="姓氏"
                />
              </div>
              <div className="genders">
                {(["male", "female", "unknown"] as Gender[]).map((g, i) => (
                  <button
                    key={g}
                    type="button"
                    className={gender === g ? "on" : ""}
                    onClick={() => setGender(g)}
                  >
                    {G_LABEL[g]}
                    <em>{i + 1}</em>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`go ${curSurname ? "" : "is-empty"}`}
                onClick={() => void generate()}
                disabled={!curSurname}
              >
                <span className="go-main">开始取名</span>
              </button>

              <label className="extra-bar">
                <span>生日（可选）</span>
                <input
                  type="date"
                  className="extra-sum"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  aria-label="宝宝生日，可不填"
                />
              </label>

              <button type="button" className="entry-bar" onClick={() => setAnalyzeOpen(true)}>
                <span>名字分析</span>
                <span>已经有名字？看看读音、字义和使用体验 · A</span>
              </button>

              {error && <p className="gen-error">{error}</p>}
            </section>

            {/* 生成态 */}
            <section className={`pane pane-gen ${phase === "generating" ? "on" : ""}`}>
              <p className="gen-title">
                正在为 <em>{curSurname}</em> 取名
              </p>
              <p className="gen-extra">
                {birthday ? `双字名 · 避开网红名 · 生辰 ${birthday}` : "双字名 · 避开网红名"}
              </p>
              <ul className="gen-log">
                {frames.map((f, i) => (
                  <li key={`${f}-${i}`} className={i === frames.length - 1 ? "on" : ""}>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="bar">
                <i style={{ width: `${progress}%` }} />
              </div>
            </section>

            {/* 揭晓态 */}
            <section className={`pane ${phase === "reveal" ? "on" : ""}`}>
              <div className="kicker">
                <i />
                REVEAL / No.{String(cardNo).padStart(3, "0")}
              </div>
              {show && <RevealView show={show} />}
            </section>

            <footer className="bottom">
              <div className="marquee" aria-hidden="true">
                <div className="marquee-track">
                  {[0, 1, 2].map((i) => (
                    <span key={i}>
                      评论区留姓名可分析，留姓氏可取名，主播挑选讲解<em>◆</em>
                    </span>
                  ))}
                </div>
              </div>
              <div className="cta-row">
                {phase === "reveal" && (
                  <>
                    <button type="button" className="next" onClick={resetToInput}>
                      下一个
                    </button>
                    <button type="button" className="save" onClick={exportCard}>
                      存图
                    </button>
                  </>
                )}
              </div>
            </footer>
          </main>

          <span className="brand-mini" aria-hidden="true">瑾瑜</span>

          <button type="button" className="skin-btn" onClick={cycleSkin}>
            换肤 · {SKIN_LABEL[skin]} · S
          </button>

          <AnalyzePanel
            open={analyzeOpen}
            onClose={() => setAnalyzeOpen(false)}
            onRename={renameFromScore}
          />
        </div>
      </div>
    </div>
  );
}
