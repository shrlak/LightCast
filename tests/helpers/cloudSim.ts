// Simulation of the church cloud for sync tests: an in-memory FAKE of the Worker's /freecast/* HTTP API
// (derived from src/domain/cloud.ts, server/cloud.mjs and tests/cloud*.test.ts — the Worker itself is not
// in this repository) and simulated computers running the real sync code (src/domain/cloudSyncRound.ts)
// on the real reducer. What the real Worker does beyond what the client code shows is ASSUMED, see the notes.
import { vi } from 'vitest';
import { createSeedLibrary } from '../../src/domain/defaults';
import { createInitialState, reducer, type Action, type AppState } from '../../src/domain/reducer';
import { baseOwnerChanges, type CloudSession, type MediaStore } from '../../src/domain/cloud';
import { syncOnce, runSyncRound, type SyncControl, type SyncEnv } from '../../src/domain/cloudSyncRound';
import type { SyncState } from '../../src/domain/syncStatus';
import { addConflicts, type ConflictRecord } from '../../src/domain/syncStatus';
import type { Library, MediaMeta, Presentation, Slide } from '../../src/domain/types';
import { libraryKey, syncable } from '../../src/domain/cloudMerge';
import { runFontSync, type CloudFont, type FontStoreApi, DEFAULT_FONT_SYNC } from '../../src/domain/fontSync';
import type { ImportedFont } from '../../src/domain/importedFonts';
import { normalizeLibrary } from '../../src/domain/persistence';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

interface Account {
  password: string;
  library: { version: number; data: unknown; updatedBy: string | null };
  media: Map<string, { bytes: Uint8Array; type: string }>;
  resetId: string | null;
}

export interface Req { method: string; path: string; token: string | null; body: unknown; headers: Headers }

/**
 * The Worker's /freecast API as the client uses it:
 *  POST register, POST login, POST logout,
 *  GET library?known=N (204 when the server has nothing newer), PUT library {baseVersion,data}
 *    (200 {version[,data]} or 409 {conflict,version,data} when baseVersion is not the stored version),
 *  GET media (list), PUT/GET/DELETE media/:id, GET storage (404 like an older Worker), GET/POST clear.
 * ASSUMED (cannot be checked here): the 409 body of PUT library, 413 for an over-quota upload, 409 for an
 * upload with a stale X-Freecast-Reset-Id, 204 semantics of `known`.
 */
export class FakeWorker {
  accounts = new Map<string, Account>();
  tokens = new Map<string, string>();
  requests: string[] = [];
  /** Every request fails like an unreachable server (fetch rejects). */
  down = false;
  /** Bytes of media one account may store (Infinity = unlimited). */
  quotaBytes = Infinity;
  /** Run before a request is handled; may return a Response to answer instead (a fault), or run another client. */
  before: ((r: Req) => Promise<Response | void> | Response | void) | null = null;
  /** Run after the request was handled but before the client sees the answer (a lost response). */
  after: ((r: Req, res: Response) => Promise<Response | void> | Response | void) | null = null;
  private seq = 0;

  constructor(public adminPassword = 'admin') {}

