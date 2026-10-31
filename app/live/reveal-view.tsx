import type { ShowData } from "./show-data";

/** 揭晓态的画面：名字、拼音、寓意、出处、体检、本场第几个、生辰、备选、落款。存图画的是同一份 ShowData */
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
        <p className="meaning reveal" style={{ ["--d" as string]: "600ms" }}>
          {show.one}
        </p>
        <ul className="tags reveal" style={{ ["--d" as string]: "700ms" }}>
          {show.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      {show.cite && (
        <blockquote className="evidence reveal" style={{ ["--d" as string]: "780ms" }}>
          <p className="ev-quote">{show.cite.quote}</p>
          <p className="ev-piece">{show.cite.piece}</p>
          <p className="ev-seal">
            <span>核验</span>
            原文逐字核过 · 两字{show.cite.kind}
          </p>
        </blockquote>
      )}

      {show.check && (
        <p className="check reveal" style={{ ["--d" as string]: "800ms" }} data-testid="live-check">
          {show.check}
        </p>
      )}

      <p className="ledger reveal" style={{ ["--d" as string]: "820ms" }}>
        本场第 {show.no} 个
        {show.sessionGiven ? ` · 此前已给过 ${show.sessionGiven} 个` : ""}
      </p>

      {show.bazi && (
        <p className="bazi reveal" style={{ ["--d" as string]: "900ms" }}>
          <span className="bazi-label">生辰</span>
          {show.bazi}
        </p>
      )}

      <section className="alt reveal" style={{ ["--d" as string]: "1000ms" }}>
        <span className="alt-label">备选</span>
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

      {/* 和存图底部同一句 */}
      <p className="credit reveal" style={{ ["--d" as string]: "1100ms" }}>
        名字由瑾瑜起草
      </p>
    </>
  );
}
