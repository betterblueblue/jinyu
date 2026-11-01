import type { ShowData } from "./show-data";

/**
 * 揭晓态的画面：名字、拼音、寓意、出处、标签和体检、生辰、备选、落款。存图画的是同一份 ShowData。
 *
 * 观众要读的（名字到备选）都排在画面 65% 高度以上，下面会被抖音评论盖住；
 * 小字只留两行：名字下面一行「查过什么、生在什么时节」，最后一行「本场第几个、谁起草的」。
 */
export function RevealView({ show }: { show: ShowData }) {
  return (
    <>
      <div className="hero">
        <h1 className="name" aria-label={show.full}>
          {show.full.split("").map((ch, i) => (
            <span key={`${ch}-${i}`} className="ch" style={{ ["--i" as string]: i }}>
              {ch}
            </span>
          ))}
        </h1>
        <p className="pinyin reveal" style={{ ["--d" as string]: "200ms" }}>
          {show.syl.map((s, i) => (
            <span className="syl" key={`${s.ch}-${i}`}>
              {s.py}
              {s.tone ? <i className="tone">{s.tone}</i> : null}
            </span>
          ))}
        </p>
        {show.pyHint && (
          <p className="pinyin-hint reveal" style={{ ["--d" as string]: "300ms" }}>
            {show.pyHint}
          </p>
        )}
        <p className="meaning reveal" style={{ ["--d" as string]: "500ms" }}>
          {show.one}
        </p>
      </div>

      {show.cite && (
        <blockquote className="evidence reveal" style={{ ["--d" as string]: "700ms" }}>
          <p className="ev-quote">{show.cite.quote}</p>
          <p className="ev-src">
            <span className="ev-piece">{show.cite.piece}</span>
            <span className="ev-seal">
              <span>核验</span>
              原文逐字核过 · 两字{show.cite.kind}
            </span>
          </p>
        </blockquote>
      )}

      <div className="facts reveal" style={{ ["--d" as string]: "850ms" }}>
        <ul className="tags">
          {show.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {(show.check || show.bazi) && (
          <p className="assure">
            {show.check && <span data-testid="live-check">{show.check}</span>}
            {show.bazi && <span>{show.bazi}</span>}
          </p>
        )}
      </div>

      <section className="alt reveal" style={{ ["--d" as string]: "1000ms" }}>
        <p className="alt-head">
          <span>备选</span>
        </p>
        <div className="alt-list">
          {show.alts.map((a) => (
            <div className="alt-item" key={a.n}>
              <span className="alt-name">{a.n}</span>
              <span className="alt-py">
                {a.syl.map((s, i) => (
                  <span className="syl" key={`${s.ch}-${i}`}>
                    {s.py}
                    {s.tone ? <i className="tone">{s.tone}</i> : null}
                  </span>
                ))}
              </span>
              <span className="alt-one">{a.one}</span>
              {a.cite && (
                <span className="alt-cite">
                  {a.cite.quote} {a.cite.piece}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 落款：「本场第几个」和存图对得上；「名字由瑾瑜起草」和存图底部同一句 */}
      <p className="credit reveal" style={{ ["--d" as string]: "1150ms" }}>
        本场第 {show.no} 个{show.sessionGiven ? ` · 此前已给过 ${show.sessionGiven} 个` : ""} · 名字由瑾瑜起草
      </p>
    </>
  );
}
