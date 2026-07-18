import fs from "node:fs";
import path from "node:path";
import type { PersonaId, PickSlip } from "./slip.js";
import type { SlipGrades } from "./grade.js";

/**
 * Corner state. Lives in corner/data/state.json which is gitignored on
 * purpose: before a reveal it contains the un-revealed slips (picks + salt),
 * and publishing those would make the sealed hashes decorative. Everything
 * public is derived into broadcast/data by `build-feed` — slips only appear
 * there once revealed on-chain.
 */

export interface PersonaState {
  authority: string;
  strategyIdx: number;
  strategyAddress: string;
  registerTx: string;
  params: string;
  expectedPerDay: number;
  windowStart: number;
  windowEnd: number;
}

export interface SlipState {
  slip: PickSlip;
  canonical: string;
  hashHex: string;
  seq?: string;
  commitment?: string;
  commitTx?: string;
  committedAt?: number; // on-chain unix seconds
  revealTx?: string;
  revealedAtMs?: number;
  grades?: SlipGrades;
}

export interface RoundState {
  id: string; // "replay-1" | "main-event"
  label: string;
  replay: boolean;
  fixtureId: number;
  fixture: string;
  home: string;
  away: string;
  kickoffMs: number;
  cutoffMs: number; // odds considered up to this instant
  slips: Partial<Record<PersonaId, SlipState>>;
}

export interface CornerState {
  personas: Partial<Record<PersonaId, PersonaState>>;
  rounds: RoundState[];
}

const DATA_DIR = path.resolve(process.env.CORNER_DATA ?? "corner/data");
const STATE = path.join(DATA_DIR, "state.json");

export function dataDir(): string {
  return DATA_DIR;
}

export function loadState(): CornerState {
  if (!fs.existsSync(STATE)) return { personas: {}, rounds: [] };
  return JSON.parse(fs.readFileSync(STATE, "utf8")) as CornerState;
}

export function saveState(s: CornerState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}

export function saveEvidence(name: string, payload: unknown): string {
  const dir = path.resolve("evidence");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}
