# THE PIT — technical deep-dive

This is the architecture document for judges and anyone who wants to audit the
claim in the README: that every pick was sealed on-chain before its deadline,
that no revealed pick differs by one byte from what was sealed, and that
silence is measurable. Everything below cites real files in this repo. Where
something is a demonstration or a trust boundary, it says so.

Program: [`8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD`](https://explorer.solana.com/address/8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD?cluster=devnet) (Solana devnet, Anchor 0.32).

## The one-paragraph version

Three AI pundit personas read the same TxLINE odds book through three
deterministic engines and file a full pick-slip per fixture. The slip is
canonical JSON; its keccak256 hash goes on-chain via `commit_signal` before
the event deadline, with the seal time set by the chain's clock. After
full-time, `reveal_signal` submits the payload bytes and the program
recomputes the hash on-chain — a doctored reveal is rejected, not flagged.
There is no instruction to edit or delete a commitment, so a bad pick has
exactly two futures: revealed and graded, or sealed forever — and the cadence
promise recorded at registration makes the second option visible, because
anyone can count commitments per day against what was promised. The fight-
night broadcast on top is deliberate theatre; the registry underneath is the
product.

## Program design (`program/programs/tape-program/src/lib.rs`)

The registry is deliberately small: two account types, three instructions,
~200 lines. It was deployed for The Tape (our pre-season project) and carried
over unchanged — same program id, same mechanics, which is why it arrives at
judging with two weeks of public history instead of a day.

### Accounts and PDAs

| Account | Seeds | Holds |
|---|---|---|
| `Strategy` | `["strategy", authority, idx_le]` | `params_hash` (keccak256 of the engine's parameter string), `window_start/end`, `expected_signals_per_day` (the cadence promise), `signal_count` |
| `Commitment` | `["commit", strategy, seq_le]` | `payload_hash` (32 bytes), `fixture_id`, `event_deadline`, `committed_at`, `committed_slot`, `revealed` |

The commitment seed is the strategy's running `signal_count`, so sequence
numbers are dense by construction: there is no way to commit "off the books"
and no gap to hide in. `signal_count` only ever increments (checked add), and
nothing decrements it.

### `register_strategy` — the cadence promise

Registration requires `clock.unix_timestamp <= window_start`
(`WindowAlreadyOpen` otherwise): a strategy's parameters and its promised
slips-per-day are frozen *before* it is allowed to act. The params hash is
keccak256 of a canonical parameter string (e.g.
`pit/steamer/v1|lookbackH=6|pickBy=max-prob-delta|…`); the three personas
publish their preimages in `broadcast/data/meta.json` and the verifier
recomputes them against the chain.

### `commit_signal` — sealing

Two clock checks, both against the chain's clock, not the client's:

1. the strategy's window must be open (`OutsideWindow`), and
2. `clock.unix_timestamp < event_deadline` (`TooLate`) — a commitment at or
   past its own deadline is rejected outright.

`committed_at` and `committed_slot` are written from `Clock::get()`, which is
what makes "sealed roughly twenty hours before kickoff" a chain-attested fact
rather than a claim from us.

### `reveal_signal` — tamper rejection

The reveal takes the raw payload bytes and recomputes keccak256 **on-chain**
(`solana_keccak_hasher::hash`); a mismatch fails with `HashMismatch`. A
commitment can be revealed once (`AlreadyRevealed`) and never modified — the
account has no other mutation path. The payload itself lives off-chain (the
broadcast hosts it); the chain certifies its identity.

Program tests live in `program/program-tests` — a separate cargo workspace so
dev-dependencies don't poison the SBF build — and run the real compiled `.so`
via `SBF_OUT_DIR`. The four scenarios are the four claims: the full
commit/reveal lifecycle, registration after the window opens rejected, a
commit after its event deadline rejected, and a tampered reveal rejected.

### Cadence bookkeeping

The program stores the promise (`expected_signals_per_day`) and the facts
(`signal_count`, one `committed_at` per commitment). The arithmetic —
window days elapsed × promise vs commitments delivered — is done by readers:
`scripts/verify.ts` and the KNOWS BALL board both compute it independently
from account state. Nothing about cadence is self-reported.

## The engines (`corner/src/personas.ts`) — three pure functions over one book

The book (`corner/src/book.ts`) is built from TxLINE
`/api/odds/updates/{fixtureId}` records — the StablePrice de-margined feed,
the only odds tier on devnet. Facts the parser leans on, learned the hard
way: records are PascalCase; prices are decimal odds × 1000; `MarketPeriod:
null` means full-match markets; `InRunning: false` filters to pre-match
prints. Implied probabilities are de-margined by proportional normalization.
The "primary" totals line is the most-quoted `.0`/`.5` line near the cutoff —
quarter-ball lines are excluded because a pub can't settle a stake split.

All three engines share one market read: the last pre-cutoff 1X2 print
against the book six hours of trading earlier (anchored to the last print,
not wall-clock, so a slip sealed 20 hours before kickoff still measures real
movement), plus a goals expectancy λ from the primary totals line and its
price skew. `P(goal after 75') = 1 − exp(−λ · 19/94 · 1.25)` — 19 of 94
played minutes, with a late-game intensity factor.

- **THE STEAMER (momentum)** backs the 1X2 side with the largest positive
  probability delta over those six hours, takes the totals side the money
  moved toward, and nudges the late-goal probability by the over/under steam.
- **THE QUANT (value)** fits a model instead of following prints: home
  supremacy is read off the Asian-handicap line that prices closest to even
  money, total-goals λ off the primary over/under, then two independent
  Poissons (one per side, goals 0–10) produce model 1X2 probabilities. He
  backs the side where model-minus-market edge is largest, grades the totals
  leg by model `P(N > line)` vs the market's over price, and derives the
  late-goal leg from his own λ. `poissonModel` and `poissonCdf` are exported
  and unit-tested.
- **THE HEEL (contrarian)** takes the side with the most negative delta —
  whatever the crowd just walked away from — fades the totals steam, and
  fades the crowd's late-drama expectation. He knowingly grades himself on
  the market's own probability for that side, which is the joke and the
  honesty at once.

Determinism is the point, not a style choice: same archived odds book in,
same slip out, byte for byte, on any machine — which is what makes a sealed
hash meaningful and the engines re-runnable by a skeptic. The engines'
parameter strings are the registered `params_hash` preimages, so the code
that ran is bound to what was promised before the window opened.

## The pick-slip and its hash (`corner/src/slip.ts`)

A slip is one persona's full call on one fixture: match winner, total goals
over/under on the primary line, and "goal after the 75th minute", each leg
with an honest probability, plus rationale, basis (`asOfMs`, source), and a
16-byte random salt. Canonicalisation is boring on purpose: recursively sort
object keys, `JSON.stringify` with no whitespace, UTF-8 encode, keccak256.
The salt exists because a slip's pick-space is small enough to enumerate — 
without it, an unrevealed hash could be brute-forced before the reveal.
`test/slip.test.ts` pins the canonical encoding (key order, no whitespace,
hash stability) so a formatting drift can't silently break every reveal.

## Grading (`corner/src/grade.ts`) — and how replay rounds are labelled

Primary grading source is the TxLINE scores feed, captured to disk at match
time (`corner/data/capture/<fixtureId>.scores.jsonl`) — devnet stops serving
a fixture's scores shortly after it finalises, so the corner archives the
feed while it's live or loses the evidence. From the captured records:

- final score = H1 + H2 goals (regular time) from the freshest record with a
  `Score` object;
- late goal = a confirmed `goal` action with `StatusId 4` (second half) and
  `Clock.Seconds ≥ 4500` — stoppage time counts, which is exactly what "late
  goal" means at the pub;
- full-time = `StatusId 5` or `game_finalised` (GameState never changes at
  the end of a match — a TxLINE fact that costs everyone an evening);
- a whole-number totals line landing exactly on the number is a push,
  graded NO ACTION.

Each graded slip also gets a Brier score over its graded legs, so confidence
is scored, not just direction — a coward's 51% hit and a loudmouth's 95% miss
both show up.

Because devnet's World Cup ended the weekend before judging, two rounds are
replays of recent fixtures, and the honesty rules are strict:

- **Replay I (France v England, 18257865)** was graded from the captured
  TxLINE score feed — all three legs, `source: "txline-scores"`.
- **Replay II (Vietnam v Myanmar, 18143850)** had no surviving score record,
  so it was graded from the market's own closing prints
  (`source: "market-close"`): the last in-play 1X2 print names a winner only
  if the market had effectively settled (max probability ≥ 0.90), and every
  other leg settles NO ACTION. Nothing is silently approximated — the grade
  record names its source, and the board shows it.
- Replay commitments were sealed *after* those matches ended, and their
  on-chain `committed_at` says so plainly. They are labelled REPLAY on every
  surface. Only the main event — Spain v Argentina, fixture 18257739 — was
  sealed before its own kickoff, roughly twenty hours before.

The main event runs unattended: `corner/src/cli.ts watch` polls the scores
snapshot every 20 seconds, appends unseen records (by `Seq`) to the capture
file, requires the full-time flag on three consecutive polls, then reveals
all three slips on-chain, grades them, and rebuilds the broadcast feed.

## Broadcast — chain-first (`broadcast/`)

The Next.js surface has three pages (the bill, the KNOWS BALL board, the
verify page) and renders from two sources with a deliberate split:

- `broadcast/data/*.json` is the published feed, written by the corner. A
  slip's payload appears there **only after its on-chain reveal** — before
  that, the feed carries hash, seq, commitment address, and seal time only.
- The board (`broadcast/lib/board.ts`) reads the chain itself:
  `getProgramAccounts` on the registry, discriminator-matched, decoded with
  Anchor's `BorshCoder` — which is case-literal (`"Strategy"`,
  `"Commitment"`, snake_case fields; the camelizing `Program` client is not
  used). Seal and reveal counts on the standings are whatever the chain says
  at render time, with an explicit "chain read unavailable" fallback rather
  than a silent stale number.

`/api/rpc` is a thin devnet JSON-RPC relay (public devnet RPCs rate-limit
residential IPs hard, `getProgramAccounts` most of all — serverless egress
spreads the load; devnet-only by construction, no secrets). `/api/live`
serves the main event's live score if TxLINE credentials are present in the
environment and degrades to `{ available: false }` without them.

The trash-talk is deterministic template packs per persona
(`corner/src/talk.ts`), seeded by keccak of the event identity through a
small PRNG — same event, same line, any machine, so the feed is reproducible
like everything else. If `ANTHROPIC_API_KEY` is present the corner may run an
optional one-shot polish pass; `meta.json` labels which mode produced the
feed. It degrades to pure templates without the key.

## The judge verifier (`scripts/verify.ts`)

```
npm install
npx tsx scripts/verify.ts          # no env, no credentials
RPC=<url> npx tsx scripts/verify.ts  # if the public endpoint rate-limits
```

Method, in order:

1. `getProgramAccounts` on the registry; classify every account by its
   8-byte discriminator from the IDL; decode raw bytes with `BorshCoder`.
   Undecodable accounts are counted and fail the run — nothing is skipped
   quietly.
2. For each Strategy: recompute keccak256 of the published params preimage
   (where one is published) against the on-chain `params_hash`, and audit
   cadence — window days elapsed × promised per day vs commitments actually
   delivered, printed as kept or as a deficit.
3. For each Commitment: check `committed_at < event_deadline` (the program
   enforces this; the verifier re-checks it from account state), then for
   every payload published in `broadcast/data/rounds.json`, recompute
   keccak256 and compare to the sealed hash. PASS/FAIL per row; any FAIL or
   undecodable account exits non-zero.

At the time of writing it decodes 5 strategies and 85 commitments (the
pre-season strategies were still committing while this document was being
written), with 9/9 hash recomputations passing: three params preimages and
six revealed replay payloads. The two pre-season strategies show large,
honest cadence deficits — promised ~127, delivered 37; promised ~303,
delivered 39 — because the meter applies to everyone or it means nothing.
Their payloads live in the project they came from, so the verifier lists
their reveals as hash-only entries rather than pretending to verify what it
can't.

Off-chain tests: 27 vitest cases across five files (`npm test`) — book
parsing and de-margining, canonical hashing, grading rules including the
push and late-goal edges, talk determinism, and the BorshCoder decode path
against fixture bytes.

## Trust model, in one table

| Layer | Status |
|---|---|
| Picks sealed before their deadline (chain clock) | enforced by the program |
| Revealed payload byte-identical to what was sealed | enforced by the program (on-chain keccak) |
| Params + cadence promise frozen before the window opens | enforced by the program |
| Nothing editable or deletable, sequence numbers dense | structural — the instructions don't exist |
| Cadence promised-vs-delivered | computable by anyone from account state |
| Engine computation integrity | **not enforced**: engines run off-chain. They are deterministic and re-runnable from the archived odds book, but the program cannot attest they ran as published. TEE attestation is the roadmap answer, not a claim we make today |
| Sybil strategies | **not enforced**: nothing stops registering ten personas and promoting the lucky one. Mitigated structurally — registration is public, cadence promises are public, abandoned siblings stay visible forever |
| Grading inputs | **trusted**: captured TxLINE score records, or market-close prints where devnet already dropped the fixture (labelled as such). Recomputable from archived data, not oracle-attested |
| Replay rounds | **demonstrations**: sealed after their matches ended, labelled REPLAY everywhere, `committed_at` tells the truth. Only the main event was sealed pre-kickoff |

No money moves anywhere in the product. The stake is reputation, which is
the one asset a pundit actually has.

## Evidence policy (`evidence/`)

Devnet prunes transaction history after roughly four days, so every link we
publish is an *account* link — accounts persist. Every registration, commit,
and reveal writes a JSON evidence record (`evidence/*.json`) with addresses,
hashes, and transaction signatures, and `scripts/archive-tx.ts` pulls every
referenced transaction into `evidence/tx/<sig>.json` while devnet still
serves it. Raw TxLINE feed captures stay out of the repo (their terms
prohibit redistribution); everything derived — slips, hashes, grades, talk
lines — is committed.

## Mainnet path

The registry needs nothing changed to be useful beyond this weekend: it is
already agent-agnostic (an authority keypair and a params hash — nothing in
the program knows what a "pundit" is). The productized version is
accountability rails for forecasting agents: registration with staked
cadence promises, TEE-attested engine runs answering the one gap the program
can't close, per-reveal grading against TxLINE-proven results, and public
strategy pages that are effectively an auditable CV for an agent. Every
graded pick is TxLINE data in (odds history) and TxLINE data out (score
records), which is what makes agent accountability a metered product line
rather than a demo.
