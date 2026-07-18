import { describe, expect, it } from "vitest";
import anchorPkg from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { createRequire } from "node:module";
import { canonicalJson } from "../corner/src/slip.js";

const { BorshCoder, BN } = anchorPkg;
const require = createRequire(import.meta.url);
const idl = require("../corner/src/idl-tape.json");

/**
 * The verifier's decode path, exercised offline: encode account bytes with
 * the same BorshCoder the chain data decodes with, then prove the
 * case-literal contract (account names and snake_case fields exactly as the
 * IDL writes them — the camelizing Program client is NOT in this path).
 */
describe("verify.ts decode path", () => {
  const coder = new BorshCoder(idl);

  it("round-trips a Strategy account case-literally", async () => {
    const authority = Keypair.generate().publicKey;
    const paramsHash = Array.from(keccak_256(new TextEncoder().encode("pit/steamer/v1|x")));
    const buf = await coder.accounts.encode("Strategy", {
      authority,
      strategy_idx: 0,
      params_hash: paramsHash,
      window_start: new BN(1784416158),
      window_end: new BN(1785542399),
      expected_signals_per_day: 1,
      signal_count: new BN(3),
      bump: 254,
    });
    const disc = (idl.accounts as Array<{ name: string; discriminator: number[] }>).find(
      (a) => a.name === "Strategy"
    )!.discriminator;
    expect(Array.from(buf.subarray(0, 8))).toEqual(disc);

    const s = coder.accounts.decode("Strategy", buf);
    expect(Number(s.strategy_idx)).toBe(0);
    expect(Number(s.expected_signals_per_day)).toBe(1);
    expect(Buffer.from(s.params_hash).toString("hex")).toBe(
      Buffer.from(paramsHash).toString("hex")
    );
    // the camelCase spelling must NOT exist on a BorshCoder decode
    expect((s as Record<string, unknown>).paramsHash).toBeUndefined();
  });

  it("round-trips a Commitment and re-verifies a canonical payload hash", async () => {
    const strategy = Keypair.generate().publicKey;
    const payload = canonicalJson({ b: 2, a: { z: 1, y: [3, 2] } });
    const payloadHash = Array.from(keccak_256(new TextEncoder().encode(payload)));
    const buf = await coder.accounts.encode("Commitment", {
      strategy,
      seq: new BN(7),
      payload_hash: payloadHash,
      fixture_id: new BN(18257739),
      event_deadline: new BN(1784487600),
      committed_at: new BN(1784416200),
      committed_slot: new BN(1),
      revealed: true,
      bump: 255,
    });
    const c = coder.accounts.decode("Commitment", buf);
    expect(Number(c.fixture_id)).toBe(18257739);
    expect(Boolean(c.revealed)).toBe(true);
    // the judge-path recompute: keccak(published payload) == sealed hash
    const recomputed = Buffer.from(keccak_256(new TextEncoder().encode(payload))).toString("hex");
    expect(recomputed).toBe(Buffer.from(c.payload_hash).toString("hex"));
    // and a doctored payload must fail
    const doctored = payload.replace("2", "3");
    expect(
      Buffer.from(keccak_256(new TextEncoder().encode(doctored))).toString("hex")
    ).not.toBe(recomputed);
  });
});
