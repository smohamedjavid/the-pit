import fs from "node:fs";
import path from "node:path";
import { PERSONAS, persona } from "./personas.js";
import { talkLine, type TalkEvent } from "./talk.js";
import type { PersonaId } from "./slip.js";
import type { CornerState, RoundState, SlipState } from "./state.js";
import { PIT_PROGRAM_ID } from "./chain.js";

/**
 * Derives the public broadcast data from corner state:
 *
 *  - rounds.json  — every round; slips appear only once revealed on-chain
 *  - feed.json    — trash-talk + graded calls, one interleaved timeline
 *  - meta.json    — program id, pundit registry accounts, params strings
 *
 * All deterministic: same state in, same feed out (talk lines are seeded
 * by event identity).
 */

const EXPLORER = "https://explorer.solana.com";

export function accountLink(address: string): string {
  return `${EXPLORER}/address/${address}?cluster=devnet`;
}

interface FeedItem {
  ts: number;
  persona: PersonaId;
  kind: TalkEvent | "call";
  text: string;
  round?: string;
  leg?: string;
  grade?: string;
  commitment?: string;
  link?: string;
}

const LEG_LABELS: Record<string, string> = {
  matchWinner: "match winner",
  totalGoals: "total goals",
  lateGoalAfter75: "late goal after 75'",
};

function pickTeamOf(s: SlipState): string {
  return s.slip.picks.matchWinner.team;
}

function lineOf(s: SlipState): string {
  const t = s.slip.picks.totalGoals;
  return `${t.side} ${t.line}`;
}

function rivalOf(id: PersonaId): string {
  const others = PERSONAS.filter((p) => p.id !== id);
  return others[0].name;
}

export function buildFeed(state: CornerState): { rounds: unknown[]; feed: FeedItem[]; meta: unknown } {
  const feed: FeedItem[] = [];
  const rounds: unknown[] = [];

  // weigh-in lines at registration time
  for (const [pid, ps] of Object.entries(state.personas)) {
    feed.push({
      ts: ps.windowStart * 1000,
      persona: pid as PersonaId,
      kind: "weighin",
      text: talkLine(pid as PersonaId, "weighin", `register|${ps.strategyAddress}`, {
        rival: rivalOf(pid as PersonaId),
      }),
      link: accountLink(ps.strategyAddress),
    });
  }

  for (const round of state.rounds) {
    const publicSlips: Record<string, unknown> = {};
    for (const [pid, s] of Object.entries(round.slips) as Array<[PersonaId, SlipState]>) {
      const revealed = Boolean(s.revealTx || s.grades);
      publicSlips[pid] = {
        hashHex: s.hashHex,
        seq: s.seq,
        commitment: s.commitment,
        commitmentLink: s.commitment ? accountLink(s.commitment) : undefined,
        committedAt: s.committedAt,
        revealed,
        // the slip itself is public only after the on-chain reveal
        ...(revealed
          ? { slip: s.slip, canonical: s.canonical, grades: s.grades, revealTx: s.revealTx }
          : {}),
      };

      if (s.committedAt) {
        feed.push({
          ts: s.committedAt * 1000,
          persona: pid,
          kind: "sealed",
          round: round.id,
          text: talkLine(pid, "sealed", `sealed|${round.id}|${s.hashHex}`, {
            team: revealed ? pickTeamOf(s) : "the pick",
            line: revealed ? lineOf(s) : "the line",
            bps: 0,
            fixture: round.fixture,
          }),
          commitment: s.commitment,
          link: s.commitment ? accountLink(s.commitment) : undefined,
        });
      }
      if (revealed && s.revealedAtMs) {
        feed.push({
          ts: s.revealedAtMs,
          persona: pid,
          kind: "revealed",
          round: round.id,
          text: talkLine(pid, "revealed", `revealed|${round.id}|${s.hashHex}`, {
            fixture: round.fixture,
          }),
          commitment: s.commitment,
          link: s.commitment ? accountLink(s.commitment) : undefined,
        });
      }
      if (s.grades && s.revealedAtMs) {
        const legs = [
          ["matchWinner", s.grades.matchWinner],
          ["totalGoals", s.grades.totalGoals],
          ["lateGoalAfter75", s.grades.lateGoalAfter75],
        ] as const;
        let offset = 1;
        for (const [leg, grade] of legs) {
          const ev: TalkEvent = grade === "HIT" ? "hit" : grade === "MISS" ? "miss" : "noaction";
          feed.push({
            ts: s.revealedAtMs + offset * 1000,
            persona: pid,
            kind: ev,
            round: round.id,
            leg: LEG_LABELS[leg],
            grade,
            text: talkLine(pid, ev, `${ev}|${round.id}|${leg}|${s.hashHex}`, {
              leg: LEG_LABELS[leg],
              team: pickTeamOf(s),
              line: lineOf(s),
            }),
          });
          offset += 1;
        }
        const results = legs.map(([, g]) => g);
        if (results.every((g) => g === "HIT")) {
          feed.push({
            ts: s.revealedAtMs + 5000,
            persona: pid,
            kind: "swept",
            round: round.id,
            text: talkLine(pid, "swept", `swept|${round.id}|${s.hashHex}`, {}),
          });
        } else if (results.every((g) => g === "MISS")) {
          feed.push({
            ts: s.revealedAtMs + 5000,
            persona: pid,
            kind: "bageled",
            round: round.id,
            text: talkLine(pid, "bageled", `bageled|${round.id}|${s.hashHex}`, {}),
          });
        }
      }
    }

    rounds.push({
      id: round.id,
      label: round.label,
      replay: round.replay,
      fixtureId: round.fixtureId,
      fixture: round.fixture,
      home: round.home,
      away: round.away,
      kickoffMs: round.kickoffMs,
      cutoffMs: round.cutoffMs,
      slips: publicSlips,
    });
  }

  feed.sort((a, b) => a.ts - b.ts);

  const meta = {
    programId: PIT_PROGRAM_ID.toBase58(),
    programLink: accountLink(PIT_PROGRAM_ID.toBase58()),
    generatedAt: Date.now(),
    talkMode: "templates", // set to "templates+haiku" by cli when polish ran
    personas: PERSONAS.map((p) => {
      const ps = state.personas[p.id];
      return {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        style: p.style,
        params: p.params,
        expectedPerDay: p.expectedPerDay,
        authority: ps?.authority,
        strategyAddress: ps?.strategyAddress,
        strategyLink: ps ? accountLink(ps.strategyAddress) : undefined,
        windowStart: ps?.windowStart,
        windowEnd: ps?.windowEnd,
      };
    }),
  };

  return { rounds, feed, meta };
}

export function writeFeed(state: CornerState, outDir: string): void {
  const { rounds, feed, meta } = buildFeed(state);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "rounds.json"), JSON.stringify(rounds, null, 2));
  fs.writeFileSync(path.join(outDir, "feed.json"), JSON.stringify(feed, null, 2));
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
}
