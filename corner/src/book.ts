/**
 * The book: a fixture's odds history distilled into what the personas
 * actually argue about. Built from TxLINE `/api/odds/updates/{fixtureId}`
 * records (StablePrice-demargined feed — the only odds tier on devnet).
 *
 * TxLINE facts this code leans on:
 *  - records are PascalCase; prices are decimal odds × 1000 (1857 = 1.857)
 *  - `1X2_PARTICIPANT_RESULT` with MarketPeriod null = full-match winner
 *  - `OVERUNDER_PARTICIPANT_GOALS` with MarketPeriod null + `line=X` params
 *  - `InRunning: false` = pre-match prints
 */

export interface OddsUpdate {
  FixtureId: number;
  Ts: number;
  SuperOddsType: string;
  MarketParameters: string | null;
  MarketPeriod: string | null;
  InRunning: boolean;
  PriceNames: string[];
  Prices: number[];
}

export interface X12Point {
  ts: number;
  /** decimal odds [home, draw, away] */
  prices: number[];
  /** proportionally de-margined implied probs [home, draw, away] */
  probs: number[];
}

export interface TotalsPoint {
  ts: number;
  over: number; // decimal odds
  under: number;
  overProb: number; // de-margined (two-way)
  underProb: number;
}

export interface HandicapPoint {
  ts: number;
  part1Prob: number; // home covers the line
  part2Prob: number;
}

export interface Book {
  fixtureId: number;
  cutoffMs: number;
  x12: X12Point[];
  /** totals series per line, e.g. 2.5 → points */
  totals: Map<number, TotalsPoint[]>;
  /** asian handicap series per line (line applies to home) */
  handicaps: Map<number, HandicapPoint[]>;
  /** most-quoted pub-gradable (.0/.5) totals line near the cutoff */
  primaryLine: number;
}

function demargin(prices: number[]): number[] {
  const decimals = prices.map((p) => p / 1000);
  if (decimals.some((d) => d <= 1)) return [];
  const raw = decimals.map((d) => 1 / d);
  const over = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / over);
}

function lineOf(params: string | null): number | undefined {
  const m = /(?:^|,)line=(-?[\d.]+)/.exec(params ?? "");
  return m ? Number(m[1]) : undefined;
}

/** Build the pre-cutoff book from raw odds updates. */
export function buildBook(
  updates: OddsUpdate[],
  fixtureId: number,
  cutoffMs: number
): Book {
  const pre = updates
    .filter((u) => u.FixtureId === fixtureId && u.Ts <= cutoffMs && !u.InRunning)
    .sort((a, b) => a.Ts - b.Ts);

  const x12: X12Point[] = [];
  const totals = new Map<number, TotalsPoint[]>();
  const handicaps = new Map<number, HandicapPoint[]>();

  for (const u of pre) {
    if (u.SuperOddsType === "1X2_PARTICIPANT_RESULT" && u.MarketPeriod == null) {
      if (u.Prices.length !== 3) continue;
      const probs = demargin(u.Prices);
      if (probs.length !== 3) continue;
      x12.push({ ts: u.Ts, prices: u.Prices.map((p) => p / 1000), probs });
    } else if (
      u.SuperOddsType === "OVERUNDER_PARTICIPANT_GOALS" &&
      u.MarketPeriod == null
    ) {
      const line = lineOf(u.MarketParameters);
      if (line === undefined || u.Prices.length !== 2) continue;
      const probs = demargin(u.Prices);
      if (probs.length !== 2) continue;
      const list = totals.get(line) ?? [];
      const iOver = u.PriceNames.indexOf("over");
      const iUnder = u.PriceNames.indexOf("under");
      if (iOver < 0 || iUnder < 0) continue;
      list.push({
        ts: u.Ts,
        over: u.Prices[iOver] / 1000,
        under: u.Prices[iUnder] / 1000,
        overProb: probs[iOver],
        underProb: probs[iUnder],
      });
      totals.set(line, list);
    } else if (
      u.SuperOddsType === "ASIANHANDICAP_PARTICIPANT_GOALS" &&
      u.MarketPeriod == null
    ) {
      const line = lineOf(u.MarketParameters);
      if (line === undefined || u.Prices.length !== 2) continue;
      const probs = demargin(u.Prices);
      if (probs.length !== 2) continue;
      const i1 = u.PriceNames.indexOf("part1");
      const i2 = u.PriceNames.indexOf("part2");
      if (i1 < 0 || i2 < 0) continue;
      const list = handicaps.get(line) ?? [];
      list.push({ ts: u.Ts, part1Prob: probs[i1], part2Prob: probs[i2] });
      handicaps.set(line, list);
    }
  }

  // primary totals line: most prints near the cutoff, restricted to lines a
  // human can settle at the pub (.0 or .5 — no quarter-ball stake splits)
  const lastTs = x12.length ? x12[x12.length - 1].ts : cutoffMs;
  const windowStart = lastTs - 6 * 3600_000;
  let primaryLine = 2.5;
  let bestCount = -1;
  for (const [line, pts] of totals) {
    if (Math.abs(line * 2 - Math.round(line * 2)) > 1e-9) continue; // quarter lines out
    const recent = pts.filter((p) => p.ts >= windowStart).length || pts.length / 1000;
    if (recent > bestCount) {
      bestCount = recent;
      primaryLine = line;
    }
  }

  return { fixtureId, cutoffMs, x12, totals, handicaps, primaryLine };
}

/** Last point at or before ts (or undefined). */
export function pointAt<T extends { ts: number }>(series: T[], ts: number): T | undefined {
  let last: T | undefined;
  for (const p of series) {
    if (p.ts > ts) break;
    last = p;
  }
  return last;
}

/** In-play settlement view for market-close grading (REPLAY fallback). */
export function lastInPlayX12(updates: OddsUpdate[], fixtureId: number):
  | { ts: number; probs: number[] }
  | undefined {
  const inplay = updates
    .filter(
      (u) =>
        u.FixtureId === fixtureId &&
        u.InRunning &&
        u.SuperOddsType === "1X2_PARTICIPANT_RESULT" &&
        u.MarketPeriod == null &&
        u.Prices.length === 3
    )
    .sort((a, b) => a.Ts - b.Ts);
  for (let i = inplay.length - 1; i >= 0; i--) {
    const probs = demargin(inplay[i].Prices);
    if (probs.length === 3) return { ts: inplay[i].Ts, probs };
  }
  return undefined;
}
