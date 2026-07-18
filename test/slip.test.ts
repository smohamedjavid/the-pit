import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  payloadMatches,
  slipBytes,
  slipHashHex,
  type PickSlip,
} from "../corner/src/slip.js";

const slip: PickSlip = {
  v: 1,
  persona: "quant",
  round: "main-event",
  replay: false,
  fixtureId: 18257739,
  fixture: "Spain v Argentina",
  kickoffMs: 1784487600000,
  picks: {
    matchWinner: { side: "home", team: "Spain", prob: 0.481 },
    totalGoals: { line: 2.5, side: "under", prob: 0.55 },
    lateGoalAfter75: { yes: true, prob: 0.52 },
  },
  rationale: "Strip the margin and Spain holds 48.1%.",
  basis: { asOfMs: 1784480000000, source: "txline-stableprice-devnet" },
  salt: "00112233445566778899aabbccddeeff",
};

describe("canonical slip encoding", () => {
  it("sorts keys recursively and is stable across key insertion order", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        salt: slip.salt,
        basis: { source: slip.basis.source, asOfMs: slip.basis.asOfMs },
        rationale: slip.rationale,
        picks: {
          lateGoalAfter75: { prob: 0.52, yes: true },
          totalGoals: { prob: 0.55, side: "under", line: 2.5 },
          matchWinner: { prob: 0.481, team: "Spain", side: "home" },
        },
        kickoffMs: slip.kickoffMs,
        fixture: slip.fixture,
        fixtureId: slip.fixtureId,
        replay: false,
        round: slip.round,
        persona: slip.persona,
        v: 1,
      })
    ) as PickSlip;
    expect(canonicalJson(reordered)).toBe(canonicalJson(slip));
    expect(slipHashHex(reordered)).toBe(slipHashHex(slip));
  });

  it("produces no whitespace and sorted top-level keys", () => {
    const c = canonicalJson(slip);
    expect(c).not.toMatch(/\s"/);
    const keys = Object.keys(JSON.parse(c));
    expect(keys).toEqual([...keys].sort());
  });

  it("hash is keccak256 of the canonical bytes and round-trips via payloadMatches", () => {
    const hex = slipHashHex(slip);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadMatches(canonicalJson(slip), hex)).toBe(true);
    expect(payloadMatches(canonicalJson({ ...slip, salt: "ff" + slip.salt.slice(2) }), hex)).toBe(false);
  });

  it("changing any pick changes the hash", () => {
    const flipped: PickSlip = structuredClone(slip);
    flipped.picks.matchWinner.side = "away";
    expect(slipHashHex(flipped)).not.toBe(slipHashHex(slip));
  });

  it("payload stays inside a comfortable transaction budget", () => {
    expect(slipBytes(slip).length).toBeLessThan(700);
  });
});
