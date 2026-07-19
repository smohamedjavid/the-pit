import type { PublicSlip, Round } from "../lib/data";
import { VerifyStrip } from "./verify-slip";

export const fmtUtc = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 16).replace("T", " · ") + " UTC";

export const fmtUtcSec = (sec: number): string => fmtUtc(sec * 1000);

export function Stamp({ grade }: { grade: "HIT" | "MISS" | "NO ACTION" }) {
  const cls = grade === "HIT" ? "hit" : grade === "MISS" ? "miss" : "push";
  return <span className={`stamp ${cls}`}>{grade}</span>;
}

export function Nav({ current }: { current: "bill" | "board" | "verify" }) {
  return (
    <nav className="nav" aria-label="site">
      <a href="/" aria-current={current === "bill" ? "page" : undefined}>
        The Bill
      </a>
      <a href="/board" aria-current={current === "board" ? "page" : undefined}>
        Knows Ball
      </a>
      <a href="/verify" aria-current={current === "verify" ? "page" : undefined}>
        Verify It
      </a>
    </nav>
  );
}

const PERSONA_NAMES: Record<string, string> = {
  steamer: "The Steamer",
  quant: "The Quant",
  heel: "The Heel",
};

export function personaName(id: string): string {
  return PERSONA_NAMES[id] ?? id;
}

export function Envelope({
  personaId,
  slip,
  round,
}: {
  personaId: string;
  slip: PublicSlip;
  round: Round;
}) {
  const name = personaName(personaId);
  if (!slip.revealed || !slip.slip) {
    return (
      <div className="env">
        <div className="env-owner">{name}</div>
        <div className="env-sealed">
          <div className="wax" aria-hidden>
            PIT
          </div>
          <div className="sealed-at">
            Sealed{slip.committedAt ? ` ${fmtUtcSec(slip.committedAt)}` : ""}
          </div>
          <div className="env-hash">keccak256 {slip.hashHex.slice(0, 20)}…</div>
        </div>
        {slip.commitment ? (
          <VerifyStrip
            commitment={slip.commitment}
            hashHex={slip.hashHex}
            link={slip.commitmentLink}
          />
        ) : null}
      </div>
    );
  }

  const p = slip.slip.picks;
  const g = slip.grades;
  return (
    <div className="env env-open">
      <div className="env-owner">{name}</div>
      <div className="slip">
        <div className="slip-leg">
          <span className="k">Winner</span>
          <span className="pick">{p.matchWinner.team}</span>
          <span className="odds">{Math.round(p.matchWinner.prob * 100)}%</span>
          {g ? <Stamp grade={g.matchWinner} /> : null}
        </div>
        <div className="slip-leg">
          <span className="k">Goals</span>
          <span className="pick">
            {p.totalGoals.side} {p.totalGoals.line}
          </span>
          <span className="odds">{Math.round(p.totalGoals.prob * 100)}%</span>
          {g ? <Stamp grade={g.totalGoals} /> : null}
        </div>
        <div className="slip-leg">
          <span className="k">Goal after 75&apos;</span>
          <span className="pick">{p.lateGoalAfter75.yes ? "yes" : "no"}</span>
          <span className="odds">{Math.round(p.lateGoalAfter75.prob * 100)}%</span>
          {g ? <Stamp grade={g.lateGoalAfter75} /> : null}
        </div>
        <div className="slip-rationale">&ldquo;{slip.slip.rationale}&rdquo;</div>
        <div className="slip-meta">
          sealed {slip.committedAt ? fmtUtcSec(slip.committedAt) : "—"}
          {g?.source === "market-close"
            ? " · graded from the market's closing prints — devnet retains no score record for this fixture, so only the winner leg settles"
            : null}
        </div>
      </div>
      {slip.commitment ? (
        <VerifyStrip
          commitment={slip.commitment}
          hashHex={slip.hashHex}
          link={slip.commitmentLink}
        />
      ) : null}
    </div>
  );
}

export function RoundCard({ round, index }: { round: Round; index: number }) {
  const personaIds = ["steamer", "quant", "heel"].filter((id) => round.slips[id]);
  const revealed = personaIds.some((id) => round.slips[id].revealed);
  const graded = personaIds.some((id) => round.slips[id].grades);
  const result = personaIds
    .map((id) => round.slips[id].grades?.detail)
    .find((d) => d && d.homeGoals90 != null);
  return (
    <article className="round" id={round.id}>
      <div className="round-head">
        <span className="round-no">Round {index + 1}</span>
        <span className="fixture">
          {round.home} v {round.away}
        </span>
        {round.replay ? (
          <span className="badge replay" title="demonstration round graded retroactively">
            Replay
          </span>
        ) : (
          <span className="badge live">Main Event</span>
        )}
        {!revealed ? <span className="badge">Sealed</span> : null}
        {graded && result && result.homeGoals90 != null ? (
          <span className="badge">
            FT {result.homeGoals90}–{result.awayGoals90}
          </span>
        ) : null}
        <span className="when">kickoff {fmtUtc(round.kickoffMs)}</span>
      </div>
      <div className="round-body">
        {personaIds.map((id) => (
          <Envelope key={id} personaId={id} slip={round.slips[id]} round={round} />
        ))}
      </div>
    </article>
  );
}