  install() {
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => this.fetch(url, init));
    return this;
  }
  count(method: string, pathPrefix: string) { return this.requests.filter((r) => r.startsWith(`${method} ${pathPrefix}`)).length; }
  account(name: string) { return this.accounts.get(name)!; }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    if (this.down) throw new TypeError('fetch failed');
    const headers = new Headers(init.headers);
    const path = url.replace('/api/cloud/', '').split('?')[0];
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const method = (init.method ?? 'GET').toUpperCase();
    const auth = headers.get('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    let body: unknown = init.body;
    if (typeof body === 'string' && headers.get('content-type')?.includes('json')) body = JSON.parse(body);
    const req: Req = { method, path: path + (query.size ? `?${query}` : ''), token, body, headers };
    this.requests.push(`${method} ${req.path}`);
    const fault = await this.before?.(req);
    if (fault) return fault;
    const res = await this.route(req, path, query, method, headers);
    return (await this.after?.(req, res.clone())) ?? res;
  }

  private async route(req: Req, path: string, query: URLSearchParams, method: string, headers: Headers): Promise<Response> {
    const body = req.body as Record<string, unknown>;
    if (path === 'register' && method === 'POST') {
      if (body.adminPassword !== this.adminPassword) return json({ error: '관리자 비밀번호가 맞지 않습니다' }, 403);
      const u = String(body.username);
      if (this.accounts.has(u)) return json({ error: '이미 있는 아이디입니다' }, 409);
      this.accounts.set(u, { password: String(body.password), library: { version: 0, data: null, updatedBy: null }, media: new Map(), resetId: null });
      return json({ ok: true });
    }
    if (path === 'login' && method === 'POST') {
      const a = this.accounts.get(String(body.username));
      if (!a || a.password !== body.password) return json({ error: '아이디 또는 비밀번호가 맞지 않습니다' }, 401);
      const token = `tok${++this.seq}`;
      this.tokens.set(token, String(body.username));
      return json({ token, username: String(body.username) });
    }
    const user = req.token ? this.tokens.get(req.token) : undefined;
    if (!user) return json({ error: 'unauthorized' }, 401);
    const acct = this.accounts.get(user)!;
    if (path === 'logout') { this.tokens.delete(req.token!); return json({ ok: true }); }
    if (path === 'library' && method === 'GET') {
      const known = query.get('known');
      if (known != null && Number(known) === acct.library.version) return new Response(null, { status: 204 });
      return json(clone(acct.library));
    }
    if (path === 'library' && method === 'PUT') {
      const { baseVersion, data } = body as { baseVersion: number; data: Library };
      if (baseVersion !== acct.library.version) return json({ conflict: true, version: acct.library.version, data: clone(acct.library.data) }, 409);
      acct.library = { version: acct.library.version + 1, data: clone(data), updatedBy: user };
      if (data?.cloudResetId) acct.resetId = data.cloudResetId;
      return json({ version: acct.library.version });
    }
    if (path === 'media' && method === 'GET') return json({ items: [...acct.media].map(([id, m]) => ({ id, size: m.bytes.length, type: m.type })) });
    if (path.startsWith('media/')) {
      const id = decodeURIComponent(path.slice(6));
      if (method === 'PUT') {
        const reset = headers.get('x-freecast-reset-id');
        if (acct.resetId && reset && reset !== acct.resetId) return json({ error: '서버가 초기화되었습니다' }, 409);
        const blob = req.body as Blob;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const used = [...acct.media.values()].reduce((s, m) => s + m.bytes.length, 0) - (acct.media.get(id)?.bytes.length ?? 0);
        if (used + bytes.length > this.quotaBytes) return json({ error: '서버 저장공간이 부족합니다' }, 413);
        acct.media.set(id, { bytes, type: blob.type || 'application/octet-stream' });
        return json({ ok: true });
      }
      if (method === 'GET') {
        const m = acct.media.get(id);
        return m ? new Response(m.bytes.slice(), { status: 200, headers: { 'content-type': m.type } }) : json({ error: 'media not found' }, 404);
      }
      if (method === 'DELETE') { acct.media.delete(id); return new Response(null, { status: 204 }); }
    }
    if (path === 'storage') return json({ error: 'not found' }, 404);
    return json({ error: 'not found' }, 404);
  }

  /** Administrator reset of one account: the library becomes `data` (with a new generation) and the media are gone. */
  reset(user: string, data: Library) {
    const a = this.account(user);
    a.media.clear();
    a.library = { version: a.library.version + 1, data: clone(data), updatedBy: null };
    a.resetId = data.cloudResetId ?? null;
  }
}

// ── simulated computers ───────────────────────────────────────────────────────────────────────

export const pres = (id: string, title: string, texts: string[] = ['one', 'two']): Presentation => ({
  id, title, themeId: 'theme_classic', folder: 'Songs',
  slides: texts.map((text, i): Slide => ({ id: `${id}_s${i}`, group: `Verse ${i + 1}`, text })),
});
export const bytesOf = (s: string) => new Blob([s], { type: 'image/png' });
export const textOf = (b: Blob | undefined) => b?.text();

export interface ClientOptions { skewMs?: number; library?: Library }

