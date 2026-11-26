// Randomised sessions for the sync stress suites (tests/stress*.test.ts). Every session runs from a seed, so a failure
// names the seed that reproduces it. The ordinary test run does a few sessions per scenario; the deep run does
// thousands:  SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
// SYNC_STRESS_SEED shifts the seeds (another set of sessions); SYNC_STRESS_ONLY=<seed> replays one session (the seed a
// failure names; add SYNC_TRACE=1 for its steps); SYNC_STRESS_REPORT=<dir> writes one JSON line per scenario (sessions,
// problems found, time) there.
import fs from 'node:fs';
import path from 'node:path';

export const STRESS_RUNS = Math.max(1, Number(process.env.SYNC_STRESS_RUNS) || 30);
export const STRESS_SEED = Number(process.env.SYNC_STRESS_SEED) || 0;

/** A small, fast, seeded random generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    shuffle: <T>(xs: T[]): T[] => { const out = [...xs]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; },
  };
}
export type Rng = ReturnType<typeof rng>;

/**
 * Run `session` for every seed of a scenario. A session throws to report a problem; the first problems (with their
 * seeds) are collected and the scenario fails with them, after all sessions ran (so the count of failures is known).
 */
export async function scenario(name: string, session: (r: Rng, seed: number) => Promise<void> | void, runs = STRESS_RUNS): Promise<void> {
  const started = performance.now();
  const problems: string[] = [];
  let failed = 0;
  const only = Number(process.env.SYNC_STRESS_ONLY) || 0;
  for (let i = 0; i < (only ? 1 : runs); i++) {
    const seed = only || STRESS_SEED + i * 7919 + 1;
    try { await session(rng(seed), seed); }
    catch (e) { failed++; if (problems.length < 5) problems.push(`seed ${seed}: ${(e as Error).message}`); }
  }
  const dir = process.env.SYNC_STRESS_REPORT;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'report.jsonl'), JSON.stringify({ scenario: name, sessions: only ? 1 : runs, failed, ms: Math.round(performance.now() - started), problems }) + '\n');
  }
  if (failed) throw new Error(`${name}: ${failed} of ${only ? 1 : runs} sessions failed\n${problems.join('\n')}`);
}

/** Fail a session with a message (an assertion that reads well in the report). */
export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

/** Generous test timeout for a scenario: about 60 ms a session, at least 30 s. */
export const timeoutFor = (perSessionMs = 60) => Math.max(30_000, STRESS_RUNS * perSessionMs * 3);
