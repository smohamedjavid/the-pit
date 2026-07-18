import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { PERSONAS, persona, runEngine, type FixtureMeta } from "./personas.js";
import { buildBook, lastInPlayX12, type OddsUpdate } from "./book.js";
import { slipBytes, slipHash, slipHashHex, canonicalJson, type PersonaId, type PickSlip } from "./slip.js";
import { PitChain, DEFAULT_RPC } from "./chain.js";
import { gradeFromScores, gradeFromMarketClose, fullTimeReached, type ScoreRecord } from "./grade.js";
import { loadState, saveState, saveEvidence, dataDir, type RoundState, type SlipState } from "./state.js";
import { writeFeed } from "./feed.js";
import { makeRest } from "./txline.js";

/**
 * The corner CLI — everything the three pundits do, in order:
 *
 *   keys        create + fund one keypair per persona (funder pays)
 *   register    register each persona's strategy on the registry program
 *   slip        run the engines for a fixture, build + store the pick-slips
 *   commit      seal each slip's keccak hash on-chain (pre-kickoff)
 *   reveal      after FT: reveal payloads, grade vs TxLINE, update feed
 *   watch       capture the live score feed; auto-reveal at game_finalised
 *   build-feed  regenerate broadcast/data from corner state
 *   status      chain + state summary
 */

const KEYS_DIR = path.resolve("corner/.keys");
const BROADCAST_DATA = path.resolve("broadcast/data");
const RPC = process.env.RPC ?? DEFAULT_RPC;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function keyPath(id: PersonaId): string {
  return path.join(KEYS_DIR, `${id}.json`);
}

function loadPersonaChain(id: PersonaId): PitChain {
  return new PitChain({ rpc: RPC, keypairPath: keyPath(id) });
}

async function cmdKeys(): Promise<void> {
  const funderPath =
    arg("funder") ?? process.env.FUNDER_KEYPAIR ?? "../txline-kit/.spike-keypair.json";
  const funder = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(funderPath, "utf8")))
  );
  const conn = new Connection(RPC, "confirmed");
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  for (const p of PERSONAS) {
    const file = keyPath(p.id);
    let kp: Keypair;
    if (fs.existsSync(file)) {
      kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(file, "utf8"))));
      console.log(`${p.id}: existing key ${kp.publicKey.toBase58()}`);
    } else {
      kp = Keypair.generate();
      fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
      console.log(`${p.id}: new key ${kp.publicKey.toBase58()}`);
    }
    const bal = await conn.getBalance(kp.publicKey);
    if (bal < 0.05 * LAMPORTS_PER_SOL) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: kp.publicKey,
          lamports: Math.round(0.15 * LAMPORTS_PER_SOL),
        })
      );
      const sig = await sendAndConfirmTransaction(conn, tx, [funder]);
      console.log(`${p.id}: funded 0.15 SOL (${sig.slice(0, 16)}…)`);
    } else {
      console.log(`${p.id}: balance ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL, no top-up`);
    }
  }
}

async function cmdRegister(): Promise<void> {
  const state = loadState();
  const windowStart = Math.floor(Date.now() / 1000) + 120;
  const windowEnd = Math.floor(new Date("2026-07-31T23:59:59Z").getTime() / 1000);

  for (const p of PERSONAS) {
    const chain = loadPersonaChain(p.id);
    const existing = await chain.fetchStrategy(0);
    if (existing) {
      console.log(`${p.id}: already registered at ${existing.address} (signals ${existing.signalCount})`);
      state.personas[p.id] = {
        authority: chain.authority.publicKey.toBase58(),
        strategyIdx: 0,
        strategyAddress: existing.address,
        registerTx: state.personas[p.id]?.registerTx ?? "",
        params: p.params,
        expectedPerDay: existing.expectedPerDay,
        windowStart: existing.windowStart,
        windowEnd: existing.windowEnd,
      };
      continue;
    }
    const { tx, strategy } = await chain.registerStrategy(
      0,
      p.params,
      windowStart,
      windowEnd,
      p.expectedPerDay
    );
    console.log(`${p.id}: registered ${strategy}`);
    console.log(`  params: ${p.params}`);
    console.log(`  cadence promise: ${p.expectedPerDay}/day, window ${windowStart} → ${windowEnd}`);
    state.personas[p.id] = {
      authority: chain.authority.publicKey.toBase58(),
      strategyIdx: 0,
      strategyAddress: strategy,
      registerTx: tx,
      params: p.params,
      expectedPerDay: p.expectedPerDay,
      windowStart,
      windowEnd,
    };
    saveEvidence(`register-${p.id}`, {
      persona: p.id,
      authority: chain.authority.publicKey.toBase58(),
      strategy,
      strategyLink: `https://explorer.solana.com/address/${strategy}?cluster=devnet`,
      params: p.params,
      windowStart,
      windowEnd,
      expectedPerDay: p.expectedPerDay,
      tx,
      at: new Date().toISOString(),
    });
  }
  saveState(state);
}