export class SimClient {
  state: AppState;
  media = new Map<string, Blob>();
  fontFiles = new Map<string, Uint8Array>();
  fonts: ImportedFont[] = [];
  knownFonts = new Set<string>();
  base: Library | null = null;
  session: CloudSession | null = null;
  status: { state: SyncState; message: string | null } = { state: 'off', message: null };
  notices: string[] = [];
  conflicts: ConflictRecord[] = [];
  online = true;
  restorePoints = 0;
  laterPending = false;
  signedOut = false;
  ctl: SyncControl = { busy: false, requested: false, failures: 0, paused: false, lastPushed: '' };
  /** Rounds started by `settle`, a guard against endless follow-up pushes. */
  rounds = 0;
  private owner = new Map<string, string>();
  ownerStorage = { getItem: (k: string) => this.owner.get(k) ?? null, setItem: (k: string, v: string) => { this.owner.set(k, v); } };
  failMedia: ((id: string, dir: 'put' | 'get') => boolean) | null = null;

  constructor(public name: string, public worker: FakeWorker, opts: ClientOptions = {}) {
    this.state = createInitialState(opts.library ?? createSeedLibrary());
  }

  get lib(): Library { return this.state.library; }
  dispatch(a: Action) { this.state = reducer(this.state, a); }
  presentation(id: string) { return this.lib.presentations.find((p) => p.id === id); }
  titles() { return this.lib.presentations.filter((p) => !p.online).map((p) => p.title).sort(); }

  store: MediaStore = {
    get: async (id) => this.media.get(id),
    put: async (id, blob) => { this.media.set(id, blob); },
  };

  /** Add a media file here (bytes + library entry). */
  addMedia(id: string, content: string, meta: Partial<MediaMeta> = {}) {
    this.media.set(id, bytesOf(content));
    this.dispatch({ type: 'media/add', media: { id, name: id, type: 'image', ...meta } });
  }

  private fontStore(): FontStoreApi {
    return {
      list: () => this.fonts,
      bytes: async (f) => this.fontFiles.get(f.id) ?? null,
      setFields: async (id, patch) => { this.fonts = this.fonts.map((f) => (f.id === id ? { ...f, ...patch } : f)); },
      add: async (entry: CloudFont, bytes: ArrayBuffer) => {
        const id = `local-${entry.id}`;
        this.fontFiles.set(id, new Uint8Array(bytes));
        this.fonts.push({ id, family: entry.family, subfamily: entry.subfamily, weight: entry.weight, italic: entry.italic, format: entry.format, bytes: entry.bytes, fsType: entry.fsType, source: entry.source, at: entry.at, hash: entry.id.slice(5) } as ImportedFont);
        return true;
      },
      remove: async (id) => { this.fonts = this.fonts.filter((f) => f.id !== id); this.fontFiles.delete(id); },
      loadKnown: async () => new Set(this.knownFonts),
      saveKnown: async (k) => { this.knownFonts = new Set(k); },
    };
  }

  /** A font file this computer imported (shared with the cloud on the next sync). */
  importFont(family: string, content: string) {
    const id = `local-${this.fonts.length}-${family}`;
    this.fontFiles.set(id, new TextEncoder().encode(content));
    this.fonts.push({ id, family, subfamily: 'Regular', weight: 400, italic: false, format: 'ttf', bytes: content.length, fsType: 0, source: 'user', at: 1 } as unknown as ImportedFont);
  }

