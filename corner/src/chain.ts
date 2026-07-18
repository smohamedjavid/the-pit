import fs from "node:fs";
import anchorPkg from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { createRequire } from "node:module";

const { AnchorProvider, Program, Wallet, BN } = anchorPkg;
const require = createRequire(import.meta.url);
const idl = require("./idl-tape.json");

/**
 * The registry program carried over from The Tape — unchanged mechanics,
 * unchanged devnet deployment. One authority keypair = one pundit.
 *
 * Known devnet noise: AnchorProvider's websocket confirmation can time out
 * ("not confirmed in 30s") while the transaction has in fact landed — every
 * write below is therefore re-checked by reading the account back.
 */
export const PIT_PROGRAM_ID = new PublicKey("8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD");
export const DEFAULT_RPC = "https://solana-devnet.api.onfinality.io/public";

export function keccakArr(bytes: Uint8Array): number[] {
  return Array.from(keccak_256(bytes));
}

export interface StrategyView {
  address: string;
  paramsHashHex: string;
  windowStart: number;
  windowEnd: number;
  expectedPerDay: number;
  signalCount: bigint;
}

export class PitChain {
  private program: InstanceType<typeof Program>;
  readonly authority: Keypair;
  readonly connection: Connection;

  constructor(opts: { rpc?: string; keypairPath: string }) {
    this.authority = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(opts.keypairPath, "utf8")))
    );
    this.connection = new Connection(opts.rpc ?? process.env.RPC ?? DEFAULT_RPC, "confirmed");
    const provider = new AnchorProvider(this.connection, new Wallet(this.authority), {
      commitment: "confirmed",
    });
    this.program = new Program(idl, provider);
  }

  strategyPda(idx: number): PublicKey {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(idx);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), this.authority.publicKey.toBuffer(), b],
      PIT_PROGRAM_ID
    )[0];
  }

  commitPda(strategy: PublicKey, seq: bigint): PublicKey {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(seq);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), strategy.toBuffer(), b],
      PIT_PROGRAM_ID
    )[0];
  }

  async fetchStrategy(idx: number): Promise<StrategyView | undefined> {
    try {
      const pda = this.strategyPda(idx);
      const s = await (this.program.account as any).strategy.fetch(pda);
      return {
        address: pda.toBase58(),
        paramsHashHex: Buffer.from(s.paramsHash).toString("hex"),
        windowStart: Number(s.windowStart),
        windowEnd: Number(s.windowEnd),
        expectedPerDay: Number(s.expectedSignalsPerDay),
        signalCount: BigInt(s.signalCount.toString()),
      };
    } catch (e) {
      // account-not-found is the expected "not registered" case; anything
      // else (rpc failure, decode failure) must be visible, never swallowed
      const msg = (e as Error).message ?? String(e);
      if (!/Account does not exist|could not find/i.test(msg)) {
        console.error(`[chain] fetchStrategy(${idx}) failed:`, msg.slice(0, 200));
      }
      return undefined;
    }
  }

  async registerStrategy(
    idx: number,
    paramsCanonical: string,
    windowStart: number,
    windowEnd: number,
    expectedPerDay: number
  ): Promise<{ tx: string; strategy: string }> {
    const paramsHash = keccakArr(new TextEncoder().encode(paramsCanonical));
    const strategy = this.strategyPda(idx);
    let tx = "";
    try {
      tx = await (this.program.methods as any)
        .registerStrategy(idx, paramsHash, new BN(windowStart), new BN(windowEnd), expectedPerDay)
        .accounts({ authority: this.authority.publicKey, strategy })
        .rpc();
    } catch (e) {
      // ws confirmation timeouts land anyway — verify by reading back
      const after = await this.fetchStrategy(idx);
      if (!after) throw e;
      console.error(`[chain] register rpc noise ignored (account exists):`, (e as Error).message?.slice(0, 120));
    }
    return { tx, strategy: strategy.toBase58() };
  }

  /** Commit a sealed payload hash pre-event. */
  async commit(
    idx: number,
    payloadHash: Uint8Array,
    fixtureId: number,
    eventDeadlineSec: number
  ): Promise<{ tx: string; commitment: string; seq: bigint }> {
    const strategy = this.strategyPda(idx);
    const s = await this.fetchStrategy(idx);
    if (!s) throw new Error(`strategy ${idx} not registered for ${this.authority.publicKey.toBase58()}`);
    const seq = s.signalCount;
    const commitment = this.commitPda(strategy, seq);
    let tx = "";
    try {
      tx = await (this.program.methods as any)
        .commitSignal(Array.from(payloadHash), new BN(fixtureId), new BN(eventDeadlineSec))
        .accounts({ authority: this.authority.publicKey, strategy, commitment })
        .rpc();
    } catch (e) {
      const info = await this.connection.getAccountInfo(commitment);
      if (!info) throw e;
      console.error(`[chain] commit rpc noise ignored (account exists):`, (e as Error).message?.slice(0, 120));
    }
    return { tx, commitment: commitment.toBase58(), seq };
  }

  async reveal(idx: number, seq: bigint, payload: Uint8Array): Promise<{ tx: string; commitment: string }> {
    const strategy = this.strategyPda(idx);
    const commitment = this.commitPda(strategy, seq);
    let tx = "";
    try {
      tx = await (this.program.methods as any)
        .revealSignal(Buffer.from(payload))
        .accounts({ authority: this.authority.publicKey, commitment, strategy })
        .rpc();
    } catch (e) {
      const c = await (this.program.account as any).commitment.fetch(commitment).catch(() => undefined);
      if (!c?.revealed) throw e;
      console.error(`[chain] reveal rpc noise ignored (revealed=true):`, (e as Error).message?.slice(0, 120));
    }
    return { tx, commitment: commitment.toBase58() };
  }

  async fetchCommitment(idx: number, seq: bigint): Promise<
    | { address: string; payloadHashHex: string; committedAt: number; revealed: boolean; fixtureId: number }
    | undefined
  > {
    try {
      const address = this.commitPda(this.strategyPda(idx), seq);
      const c = await (this.program.account as any).commitment.fetch(address);
      return {
        address: address.toBase58(),
        payloadHashHex: Buffer.from(c.payloadHash).toString("hex"),
        committedAt: Number(c.committedAt),
        revealed: Boolean(c.revealed),
        fixtureId: Number(c.fixtureId),
      };
    } catch (e) {
      console.error(`[chain] fetchCommitment(${idx},${seq}) failed:`, (e as Error).message?.slice(0, 150));
      return undefined;
    }
  }
}
