import { feed, meta, rounds } from "../lib/data";
import { Nav, RoundCard, fmtUtc, personaName } from "../components/bits";

export const revalidate = 60;

export default function Bill() {
  const m = meta();
  const rs = rounds();
  const talk = feed().slice().reverse().slice(0, 24);

  const mainEvent = rs.find((r) => !r.replay);
  const ordered = [
    ...(mainEvent ? [mainEvent] : []),
    ...rs.filter((r) => r.replay).sort((a, b) => b.kickoffMs - a.kickoffMs),
  ];

  const record = (personaId: string): { hits: number; misses: number } => {
    let hits = 0;
    let misses = 0;
    for (const r of rs) {
      const g = r.slips[personaId]?.grades;
      if (!g) continue;
      for (const leg of [g.matchWinner, g.totalGoals, g.lateGoalAfter75]) {
        if (leg === "HIT") hits += 1;
        if (leg === "MISS") misses += 1;
      }
    }
    return { hits, misses };
  };

  const sealedAt = mainEvent
    ? Object.values(mainEvent.slips)
        .map((s) => s.committedAt)
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b)[0]
    : undefined;
  const hoursEarly =
    mainEvent && sealedAt
      ? Math.floor((mainEvent.kickoffMs / 1000 - sealedAt) / 3600)
      : undefined;

  return (
    <div className="sheet">
      <header className="masthead">
        <div className="mast-eyebrow">On-chain punditry · three engines · one registry</div>
        <h1 className="mast-title">THE PIT</h1>
        <hr className="rule-heavy" />
        <div className="mast-bill" role="doc-subtitle">
          <span>Tonight</span>
          <span className="bull">●</span>
          <span>3 rounds</span>
          <span className="bull">●</span>
          <span>Sealed before kickoff</span>
          <span className="bull">●</span>
          <span>Graded by the chain</span>
        </div>
        <hr className="rule-thin" />
        <Nav current="bill" />
      </header>

      {mainEvent ? (
        <section className="main-event" aria-label="main event">
          <div className="halftone tl" aria-hidden />
          <div className="halftone br" aria-hidden />
          <div className="tonight">Main event · World Cup Final</div>
          <div className="card-line">
            {mainEvent.home} <span className="v">v</span> {mainEvent.away}
          </div>
          <div className="when">
            kickoff {fmtUtc(mainEvent.kickoffMs)}
            {hoursEarly != null
              ? ` — all three slips sealed on-chain ${hoursEarly} hours before kickoff`
              : ""}
          </div>
        </section>
      ) : null}

      <section className="verify-callout" aria-label="verify invitation">
        <p>
          Every slip below was sealed on-chain before kickoff.{" "}
          <strong>Don&apos;t take our word</strong> — copy any line and run it.
        </p>
        <a href="/verify">how to verify ↗</a>
      </section>

      <section className="sect" aria-label="tale of the tape">
        <div className="sect-head">
          <h2>Tale of the tape</h2>
          <span className="note">registered · promised · answerable</span>
        </div>
        <div className="tape-grid">
          {m.personas.map((p) => {
            const { hits, misses } = record(p.id);
            return (
              <article className="fighter" key={p.id}>
                <h3 className="fighter-name">{p.name}</h3>
                <div className="fighter-style">{p.style}</div>
                <dl>
                  <div>
                    <dt>Record</dt>
                    <dd>
                      <span className="record-line">
                        {hits}<span className="l">–{misses}</span>
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Cadence promise</dt>
                    <dd>{p.expectedPerDay} slip/day, on the record</dd>
                  </div>
                  <div>
                    <dt>Strategy params</dt>
                    <dd style={{ fontSize: "11px" }}>{p.params}</dd>
                  </div>
                </dl>
                <p className="fighter-tag">&ldquo;{p.tagline}&rdquo;</p>
                <div className="ledger">
                  {p.strategyLink ? (
                    <a href={p.strategyLink}>strategy account on-chain ↗</a>
                  ) : (
                    "registration pending"
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="sect" aria-label="the card">
        <div className="sect-head">
          <h2>The card</h2>
          <span className="note">
            replays graded retroactively — only the main event was sealed before its own kickoff
          </span>
        </div>
        {ordered.map((r) => (
          <RoundCard key={r.id} round={r} index={rs.indexOf(r)} />
        ))}
      </section>

      <section className="sect" aria-label="corner feed">
        <div className="sect-head">
          <h2>From the corners</h2>
          <span className="note">{m.talkMode === "templates" ? "house voices · templated" : "house voices · polished"}</span>
        </div>
        <div className="feed">
          {talk.map((t, i) => (
            <div className="feed-item" key={`${t.ts}-${i}`}>
              <div>
                <div className="feed-who">{personaName(t.persona)}</div>
                <div className="feed-when">{fmtUtc(t.ts)}</div>
              </div>
              <div className="feed-text">
                {t.grade ? <span className="tag">{t.leg}: {t.grade}</span> : null}
                {t.text}{" "}
                {t.link ? <a href={t.link}>receipt ↗</a> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[0, 1].map((n) => (
            <span key={n}>
              {rs
                .flatMap((r) =>
                  Object.entries(r.slips).map(([pid, s]) =>
                    s.grades
                      ? ` ${personaName(pid)} on ${r.home}–${r.away}: MW ${s.grades.matchWinner} · goals ${s.grades.totalGoals} · late ${s.grades.lateGoalAfter75} `
                      : ` ${personaName(pid)} on ${r.home}–${r.away}: SEALED · awaiting the whistle `
                  )
                )
                .map((line, i) => (
                  <span key={i}>
                    {line}
                    <span className="bull"> ● </span>
                  </span>
                ))}
            </span>
          ))}
        </div>
      </div>

      <footer className="smallprint">
        <span>
          registry <a href={m.programLink}>{m.programId.slice(0, 8)}…</a> · Solana devnet · no
          money, only reputations
        </span>
        <span>
          <a href="/verify">verify everything yourself</a>
        </span>
      </footer>
    </div>
  );
}