async function fetchFixtureMeta(fixtureId: number): Promise<FixtureMeta & { fixture: string }> {
  const rest = makeRest();
  const fixtures = await rest.fixturesSnapshot();
  const f = fixtures.find((x) => x.FixtureId === fixtureId);
  if (f) {
    return {
      fixtureId,
      home: f.Participant1IsHome ? f.Participant1 : f.Participant2,
      away: f.Participant1IsHome ? f.Participant2 : f.Participant1,
      kickoffMs: f.StartTime,
      fixture: `${f.Participant1} v ${f.Participant2}`,
    };
  }
  // finished fixtures drop out of the snapshot — allow explicit overrides
  const home = arg("home");
  const away = arg("away");
  const kickoff = arg("kickoff");
  if (!home || !away || !kickoff) {
    throw new Error(
      `fixture ${fixtureId} not in snapshot; pass --home --away --kickoff <ms> for finished fixtures`
    );
  }
  return {
    fixtureId,
    home,
    away,
    kickoffMs: Number(kickoff),
    fixture: `${home} v ${away}`,
  };
}

async function loadOddsUpdates(fixtureId: number): Promise<OddsUpdate[]> {
  const archive = path.join(dataDir(), "capture", `${fixtureId}.odds-updates.json`);
  const rest = makeRest();
  try {
    const updates = (await rest.oddsUpdates(fixtureId)) as OddsUpdate[];
    if (Array.isArray(updates) && updates.length > 0) {
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      fs.writeFileSync(archive, JSON.stringify(updates));
      return updates;
    }
  } catch (e) {
    console.error(`odds updates fetch failed: ${(e as Error).message?.slice(0, 120)}`);
  }
  if (fs.existsSync(archive)) {
    console.log(`using archived odds updates for ${fixtureId}`);
    return JSON.parse(fs.readFileSync(archive, "utf8")) as OddsUpdate[];
  }
  throw new Error(`no odds updates available for fixture ${fixtureId}`);
}

async function cmdSlip(): Promise<void> {
  const fixtureId = Number(arg("fixture"));
  const roundId = arg("round") ?? `round-${fixtureId}`;
  const label = arg("label") ?? roundId;
  const replay = process.argv.includes("--replay");
  if (!fixtureId) throw new Error("--fixture required");

  const meta = await fetchFixtureMeta(fixtureId);
  const updates = await loadOddsUpdates(fixtureId);
  // cutoff: engines only ever see pre-kickoff prints, and for a live round
  // the honest as-of moment is seal time, not kickoff
  const defaultCutoff = replay ? meta.kickoffMs : Math.min(Date.now(), meta.kickoffMs);
  const cutoffMs = Math.min(Number(arg("cutoff") ?? defaultCutoff), meta.kickoffMs);

  const state = loadState();
  let round = state.rounds.find((r) => r.id === roundId);
  if (!round) {
    round = {
      id: roundId,
      label,
      replay,
      fixtureId,
      fixture: meta.fixture,
      home: meta.home,
      away: meta.away,
      kickoffMs: meta.kickoffMs,
      cutoffMs,
      slips: {},
    };
    state.rounds.push(round);
  }

  for (const p of PERSONAS) {
    if (round.slips[p.id]?.commitTx) {
      console.log(`${p.id}: slip already committed for ${roundId}, skipping`);
      continue;
    }
    const book = buildBook(updates, fixtureId, cutoffMs);
    const out = runEngine(p.id, book, meta);
    const slip: PickSlip = {
      v: 1,
      persona: p.id,
      round: roundId,
      replay,
      fixtureId,
      fixture: meta.fixture,
      kickoffMs: meta.kickoffMs,
      picks: out.picks,
      rationale: out.rationale,
      basis: { asOfMs: cutoffMs, source: "txline-stableprice-devnet" },
      salt: crypto.randomBytes(16).toString("hex"),
    };
    const canonical = canonicalJson(slip);
    round.slips[p.id] = { slip, canonical, hashHex: slipHashHex(slip) };
    console.log(`${p.id}: ${out.picks.matchWinner.team} / ${out.picks.totalGoals.side} ${out.picks.totalGoals.line} / late goal ${out.picks.lateGoalAfter75.yes ? "yes" : "no"}`);
    console.log(`  "${out.rationale}"`);
    console.log(`  hash ${round.slips[p.id]!.hashHex.slice(0, 16)}… (${canonical.length} bytes)`);
  }
  saveState(state);
}

