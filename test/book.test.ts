import { describe, expect, it } from "vitest";
import { buildBook, lastInPlayX12, type OddsUpdate } from "../corner/src/book.js";
import { runEngine, poissonModel, poissonCdf } from "../corner/src/personas.js";

/**
 * Synthetic odds tape (no real TxLINE data is committed to this repo).
 * Story: over ~12h the home side steams from ~33% to ~45%, the away side
 * drifts; the totals market trades 2.5 and the AH ladder prices home -0.25
 * near even late on.
 */
const KICKOFF = 1_784_487_600_000;
const H = 3_600_000;

function u(partial: Partial<OddsUpdate>): OddsUpdate {
  return {
    FixtureId: 7,
    Ts: KICKOFF - 12 * H,
    SuperOddsType: "1X2_PARTICIPANT_RESULT",
    MarketParameters: null,
    MarketPeriod: null,
    InRunning: false,
    PriceNames: ["part1", "draw", "part2"],
    Prices: [3000, 3200, 3000],
    ...partial,
  };
}

const tape: OddsUpdate[] = [
  // early 1X2: dead even
  u({ Ts: KICKOFF - 12 * H, Prices: [3000, 3200, 3000] }),
  u({ Ts: KICKOFF - 8 * H, Prices: [2800, 3200, 3100] }),
  // home steams over the last six hours
  u({ Ts: KICKOFF - 5 * H, Prices: [2500, 3300, 3400] }),
  u({ Ts: KICKOFF - 2 * H, Prices: [2300, 3400, 3700] }),
  u({ Ts: KICKOFF - 1 * H, Prices: [2200, 3400, 3900] }),
  // a half-period market that must be ignored
  u({ Ts: KICKOFF - 1 * H, MarketPeriod: "half=1", Prices: [3100, 2200, 5000] }),
  // totals: 2.5 quoted throughout, 2.25 quoted more often (must lose primaryLine)
  u({
    Ts: KICKOFF - 6 * H,
    SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
    MarketParameters: "line=2.5",
    PriceNames: ["over", "under"],
    Prices: [1900, 1900],
  }),
  u({
    Ts: KICKOFF - 2 * H,
    SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
    MarketParameters: "line=2.5",
    PriceNames: ["over", "under"],
    Prices: [2050, 1800],
  }),
  ...[5, 4, 3, 2.5, 2].map((h) =>
    u({
      Ts: KICKOFF - h * H,
      SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
      MarketParameters: "line=2.25",
      PriceNames: ["over", "under"],
      Prices: [1800, 2000],
    })
  ),
  // AH ladder: home -0.25 close to even late
  u({
    Ts: KICKOFF - 90 * 60_000,
    SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS",
    MarketParameters: "line=-0.25",
    PriceNames: ["part1", "part2"],
    Prices: [1950, 1930],
  }),
  u({
    Ts: KICKOFF - 90 * 60_000,
    SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS",
    MarketParameters: "line=-0.75",
    PriceNames: ["part1", "part2"],
    Prices: [2600, 1500],
  }),
  // post-kickoff prints that must never leak into a pre-kickoff book
  u({ Ts: KICKOFF + 10 * 60_000, InRunning: true, Prices: [1200, 6000, 15000] }),
];

const META = { fixtureId: 7, home: "Homeshire", away: "Awayton", kickoffMs: KICKOFF };

describe("book building", () => {
  const book = buildBook(tape, 7, KICKOFF);

  it("keeps only pre-cutoff, pre-match, full-match prints", () => {
    expect(book.x12).toHaveLength(5);
    expect(book.x12.at(-1)!.prices[0]).toBeCloseTo(2.2);
  });

  it("refuses quarter-ball primary lines even when they trade more", () => {
    expect(book.primaryLine).toBe(2.5);
  });

  it("collects the AH ladder", () => {
    expect([...book.handicaps.keys()].sort((a, b) => a - b)).toEqual([-0.75, -0.25]);
  });

  it("finds the in-play close only from in-running prints", () => {
    const close = lastInPlayX12(tape, 7);
    expect(close).toBeDefined();
    expect(close!.probs[0]).toBeGreaterThan(0.7);
  });
});

describe("persona engines", () => {
  const book = buildBook(tape, 7, KICKOFF);

  it("are deterministic — same book, same slip picks", () => {
    const a = runEngine("steamer", book, META);
    const b = runEngine("steamer", book, META);
    expect(a).toEqual(b);
  });

  it("the steamer backs the steamed side", () => {
    const out = runEngine("steamer", book, META);
    expect(out.picks.matchWinner.side).toBe("home");
    expect(out.color.movedBps).toBeGreaterThan(200);
  });

  it("the heel fades the steam", () => {
    const out = runEngine("heel", book, META);
    expect(out.picks.matchWinner.side).not.toBe("home");
  });

  it("the quant prices from its model, not from the crowd's move", () => {
    const out = runEngine("quant", book, META);
    const model = poissonModel(book, 0.5);
    expect(model.supremacy).toBeCloseTo(0.25);
    expect(out.picks.matchWinner.prob).toBeGreaterThan(0);
    expect(out.picks.matchWinner.prob).toBeLessThan(1);
  });

  it("all probabilities are honest probabilities", () => {
    for (const id of ["steamer", "quant", "heel"] as const) {
      const out = runEngine(id, book, META);
      for (const p of [
        out.picks.matchWinner.prob,
        out.picks.totalGoals.prob,
        out.picks.lateGoalAfter75.prob,
      ]) {
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });
});

describe("poisson helpers", () => {
  it("cdf is monotone and bounded", () => {
    expect(poissonCdf(2.5, 2.6)).toBeGreaterThan(0);
    expect(poissonCdf(2.5, 2.6)).toBeLessThan(1);
    expect(poissonCdf(5, 2.6)).toBeGreaterThan(poissonCdf(2, 2.6));
  });
});
