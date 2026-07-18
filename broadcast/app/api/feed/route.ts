import { NextResponse } from "next/server";
import { feed, meta, rounds } from "../../../lib/data";

export const dynamic = "force-dynamic";

/** The broadcast data, as one JSON: talk lines, rounds, registry metadata. */
export async function GET() {
  return NextResponse.json(
    { meta: meta(), rounds: rounds(), feed: feed() },
    { headers: { "Cache-Control": "public, max-age=30" } }
  );
}
