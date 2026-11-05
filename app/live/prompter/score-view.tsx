import type { PrompterScoreRound } from "@/live/prompter";

/*
 * 颜色只表达一件事（2026-11-05 用户：好的和不好的对比要明显）：
 *   绿 = 好（优点、分高的维度、非常优秀、改法涨的分）
 *   红 = 不好（问题、分低的维度、建议改、被压上限）
 *   琥珀 = 只给主播的提醒（谐音、撞名人），不表示好坏
 * 每处颜色都带文字或符号（✓ ✗ 重 轻），不靠颜色单独传意思。
 */
const BAND_STYLE: Record<string, { text: string; chip: string }> = {
  非常优秀: { text: "text-emerald-300", chip: "border-emerald-400/60 bg-emerald-400/15 text-emerald-200" },
  还能更好: { text: "text-sky-200", chip: "border-sky-400/50 bg-sky-400/10 text-sky-200" },
  // 11-05 改名前缓存过的提词稿还是旧叫法
  可以用: { text: "text-sky-200", chip: "border-sky-400/50 bg-sky-400/10 text-sky-200" },
  建议改: { text: "text-rose-300", chip: "border-rose-400/60 bg-rose-400/15 text-rose-200" },
};

/** 维度得分率：≥ 0.8 绿、≥ 0.6 灰（还行）、更低红 */
function dimTone(score: number, max: number): { bar: string; num: string } {
  const r = max > 0 ? score / max : 0;
  if (r >= 0.8) return { bar: "bg-emerald-400", num: "text-emerald-300" };
  if (r >= 0.6) return { bar: "bg-neutral-400", num: "text-neutral-100" };
  return { bar: "bg-rose-400", num: "text-rose-300" };
}

/** 提词页「打分」页签传进来的：主播点哪个改法，直播台表格第三格就抄哪个 */
export interface FixPick {
  /** 选中的改法（全名）；"none" = 不改 */
  picked: string;
  onPick: (full: string) => void;
  /** 有就显示「再试一次」 */
  onRetry?: () => void;
}

/**
 * 打分稿：分数、优点、问题先念，改法写好一条出一条（2026-11-05 改法挪到优点、问题后面，用户定）。
 * 字典、「模型正在看」紧跟在改法后面：等模型的那几秒主播靠它们说话。
 */
