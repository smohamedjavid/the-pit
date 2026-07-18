import type { Book } from "./book.js";
import { pointAt } from "./book.js";
import type { PersonaId, PickSlip, WinnerSide } from "./slip.js";

/**
 * Three pundits, three genuinely different reads of the same tape.
 * Every engine is a pure function of the pre-kickoff book — deterministic
 * by construction, because the whole point of The Pit is that a pick can
 * be re-derived from archived data and checked against the sealed hash.
 */

export interface PersonaDef {
  id: PersonaId;
  name: string;
  tagline: string;
  style: string;
  /** canonical params string — keccak of this is the on-chain params_hash */
  params: string;
  /** cadence promise registered on-chain (slips per day inside the window) */
  expectedPerDay: number;
}

export const PERSONAS: PersonaDef[] = [
  {
    id: "steamer",
    name: "THE STEAMER",
    tagline: "Follows the money. Never early, never wrong for long.",
    style: "momentum — backs the side the market is steaming toward",
    params: "pit/steamer/v1|lookbackH=6|pickBy=max-prob-delta|totals=steam-side|late=goals-lambda+steam",
    expectedPerDay: 1,
  },
  {
    id: "quant",
    name: "THE QUANT",
    tagline: "Two lambdas and a hash function. That is the whole act.",
    style: "value — fits a Poisson model to the handicap/totals ladder, backs the side the 1X2 underprices",
    params: "pit/quant/v1|model=poisson|supremacy=ah-even-line|total=primary-ou|pickBy=max-model-edge|late=lambda*19/94*1.25",
    expectedPerDay: 1,
  },
  {
    id: "heel",
    name: "THE HEEL",
    tagline: "Your favourite pundit's least favourite pundit.",
    style: "contrarian — fades the biggest public move on the board",
    params: "pit/heel/v1|lookbackH=6|pickBy=min-prob-delta|totals=fade-steam|late=fade-crowd",
    expectedPerDay: 1,
  },
];

export function persona(id: PersonaId): PersonaDef {
  const p = PERSONAS.find((p) => p.id === id);
  if (!p) throw new Error(`unknown persona ${id}`);
  return p;
}

const SIDES: WinnerSide[] = ["home", "draw", "away"];

export interface FixtureMeta {
  fixtureId: number;
  home: string;
  away: string;
  kickoffMs: number;
}

export interface EngineOut {
  picks: PickSlip["picks"];
  rationale: string;
  /** numbers the talk layer can quote */
  color: { movedSide: WinnerSide; movedBps: number; evPct: number; pLate: number };
}

function teamOf(meta: FixtureMeta, side: WinnerSide): string {
  return side === "home" ? meta.home : side === "away" ? meta.away : "Draw";
}

const r3 = (x: number) => Number(x.toFixed(3));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Shared market read: the last pre-cutoff print vs the book ~6 hours of
 * trading earlier (anchored to the last print, not wall-clock, so a slip
 * sealed 20h before kickoff still measures real movement).
 */
function marketRead(book: Book) {
  const latest = book.x12[book.x12.length - 1];
  if (!latest) throw new Error(`no pre-kickoff 1X2 prints for fixture ${book.fixtureId}`);
  const anchor = latest.ts - 6 * 3600_000;
  const baseline = pointAt(book.x12, anchor) ?? book.x12[0];
  const deltas = latest.probs.map((p, i) => p - baseline.probs[i]);

  const totalsSeries = book.totals.get(book.primaryLine) ?? [];
  const tLatest = totalsSeries[totalsSeries.length - 1];
  const tBaseline = pointAt(totalsSeries, anchor) ?? totalsSeries[0];
  const overDelta = tLatest && tBaseline ? tLatest.overProb - tBaseline.overProb : 0;

  // crude goals expectancy off the primary line + where the over is priced
  const overProb = tLatest?.overProb ?? 0.5;
  const lambda = Math.max(0.4, book.primaryLine + (overProb - 0.5) * 2);
  // P(any goal after 75:00): 19 of 94 played minutes, late-game intensity 1.25
  const pLate = 1 - Math.exp(-lambda * (19 / 94) * 1.25);

  return { latest, baseline, deltas, tLatest, overDelta, overProb, lambda, pLate };
}

/** P(N <= line) for integer-truncated line under Poisson(lambda). */
export function poissonCdf(line: number, lambda: number): number {
  let acc = 0;
  for (let k = 0; k <= Math.floor(line); k++) acc += pois(k, lambda);
  return acc;
}

const pois = (k: number, l: number): number => {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-l) * l ** k) / f;
};

/**
 * The Quant's model: home supremacy from the Asian-handicap line closest to
 * even money, total goals from the primary OU line + its price skew, then
 * independent Poissons for each side's goals → 1X2 model probabilities.
 */
