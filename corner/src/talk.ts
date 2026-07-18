import { keccak_256 } from "@noble/hashes/sha3";
import type { PersonaId } from "./slip.js";

/**
 * The trash-talk layer. Deterministic template packs per persona, seeded by
 * event data — same event, same line, every run. If ANTHROPIC_API_KEY is
 * present a one-shot Haiku pass may polish a line; without it the packs
 * stand on their own. The UI labels which mode produced the feed.
 */

export type TalkEvent =
  | "weighin" // registration / pre-fight
  | "sealed" // slip committed on-chain
  | "revealed"
  | "hit"
  | "miss"
  | "noaction"
  | "swept" // all three legs hit
  | "bageled"; // all three legs missed

export interface TalkContext {
  fixture?: string;
  team?: string; // the pick
  oppTeam?: string;
  line?: string; // "over 2.5"
  bps?: number;
  prob?: number; // 0..1
  rival?: string; // rival persona name
  leg?: string; // "match winner" | "total goals" | "late goal"
}

/** mulberry32 over a keccak-derived seed — stable across runs and machines. */
function seeded(seedText: string): () => number {
  const h = keccak_256(new TextEncoder().encode(seedText));
  let a = ((h[0] | (h[1] << 8) | (h[2] << 16) | (h[3] << 24)) >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pack = Record<TalkEvent, string[]>;

const STEAMER: Pack = {
  weighin: [
    "Evening. I don't have opinions, I have a till roll. When the money leans, I lean with it.",
    "They call it herd behaviour. I call it a queue forming at the right window.",
    "I've been reading the tape since before {rival} learned where the decimal goes.",
  ],
  sealed: [
    "Slip's in the wax. {bps} basis points walked onto {team} this afternoon and I walked with them.",
    "Sealed. The line dragged itself towards {team} all day — you don't argue with a tide.",
    "That's me done. {team}, {line}, and the envelope's shut. Watch the board, not my face.",
  ],
  revealed: [
    "There it is, in full. Every leg exactly where the steam said it'd be.",
    "Opened. No edits, no mates' rates, hash checks out. That's the whole point of the wax.",
  ],
  hit: [
    "{leg}: landed. The money knew. The money always knows.",
    "Another one for the till. {leg} comes in and the tide takes a bow.",
    "{leg} good. You can boo, but the board's printed.",
  ],
  miss: [
    "{leg} goes down. Steam got caught in the rain. It happens; it's on the chain forever, which is the deal.",
    "Wrong on {leg}. The crowd can be early and still be wrong — tonight we were both.",
  ],
  noaction: [
    "{leg}: no action. The record keeps the silence too — that's what makes it a record.",
  ],
  swept: [
    "Clean sweep. Three legs, three landings. Frame the slip.",
  ],
  bageled: [
    "A bagel. Three down. I'd delete it if I could — I can't, and that's why you can trust the good nights.",
  ],
  };

const QUANT: Pack = {
  weighin: [
    "Good evening. I remove the bookmaker's margin and read what's left. It's rarely flattering to the favourite-backers.",
    "My edge fits in one line of arithmetic. {rival}'s fits in a horoscope.",
    "I don't do narratives. I do prices, and tonight one of them is mispriced.",
  ],
  sealed: [
    "Committed. Margin off, {team} is the only leg on the board paying rent. Hash on the chain, kettle on.",
    "Sealed before the event, as arithmetic demands. {team}, {line} — the numbers signed it, I just posted it.",
    "The slip is hashed and lodged. If I re-priced it after kickoff the program would spit it back. Working as designed.",
  ],
  revealed: [
    "Revealed, byte for byte. Recompute the keccak yourself — that's not a request, it's an invitation.",
    "Opened. The payload matches the commitment because it must. Trust is for people without hash functions.",
  ],
  hit: [
    "{leg} settles as priced. Expected value is a patient landlord.",
    "{leg}: correct. Not lucky — priced. There's a difference and it compounds.",
  ],
  miss: [
    "{leg} fails. A 40% event happening is not a refutation, it's a Tuesday. The ledger will average me out.",
    "Wrong on {leg}. Variance pays no rent this week. The model stands.",
  ],
  noaction: [
    "{leg}: void. Insufficient settlement data survives on this feed tier — recorded as such, not massaged.",
  ],
  swept: [
    "Three for three. Somewhere a margin weeps.",
  ],
  bageled: [
    "Zero from three. I'll be re-reading the priors so you don't have to.",
  ],
};

const HEEL: Pack = {
  weighin: [
    "Boo all you like. The crowd's been wrong since it invented itself — I'm just here to invoice it.",
    "{rival} follows the money. I follow {rival}, and then I turn around.",
    "Everyone fancies the same thing tonight. Lovely. Shorter queue at my window.",
  ],
  sealed: [
    "Slip's sealed. You all piled one way; I've taken the door you left swinging. {team}, since you ask.",
    "In the wax. Fading the move on {team}'s rival — the public's never once bought a top.",
    "Done and hashed. When it lands you'll call it luck. It's on-chain either way, sunshine.",
  ],
  revealed: [
    "Open it up. Yes, that's really the pick. No, I wasn't joking.",
    "Revealed. Exactly what I sealed, which is more than your group chat can say.",
  ],
  hit: [
    "{leg} LANDS. Go on, check the hash. Cry into it.",
    "That's {leg} for the villain. The herd sends its regards from the bottom of the river.",
  ],
  miss: [
    "{leg} misses. Even the house wins one now and then. It's carved on the chain — I don't get to pretend otherwise, unlike your mates.",
    "Down on {leg}. The mob was right once. Put out the bunting.",
  ],
  noaction: [
    "{leg}: no action. Even I can't argue with a void leg. Watch me try anyway.",
  ],
  swept: [
    "Swept it. Three legs against the crowd and every one landed. Book the villain again.",
  ],
  bageled: [
    "Three misses. Sealed, revealed, humiliated — publicly, permanently. You're welcome.",
  ],
};

const PACKS: Record<PersonaId, Pack> = { steamer: STEAMER, quant: QUANT, heel: HEEL };

function fill(template: string, ctx: TalkContext): string {
  return template
    .replace(/\{team\}/g, ctx.team ?? "the pick")
    .replace(/\{oppTeam\}/g, ctx.oppTeam ?? "the other lot")
    .replace(/\{line\}/g, ctx.line ?? "the line")
    .replace(/\{bps\}/g, String(ctx.bps ?? 0))
    .replace(/\{prob\}/g, ctx.prob != null ? `${Math.round(ctx.prob * 100)}%` : "the price")
    .replace(/\{rival\}/g, ctx.rival ?? "the other corner")
    .replace(/\{leg\}/g, ctx.leg ?? "the leg")
    .replace(/\{fixture\}/g, ctx.fixture ?? "the bill");
}

/**
 * Deterministic line for (persona, event, seedKey). seedKey should encode
 * the concrete event identity (fixtureId, leg, seq) so different events get
 * different lines while re-runs reproduce the feed exactly.
 */
export function talkLine(
  personaId: PersonaId,
  event: TalkEvent,
  seedKey: string,
  ctx: TalkContext = {}
): string {
  const pool = PACKS[personaId][event];
  const rand = seeded(`${personaId}|${event}|${seedKey}`);
  return fill(pool[Math.floor(rand() * pool.length)], ctx);
}

/**
 * Optional polish pass — only if ANTHROPIC_API_KEY is set. Failure of any
 * kind falls back to the template line; the feed marks which mode ran.
 */
export async function polish(line: string, personaId: PersonaId): Promise<{ text: string; polished: boolean }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: line, polished: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: `Rewrite this football pundit line keeping its exact meaning, persona (${personaId}) and British banter register. One sentence back, no quotes, no emoji:\n${line}`,
          },
        ],
      }),
    });
    if (!res.ok) return { text: line, polished: false };
    const body = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = body.content?.[0]?.text?.trim();
    if (!text || text.length > 220) return { text: line, polished: false };
    return { text, polished: true };
  } catch {
    return { text: line, polished: false };
  }
}
