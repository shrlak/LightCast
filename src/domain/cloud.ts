// Client for the church cloud library (Worker /freecast/* via this app's /api/cloud proxy).
import type { Library } from './types';
import { getMedia, putMedia } from './media';
import { summarizeCloudStorage, parseServerStorage } from './cloudStorage';
import { normalizeLibrary } from './persistence';

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
  try {
    res = await fetch(`/api/cloud/${path}`, { ...init, headers });
  } catch {
    throw Object.assign(new Error('LightCast 서버에 연결할 수 없습니다.'), { network: true });
  }
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
  uploadMedia: (token: string, id: string, blob: Blob, resetId?: string) =>
    call(`media/${encodeURIComponent(id)}`, { method: 'PUT', token, body: blob, headers: { 'content-type': blob.type || 'application/octet-stream', ...(resetId ? { 'X-Freecast-Reset-Id': resetId } : {}) } }),
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

export const saveBase = (lib: Library) => putMedia(BASE_KEY, new Blob([JSON.stringify(lib)], { type: 'application/json' }));

/**
 * Upload media this computer has that the server lacks, and download the reverse. One file that
 * cannot be sent or received is skipped (and tried again next time); it no longer stops the rest,
 * nor marks the whole sync as failed. `failed` lists the names of the files skipped this time.
 */
export async function syncMedia(token: string, lib: Library, onProgress: (msg: string) => void) {
  const items = await cloudApi.listMedia(token);
  const remote = new Set(items.map((m) => m.id));
  const failed: string[] = [];
  for (const m of lib.media) {
    const local = await getMedia(m.id).catch(() => undefined);
    try {
      if (local && !remote.has(m.id)) {
        if (local.size > 50 * 1024 * 1024) continue;
        onProgress(`미디어 올리는 중: ${m.name}`);
        await cloudApi.uploadMedia(token, m.id, local, lib.cloudResetId);
        remote.add(m.id); items.push({ id: m.id, size: local.size });
      } else if (!local && remote.has(m.id)) {
        onProgress(`미디어 받는 중: ${m.name}`);
        await putMedia(m.id, await cloudApi.downloadMedia(token, m.id));
      }
    } catch (e) {
      // A signed-out session or a lost connection ends this round; anything else skips just this file.
      const err = e as { status?: number; network?: boolean };
      if (err.status === 401 || err.network) throw e;
      failed.push(m.name);
    }
  }
  return Object.assign(items, { failed });
}

/** Read server data, not this computer's pending edits or media cache. */
export async function getCloudStorageUsage(token: string) {
  try {
    const response = await call<unknown>('storage', { token });
    return parseServerStorage(response.data);
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    // Older Workers still provide logical file sizes; never label them as full database usage.
  }
  const [remote, items] = await Promise.all([cloudApi.getLibrary(token), cloudApi.listMedia(token)]);
  return summarizeCloudStorage(remote?.data ?? null, items);
}
