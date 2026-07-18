import type { PickSlip, WinnerSide } from "./slip.js";

/**
 * Grading. Primary source: the TxLINE scores feed for the fixture
 * (records captured to disk at match time — devnet's scores endpoints stop
 * serving a fixture shortly after it finalises, so the corner archives the
 * feed as evidence while it is still live).
 *
 * Fallback for replay rounds where no score record survives: the market's
 * own closing prints (last in-play full-match 1X2). That grades the winner
 * leg only; the other legs settle NO ACTION. The grade record says which
 * source graded it — nothing is silently approximated.
 */

export interface ScoreRecord {
  FixtureId: number;
  Action?: string;
  StatusId?: number;
  Ts: number;
  Seq?: number;
  Confirmed?: boolean;
  Clock?: { Running?: boolean; Seconds?: number };
  Score?: {
    Participant1?: Record<string, { Goals?: number; Corners?: number }>;
    Participant2?: Record<string, { Goals?: number; Corners?: number }>;
  };
  Data?: { Action?: string };
}

export type LegGrade = "HIT" | "MISS" | "NO ACTION";

export interface SlipGrades {
  source: "txline-scores" | "market-close";
  matchWinner: LegGrade;
  totalGoals: LegGrade;
  lateGoalAfter75: LegGrade;
  /** Brier over graded legs (probabilistic honesty score, lower = better) */
  brier: number | null;
  detail: {
    homeGoals90: number | null;
    awayGoals90: number | null;
    resultSide: WinnerSide | null;
    totalGoals90: number | null;
    lateGoal: boolean | null;
  };
}

/** Regular-time (H1+H2) goals for both sides from the last known record. */
export function finalScore90(records: ScoreRecord[]): { home: number; away: number } | undefined {
  // walk from the end: the freshest record with a Score object wins
  for (let i = records.length - 1; i >= 0; i--) {
    const s = records[i].Score;
    if (!s?.Participant1 || !s.Participant2) continue;
    const g = (p: Record<string, { Goals?: number }>) =>
      (p.H1?.Goals ?? 0) + (p.H2?.Goals ?? 0);
    return { home: g(s.Participant1), away: g(s.Participant2) };
  }
  return undefined;
}

/**
 * Was there a confirmed goal after the 75th minute of regular time?
 * StatusId 4 = second half; Clock.Seconds is the running game clock, so
 * >= 4500s (75:00) during the second half includes stoppage time,
 * which is exactly what "late goal" means at the pub.
 */
export function lateGoalAfter75(records: ScoreRecord[]): boolean {
  return records.some(
    (r) =>
      (r.Action === "goal" || r.Data?.Action === "goal") &&
      r.Confirmed !== false &&
      r.StatusId === 4 &&
      (r.Clock?.Seconds ?? 0) >= 4500
  );
}

export function fullTimeReached(records: ScoreRecord[]): boolean {
  return records.some(
    (r) => r.StatusId === 5 || r.Action === "game_finalised" || r.Data?.Action === "game_finalised"
  );
}

function resultSide(home: number, away: number): WinnerSide {
  return home > away ? "home" : away > home ? "away" : "draw";
}

function brierOf(graded: Array<{ grade: LegGrade; prob: number }>): number | null {
  const active = graded.filter((g) => g.grade !== "NO ACTION");
  if (active.length === 0) return null;
  const sum = active.reduce((a, g) => a + (g.prob - (g.grade === "HIT" ? 1 : 0)) ** 2, 0);
  return Number((sum / active.length).toFixed(4));
}

/** Grade a slip against captured TxLINE score records. */
export function gradeFromScores(slip: PickSlip, records: ScoreRecord[]): SlipGrades {
  const score = finalScore90(records);
  if (!score) throw new Error(`no score records with a Score object for fixture ${slip.fixtureId}`);
  const side = resultSide(score.home, score.away);
  const total = score.home + score.away;
  const late = lateGoalAfter75(records);

  const mw: LegGrade = slip.picks.matchWinner.side === side ? "HIT" : "MISS";
  const tg: LegGrade =
    (slip.picks.totalGoals.side === "over") === total > slip.picks.totalGoals.line &&
    total !== slip.picks.totalGoals.line
      ? "HIT"
      : total === slip.picks.totalGoals.line
        ? "NO ACTION" // push on a whole-number line
        : "MISS";
  const lg: LegGrade = slip.picks.lateGoalAfter75.yes === late ? "HIT" : "MISS";

  return {
    source: "txline-scores",
    matchWinner: mw,
    totalGoals: tg,
    lateGoalAfter75: lg,
    brier: brierOf([
      { grade: mw, prob: slip.picks.matchWinner.prob },
      { grade: tg, prob: slip.picks.totalGoals.prob },
      { grade: lg, prob: slip.picks.lateGoalAfter75.prob },
    ]),
    detail: {
      homeGoals90: score.home,
      awayGoals90: score.away,
      resultSide: side,
      totalGoals90: total,
      lateGoal: late,
    },
  };
}

/**
 * Market-close fallback: the last in-play 1X2 print names the winner iff
 * the market had effectively settled (max prob >= 0.90). Everything else
 * is NO ACTION.
 */
export function gradeFromMarketClose(
  slip: PickSlip,
  closeProbs: number[] | undefined
): SlipGrades {
  let mw: LegGrade = "NO ACTION";
  let side: WinnerSide | null = null;
  if (closeProbs && closeProbs.length === 3) {
    const iMax = closeProbs.indexOf(Math.max(...closeProbs));
    if (closeProbs[iMax] >= 0.9) {
      side = (["home", "draw", "away"] as const)[iMax];
      mw = slip.picks.matchWinner.side === side ? "HIT" : "MISS";
    }
  }
  return {
    source: "market-close",
    matchWinner: mw,
    totalGoals: "NO ACTION",
    lateGoalAfter75: "NO ACTION",
    brier: brierOf([{ grade: mw, prob: slip.picks.matchWinner.prob }]),
    detail: {
      homeGoals90: null,
      awayGoals90: null,
      resultSide: side,
      totalGoals90: null,
      lateGoal: null,
    },
  };
}
