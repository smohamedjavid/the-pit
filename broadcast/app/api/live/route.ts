import { NextResponse } from "next/server";
import { TxlineSession, TxlineRest } from "txline-kit";
import { rounds } from "../../../lib/data";

export const dynamic = "force-dynamic";

/**
 * Live score for the main event, if TxLINE credentials are present in the
 * environment (TXLINE_JWT / TXLINE_API_TOKEN). Degrades to
 * { available: false } without them — the bill renders fine either way.
 */
export async function GET() {
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  const main = rounds().find((r) => !r.replay);
  if (!jwt || !apiToken || !main) {
    return NextResponse.json({ available: false });
  }
  try {
    const session = new TxlineSession({ network: "devnet" });
    session.setTokens({ jwt, apiToken });
    const rest = new TxlineRest(session);
    const records = (await rest.scoresSnapshot(main.fixtureId)) as Array<{
      StatusId?: number;
      Clock?: { Seconds?: number };
      Score?: Record<string, unknown>;
    }>;
    const latest = [...(records ?? [])].reverse().find((r) => r.Score);
    return NextResponse.json(
      {
        available: Boolean(latest),
        fixtureId: main.fixtureId,
        statusId: latest?.StatusId ?? null,
        clockSeconds: latest?.Clock?.Seconds ?? null,
        score: latest?.Score ?? null,
      },
      { headers: { "Cache-Control": "public, max-age=20" } }
    );
  } catch (e) {
    console.error("[live] fetch failed:", (e as Error).message);
    return NextResponse.json({ available: false });
  }
}
