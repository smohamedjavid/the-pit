import fs from "node:fs";
import path from "node:path";
import { TxlineSession, TxlineRest } from "txline-kit";

/**
 * TxLINE access for the corner. Tokens come from env
 * (TXLINE_JWT / TXLINE_API_TOKEN) or a local tokens file; guest start is
 * the fallback so a fresh clone still works.
 */
export function makeRest(): TxlineRest {
  const session = new TxlineSession({ network: "devnet" });
  let jwt = process.env.TXLINE_JWT;
  let apiToken = process.env.TXLINE_API_TOKEN;
  if (!jwt || !apiToken) {
    const candidates = [
      process.env.TXLINE_TOKENS_FILE,
      path.resolve("../txline-kit/.spike-tokens.json"),
      path.resolve(".tokens.json"),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const t = JSON.parse(fs.readFileSync(p, "utf8"));
        jwt = t.jwt;
        apiToken = t.apiToken;
        break;
      }
    }
  }
  if (jwt && apiToken) session.setTokens({ jwt, apiToken });
  return new TxlineRest(session);
}
