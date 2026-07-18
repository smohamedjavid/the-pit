import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.RPC_UPSTREAM ?? "https://solana-devnet.api.onfinality.io/public";

/**
 * Devnet JSON-RPC relay. Public devnet RPCs rate-limit residential IPs hard
 * (getProgramAccounts most of all); serverless egress spreads the load so
 * the verifier and the board can be pointed here. Devnet-only by
 * construction (upstream), no secrets involved.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const out = await res.text();
    return new NextResponse(out, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: (e as Error).message } },
      { status: 502 }
    );
  }
}
