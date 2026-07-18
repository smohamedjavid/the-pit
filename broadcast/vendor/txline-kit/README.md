# txline-kit

TypeScript SDK for [TxLINE](https://txline.txodds.com) — TxODDS' cryptographically verifiable sports data platform on Solana.

Typed REST clients, header-authenticated SSE streams with automatic reconnect/resume, and a replay engine that makes historical matches indistinguishable from live ones.

> Community SDK — not affiliated with TxODDS. MIT.

## Install

```sh
npm install txline-kit
```

## Quickstart

```ts
import { TxlineSession, TxlineRest, TxlineStream, activationMessage, NETWORKS } from "txline-kit";
import nacl from "tweetnacl";

// 1. Subscribe on-chain first (service level 1 = free World Cup tier, weeks
//    must be a multiple of 4). See scripts/devnet-spike.ts for the full
//    Anchor flow including manual PDA derivation.

// 2. Authenticate: guest JWT → wallet-signed activation → API token
const session = new TxlineSession({ network: "devnet" });
const jwt = await session.guestStart();

const message = activationMessage(subscribeTxSig, [], jwt); // `${txSig}:${leagues}:${jwt}`
const walletSignature = Buffer.from(nacl.sign.detached(message, wallet.secretKey)).toString("base64");
await session.activate({ txSig: subscribeTxSig, walletSignature, leagues: [] });

// 3. Data
const rest = new TxlineRest(session);
const fixtures = await rest.fixturesSnapshot();

const stream = new TxlineStream(session, "/api/scores/stream", { fixtureId: fixtures[0].FixtureId });
stream.addEventListener("data", (e) => console.log((e as CustomEvent).detail));
stream.start();
```

## Replay a finished match (demos & tests)

```ts
import { ReplayStream } from "txline-kit";

const replay = await ReplayStream.fromFixture(rest, fixtureId, { speed: 60 }); // 90 min → 90 s
replay.addEventListener("data", handler); // identical event shape to TxlineStream
replay.start();
```

Replay pulls TxLINE's own historical endpoints at runtime — no feed data is bundled or redistributed.

## Why fetch-based SSE?

TxLINE's SSE endpoints require `Authorization` **and** `X-Api-Token` headers. The browser `EventSource` API cannot set headers, so `TxlineStream` implements SSE over fetch streams: reconnect with backoff, `Last-Event-ID` resume, heartbeat events, and duplicate-id suppression.

## Networks

| | API origin | Program |
|---|---|---|
| mainnet | `https://txline.txodds.com` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |
| devnet | `https://txline-dev.txodds.com` | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |

Program IDL (devnet) ships in [`idl/`](./idl). Field notes and API feedback: [`docs/txline-feedback.md`](./docs/txline-feedback.md).

## License

MIT
