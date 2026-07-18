import { Connection, PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import idl from "./idl-tape.json";
import { meta, rounds, type Grades } from "./data";

/**
 * KNOWS BALL board — chain-first. Strategy and Commitment accounts are read
 * straight from the registry program and decoded with BorshCoder
 * (case-literal: "Strategy"/"Commitment", snake_case fields — the camelizing
 * Program client is not used here). Grades come from the published rounds;
 * the chain supplies the part nobody can edit: what was sealed, and when.
 */

export const PROGRAM_ID = new PublicKey("8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD");

const RPC =
  process.env.RPC_UPSTREAM ?? "https://solana-devnet.api.onfinality.io/public";

export interface BoardRow {
  persona: string;
  name: string;
  style: string;
  authority?: string;
  strategyAddress?: string;
  strategyLink?: string;
  onChain: boolean;
  sealed: number; // commitments on-chain
  revealed: number;
  hits: number;
  misses: number;
  noActions: number;
  brierAvg: number | null;
  promisedPerDay: number;
  promisedToDate: number;
  deliveredToDate: number;
  windowStart?: number;
  windowEnd?: number;
}

interface ChainCommitment {
  strategy: string;
  committedAt: number;
  revealed: boolean;
}

async function chainCommitments(): Promise<{
  byStrategy: Map<string, ChainCommitment[]>;
  ok: boolean;
}> {
  const byStrategy = new Map<string, ChainCommitment[]>();
  try {
    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshCoder(idl as never);
    const discCommit = Buffer.from(
      (idl.accounts as Array<{ name: string; discriminator: number[] }>).find(
        (a) => a.name === "Commitment"
      )!.discriminator
    );
    const accounts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed" });
    for (const { pubkey, account } of accounts) {
      if (!account.data.subarray(0, 8).equals(discCommit)) continue;
      try {
        const c = coder.accounts.decode("Commitment", account.data);
        const strategy = new PublicKey(c.strategy).toBase58();
        const list = byStrategy.get(strategy) ?? [];
        list.push({
          strategy,
          committedAt: Number(c.committed_at),
          revealed: Boolean(c.revealed),
        });
        byStrategy.set(strategy, list);
      } catch (e) {
        console.error(`[board] decode ${pubkey.toBase58()} failed:`, (e as Error).message);
      }
    }
    return { byStrategy, ok: true };
  } catch (e) {
    console.error("[board] getProgramAccounts failed:", (e as Error).message);
    return { byStrategy, ok: false };
  }
}

function gradeCounts(persona: string): {
  hits: number;
  misses: number;
  noActions: number;
  briers: number[];
} {
  let hits = 0;
  let misses = 0;
  let noActions = 0;
  const briers: number[] = [];
  for (const r of rounds()) {
    const s = r.slips[persona];
    const g: Grades | undefined = s?.grades;
    if (!g) continue;
    for (const leg of [g.matchWinner, g.totalGoals, g.lateGoalAfter75]) {
      if (leg === "HIT") hits += 1;
      else if (leg === "MISS") misses += 1;
      else noActions += 1;
    }
    if (g.brier != null) briers.push(g.brier);
  }
  return { hits, misses, noActions, briers };
}

export async function board(): Promise<{ rows: BoardRow[]; chainOk: boolean }> {
  const m = meta();
  const { byStrategy, ok } = await chainCommitments();
  const nowSec = Math.floor(Date.now() / 1000);

  const rows: BoardRow[] = m.personas.map((p) => {
    const chain = p.strategyAddress ? byStrategy.get(p.strategyAddress) ?? [] : [];
    const { hits, misses, noActions, briers } = gradeCounts(p.id);
    const windowDays =
      p.windowStart != null
        ? Math.max((Math.min(nowSec, p.windowEnd ?? nowSec) - p.windowStart) / 86_400, 0)
        : 0;
    return {
      persona: p.id,
      name: p.name,
      style: p.style,
      authority: p.authority,
      strategyAddress: p.strategyAddress,
      strategyLink: p.strategyLink,
      onChain: chain.length > 0,
      sealed: chain.length,
      revealed: chain.filter((c) => c.revealed).length,
      hits,
      misses,
      noActions,
      brierAvg: briers.length
        ? Number((briers.reduce((a, b) => a + b, 0) / briers.length).toFixed(4))
        : null,
      promisedPerDay: p.expectedPerDay,
      promisedToDate: Math.floor(windowDays * p.expectedPerDay),
      deliveredToDate: chain.length,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
    };
  });

  // best hit-rate first; brier breaks ties
  rows.sort((a, b) => {
    const ra = a.hits + a.misses === 0 ? 0 : a.hits / (a.hits + a.misses);
    const rb = b.hits + b.misses === 0 ? 0 : b.hits / (b.hits + b.misses);
    if (rb !== ra) return rb - ra;
    return (a.brierAvg ?? 1) - (b.brierAvg ?? 1);
  });

  return { rows, chainOk: ok };
}
