// Client for the church cloud library (Worker /freecast/* via this app's /api/cloud proxy).
import type { Library } from './types';
import { deleteMedia, getMedia, mediaKeys, putMedia } from './media';
import { summarizeCloudStorage, parseServerStorage } from './cloudStorage';
import { normalizeLibrary } from './persistence';
import { learnServerTime } from './serverClock';

const SESSION_KEY = 'freecast.cloud';
const BASE_KEY = 'cloud:base';

export interface CloudSession {
  token: string;
  username: string;
  /** Server library version this computer last synced with. */
  version: number;
}

export interface CloudClearPreview {
  server: string; revision: string; version: number; presentations: number; playlists: number; trash: number; mediaCount: number; mediaBytes: number;
}

export function loadSession(): CloudSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return s?.token ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: CloudSession | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  const sentAt = Date.now();
  try {
    res = await fetch(`/api/cloud/${path}`, { ...init, headers });
  } catch {
    throw Object.assign(new Error('LightCast 서버에 연결할 수 없습니다.'), { network: true });
  }
  // Every answer tells this computer the church server's time (edits are stamped with it).
  learnServerTime(res, sentAt, Date.now());
  if (res.status === 204) return { status: 204, data: null as T };
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.blob();
  if (res.status === 404 && (data as { error?: string })?.error === 'not found') {
    // The Worker answered but has no /freecast routes: the account feature is not deployed there yet.
    throw Object.assign(new Error('교회 서버(Cloudflare Worker)에 계정 기능이 아직 설치되지 않았습니다. 관리자가 Worker를 업데이트해야 로그인할 수 있어요.'), { status: 404 });
  }
  if (!res.ok && res.status !== 409) throw Object.assign(new Error((data as { error?: string })?.error ?? `오류 ${res.status}`), { status: res.status });
  return { status: res.status, data: data as T };
}

