import { describe, expect, it } from "vitest";
import { talkLine } from "../corner/src/talk.js";
import { PERSONAS } from "../corner/src/personas.js";

describe("trash-talk determinism", () => {
  it("same persona + event + seed always yields the same line", () => {
    for (let i = 0; i < 5; i++) {
      expect(talkLine("heel", "sealed", "seed-a", { team: "Spain" })).toBe(
        talkLine("heel", "sealed", "seed-a", { team: "Spain" })
      );
    }
  });

  it("different seeds can select different templates", () => {
    const lines = new Set(
      Array.from({ length: 24 }, (_, i) => talkLine("steamer", "hit", `s${i}`, { leg: "match winner" }))
    );
    expect(lines.size).toBeGreaterThan(1);
  });

  it("fills slots and leaves no braces behind", () => {
    for (const p of PERSONAS) {
      for (const ev of ["weighin", "sealed", "revealed", "hit", "miss", "noaction", "swept", "bageled"] as const) {
        const line = talkLine(p.id, ev, "x", {
          team: "Spain",
          line: "over 2.5",
          bps: 120,
          rival: "THE QUANT",
          leg: "total goals",
          fixture: "Spain v Argentina",
        });
        expect(line).not.toMatch(/\{[a-z]+\}/i);
        expect(line.length).toBeGreaterThan(10);
      }
    }
  });
});
