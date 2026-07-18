/**
 * Archive every transaction referenced by evidence/*.json into
 * evidence/tx/<sig>.json. Devnet keeps only ~4 days of transaction history,
 * so the archived JSON is the durable copy; the account links in the
 * evidence files remain live regardless.
 *
 *   npx tsx scripts/archive-tx.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection } from "@solana/web3.js";

const EV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "evidence");

async function main() {
  const conn = new Connection(
    process.env.RPC ?? "https://solana-devnet.api.onfinality.io/public",
    "confirmed"
  );
  const sigs = new Set<string>();
  for (const f of fs.readdirSync(EV)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(EV, f), "utf8")) as Record<string, unknown>;
    for (const k of ["tx", "revealTx", "registerTx"]) {
      const v = j[k];
      if (typeof v === "string" && v.length > 40) sigs.add(v);
    }
  }
  fs.mkdirSync(path.join(EV, "tx"), { recursive: true });
  let archived = 0;
  for (const sig of sigs) {
    const out = path.join(EV, "tx", `${sig}.json`);
    if (fs.existsSync(out)) continue;
    const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
    if (!tx) {
      console.error(`not found on rpc (already purged?): ${sig}`);
      continue;
    }
    fs.writeFileSync(out, JSON.stringify(tx, null, 2));
    archived += 1;
  }
  console.log(`archived ${archived} transactions (${sigs.size} referenced)`);
}

main().catch((e) => {
  console.error("archive failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
