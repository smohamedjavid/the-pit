import fs from "node:fs";
import path from "node:path";

/**
 * Broadcast data. Written by the corner (`build-feed`); slips appear here
 * only after their on-chain reveal — before that a round carries hash and
 * seal metadata only.
 */

export interface Grades {
  source: "txline-scores" | "market-close";
  matchWinner: "HIT" | "MISS" | "NO ACTION";
  totalGoals: "HIT" | "MISS" | "NO ACTION";
  lateGoalAfter75: "HIT" | "MISS" | "NO ACTION";
  brier: number | null;
  detail: {
    homeGoals90: number | null;
    awayGoals90: number | null;
    resultSide: string | null;
    totalGoals90: number | null;
    lateGoal: boolean | null;
  };
}

export interface PublicSlip {
  hashHex: string;
  seq?: string;
  commitment?: string;
  commitmentLink?: string;
  committedAt?: number;
  revealed: boolean;
  slip?: {
    picks: {
      matchWinner: { side: string; team: string; prob: number };
      totalGoals: { line: number; side: string; prob: number };
      lateGoalAfter75: { yes: boolean; prob: number };
    };
    rationale: string;
    basis: { asOfMs: number; source: string };
  };
  canonical?: string;
  grades?: Grades;
  revealTx?: string;
}

export interface Round {
  id: string;
  label: string;
  replay: boolean;
  fixtureId: number;
  fixture: string;
  home: string;
  away: string;
  kickoffMs: number;
  cutoffMs: number;
  slips: Record<string, PublicSlip>;
}

export interface FeedItem {
  ts: number;
  persona: string;
  kind: string;
  text: string;
  round?: string;
  leg?: string;
  grade?: string;
  commitment?: string;
  link?: string;
}

export interface Meta {
  programId: string;
  programLink: string;
  generatedAt: number;
  talkMode: string;
  personas: Array<{
    id: string;
    name: string;
    tagline: string;
    style: string;
    params: string;
    expectedPerDay: number;
    authority?: string;
    strategyAddress?: string;
    strategyLink?: string;
    windowStart?: number;
    windowEnd?: number;
  }>;
}

const DATA = path.join(process.cwd(), "data");

function read<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")) as T;
  } catch (e) {
    console.error(`[data] read ${name} failed:`, (e as Error).message);
    return fallback;
  }
}

export function rounds(): Round[] {
  return read<Round[]>("rounds.json", []);
}

export function feed(): FeedItem[] {
  return read<FeedItem[]>("feed.json", []);
}

export function meta(): Meta {
  return read<Meta>("meta.json", {
    programId: "8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD",
    programLink:
      "https://explorer.solana.com/address/8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD?cluster=devnet",
    generatedAt: 0,
    talkMode: "templates",
    personas: [],
  });
}