  env: SyncEnv = {
    session: () => this.session,
    setSession: (s) => { this.session = s; },
    local: () => this.lib,
    merge: (library) => this.dispatch({ type: 'library/merge', library }),
    cloudReset: (library) => { this.dispatch({ type: 'library/cloudReset', library }); this.ctl.failures = 0; this.conflicts = []; },
    addConflicts: (pairs) => { this.conflicts = addConflicts(this.conflicts, pairs, Date.now()); },
    notify: (m) => { this.notices.push(m); },
    progress: () => undefined,
    loadBase: async () => (this.base ? normalizeLibrary(clone(this.base)) : null),
    saveBase: async (lib) => { this.base = clone(lib); },
    restorePoint: async () => { this.restorePoints++; },
    pushed: (lib) => { this.ctl.lastPushed = libraryKey(lib); },
    media: {
      get: async (id) => { if (this.failMedia?.(id, 'get')) throw new Error('disk'); return this.media.get(id); },
      put: async (id, blob) => { if (this.failMedia?.(id, 'put')) throw new Error('disk'); this.media.set(id, blob); },
    },
    fonts: async (current) => {
      const session = this.session!;
      const out = await runFontSync(
        {
          cloud: {
            list: async () => (await (await this.worker.fetch('/api/cloud/media', { headers: { Authorization: `Bearer ${session.token}` } })).json()).items,
            upload: async (id, blob) => { await this.worker.fetch(`/api/cloud/media/${id}`, { method: 'PUT', body: blob, headers: { Authorization: `Bearer ${session.token}`, 'content-type': 'application/octet-stream' } }); },
            download: async (id) => this.worker.fetch(`/api/cloud/media/${id}`, { headers: { Authorization: `Bearer ${session.token}` } }).then((r) => r.blob()),
            remove: async (id) => { await this.worker.fetch(`/api/cloud/media/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } }); },
          },
          store: this.fontStore(),
        },
        { manifest: current.fonts ?? [], settings: DEFAULT_FONT_SYNC, used: new Set(), freeBytes: null },
      );
      if (out.manifest) {
        const { fonts: _old, ...rest } = syncable(this.lib);
        this.dispatch({ type: 'library/merge', library: { ...rest, ...(out.manifest.length ? { fonts: out.manifest } : {}) } });
      }
      return out.report.failed.length ? `글꼴 ${out.report.failed.length}개` : null;
    },
  };

  async login(username: string, password = 'pw') {
    const res = await this.worker.fetch('/api/cloud/login', { method: 'POST', body: JSON.stringify({ username, password }), headers: { 'content-type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // As useCloudSync's login: a base of another account is forgotten.
    if (baseOwnerChanges(data.username, this.ownerStorage)) this.base = null;
    this.session = { token: data.token, username: data.username, version: 0 };
    this.signedOut = false;
  }

  /** One sync round with the real bookkeeping. */
  sync(reason: 'pull' | 'push' = 'pull') {
    return syncOnce(this.ctl, this.env, {
      online: () => this.online,
      status: (p) => { this.status = { state: p.state, message: p.message }; },
      later: () => { this.laterPending = true; },
      signedOut: () => { this.session = null; this.signedOut = true; this.notices.push('클라우드 로그인이 만료되었습니다. 다시 로그인하세요.'); },
      done: () => undefined,
    }, reason);
  }

  /** A raw round (throws) for tests that want the error. */
  round(reason: 'pull' | 'push' = 'pull') { return runSyncRound(this.env, reason); }

  /** Sync, then keep running the follow-up pushes the hook would schedule, up to `max` rounds. Returns the rounds run. */
  async settle(max = 8): Promise<number> {
    let n = 0;
    await this.sync('pull'); n++;
    while (this.laterPending && n < max) { this.laterPending = false; await this.sync('push'); n++; }
    this.rounds += n;
    return n;
  }
}

/** Two or three computers signed into the same account on one server. */
export async function setup(count = 2, opts: { account?: string; quotaBytes?: number } = {}) {
  const worker = new FakeWorker().install();
  if (opts.quotaBytes != null) worker.quotaBytes = opts.quotaBytes;
  const account = opts.account ?? 'church';
  await worker.fetch('/api/cloud/register', { method: 'POST', body: JSON.stringify({ username: account, password: 'pw', adminPassword: 'admin' }), headers: { 'content-type': 'application/json' } });
  const clients: SimClient[] = [];
  for (let i = 0; i < count; i++) {
    const c = new SimClient(String.fromCharCode(65 + i), worker);
    await c.login(account);
    clients.push(c);
  }
  return { worker, clients, account };
}

/** Run every client until nothing more is sent (the system is quiet) and return the total rounds; fails on a loop. */
export async function converge(clients: SimClient[], maxPasses = 6): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const before = clients[0].worker.requests.filter((r) => r.startsWith('PUT library')).length;
    for (const c of clients) total += await c.settle();
    const after = clients[0].worker.requests.filter((r) => r.startsWith('PUT library')).length;
    if (after === before && pass > 0) return total;
  }
  throw new Error(`no convergence after ${maxPasses} passes (${clients[0].worker.requests.filter((r) => r.startsWith('PUT library')).length} library writes)`);
}
