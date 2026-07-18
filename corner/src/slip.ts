import { keccak_256 } from "@noble/hashes/sha3";

/**
 * The pick-slip: one pundit's full call on one fixture, sealed on-chain
 * before kickoff as keccak256 of the canonical JSON encoding below.
 *
 * Canonicalisation rule: recursively sort object keys, serialise with
 * JSON.stringify and no whitespace. Same slip in, same bytes out, on any
 * machine — the reveal must reproduce these bytes exactly or the program
 * rejects it (HashMismatch).
 *
 * The salt exists because a slip's pick-space is small enough to enumerate;
 * without it a sealed hash could be brute-forced before the reveal.
 */
export type PersonaId = "steamer" | "quant" | "heel";

export type WinnerSide = "home" | "draw" | "away";

export interface PickSlip {
  v: 1;
  persona: PersonaId;
  round: string; // "main-event", "replay-1", ...
  replay: boolean;
  fixtureId: number;
  fixture: string; // "Spain v Argentina"
  kickoffMs: number;
  picks: {
    matchWinner: { side: WinnerSide; team: string; prob: number };
    totalGoals: { line: number; side: "over" | "under"; prob: number };
    lateGoalAfter75: { yes: boolean; prob: number };
  };
  rationale: string;
  basis: { asOfMs: number; source: string };
  salt: string;
}

/** Recursively sort object keys; arrays keep order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function slipBytes(slip: PickSlip): Uint8Array {
  return new TextEncoder().encode(canonicalJson(slip));
}

export function slipHash(slip: PickSlip): Uint8Array {
  return keccak_256(slipBytes(slip));
}

export function slipHashHex(slip: PickSlip): string {
  return Buffer.from(slipHash(slip)).toString("hex");
}

/** Verify a revealed payload against an on-chain hash. */
export function payloadMatches(payloadUtf8: string, hashHex: string): boolean {
  const h = keccak_256(new TextEncoder().encode(payloadUtf8));
  return Buffer.from(h).toString("hex") === hashHex.toLowerCase();
}