async function cmdCommit(): Promise<void> {
  const fixtureId = Number(arg("fixture"));
  const state = loadState();
  const round = state.rounds.find((r) => r.fixtureId === fixtureId);
  if (!round) throw new Error(`no slips for fixture ${fixtureId} — run slip first`);

  // deadline: kickoff for live rounds; for replay demonstrations the event
  // is already over, so the deadline is only "before the scripted reveal" —
  // the round is labelled REPLAY everywhere and committed_at tells the truth
  const deadlineSec = round.replay
    ? Math.floor(Date.now() / 1000) + 30 * 60
    : Math.floor(round.kickoffMs / 1000);

  for (const p of PERSONAS) {
    const s = round.slips[p.id];
    if (!s) continue;
    if (s.commitTx) {
      console.log(`${p.id}: already committed seq ${s.seq}`);
      continue;
    }
    const chain = loadPersonaChain(p.id);
    const res = await chain.commit(0, slipHash(s.slip), fixtureId, deadlineSec);
    const onchain = await chain.fetchCommitment(0, res.seq);
    s.seq = res.seq.toString();
    s.commitment = res.commitment;
    s.commitTx = res.tx;
    s.committedAt = onchain?.committedAt ?? Math.floor(Date.now() / 1000);
    console.log(`${p.id}: sealed seq ${s.seq} at ${s.commitment}`);
    saveEvidence(`commit-${fixtureId}-${p.id}`, {
      persona: p.id,
      round: round.id,
      replay: round.replay,
      fixtureId,
      seq: s.seq,
      commitment: s.commitment,
      commitmentLink: `https://explorer.solana.com/address/${s.commitment}?cluster=devnet`,
      payloadHashHex: s.hashHex,
      eventDeadline: deadlineSec,
      committedAt: s.committedAt,
      tx: s.commitTx,
      at: new Date().toISOString(),
    });
  }
  saveState(state);
}

function readCapturedScores(fixtureId: number): ScoreRecord[] {
  const file = path.join(dataDir(), "capture", `${fixtureId}.scores.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ScoreRecord);
}

async function cmdReveal(): Promise<void> {
  const fixtureId = Number(arg("fixture"));
  const state = loadState();
  const round = state.rounds.find((r) => r.fixtureId === fixtureId);
  if (!round) throw new Error(`no round for fixture ${fixtureId}`);

  const captured = readCapturedScores(fixtureId);
  let closeProbs: number[] | undefined;
  if (captured.length === 0) {
    const updates = await loadOddsUpdates(fixtureId);
    closeProbs = lastInPlayX12(updates, fixtureId)?.probs;
    console.log(
      `no captured scores for ${fixtureId}; market-close grading (probs ${closeProbs?.map((p) => p.toFixed(3)).join("/") ?? "n/a"})`
    );
  }

  for (const p of PERSONAS) {
    const s = round.slips[p.id];
    if (!s?.commitTx || !s.seq) {
      console.log(`${p.id}: nothing committed, skipping`);
      continue;
    }
    if (!s.revealTx) {
      const chain = loadPersonaChain(p.id);
      const res = await chain.reveal(0, BigInt(s.seq), slipBytes(s.slip));
      s.revealTx = res.tx;
      s.revealedAtMs = Date.now();
      console.log(`${p.id}: revealed seq ${s.seq}`);
    }
    s.grades = captured.length
      ? gradeFromScores(s.slip, captured)
      : gradeFromMarketClose(s.slip, closeProbs);
    console.log(
      `${p.id}: MW ${s.grades.matchWinner} · totals ${s.grades.totalGoals} · late ${s.grades.lateGoalAfter75}` +
        (s.grades.brier != null ? ` · brier ${s.grades.brier}` : "")
    );
    saveEvidence(`reveal-${fixtureId}-${p.id}`, {
      persona: p.id,
      round: round.id,
      fixtureId,
      seq: s.seq,
      commitment: s.commitment,
      commitmentLink: `https://explorer.solana.com/address/${s.commitment}?cluster=devnet`,
      payloadCanonical: s.canonical,
      payloadHashHex: s.hashHex,
      revealTx: s.revealTx,
      grades: s.grades,
      at: new Date().toISOString(),
    });
  }
  saveState(state);
  writeFeed(loadState(), BROADCAST_DATA);
  console.log("feed rebuilt");
}

