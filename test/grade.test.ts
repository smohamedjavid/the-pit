import { describe, expect, it } from "vitest";
import {
  finalScore90,
  fullTimeReached,
  gradeFromMarketClose,
  gradeFromScores,
  lateGoalAfter75,
  type ScoreRecord,
} from "../corner/src/grade.js";
import type { PickSlip } from "../corner/src/slip.js";

function rec(partial: Partial<ScoreRecord>): ScoreRecord {
  return { FixtureId: 1, Ts: 0, ...partial };
}

const records: ScoreRecord[] = [
  rec({ Ts: 1, StatusId: 1, Action: "kickoff" }),
  rec({
    Ts: 2,
    StatusId: 4,
    Action: "goal",
    Confirmed: true,
    Clock: { Seconds: 4700 },
    Score: {
      Participant1: { H1: { Goals: 1 }, H2: { Goals: 1 }, Total: { Goals: 2 } },
      Participant2: { H1: {}, H2: { Goals: 1 }, Total: { Goals: 1 } },
    },
  }),
  rec({ Ts: 3, StatusId: 5, Action: "status" }),
];

const slip: PickSlip = {
  v: 1,
  persona: "steamer",
  round: "replay-1",
  replay: true,
  fixtureId: 1,
  fixture: "A v B",
  kickoffMs: 0,
  picks: {
    matchWinner: { side: "home", team: "A", prob: 0.6 },
    totalGoals: { line: 2.5, side: "over", prob: 0.55 },
    lateGoalAfter75: { yes: true, prob: 0.5 },
  },
  rationale: "r",
  basis: { asOfMs: 0, source: "test" },
  salt: "00",
};

describe("grading from captured TxLINE scores", () => {
  it("reads regular-time score from the freshest record with a Score", () => {
    expect(finalScore90(records)).toEqual({ home: 2, away: 1 });
  });

  it("detects a confirmed second-half goal after 75:00", () => {
    expect(lateGoalAfter75(records)).toBe(true);
    expect(
      lateGoalAfter75([rec({ Action: "goal", StatusId: 4, Clock: { Seconds: 4400 } })])
    ).toBe(false);
    // first-half goals never count, whatever the clock claims
    expect(
      lateGoalAfter75([rec({ Action: "goal", StatusId: 2, Clock: { Seconds: 4700 } })])
    ).toBe(false);
  });

  it("sees full-time via StatusId 5 or game_finalised", () => {
    expect(fullTimeReached(records)).toBe(true);
    expect(fullTimeReached([rec({ Data: { Action: "game_finalised" } })])).toBe(true);
    expect(fullTimeReached([rec({ StatusId: 4 })])).toBe(false);
  });

  it("grades all three legs and averages Brier over graded legs", () => {
    const g = gradeFromScores(slip, records);
    expect(g.source).toBe("txline-scores");
    expect(g.matchWinner).toBe("HIT"); // 2-1 home
    expect(g.totalGoals).toBe("HIT"); // 3 > 2.5
    expect(g.lateGoalAfter75).toBe("HIT");
    // brier = mean((p-1)^2) for three hits
    const expected = ((0.6 - 1) ** 2 + (0.55 - 1) ** 2 + (0.5 - 1) ** 2) / 3;
    expect(g.brier).toBeCloseTo(expected, 4);
  });

  it("pushes a whole-number totals line landing exactly on the number", () => {
    const g = gradeFromScores(
      { ...slip, picks: { ...slip.picks, totalGoals: { line: 3, side: "over", prob: 0.5 } } },
      records
    );
    expect(g.totalGoals).toBe("NO ACTION");
  });
});

describe("market-close fallback", () => {
  it("grades the winner only when the close is decisive", () => {
    const g = gradeFromMarketClose(slip, [0.95, 0.03, 0.02]);
    expect(g.source).toBe("market-close");
    expect(g.matchWinner).toBe("HIT");
    expect(g.totalGoals).toBe("NO ACTION");
    expect(g.lateGoalAfter75).toBe("NO ACTION");
  });

  it("refuses to grade an indecisive close", () => {
    const g = gradeFromMarketClose(slip, [0.55, 0.25, 0.2]);
    expect(g.matchWinner).toBe("NO ACTION");
    expect(g.brier).toBeNull();
  });
});
