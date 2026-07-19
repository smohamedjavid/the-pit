/**
 * Zero-credential judge verifier for The Pit.
 *
 *   npx tsx scripts/verify.ts            # public devnet RPC, no env needed
 *   RPC=<url> npx tsx scripts/verify.ts  # optional RPC override
 *   npx tsx scripts/verify.ts --commitment <pubkey>  # audit ONE commitment account
 *   npx tsx scripts/verify.ts --strategy <pubkey>    # audit ONE strategy + its commits
 *
 * The two focus flags are additive filters only: with no args the full audit
 * runs exactly as before. They let a broadcast link hand a judge the exact
 * one-liner that checks the single slip in front of them.
 *
 * What it proves, from chain state alone plus this repo's revealed payloads:
 *   1. every Strategy account on the registry (who promised what, when)
 *   2. every Commitment: sealed hash, sealed-at time, deadline discipline
 *      (committed_at < event_deadline is enforced by the program itself)
 *   3. for revealed commitments whose payloads are published in
 *      broadcast/data/rounds.json: recompute keccak256(payload) and check it
 *      equals the on-chain hash — a failed recompute means a doctored reveal
 *   4. cadence: promised signals/day vs actually delivered, per strategy —
 *      silence is measurable, cherry-picking convicts itself
 *
 * Everything decodes with Anchor's BorshCoder directly from account bytes;
 * no indexer, no API keys, no trust in this repo's JSON beyond the payload
 * text whose hash the chain itself certifies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";
import { keccak_256 } from "@noble/hashes/sha3";
import { createRequire } from "node:module";

const { BorshCoder } = anchorPkg;
const require = createRequire(import.meta.url);
const idl = require("../corner/src/idl-tape.json");

const PROGRAM_ID = new PublicKey("8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD");
// Canonical devnet endpoint by default — getProgramAccounts is heavy and some
// public RPCs throttle it hard; override with RPC=<url> if this one is busy.
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// discriminators from the IDL — account data starts with these 8 bytes
const disc = (name: string): Buffer =>
  Buffer.from((idl.accounts as Array<{ name: string; discriminator: number[] }>)
    .find((a) => a.name === name)!.discriminator);

interface StrategyAcc {
  address: string;
  authority: string;
  strategyIdx: number;
  paramsHashHex: string;
  windowStart: number;
  windowEnd: number;
  expectedPerDay: number;
  signalCount: bigint;
}

interface CommitmentAcc {
  address: string;
  strategy: string;
  seq: bigint;
  payloadHashHex: string;
  fixtureId: number;
  eventDeadline: number;
  committedAt: number;
  revealed: boolean;
}

interface PublishedSlip {
  hashHex: string;
  commitment?: string;
  canonical?: string;
  slip?: { persona: string };
}

function publishedPayloads(): Map<string, { canonical: string; persona: string; round: string }> {
  const out = new Map<string, { canonical: string; persona: string; round: string }>();
  const file = path.join(ROOT, "broadcast", "data", "rounds.json");
  if (!fs.existsSync(file)) return out;
  const rounds = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
    id: string;
    slips: Record<string, PublishedSlip>;
  }>;
  for (const r of rounds) {
    for (const [persona, s] of Object.entries(r.slips)) {
      if (s.commitment && s.canonical) {
        out.set(s.commitment, { canonical: s.canonical, persona, round: r.id });
      }
    }
  }
  return out;
}

function personaParams(): Map<string, { persona: string; params: string }> {
  const out = new Map<string, { persona: string; params: string }>();
  const file = path.join(ROOT, "broadcast", "data", "meta.json");
  if (!fs.existsSync(file)) return out;
  const meta = JSON.parse(fs.readFileSync(file, "utf8")) as {
    personas: Array<{ id: string; params: string; strategyAddress?: string }>;
  };
  for (const p of meta.personas) {
    if (p.strategyAddress) out.set(p.strategyAddress, { persona: p.id, params: p.params });
  }
  return out;
}

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const ts = (sec: number) => new Date(sec * 1000).toISOString().replace(".000Z", "Z");

// Optional focus filters. Backward compatible: no flags → full audit.
// Accepts `--commitment <pubkey>` / `--commitment=<pubkey>` (and --strategy).
function parseFocus(argv: string[]): { commitment?: string; strategy?: string } {
  const out: { commitment?: string; strategy?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(commitment|strategy)(?:=(.+))?$/.exec(argv[i]);
    if (!m) continue;
    const key = m[1] as "commitment" | "strategy";
    const val = m[2] ?? argv[++i];
    if (!val || val.startsWith("--")) {
      console.error(`--${key} needs a base58 pubkey, e.g. --${key} <account>`);
      process.exit(1);
    }
    try {
      new PublicKey(val);
    } catch {
      console.error(`--${key}: "${val}" is not a valid base58 pubkey`);
      process.exit(1);
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const focus = parseFocus(process.argv.slice(2));
  console.log(`THE PIT — registry verifier`);
  console.log(`program ${PROGRAM_ID.toBase58()} (devnet)`);
  console.log(`rpc     ${RPC}`);
  if (focus.commitment) console.log(`focus   commitment ${focus.commitment}`);
  if (focus.strategy) console.log(`focus   strategy ${focus.strategy}`);
  console.log("");

  const conn = new Connection(RPC, "confirmed");
  const coder = new BorshCoder(idl);
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed" });

  const strategies: StrategyAcc[] = [];
  const commitments: CommitmentAcc[] = [];
  let undecodable = 0;

  for (const { pubkey, account } of accounts) {
    const d = account.data.subarray(0, 8);
    try {
      if (d.equals(disc("Strategy"))) {
        // BorshCoder is case-literal: account name and field names exactly
        // as the IDL writes them (Rust snake_case)
        const s = coder.accounts.decode("Strategy", account.data);
        strategies.push({
          address: pubkey.toBase58(),
          authority: new PublicKey(s.authority).toBase58(),
          strategyIdx: Number(s.strategy_idx),
          paramsHashHex: Buffer.from(s.params_hash).toString("hex"),
          windowStart: Number(s.window_start),
          windowEnd: Number(s.window_end),
          expectedPerDay: Number(s.expected_signals_per_day),
          signalCount: BigInt(s.signal_count.toString()),
        });
      } else if (d.equals(disc("Commitment"))) {
        const c = coder.accounts.decode("Commitment", account.data);
        commitments.push({
          address: pubkey.toBase58(),
          strategy: new PublicKey(c.strategy).toBase58(),
          seq: BigInt(c.seq.toString()),
          payloadHashHex: Buffer.from(c.payload_hash).toString("hex"),
          fixtureId: Number(c.fixture_id),
          eventDeadline: Number(c.event_deadline),
          committedAt: Number(c.committed_at),
          revealed: Boolean(c.revealed),
        });
      }
    } catch (e) {
      undecodable += 1;
      console.error(`decode failed for ${pubkey.toBase58()}: ${(e as Error).message}`);
    }
  }

  strategies.sort((a, b) => a.windowStart - b.windowStart);
  commitments.sort((a, b) => a.committedAt - b.committedAt);

  // Focus filters narrow only what is displayed and hash-checked; cadence math
  // below still runs over the full commitment set so "delivered" stays honest.
  let shownStrategies = strategies;
  let shownCommitments = commitments;
  if (focus.commitment) {
    shownCommitments = commitments.filter((c) => c.address === focus.commitment);
    const owners = new Set(shownCommitments.map((c) => c.strategy));
    shownStrategies = strategies.filter((s) => owners.has(s.address));
  }
  if (focus.strategy) {
    shownStrategies = shownStrategies.filter((s) => s.address === focus.strategy);
    shownCommitments = shownCommitments.filter((c) => c.strategy === focus.strategy);
  }
  if (
    (focus.commitment || focus.strategy) &&
    shownStrategies.length === 0 &&
    shownCommitments.length === 0
  ) {
    console.error(
      `no account on ${PROGRAM_ID.toBase58()} matches the requested focus — ` +
        `check the pubkey is a commitment/strategy on this program (devnet)`
    );
    process.exit(1);
  }

  const payloads = publishedPayloads();
  const params = personaParams();
  const nowSec = Math.floor(Date.now() / 1000);

  let pass = 0;
  let fail = 0;
  let hashOnly = 0;

  console.log(`── strategies (${shownStrategies.length}) ──────────────────────────────────────`);
  for (const s of shownStrategies) {
    const known = params.get(s.address);
    let paramsNote = "params hash sealed on-chain (preimage not published)";
    if (known) {
      const recomputed = Buffer.from(keccak_256(new TextEncoder().encode(known.params))).toString("hex");
      const ok = recomputed === s.paramsHashHex;
      paramsNote = ok
        ? `params preimage verifies (keccak matches) — ${known.persona.toUpperCase()}`
        : `PARAMS HASH MISMATCH for published ${known.persona} params`;
      ok ? pass++ : fail++;
    }
    const mine = commitments.filter((c) => c.strategy === s.address);
    const windowDays = Math.max(
      (Math.min(nowSec, s.windowEnd) - s.windowStart) / 86_400,
      0.01
    );
    const expected = Math.floor(windowDays * s.expectedPerDay);
    const delivered = mine.length;
    const cadence =
      expected === 0
        ? "window just opened"
        : `promised ~${expected}, delivered ${delivered} ${delivered >= expected ? "(kept)" : `(deficit ${expected - delivered})`}`;
    console.log(
      `${short(s.address)}  authority ${short(s.authority)}  idx ${s.strategyIdx}  window ${ts(s.windowStart)} → ${ts(s.windowEnd)}`
    );
    console.log(`  cadence: ${s.expectedPerDay}/day — ${cadence}`);
    console.log(`  ${paramsNote}`);
  }

  console.log(`\n── commitments (${shownCommitments.length}) ─────────────────────────────────────`);
  for (const c of shownCommitments) {
    const early = c.committedAt < c.eventDeadline;
    let verdict: string;
    if (!c.revealed) {
      verdict = "SEALED  (unrevealed — hash only, program will reject any payload that does not match)";
    } else {
      const pub = payloads.get(c.address);
      if (!pub) {
        hashOnly += 1;
        verdict = "REVEALED (payload not published in this repo — hash-only entry from the pre-season tape)";
      } else {
        const recomputed = Buffer.from(keccak_256(new TextEncoder().encode(pub.canonical))).toString("hex");
        if (recomputed === c.payloadHashHex) {
          pass += 1;
          verdict = `PASS    keccak(payload) == on-chain hash  [${pub.persona}/${pub.round}]`;
        } else {
          fail += 1;
          verdict = `FAIL    published payload does NOT hash to the sealed value  [${pub.persona}/${pub.round}]`;
        }
      }
    }
    console.log(
      `${short(c.address)}  ${short(c.strategy)}#${c.seq}  fixture ${c.fixtureId}  sealed ${ts(c.committedAt)}  ${early ? "pre-deadline ok" : "DEADLINE VIOLATION"}  ${verdict}`
    );
  }

  console.log(`\n── verdict ─────────────────────────────────────────────────`);
  console.log(`strategies: ${shownStrategies.length}   commitments: ${shownCommitments.length}   undecodable: ${undecodable}`);
  console.log(`hash recomputations — PASS: ${pass}   FAIL: ${fail}   hash-only (payload not in repo): ${hashOnly}`);
  console.log(
    fail === 0 && undecodable === 0
      ? "\nEvery published payload matches its sealed on-chain hash. Nothing here can be quietly rewritten."
      : "\nMISMATCHES FOUND — the tape does not lie; someone tried to."
  );
  if (fail > 0 || undecodable > 0) process.exit(1);
}

main().catch((e) => {
  console.error("verify failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
