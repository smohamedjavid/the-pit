# THE PIT

Three rival AI pundits predict football on the record: every pick is sealed on-chain before its deadline, revealed after full-time, and graded against TxLINE data. The broadcast looks like a fight night because that is what punditry deserves — but the product is the registry underneath, which makes hiding a bad call impossible.

Solana devnet only. No money moves; the stake is reputation.

Live broadcast: **https://the-pit-pi-five.vercel.app** (alias:
[the-pit-club.vercel.app](https://the-pit-club.vercel.app)). Architecture and
trust-model deep-dive: [TECHNICAL.md](TECHNICAL.md).

## The fight bill

Three personas, three genuinely different engines over the same TxLINE odds feed:

- **THE STEAMER** (momentum) — measures how the de-margined 1X2 probabilities moved over the last six hours of trading and backs the side the money is walking toward.
- **THE QUANT** (value) — fits two Poisson goal rates from the Asian-handicap ladder (supremacy = the line that prices closest to even) and the primary totals line, derives model 1X2 probabilities, and backs the side the market underprices most.
- **THE HEEL** (contrarian) — finds the biggest public move on the board and takes the side the crowd deserted.

Each round, every persona files a full pick-slip for one fixture — match winner, total goals over/under, and a "goal after the 75th minute" prop — with an honest probability on each leg. Slips are canonical JSON; their keccak256 hash is committed on-chain before the deadline; after full-time the payload is revealed and graded leg by leg (HIT / MISS / NO ACTION), with a Brier score over the claimed probabilities so confidence is graded, not just direction.

The engines are pure functions of the pre-kickoff odds book. Same archived book in, same slip out — which is what makes a sealed hash meaningful.

## How sealing works

The registry is a small Anchor program (`program/`, deployed on devnet as [`8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD`](https://explorer.solana.com/address/8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD?cluster=devnet)) with three instructions:

1. `register_strategy` — records keccak256 of the persona's parameter string, its window, and a cadence promise (slips per day). The program requires registration to happen **before** the window opens; parameters are frozen from then on.
2. `commit_signal` — stores a 32-byte payload hash, the fixture id, and an event deadline. The program rejects any commit at or past its deadline; `committed_at` comes from the chain's clock.
3. `reveal_signal` — takes the payload bytes, recomputes keccak256 **on-chain**, and rejects a mismatch. A commitment can never be edited or deleted.

Why hiding calls is impossible: a bad pick can only stay sealed, and the cadence promise makes that visible — anyone can count commitments per day against the promise recorded at registration. Silence is data. The pick-slips carry a random salt, so an unrevealed hash cannot be brute-forced from the small space of possible picks.

## Trust model

Enforced by the program:

- picks are sealed before their deadline (chain clock, not ours)
- a revealed payload is byte-identical to what was sealed
- parameters and cadence promises are frozen before the window opens
- nothing is deletable

Not enforced, stated plainly:

- **computation integrity** — the engines run off-chain; you can re-run them from an archived odds book, but the program cannot attest they ran as published. TEE attestation is the roadmap answer.
- **Sybil strategies** — nothing stops someone registering ten personas and promoting the lucky one. Mitigation is social and structural: registration is public, cadence promises are public, and abandoned siblings stay visible forever.
- **grading inputs** — grades come from TxLINE score records (or, where devnet has already dropped a finished fixture's stats, from the market's own closing prints, labelled as such). The grade is recomputable from archived data, not oracle-attested.
- **replay rounds are demonstrations** — devnet's World Cup ends this weekend, so two rounds replay recent fixtures and are labelled REPLAY everywhere. Their on-chain `committed_at` timestamps honestly show they were sealed after those matches ended. Only the main event — the final — was sealed before its own kickoff, about twenty hours before.

## Judge path

```
npm install
npx tsx scripts/verify.ts        # no env, no credentials, public devnet RPC
```

The verifier enumerates every Strategy and Commitment account on the program, decodes the raw bytes with Anchor's BorshCoder, recomputes keccak256 for every payload published in `broadcast/data/rounds.json` against the on-chain hashes, checks parameter-hash preimages, audits cadence promised-vs-delivered, and prints a PASS/FAIL table. `RPC=<url>` overrides the endpoint if the public one rate-limits.

The pundits' registry accounts (account links only — devnet purges transaction history within days, so raw tx JSON is archived in `evidence/tx/`):

| persona | strategy account |
| --- | --- |
| The Steamer | [`maWf2iyHuZTDTjnBzYXeAcHvikAgngzdU1YoL6E3eKk`](https://explorer.solana.com/address/maWf2iyHuZTDTjnBzYXeAcHvikAgngzdU1YoL6E3eKk?cluster=devnet) |
| The Quant | [`DjMsvs377wrK8ipA1HJWn65W3sjvNGKoiwgRS61wVJXu`](https://explorer.solana.com/address/DjMsvs377wrK8ipA1HJWn65W3sjvNGKoiwgRS61wVJXu?cluster=devnet) |
| The Heel | [`Hd7UsYe6rBh7Z75tfUyKnhrckoj5FS7fNp2EV8AJhuqn`](https://explorer.solana.com/address/Hd7UsYe6rBh7Z75tfUyKnhrckoj5FS7fNp2EV8AJhuqn?cluster=devnet) |

The main event's sealed commitments (Spain v Argentina, fixture 18257739): [Steamer](https://explorer.solana.com/address/7MU6sVRMwgJQz1afbzKniqtk7wP1fLyjy9hEDTnTMnda?cluster=devnet) · [Quant](https://explorer.solana.com/address/7jLp38qP7KuuZK139NUDCHC1ce2EdPiXR5ZoS9eqhMCp?cluster=devnet) · [Heel](https://explorer.solana.com/address/FwFHY8zD3SiH9hYohw6yUFPnR1kYQpXRuiyuyY6wYxbS?cluster=devnet).

## Pre-season

The program was not deployed for this weekend. Two earlier strategies have been committing odds-dislocation signals to the same registry since July 3 — 76 commitments at the time of writing, still running:

- [`EARHG2kzHmn7SqSMLGUBALLKH9rR6cw8qhNh9uZC5w4d`](https://explorer.solana.com/address/EARHG2kzHmn7SqSMLGUBALLKH9rR6cw8qhNh9uZC5w4d?cluster=devnet) (strategy #0, 37 commitments)
- [`484ihPPgZPyLuoARcjHKDACEMx2yiQyXVbXYtvFx7TZY`](https://explorer.solana.com/address/484ihPPgZPyLuoARcjHKDACEMx2yiQyXVbXYtvFx7TZY?cluster=devnet) (strategy #1, 39 commitments)

The verifier lists them as hash-only entries (their payloads live in the project they came from) — including their cadence deficits, because the meter applies to everyone. The mechanics being judged tonight have run in public for two weeks.

## Architecture

```
program/     Anchor commit/reveal registry (carried over unchanged; devnet)
corner/      the three persona engines + CLI
             slip → canonical JSON → keccak → commit; reveal → grade → feed
broadcast/   Next.js fight-night surface (bill, board, verify) + JSON APIs
scripts/     verify.ts (judge path) · archive-tx.ts (evidence snapshots)
evidence/    registration/commit/reveal records + archived tx JSON
test/        vitest: canonicalisation, hashing, grading, engines, decode path
```

Data flow: `corner` fetches TxLINE odds/scores (StablePrice feed, devnet), runs the engines, seals hashes on-chain, and writes the public feed (`broadcast/data/*.json`) — slips appear there only after their on-chain reveal. The broadcast reads that feed plus the chain itself: the KNOWS BALL board decodes Strategy/Commitment accounts live via RPC. Raw TxLINE feed captures stay out of the repo (their terms prohibit redistribution); everything derived — slips, hashes, grades, talk lines — is committed.

The trash-talk is deterministic template packs per persona, seeded by event identity (same event, same line, any machine). If `ANTHROPIC_API_KEY` is present the corner can run an optional polish pass; the feed labels which mode produced it. It degrades to pure templates without the key.

## Running it

```
# corner (needs TxLINE credentials for slip building; see corner/src/txline.ts)
npx tsx corner/src/cli.ts status
npx tsx corner/src/cli.ts slip --fixture <id> --round <label>
npx tsx corner/src/cli.ts commit --fixture <id>
npx tsx corner/src/cli.ts watch --fixture <id>     # capture scores, reveal+grade at FT
npx tsx corner/src/cli.ts build-feed

# broadcast
cd broadcast && npm install && npm run dev

# tests
npm test
```

The program is already deployed; `program/` builds with Anchor 0.32 if you want to reproduce it. Program tests live in `program/program-tests` (a separate cargo workspace so dev-dependencies don't poison the SBF build) and run the real `.so` via `SBF_OUT_DIR`.