export function ScoreView({ round, pick }: { round: PrompterScoreRound; pick?: FixPick }) {
  const { fix } = round;
  const band = BAND_STYLE[round.bandLabel];
  const strengths = round.strengths ?? [];
  const issues = round.issues ?? [];
  const majors = issues.filter((it) => it.importance === "major").length;
  // 原名分还没到（score 0）时不放改法这一节，免得「改法还在写」压在问题上面
  const showFix = Boolean(fix && (round.score > 0 || fix.options.length || fix.note || pick?.onRetry));
  return (
    <section data-testid="prompter-score">
      <p className="text-lg tracking-wider text-neutral-400 sm:text-xl">本场第 {round.no} 位</p>
      <p className="mt-4 text-6xl font-semibold tracking-[0.2em] text-white sm:text-7xl">{round.full}</p>
      <p className="mt-3 text-2xl tracking-widest text-neutral-300 sm:text-3xl">{round.pinyin}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {round.score > 0 ? (
          <span className={`text-5xl font-semibold tabular-nums ${band?.text ?? "text-neutral-100"}`}>{round.score} 分</span>
        ) : null}
        <span
          className={`rounded border px-3 py-1 text-2xl font-semibold ${band?.chip ?? "border-neutral-600 text-neutral-300"}`}
          data-testid="prompter-band"
        >
          {round.bandLabel}
        </span>
        {round.math ? <span className="text-2xl text-neutral-400">{round.math}</span> : null}
        {strengths.length || issues.length ? (
          <span className="text-xl text-neutral-400" data-testid="prompter-tally">
            <span className="text-emerald-300">✓ 优点 {strengths.length}</span>
            <span className="mx-2">·</span>
            <span className={issues.length ? "text-rose-300" : "text-neutral-400"}>
              ✗ 问题 {issues.length}
              {majors ? `（重 ${majors}）` : ""}
            </span>
          </span>
        ) : null}
      </div>
      {round.capNote ? (
        <p
          className="mt-3 rounded border border-rose-400/50 bg-rose-400/10 px-4 py-2 text-[clamp(18px,2.4vw,26px)] text-rose-200"
          data-testid="prompter-cap"
        >
          ✗ {round.capNote}
        </p>
      ) : null}
      {strengths.length || issues.length ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2" data-testid="prompter-compare">
          <section
            className="rounded-lg border-l-4 border-emerald-400 bg-emerald-400/10 px-5 py-4"
            data-testid="prompter-strengths"
          >
            <p className="text-lg font-semibold tracking-widest text-emerald-300">✓ 好在哪 · 先念</p>
            {strengths.length ? (
              <ul className="mt-2 space-y-2 text-[clamp(22px,3vw,34px)] leading-relaxed text-emerald-50">
                {strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-lg text-neutral-500">还在写……</p>
            )}
          </section>
          <section
            className={`rounded-lg border-l-4 px-5 py-4 ${
              issues.length ? "border-rose-400 bg-rose-400/10" : "border-neutral-600 bg-neutral-900/60"
            }`}
            data-testid="prompter-issues"
          >
            <p className={`text-lg font-semibold tracking-widest ${issues.length ? "text-rose-300" : "text-neutral-400"}`}>
              {issues.length ? "✗ 问题在哪" : "问题在哪"}
            </p>
            {issues.length ? (
              <ol className="mt-2 space-y-3">
                {issues.map((it, i) => (
                  <li
                    key={`${i}-${it.text}`}
                    className={
                      it.importance === "major"
                        ? "text-[clamp(22px,3vw,34px)] font-semibold leading-relaxed text-rose-50"
                        : "text-[clamp(20px,2.6vw,28px)] leading-relaxed text-rose-100/80"
                    }
                  >
                    <span
                      className={`mr-2 inline-block rounded px-2 py-0.5 align-middle text-[clamp(14px,1.8vw,18px)] font-normal ${
                        it.importance === "major" ? "bg-rose-500 text-white" : "border border-rose-300/50 text-rose-200"
                      }`}
                    >
                      {it.importance === "major" ? "重" : "轻"}
                      {it.kind ? ` · ${it.kind}` : ""}
                    </span>
                    {it.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[clamp(20px,2.6vw,28px)] text-emerald-200">没有查到明显问题</p>
            )}
          </section>
        </div>
      ) : null}
      {round.say ? (
        <p className="mt-6 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-sky-200" data-testid="prompter-say">
          {round.say}
        </p>
      ) : null}
      {fix && showFix ? <FixList round={round} fix={fix} pick={pick} /> : null}
      {round.dictionary?.length ? (
        <section className="mt-5 rounded border border-sky-700/60 bg-sky-950/30 px-4 py-3" data-testid="prompter-dictionary">
          <p className="text-lg tracking-widest text-sky-300">字典先查 · 主播可以先照着念</p>
          <ul className="mt-2 space-y-3 text-[clamp(18px,2.4vw,26px)] leading-relaxed text-neutral-200">
            {round.dictionary.map((d) => (
              <li key={d.char}>
                <p className="font-semibold text-white">
                  {d.char}
                  {d.pinyin ? <span className="ml-2 text-neutral-400">{d.pinyin}</span> : null}
                </p>
                {d.missing ? (
                  <>
                    {d.strokes !== undefined || d.gbLevel !== undefined ? (
                      <p data-testid="prompter-dict-offline">
                        {[
                          d.strokes !== undefined ? `${d.strokes} 画` : "",
                          d.gbLevel === 1 ? "常用字" : d.gbLevel === 2 ? "次常用字" : d.gbLevel === 0 ? "不在常用字表，念之前确认读音" : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {d.otherReadings?.length ? (
                      <p className="text-amber-200">多音字，名字里读 {d.pinyin}，别念成 {d.otherReadings.join("、")}</p>
                    ) : null}
                    {d.basicMeaning ? (
                      <p data-testid="prompter-dict-fallback">
                        基本含义：{d.basicMeaning}
                        {d.meaningSource ? <span className="ml-2 text-neutral-500">（{d.meaningSource}）</span> : null}
                      </p>
                    ) : (
                      <p className="text-neutral-500">字典没收这个字，字义等模型分析，十几秒就到</p>
                    )}
                  </>
                ) : (
                  <>
                    {d.basicMeaning ? <p>基本含义：{d.basicMeaning}</p> : null}
                    {d.decomposition ? <p className="text-neutral-400">拆字：{d.decomposition}</p> : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {round.thinking?.length ? (
        <section
          className="mt-4 rounded border border-neutral-700 bg-neutral-900/70 px-4 py-3"
          data-testid="prompter-thinking"
        >
          <p className="text-lg tracking-widest text-neutral-400">模型正在看（还没定，可以先顺着说）</p>
          <ul className="mt-2 space-y-1 text-[clamp(18px,2.4vw,26px)] leading-relaxed text-neutral-300">
            {round.thinking.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {round.dimensions?.length ? (
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="prompter-dimensions">
          {round.dimensions.map((d) => {
            const tone = dimTone(d.score, d.max);
            return (
              <div key={d.label} className="min-w-0">
                <p className="flex items-baseline justify-between text-[clamp(18px,2.4vw,26px)] text-neutral-300">
                  <span>{d.label}</span>
                  <span>
                    <b className={`tabular-nums ${tone.num}`}>{d.score}</b>
                    <span className="text-neutral-500">/{d.max}</span>
                  </span>
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded bg-neutral-800">
                  <div className={`h-full ${tone.bar}`} style={{ width: `${d.max > 0 ? Math.round((d.score / d.max) * 100) : 0}%` }} />
                </div>
                {d.reason ? (
                  <p className="mt-1 text-[clamp(14px,1.8vw,18px)] leading-snug text-neutral-500">{d.reason}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {round.reminders?.length ? (
        <section className="mt-6" data-testid="prompter-reminders">
          <p className="text-lg tracking-widest text-amber-300">主播提醒 · 谐音、联想、撞名人</p>
          <ul className="mt-2 space-y-2 text-[clamp(20px,2.8vw,30px)] leading-relaxed text-amber-100">
            {round.reminders.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {round.merit ? (
        <section className="mt-6" data-testid="prompter-merit">
          <p className="text-lg tracking-widest text-neutral-400">模型评价 · 好在哪、问题在哪，念之前扫一眼</p>
          {round.merit.lines.length ? (
            <div className="mt-2 space-y-2 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-neutral-50">
              {round.merit.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-lg text-neutral-500">字义和寓意还在写，几秒就到……</p>
          )}
          {round.merit.tip ? (
            <p
              className="mt-3 rounded border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-[clamp(18px,2.4vw,26px)] leading-relaxed text-amber-200"
              data-testid="prompter-merit-tip"
            >
              只给主播看：{round.merit.tip}
            </p>
          ) : null}
        </section>
      ) : null}
      {round.genderAsk ? (
        <p className="mt-5 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-sky-200" data-testid="prompter-gender-ask">
          {round.genderAsk}
        </p>
      ) : null}
      {round.checks ? (
        <p className="mt-5 text-[clamp(20px,2.8vw,30px)] leading-relaxed text-neutral-300" data-testid="prompter-checks">
          {round.checks}
        </p>
      ) : null}
      {round.deductions.length ? (
        <ol className="mt-6 space-y-4">
          {round.deductions.map((d, i) => (
            <li key={`${i}-${d.line}`} className="flex gap-4 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-neutral-50">
              <span className="w-14 shrink-0 text-right text-neutral-500">−{d.points}</span>
              <span>{d.line}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {round.folk.length ? (
        <div className="mt-5 space-y-2 text-[clamp(18px,2.4vw,26px)] leading-relaxed text-neutral-400">
          <p>民间说法，不扣分，可以顺口提一句：</p>
          {round.folk.map((f) => (
            <p key={f}>{f}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

type Fix = NonNullable<PrompterScoreRound["fix"]>;

/** 改一个字：有 pick 时每条都能点，点哪个直播台表格第三格就抄哪个；最后一条「不改」 */
function FixList({ round, fix, pick }: { round: PrompterScoreRound; fix: Fix; pick?: FixPick }) {
  const box = (on: boolean) =>
    `block w-full rounded-lg border-2 px-5 py-3 text-left ${
      on ? "border-amber-400 bg-amber-400/10" : "border-neutral-800 hover:border-neutral-600"
    }`;
  const mark = <span className="ml-3 text-[clamp(16px,2.2vw,22px)] text-amber-300">✓ 第三格用这个</span>;
  const empty = !fix.running && !fix.options.length && !fix.note;
  return (
    <section className="mt-8 border-t border-neutral-700 pt-5" data-testid="prompter-fixes">
      <p className="text-lg tracking-widest text-neutral-400">
        改一个字 · 寓意是模型写的，没人审过，念之前扫一眼{pick && fix.options.length ? "；点哪个，第三格就抄哪个" : ""}
      </p>
      <ul className="mt-3 space-y-3">
        {fix.options.map((o, i) => {
          const on = pick?.picked === o.full;
          const body = (
            <>
              <p>
                <span className="mr-2 rounded border border-neutral-500 px-2 py-0.5 text-[clamp(14px,1.8vw,18px)] text-neutral-200">
                  {i === 0 ? "首选" : "备选"}
                </span>
                <span className="font-semibold text-white">{o.full}</span>
                <span className="ml-3 text-neutral-400">{o.pinyin}</span>
                <span className="ml-3 font-semibold tabular-nums text-emerald-300">{o.score} 分</span>
                {round.score > 0 && o.score > round.score ? (
                  <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 text-[clamp(16px,2.2vw,22px)] font-semibold text-emerald-200">
                    ↑ {o.score - round.score}
                  </span>
                ) : null}
                {on ? mark : null}
              </p>
              <p className="text-[clamp(16px,2.2vw,22px)] text-neutral-400">{o.change}</p>
              {o.solves?.length ? (
                <p className="mt-1 text-[clamp(16px,2.2vw,22px)] text-emerald-300">✓ 解决：{o.solves.join("、")}</p>
              ) : null}
              {o.keeps?.length ? (
                <p className="text-[clamp(16px,2.2vw,22px)] text-sky-300">保留：{o.keeps.join("、")}</p>
              ) : null}
              <p className="mt-1 text-[clamp(22px,3.3vw,36px)] leading-relaxed text-neutral-50">{o.meaning}</p>
              {o.loss ? <p className="mt-1 text-[clamp(16px,2.2vw,22px)] text-rose-200/80">✗ 取舍：{o.loss}</p> : null}
            </>
          );
          return (
            <li key={o.full} className="text-[clamp(20px,2.8vw,30px)] leading-relaxed" data-testid="prompter-fix">
              {pick ? (
                <button type="button" className={box(on)} onClick={() => pick.onPick(o.full)}>
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
        {pick && fix.options.length ? (
          <li>
            <button
              type="button"
              className={`${box(pick.picked === "none")} text-[clamp(20px,2.8vw,28px)]`}
              onClick={() => pick.onPick("none")}
            >
              不改 · 第三格写「{round.bandLabel}」
              {pick.picked === "none" ? mark : null}
            </button>
          </li>
        ) : null}
      </ul>
      {fix.running ? (
        <p className="mt-3 text-lg text-neutral-500">{fix.options.length ? "下一个改法还在写……" : "改法还在写，几秒就到……"}</p>
      ) : null}
      {fix.note ? <p className="mt-3 text-[clamp(20px,2.8vw,30px)] text-amber-200">{fix.note}</p> : null}
      {empty && pick ? (
        <p className="mt-1 text-[clamp(20px,2.8vw,28px)] text-neutral-300">没有改法，第三格写「{round.bandLabel}」。</p>
      ) : null}
      {pick?.onRetry ? (
        <button
          type="button"
          className="mt-4 rounded border border-neutral-600 px-5 py-2 text-xl text-neutral-200 hover:border-amber-400 hover:text-amber-200"
          onClick={pick.onRetry}
        >
          再试一次
        </button>
      ) : null}
    </section>
  );
}
