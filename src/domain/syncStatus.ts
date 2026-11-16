// Offline-first sync: the library always lives on this computer and is saved there first. These are the
// pieces that make being offline an ordinary state: when to retry, what is still waiting to be sent, and
// what to do with a presentation that two computers changed at once.
import type { Library, Presentation } from './types';
import type { Action } from './reducer';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error' | 'offline';

const BASE_DELAY = 20_000;
const MAX_DELAY = 5 * 60_000;

/** How long to wait before asking the server again: every 20 s, then slower after each failure (at most 5 min). */
export function retryDelay(failures: number): number {
  return Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.max(0, Math.min(failures, 8)));
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

// ---------- the same presentation changed on two computers
export interface ConflictRecord {
  id: string;
  title: string;
  /** This computer's version (kept under its own id). */
  localId: string;
  /** The other computer's version, saved beside it as "(다른 기기)". */
  copyId: string;
  at: number;
}

export const COPY_SUFFIX = ' (다른 기기)';
export type ConflictChoice = 'mine' | 'theirs' | 'both';

const KEY = 'freecast.sync.conflicts';
const MAX_CONFLICTS = 50;

const isRecord = (v: unknown): v is ConflictRecord => {
  const c = v as ConflictRecord | null;
  return !!c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.localId === 'string' && typeof c.copyId === 'string' && Number.isFinite(c.at);
};

export function loadConflicts(): ConflictRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(isRecord).slice(-MAX_CONFLICTS) : [];
  } catch {
    return [];
  }
}

export function saveConflicts(list: ConflictRecord[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_CONFLICTS))); } catch { /* the list is kept for this session only */ }
}

/** Add new conflicts, once each (the same copy is never listed twice). */
export function addConflicts(list: ConflictRecord[], found: Omit<ConflictRecord, 'id' | 'at'>[], at: number): ConflictRecord[] {
  const known = new Set(list.map((c) => c.copyId));
  const added = found.filter((f) => !known.has(f.copyId)).map((f) => ({ ...f, id: `${f.copyId}`, at }));
  return [...list, ...added].slice(-MAX_CONFLICTS);
}

/** Conflicts whose two versions both still exist; the others were already dealt with (deleted, merged by hand). */
export function openConflicts(list: ConflictRecord[], lib: Library): ConflictRecord[] {
  const ids = new Set(lib.presentations.map((p) => p.id));
  return list.filter((c) => ids.has(c.localId) && ids.has(c.copyId));
}

const withoutSuffix = (title: string) => (title.endsWith(COPY_SUFFIX) ? title.slice(0, -COPY_SUFFIX.length) : title);

/**
 * The actions for each choice: keep mine (drop the other computer's copy), use theirs (this presentation
 * becomes the other computer's version, under its own name and place), or keep both (nothing changes).
 */
export function conflictActions(c: ConflictRecord, lib: Library, choice: ConflictChoice): Action[] {
  const copy = lib.presentations.find((p) => p.id === c.copyId);
  if (choice === 'both') return [];
  if (choice === 'mine' || !copy) return [{ type: 'presentation/delete', id: c.copyId }];
  const { id: _id, ...rest } = copy;
  const patch: Partial<Omit<Presentation, 'id'>> = { ...rest, title: withoutSuffix(copy.title), protected: undefined, protectionChangedAt: undefined };
  return [{ type: 'presentation/update', id: c.localId, patch }, { type: 'presentation/delete', id: c.copyId }];
}
