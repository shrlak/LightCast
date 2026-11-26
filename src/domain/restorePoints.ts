import type { Library, DeviceIdentity, ActivityEntry } from './types';
import { getDevice } from './device';
import { normalizeLibrary } from './persistence';

// Snapshots of the library, kept in IndexedDB beside the media so a bad edit can be rolled back
// days later (undo only lasts for the open session).
const DB_NAME = 'freecast-restore';
const STORE = 'points';
export const MAX_POINTS = 30;
/** At most one automatic snapshot this often (ms). */
export const AUTO_INTERVAL = 10 * 60_000;

export interface RestorePoint {
  id: number;
  at: number;
  /** 'auto' (timer / startup), 'manual', or 'before restore'. */
  kind: 'auto' | 'manual' | 'safety' | 'import' | 'show' | 'sync';
  presentations: number;
  slides: number;
  json: string;
  label?: string;
  savedBy?: DeviceIdentity;
  lastModified?: ActivityEntry;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const transaction = d.transaction(STORE, mode);
    const req = f(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(req.result);
    transaction.onerror = () => reject(transaction.error ?? req.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('복원 지점 저장이 취소되었습니다'));
  }));
}

/** Sync snapshots kept at most (they come often while several devices edit; they must not push out the others). */
export const MAX_SYNC_POINTS = 8;
/** At most one sync snapshot this often (ms): while devices edit together, changes arrive every few seconds. */
export const SYNC_INTERVAL = 2 * 60_000;

/** Which snapshots survive: the newest `max`, but a manual or safety snapshot outlives autos, and sync snapshots are capped. */
export function pruneIds(points: Pick<RestorePoint, 'id' | 'at' | 'kind'>[], max = MAX_POINTS): number[] {
  const newest = [...points].sort((a, b) => b.at - a.at);
  const keep = new Set<number>();
  let syncs = 0;
  for (const p of newest) if (p.kind !== 'auto' && p.kind !== 'sync' && keep.size < max) keep.add(p.id);
  for (const p of newest) if (p.kind === 'sync' && syncs < MAX_SYNC_POINTS && keep.size < max) { keep.add(p.id); syncs++; }
  for (const p of newest) if (p.kind === 'auto' && keep.size < max) keep.add(p.id);
  return newest.filter((p) => !keep.has(p.id)).map((p) => p.id);
}

/** Online songs are never saved with the library (they come back from the server). */
const serialize = (lib: Library) => JSON.stringify({ ...lib, presentations: lib.presentations.filter((p) => !p.online) });

let saveQueue: Promise<void> = Promise.resolve();
export function saveRestorePoint(lib: Library, kind: RestorePoint['kind'], at = Date.now(), label?: string): Promise<void> {
  const job = saveQueue.then(() => writeRestorePoint(lib, kind, at, label));
  saveQueue = job.catch(() => undefined);
  return job;
}

type Meta = Pick<RestorePoint, 'id' | 'at' | 'kind'>;
/**
 * Which snapshots exist, kept in memory: each snapshot holds the whole library, so reading them
 * all for every save (every sync, every minute) made sync and the app slow with a large library.
 */
let metaCache: Meta[] | null = null;
const metaOf = ({ id, at, kind }: RestorePoint): Meta => ({ id, at, kind });
async function metas(): Promise<Meta[]> {
  // Read once per session; afterwards the list is kept up to date here.
  if (!metaCache) await listRestorePoints();
  return metaCache ?? [];
}

async function writeRestorePoint(lib: Library, kind: RestorePoint['kind'], at: number, label?: string): Promise<void> {
  const mine = lib.presentations.filter((p) => !p.online);
  const existing = await metas();
  const id = Math.max(at, ...existing.map((p) => p.id + 1));
  const point: RestorePoint = { id, at, kind, label, savedBy: getDevice(), lastModified: lib.lastModified, presentations: mine.length, slides: mine.reduce((n, p) => n + p.slides.length, 0), json: serialize(lib) };
  await run('readwrite', (s) => s.put(point));
  const all = [...existing.filter((m) => m.id !== id), metaOf(point)];
  const gone = new Set(pruneIds(all));
  for (const old of gone) await run('readwrite', (s) => s.delete(old));
  metaCache = all.filter((m) => !gone.has(m.id));
}

/** Newest first. */
export async function listRestorePoints(): Promise<RestorePoint[]> {
  const all = await run<RestorePoint[]>('readonly', (s) => s.getAll());
  metaCache = all.map(metaOf);
  return all.sort((a, b) => b.at - a.at);
}

/** When the newest snapshot was taken (null when there is none), without reading the snapshots. */
export async function newestRestorePointAt(): Promise<number | null> {
  const all = await metas();
  return all.length ? Math.max(...all.map((m) => m.at)) : null;
}

/** The library of a snapshot (null if it can no longer be read). */
export const libraryOf = (p: RestorePoint): Library | null => {
  try {
    return normalizeLibrary(JSON.parse(p.json));
  } catch {
    return null;
  }
};

/** Save each distinct state at the beginning of sync, including attempts that fail offline. */
let syncSnapshotQueue: Promise<void> = Promise.resolve();
/** The library of the last sync snapshot (undefined until read once): checks that change nothing stay in memory. */
let lastSyncJson: string | null | undefined;
let lastSyncAt = 0;
export function saveSyncRestorePoint(lib: Library, now = Date.now()): Promise<void> {
  // While devices edit together a change arrives every few seconds; one snapshot every couple of minutes is enough
  // (and each one holds the whole library).
  if (now - lastSyncAt < SYNC_INTERVAL) return syncSnapshotQueue;
  const json = serialize(lib);
  const job = syncSnapshotQueue.then(async () => {
    if (lastSyncJson === undefined) {
      const newest = [...(await metas())].filter((m) => m.kind === 'sync').sort((a, b) => b.at - a.at)[0];
      lastSyncJson = newest ? (await run<RestorePoint | undefined>('readonly', (s) => s.get(newest.id)))?.json ?? null : null;
    }
    if (lastSyncJson === json) return;
    await saveRestorePoint(lib, 'sync', Date.now(), '수정 후 동기화 시작');
    lastSyncJson = json;
    lastSyncAt = now;
  });
  syncSnapshotQueue = job.catch(() => undefined);
  return job;
}
