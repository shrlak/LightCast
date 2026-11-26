// Offline-first sync: the library always lives on this computer and is saved there first. These are the
// pieces that make being offline an ordinary state: when to ask the server again, when to retry, and what is still
// waiting to be sent.
import type { Library } from './types';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error' | 'offline';

const RETRY_DELAY = 2_500;
const MAX_DELAY = 3 * 60_000;

/** After failed rounds: 5 s, 10 s, 20 s … at most 3 min (the connection returning asks at once). */
export function retryDelay(failures: number): number {
  return Math.min(MAX_DELAY, RETRY_DELAY * 2 ** Math.max(0, Math.min(failures, 8)));
}

/** How often to ask the server for other devices' edits. A quiet ask is one small request (answered 204). */
export const POLL = {
  /** Someone is editing (here or on another device, within the last three minutes). */
  live: 1_000,
  /** This window is on screen and in use. */
  visible: 2_000,
  /** On screen but not the active window (e.g. behind the slide show). */
  background: 4_000,
  /** On screen, nobody edited anything for ten minutes. */
  idle: 8_000,
  /** Minimised or hidden. */
  hidden: 30_000,
} as const;
const LIVE_FOR = 3 * 60_000;
const IDLE_AFTER = 10 * 60_000;

export interface PollContext { failures: number; hidden: boolean; focused: boolean; now: number; /** Last edit here or change from another device. */ activeAt: number }

/** When to ask the server next (ms). */
export function pollDelay(c: PollContext): number {
  if (c.failures > 0) return retryDelay(c.failures);
  if (c.hidden) return POLL.hidden;
  const since = c.now - c.activeAt;
  if (since < LIVE_FOR) return POLL.live;
  if (since > IDLE_AFTER) return POLL.idle;
  return c.focused ? POLL.visible : POLL.background;
}

/** Errors that mean "the server cannot be reached" (no internet, church server down), not "the server said no". */
export function isOfflineError(e: unknown): boolean {
  const err = e as { network?: boolean; status?: number } | null;
  return !!err && (err.network === true || [502, 503, 504].includes(err.status ?? 0));
}

const LISTS = ['presentations', 'playlists', 'themes', 'media', 'timers', 'props', 'messageTemplates', 'macros', 'screens', 'schedules', 'looks', 'stageLayouts', 'fonts'] as const;

export interface PendingChanges {
  presentations: number;
  playlists: number;
  /** Everything else: themes, media, macros, timers, settings … */
  other: number;
  total: number;
}

function changedItems(before: { id: string }[] | undefined, after: { id: string }[] | undefined): number {
  const old = new Map((before ?? []).map((x) => [x.id, JSON.stringify(x)]));
  let n = 0;
  const seen = new Set<string>();
  for (const x of after ?? []) {
    seen.add(x.id);
    if (old.get(x.id) !== JSON.stringify(x)) n++;
  }
  for (const id of old.keys()) if (!seen.has(id)) n++;
  return n;
}

/** What differs between the library the server last had (`base`) and this computer's: the edits not sent yet. */
export function pendingChanges(base: Library | null, current: Library): PendingChanges {
  const mine = (lib: Library | null) => (lib ? lib.presentations.filter((p) => !p.online) : undefined);
  const presentations = changedItems(mine(base), mine(current));
  const playlists = changedItems(base?.playlists, current.playlists);
  let other = 0;
  for (const key of LISTS) if (key !== 'presentations' && key !== 'playlists') other += changedItems(base?.[key] as { id: string }[] | undefined, current[key] as { id: string }[]);
  for (const key of ['sunday', 'logoMediaId', 'retreat'] as const) if (JSON.stringify(base?.[key] ?? null) !== JSON.stringify(current[key] ?? null)) other++;
  return { presentations, playlists, other, total: presentations + playlists + other };
}

export function describePending(p: PendingChanges): string {
  if (!p.total) return '보낼 변경 없음';
  return [p.presentations && `프레젠테이션 ${p.presentations}`, p.playlists && `재생목록 ${p.playlists}`, p.other && `기타 ${p.other}`].filter(Boolean).join(' · ');
}

/**
 * Older versions kept a presentation two computers changed at once twice and asked which to keep. Sync now takes the
 * later edit by itself (cloudMerge.ts), so the saved list of those questions is cleared once.
 */
export function forgetOldConflicts(storage: Pick<Storage, 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  try { storage?.removeItem('freecast.sync.conflicts'); } catch { /* nothing kept */ }
}
