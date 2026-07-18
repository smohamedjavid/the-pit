import { NextResponse } from "next/server";
import { board } from "../../../lib/board";

export const dynamic = "force-dynamic";

/**
 * KNOWS BALL, as JSON. Chain-first: seal/reveal counts come from decoding
 * the registry program's accounts live; grades from the published rounds.
 */
export async function GET() {
  const b = await board();
  return NextResponse.json(b, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