async function cmdWatch(): Promise<void> {
  const fixtureId = Number(arg("fixture"));
  if (!fixtureId) throw new Error("--fixture required");
  const rest = makeRest();
  const file = path.join(dataDir(), "capture", `${fixtureId}.scores.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const seen = new Set<number>();
  for (const r of readCapturedScores(fixtureId)) if (r.Seq != null) seen.add(r.Seq);
  console.log(`watching fixture ${fixtureId} (have ${seen.size} records)`);

  let finalPolls = 0;
  const poll = async () => {
    try {
      const arr = (await rest.scoresSnapshot(fixtureId)) as ScoreRecord[];
      if (Array.isArray(arr)) {
        for (const rec of arr) {
          if (rec.Seq != null && !seen.has(rec.Seq)) {
            seen.add(rec.Seq);
            fs.appendFileSync(file, JSON.stringify(rec) + "\n");
          }
        }
        if (fullTimeReached(arr) || fullTimeReached(readCapturedScores(fixtureId))) {
          finalPolls += 1;
          console.log(`full-time flag seen (${finalPolls}/3)`);
        }
      }
    } catch (e) {
      console.error(`poll: ${(e as Error).message?.slice(0, 120)}`);
    }
    if (finalPolls >= 3) {
      console.log("full-time confirmed — revealing and grading");
      await cmdRevealFor(fixtureId);
      process.exit(0);
    }
  };
  await poll();
  setInterval(() => void poll(), 20_000);
}

async function cmdRevealFor(fixtureId: number): Promise<void> {
  process.argv.push("--fixture", String(fixtureId));
  await cmdReveal();
}

async function cmdBuildFeed(): Promise<void> {
  writeFeed(loadState(), BROADCAST_DATA);
  console.log(`wrote ${BROADCAST_DATA}/{rounds,feed,meta}.json`);
}

async function cmdStatus(): Promise<void> {
  const state = loadState();
  for (const p of PERSONAS) {
    const ps = state.personas[p.id];
    if (!ps) {
      console.log(`${p.id}: not registered`);
      continue;
    }
    const chain = loadPersonaChain(p.id);
    const s = await chain.fetchStrategy(0);
    console.log(
      `${p.id}: ${ps.strategyAddress} signals=${s?.signalCount ?? "?"} promise=${ps.expectedPerDay}/day`
    );
  }
  for (const r of state.rounds) {
    const parts = PERSONAS.map((p) => {
      const s = r.slips[p.id];
      return `${p.id}:${s?.grades ? "graded" : s?.revealTx ? "revealed" : s?.commitTx ? "sealed" : s ? "slipped" : "-"}`;
    });
    console.log(`${r.id} (${r.fixture}${r.replay ? ", REPLAY" : ""}): ${parts.join(" ")}`);
  }
}

const commands: Record<string, () => Promise<void>> = {
  keys: cmdKeys,
  register: cmdRegister,
  slip: cmdSlip,
  commit: cmdCommit,
  reveal: cmdReveal,
  watch: cmdWatch,
  "build-feed": cmdBuildFeed,
  status: cmdStatus,
};

const cmd = process.argv[2];
if (!cmd || !commands[cmd]) {
  console.log(`usage: tsx corner/src/cli.ts <${Object.keys(commands).join("|")}> [--fixture id] [...]`);
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error(`${cmd} failed:`, e instanceof Error ? e.message : e);
  process.exit(1);
});