export function poissonModel(book: Book, overProb: number): {
  supremacy: number;
  lambdaTotal: number;
  probs: [number, number, number];
} {
  // find the AH line where the two sides price closest to even at the latest print
  let supremacy = 0;
  let bestGap = Infinity;
  for (const [line, pts] of book.handicaps) {
    const last = pts[pts.length - 1];
    if (!last) continue;
    const gap = Math.abs(last.part1Prob - 0.5);
    if (gap < bestGap) {
      bestGap = gap;
      // home getting line L prices even ⇒ home is about -L goals better
      supremacy = -line;
    }
  }
  const lambdaTotal = Math.max(0.5, book.primaryLine + (overProb - 0.5) * 2);
  const lh = Math.max(0.05, (lambdaTotal + supremacy) / 2);
  const la = Math.max(0.05, (lambdaTotal - supremacy) / 2);
  let pH = 0;
  let pD = 0;
  let pA = 0;
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const p = pois(h, lh) * pois(a, la);
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
    }
  }
  const norm = pH + pD + pA;
  return { supremacy, lambdaTotal, probs: [pH / norm, pD / norm, pA / norm] };
}

export function runEngine(id: PersonaId, book: Book, meta: FixtureMeta): EngineOut {
  const m = marketRead(book);
  const line = book.primaryLine;

  let side: WinnerSide;
  let prob: number;
  let totalsSide: "over" | "under";
  let totalsProb: number;
  let lateYes: boolean;
  let lateProb: number;
  let rationale: string;

  const iMax = m.deltas.indexOf(Math.max(...m.deltas));
  const iMin = m.deltas.indexOf(Math.min(...m.deltas));
  const movedBps = Math.round(m.deltas[iMax] * 10_000);

  if (id === "steamer") {
    side = SIDES[iMax];
    prob = m.latest.probs[iMax];
    totalsSide = m.overDelta >= 0 ? "over" : "under";
    totalsProb = totalsSide === "over" ? m.tLatest?.overProb ?? 0.5 : m.tLatest?.underProb ?? 0.5;
    const pLateSteamed = clamp(m.pLate + m.overDelta * 2, 0.05, 0.95);
    lateYes = pLateSteamed >= 0.5;
    lateProb = lateYes ? pLateSteamed : 1 - pLateSteamed;
    rationale = `Money moved ${movedBps}bps onto ${teamOf(meta, side)} in six hours. I go where it goes.`;
  } else if (id === "quant") {
    // model probs vs market probs: back the biggest positive model edge
    const model = poissonModel(book, m.overProb);
    const edges = model.probs.map((p, i) => p - m.latest.probs[i]);
    const iBest = edges.indexOf(Math.max(...edges));
    side = SIDES[iBest];
    prob = clamp(model.probs[iBest], 0.01, 0.99);
    // totals: model P(N > line) vs the market's over price
    const pOverModel = 1 - poissonCdf(book.primaryLine, model.lambdaTotal);
    const marketOver = m.tLatest?.overProb ?? 0.5;
    totalsSide = pOverModel >= marketOver ? "over" : "under";
    totalsProb = clamp(totalsSide === "over" ? pOverModel : 1 - pOverModel, 0.01, 0.99);
    const pLateQ = 1 - Math.exp(-model.lambdaTotal * (19 / 94) * 1.25);
    lateYes = pLateQ >= 0.5;
    lateProb = lateYes ? pLateQ : 1 - pLateQ;
    const edgeBps = Math.round(edges[iBest] * 10_000);
    rationale = `Two Poissons fitted to the handicap ladder make ${teamOf(meta, side)} ${(model.probs[iBest] * 100).toFixed(1)}%; the 1X2 says ${(m.latest.probs[iBest] * 100).toFixed(1)}%. That is ${edgeBps} basis points the market is giving away.`;
  } else {
    // the heel: back whatever the crowd just walked away from
    side = SIDES[iMin];
    prob = m.latest.probs[iMin];
    totalsSide = m.overDelta > 0 ? "under" : "over";
    totalsProb = totalsSide === "over" ? m.tLatest?.overProb ?? 0.5 : m.tLatest?.underProb ?? 0.5;
    lateYes = m.pLate < 0.5; // the crowd expects late drama when pLate is high; fade it
    lateProb = clamp(lateYes ? 1 - m.pLate : m.pLate, 0.05, 0.95);
    // heel grades himself on the market's own number — honesty as insult
    rationale = `The herd dumped ${teamOf(meta, side)} for ${teamOf(meta, SIDES[iMax])}. Herds drown. I'll take the side they left warm.`;
  }

  return {
    picks: {
      matchWinner: { side, team: teamOf(meta, side), prob: r3(prob) },
      totalGoals: { line, side: totalsSide, prob: r3(totalsProb) },
      lateGoalAfter75: { yes: lateYes, prob: r3(lateProb) },
    },
    rationale,
    color: {
      movedSide: SIDES[iMax],
      movedBps,
      evPct: r3(prob * (m.latest.prices[SIDES.indexOf(side)] ?? 0) - 1),
      pLate: r3(m.pLate),
    },
  };
}