export const cloudApi = {
  clearPreview: (token: string) => call<CloudClearPreview>('clear', { token }).then((r) => r.data),
  clearAll: async (token: string, password: string, revision: string) => {
    const r = await call<{ ok: boolean; token: string; username: string; version: number; data: Library; deleted: CloudClearPreview; error?: string }>('clear', { method: 'POST', token, body: JSON.stringify({ password, revision }) });
    if (r.status !== 200) throw Object.assign(new Error(r.data.error ?? '서버 자료가 변경되었습니다. 삭제 대상을 다시 확인하세요.'), { status: r.status });
    return r.data;
  },
  register: (username: string, password: string, adminPassword: string) =>
    call<{ ok: boolean }>('register', { method: 'POST', body: JSON.stringify({ username, password, adminPassword }) }),
  login: (username: string, password: string) =>
    call<{ token: string; username: string }>('login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: (token: string) => call('logout', { method: 'POST', token }).catch(() => undefined),
  /** null when the server has nothing newer than `known`. */
  getLibrary: async (token: string, known?: number) => {
    const r = await call<{ version: number; data: unknown; updatedBy: string | null }>(`library${known != null ? `?known=${known}` : ''}`, { token });
    return r.status === 204 ? null : r.data;
  },
  putLibrary: (token: string, baseVersion: number, data: Library) =>
    call<{ version: number; conflict?: boolean; data?: unknown }>('library', { method: 'PUT', token, body: JSON.stringify({ baseVersion, data }) }),
  listMedia: (token: string) => call<{ items: { id: string; size: number; type?: string }[] }>('media', { token }).then((r) => r.data.items),
  uploadMedia: async (token: string, id: string, blob: Blob, resetId?: string) => {
    const r = await call<{ error?: string } | null>(`media/${encodeURIComponent(id)}`, { method: 'PUT', token, body: blob, headers: { 'content-type': blob.type || 'application/octet-stream', ...(resetId ? { 'X-Freecast-Reset-Id': resetId } : {}) } });
    // `call` lets 409 through for the library; for a file it means "not stored" (e.g. sent from before a server reset).
    if (r.status === 409) throw Object.assign(new Error(r.data?.error ?? '서버가 이 파일을 받지 않았습니다'), { status: 409 });
    return r;
  },
  deleteMedia: (token: string, id: string) => call(`media/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
  downloadMedia: (token: string, id: string) => call<Blob>(`media/${encodeURIComponent(id)}`, { token }).then((r) => r.data),
};

/** The library as the server last saw it (kept in IndexedDB: it can be large). */
export async function loadBase(): Promise<Library | null> {
  const b = await getMedia(BASE_KEY).catch(() => undefined);
  if (!b) return null;
  try {
    return normalizeLibrary(JSON.parse(await b.text()));
  } catch {
    return null;
  }
}

export const clearBase = () => deleteMedia(BASE_KEY).catch(() => undefined);

const BASE_OWNER_KEY = 'freecast.cloud.baseOwner';
/**
 * Signing in: does the remembered base belong to another account? Then it must be forgotten, or the merge
 * takes everything that account had and this one lacks for "deleted in the cloud" and drops it from this
 * computer. A base from before the owner was recorded is taken to be this account's.
 */
export function baseOwnerChanges(username: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): boolean {
  let owner: string | null = null;
  try { owner = storage.getItem(BASE_OWNER_KEY); storage.setItem(BASE_OWNER_KEY, username); } catch { /* private mode: keep the base */ }
  return owner !== null && owner !== username;
}

export const saveBase = (lib: Library) => putMedia(BASE_KEY, new Blob([JSON.stringify(lib)], { type: 'application/json' }));

/**
 * Upload media this computer has that the server lacks, and download the reverse, a few files at a time. One file
 * that cannot be sent or received is skipped (and tried again next time); it no longer stops the rest, nor marks the
 * whole sync as failed. `failed` lists the names of the files skipped this time.
 */
export interface MediaStore {
  get(id: string): Promise<Blob | undefined>;
  put(id: string, blob: Blob): Promise<unknown>;
  /** The ids stored here, read at once (without it every file is read to see whether it is there). */
  keys?(): Promise<Set<string>>;
}
const deviceMedia: MediaStore = { get: (id) => getMedia(id), put: (id, blob) => putMedia(id, blob), keys: async () => mediaKeys() };

/** Files moved at once: enough to fill the line, few enough not to starve the library requests. */
export const MEDIA_CONCURRENCY = 3;
const MAX_UPLOAD = 50 * 1024 * 1024;

export async function syncMedia(token: string, lib: Library, onProgress: (msg: string) => void, store: MediaStore = deviceMedia) {
  const items = await cloudApi.listMedia(token);
  const remote = new Set(items.map((m) => m.id));
  const failed: string[] = [];
  const here = store.keys ? await store.keys().catch(() => null) : null;
  // Only files that have to move are read: a stored file the server already has is never opened.
  const work = lib.media.filter((m) => (here ? here.has(m.id) !== remote.has(m.id) : true));
  let fatal: unknown = null;
  let next = 0;
  const one = async (m: Library['media'][number]) => {
    let local: Blob | undefined;
    // A file that cannot be read here (a disk error) is not "missing here": it is tried again next time, never skipped.
    try { local = here && !here.has(m.id) ? undefined : await store.get(m.id); }
    catch { failed.push(m.name); return; }
    try {
      if (local && !remote.has(m.id)) {
        if (local.size > MAX_UPLOAD) return;
        onProgress(`미디어 올리는 중: ${m.name}`);
        await cloudApi.uploadMedia(token, m.id, local, lib.cloudResetId);
        remote.add(m.id); items.push({ id: m.id, size: local.size });
      } else if (!local && remote.has(m.id)) {
        onProgress(`미디어 받는 중: ${m.name}`);
        await store.put(m.id, await cloudApi.downloadMedia(token, m.id));
      }
    } catch (e) {
      // A signed-out session or a lost connection ends this round; anything else skips just this file.
      const err = e as { status?: number; network?: boolean };
      if (err.status === 401 || err.network) { fatal ??= e; return; }
      failed.push(m.name);
    }
  };
  const lane = async () => { while (!fatal && next < work.length) await one(work[next++]); };
  await Promise.all(Array.from({ length: Math.min(MEDIA_CONCURRENCY, work.length) }, lane));
  if (fatal) throw fatal;
  // Files the library names that are still not here (not on the server yet either: another device is still sending them).
  const after = store.keys ? await store.keys().catch(() => null) : null;
  let missing = 0;
  for (const m of lib.media) if (after ? !after.has(m.id) : !(await store.get(m.id).catch(() => undefined))) missing++;
  return Object.assign(items, { failed, missing });
}

/** An older Worker without GET /storage: not asked again for a while (each ask was a wasted request). */
let storageMissingUntil = 0;

/**
 * Read server data, not this computer's pending edits or media cache. `base` is the library as the server last sent it
 * (kept here after every sync): with an older Worker the usage is worked out from it instead of downloading it again.
 */
export async function getCloudStorageUsage(token: string, base?: () => Promise<Library | null>) {
  if (Date.now() >= storageMissingUntil) {
    try {
      const response = await call<unknown>('storage', { token });
      return parseServerStorage(response.data);
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      storageMissingUntil = Date.now() + 10 * 60_000;
      // Older Workers still provide logical file sizes; never label them as full database usage.
    }
  }
  const [known, items] = await Promise.all([base ? base().catch(() => null) : Promise.resolve(null), cloudApi.listMedia(token)]);
  const data = known ?? (await cloudApi.getLibrary(token))?.data ?? null;
  return summarizeCloudStorage(data, items);
}
