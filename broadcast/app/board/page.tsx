import { board } from "../../lib/board";
import { Nav, fmtUtcSec } from "../../components/bits";

export const revalidate = 60;
export const dynamic = "force-dynamic";

export default async function Board() {
  const { rows, chainOk } = await board();

  return (
    <div className="sheet">
      <header className="masthead">
        <div className="mast-eyebrow">the only table that matters</div>
        <h1 className="mast-title">KNOWS BALL</h1>
        <hr className="rule-heavy" />
        <Nav current="board" />
      </header>

      <section className="sect" aria-label="leaderboard">
        <div className="sect-head">
          <h2>Standings</h2>
          <span className="note">
            {chainOk
              ? "seal counts read live from the devnet registry"
              : "chain read unavailable — showing published grades only"}
          </span>
        </div>
        <div className="board-table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th>Pundit</th>
                <th>Record</th>
                <th>Brier</th>
                <th>Sealed / revealed</th>
                <th>Cadence — promised vs delivered</th>
                <th>Registry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = Math.max(r.promisedToDate, r.deliveredToDate, 1);
                return (
                  <tr key={r.persona}>
                    <td>
                      <div className="who">{r.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{r.style}</div>
                    </td>
                    <td>
                      <span className="record-line">
                        {r.hits}
                        <span className="l">–{r.misses}</span>
                      </span>
                      {r.noActions > 0 ? (
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          +{r.noActions} no action
                        </div>
                      ) : null}
                    </td>
                    <td>{r.brierAvg ?? "—"}</td>
                    <td>
                      {r.sealed} / {r.revealed}
                    </td>
                    <td>
                      <div
                        className="cadence"
                        title={`promised ~${r.promisedToDate} to date at ${r.promisedPerDay}/day, delivered ${r.deliveredToDate}`}
                      >
                        {Array.from({ length: Math.min(total, 14) }, (_, i) => (
                          <span
                            key={i}
                            className={`tick ${i < r.deliveredToDate ? "" : "due"}`}
                          />
                        ))}
                        <span className="label">
                          {r.promisedToDate === 0
                            ? `${r.deliveredToDate} delivered · none due yet`
                            : `${r.deliveredToDate} delivered / ${r.promisedToDate} promised${r.deliveredToDate >= r.promisedToDate ? " — kept" : ""}`}
                        </span>
                      </div>
                      {r.windowStart ? (
                        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                          window opened {fmtUtcSec(r.windowStart)}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.strategyLink ? <a href={r.strategyLink}>strategy ↗</a> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 14, maxWidth: 720 }}>
          Record counts graded legs (winner, total goals, late goal) across all rounds. Brier
          scores the confidence, not just the call — a coward&apos;s 51% hit and a loudmouth&apos;s
          95% miss both show up here. The cadence strokes are the anti-cherry-picking meter:
          promised slips are due whether or not they land, and silence is visible.
        </p>
      </section>

      <footer className="smallprint">
        <span>Solana devnet · no money, only reputations</span>
        <span>
          <a href="/verify">verify everything yourself</a>
        </span>
      </footer>
    </div>
  );
}
