// One round of cloud sync (pull, merge, push, media, fonts), free of React and of the browser so that
// tests can run several simulated computers against a fake server. useCloudSync.ts owns the status,
// the timers and the retry/backoff; everything it needs from the outside comes in through `SyncEnv`.
//
// Rounds are cheap when nothing changed: the library's sync form and its key are kept per library object, so a round
// that finds nothing new here asks the server one small question (GET library?known=N, answered 204) and stops. That is
// what lets every device ask every few seconds, so an edit on one device shows on the others almost at once.
import type { Library } from './types';
import { cloudApi, syncMedia, type CloudSession, type MediaStore } from './cloud';
import { libraryKey, mergeLibrary, syncable } from './cloudMerge';
import { normalizeLibrary } from './persistence';
import { isOfflineError, type SyncState } from './syncStatus';

export interface SyncEnv {
  session(): CloudSession | null;
  setSession(s: CloudSession): void;
  /** The library as it is now in the app (with online songs). */
  local(): Library;
  /** Put the merged library into the app; `from` is the library it was worked out from (edits made since are kept). */
  merge(lib: Library, from?: Library): void;
  /** The server was reset: replace the app's library and forget pending edits. */
  cloudReset(lib: Library): void;
  notify(msg: string): void;
  progress(msg: string): void;
  loadBase(): Promise<Library | null>;
  saveBase(lib: Library): Promise<unknown>;
  restorePoint(lib: Library): Promise<unknown>;
  media?: MediaStore;
  /** Imported fonts both ways; resolves to a notice (or null). Errors with status 401 / network end the round. */
  fonts?(current: Library): Promise<string | null>;
  /** The state just sent / received, so edits made while a request was in flight are not taken for sent. */
  pushed(current: Library): void;
}

export interface RoundResult {
  /** Why part of the round was left for next time (media or fonts that could not move), or null. */
  message: string | null;
  /** Nothing moved either way (a quiet poll). */
  quiet?: boolean;
  /** Changes from another device were merged in. */
  received?: boolean;
  /** This computer's changes were sent. */
  sent?: boolean;
  /** Media and fonts left for later: files that failed, or that the library names and nobody has sent yet. */
  extrasWaiting?: boolean;
}

/**
 * The library in the form every read gives it (normalizeLibrary: lyrics centred, templates, defaults). A library
 * this window made and never reloaded (a fresh install, a song made this session) is otherwise read differently
 * on every other computer, and the two forms overwrite each other forever.
 */
export function syncForm(lib: Library): Library {
  const plain = syncable(lib);
  // Normalised as it is, not through a JSON copy: presentations that are already in form stay the same objects, so
  // their keys are remembered (cloudMerge.libraryKey) and a round after one keystroke works out one presentation, not
  // the whole library. (What JSON would drop — undefined fields — no comparison or upload sees anyway.)
  return normalizeLibrary(plain) ?? plain;
}

/** The sync form of a library object and the keys of both, worked out once per object (the reducer never mutates). */
interface Form { form: Library; key: string; rawKey: string }
const forms = new WeakMap<Library, Form>();
export function formOf(lib: Library): Form {
  let f = forms.get(lib);
  if (!f) {
    const form = syncForm(lib);
    const key = libraryKey(form);
    const rawKey = libraryKey(syncable(lib));
    f = { form, key, rawKey };
    forms.set(lib, f);
    forms.set(form, { form, key, rawKey: key });
  }
  return f;
}
/** The key of a library's shared part in sync form (what `lastPushed` holds), kept per object. */
export const keyOf = (lib: Library): string => formOf(lib).key;

/** How often one round may retry a write that another computer got in ahead of. */
export const MAX_CONFLICT_RETRIES = 3;

/** What one round should do besides the library itself. */
export interface RoundOptions {
  /** The key of the library as last sent / received ('' = not known this session: compared with the saved base). */
  known?: string;
  /** Move media and fonts too (otherwise only when the library changed either way). */
  extras?: boolean;
}

/**
 * Merge a server library into this computer's; returns the merged syncable library and the version it is in.
 * Resolves to null when the person signed out (or into another account) meanwhile.
 */
export async function absorb(env: SyncEnv, remoteData: unknown, remoteVersion: number, session: CloudSession): Promise<{ merged: Library; version: number; remote: Library | null } | null> {
  const same = () => env.session()?.token === session.token;
  const remote = normalizeLibrary(remoteData);
  // An empty server (no library yet) has nothing to merge; one we cannot read must never be overwritten with ours.
  if (!remote && (remoteData === null || remoteData === undefined)) return { merged: formOf(env.local()).form, version: remoteVersion, remote: null };
  if (!remote) throw new Error('서버의 라이브러리를 읽지 못했습니다. 다른 기기의 LightCast를 업데이트했는지 확인하세요. 이 컴퓨터의 자료는 그대로입니다.');
  const base = await env.loadBase();
  if (!same()) return null;
  const from = env.local();
  const local = formOf(from).form;
  // The later edit of anything both devices changed wins (server time); nothing is kept twice, nothing is asked.
  const { library: merged } = mergeLibrary(base, local, remote);
  if (remote.cloudResetId && remote.cloudResetId !== local.cloudResetId) env.cloudReset(remote);
  else env.merge(merged, from);
  await env.saveBase(remote);
  if (!same()) return null;
  env.setSession({ ...session, version: remoteVersion });
  return { merged, version: remoteVersion, remote };
}

/** Run one sync round. Resolves to null when the session ended meanwhile; throws errors carrying `status` / `network`. */
export async function runSyncRound(env: SyncEnv, reason: 'pull' | 'push', opts: RoundOptions = {}): Promise<RoundResult | null> {
  const session = env.session();
  if (!session) return null;
  const same = () => env.session()?.token === session.token;
  let version = session.version;
  const start = env.local();
  const here = formOf(start);
  let current = here.form;
  // This window's library in the form the other computers will read it, so both sides compare like with like.
  if (here.key !== here.rawKey) env.merge(current, start);
  let known = opts.known ?? '';
  if (!known && version !== 0) {
    // First round of this session: what this computer last synced is the saved base.
    const base = await env.loadBase();
    if (!same()) return null;
    if (base && libraryKey(base) === here.key) known = here.key;
  }
  const dirty = here.key !== known || version === 0;
  let received = false;
  let sent = false;
  let needPush = dirty;
  if (!dirty || reason === 'pull') {
    // Nothing (or not only) to send: ask whether another device sent something (a 204 when not).
    const remote = await cloudApi.getLibrary(session.token, version || undefined);
    if (!same()) return null;
    if (remote && remote.version !== version) {
      // Keep the exact local state before an incoming merge.
      try { await env.restorePoint(current); }
      catch { throw new Error('동기화 전 복원 지점을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 동기화하세요.'); }
      const got = await absorb(env, remote.data, remote.version, session);
      if (!got) return null;
      ({ merged: current, version } = got);
      received = true;
      // The merge kept edits of this computer the server does not have yet: send them.
      needPush = !got.remote || libraryKey(got.remote) !== libraryKey(current) || version === 0;
    } else if (remote && version === 0) needPush = true;
  }
  if (!same()) return null;
  if (needPush) {
    let res = await cloudApi.putLibrary(session.token, version, current);
    // Another computer wrote first: merge what it wrote and send again (a few times at most).
    for (let n = 0; res.status === 409 && n < MAX_CONFLICT_RETRIES; n++) {
      let data = res.data.data, at = res.data.version;
      if (data === undefined) {
        // A server that does not send its library with the conflict: read it.
        const full = await cloudApi.getLibrary(session.token);
        if (!same()) return null;
        data = full?.data; at = full?.version ?? at;
      }
      try { await env.restorePoint(current); }
      catch { throw new Error('동기화 전 복원 지점을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 동기화하세요.'); }
      const got = await absorb(env, data, at, session);
      if (!got) return null;
      ({ merged: current, version } = got);
      received = true;
      res = await cloudApi.putLibrary(session.token, version, current);
    }
    if (res.status !== 200) throw new Error('다른 기기의 수정과 충돌했습니다. 이 컴퓨터의 내용은 그대로이며 잠시 뒤 다시 보냅니다.');
    if (!same()) return null;
    if (res.data.data) {
      const canonical = normalizeLibrary(res.data.data);
      if (!canonical) throw new Error('서버의 미디어 정리 결과가 올바르지 않습니다.');
      const from = env.local();
      if (libraryKey(canonical) !== libraryKey(current)) await env.restorePoint(formOf(from).form).catch(() => undefined);
      const { library: merged } = mergeLibrary(current, formOf(from).form, canonical);
      env.merge(merged, from);
      current = canonical;
    }
    version = res.data.version;
    await env.saveBase(current);
    if (!same()) return null;
    env.setSession({ ...session, version });
    sent = true;
  }
  // Never mark edits made during an in-flight request as already uploaded.
  env.pushed(current);
  if (!received && !sent && !opts.extras && opts.known !== undefined) return { message: null, quiet: true };
  const { failed, missing } = await syncMedia(session.token, current, env.progress, env.media);
  if (!same()) return null;
  const fontNote = env.fonts ? await env.fonts(current) : null;
  if (!same()) return null;
  const skippedMedia = failed.length ? `미디어 ${failed.length}개를 주고받지 못해 다음 동기화에서 다시 시도합니다: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' …' : ''}` : null;
  const message = [skippedMedia, fontNote].filter(Boolean).join(' · ') || null;
  return { message, received, sent, extrasWaiting: !!message || missing > 0 };
}

// ── The round's bookkeeping: one at a time, status, backoff and the follow-up push ─────────────
export interface SyncControl {
  busy: boolean;
  /** Something asked for a round while one was running. */
  requested: boolean;
  /** Rounds in a row that failed (drives the backoff). */
  failures: number;
  /** A reviewed full clear pauses automatic sync. */
  paused: boolean;
  /** The syncable library as last sent / received, to tell edits made since. */
  lastPushed: string;
  /** Media and fonts are due at the next round (session start, a font change, files left for later, now and then). */
  extrasDue?: boolean;
  /** When media and fonts last moved (ms). */
  extrasAt?: number;
  /** Media and fonts that are due wait until then (ms): files that failed or are still on their way, with a back-off. */
  extrasRetryAt?: number;
  /** Rounds in a row that left files for later (drives that back-off). */
  extrasWaits?: number;
  /** When another device's change last arrived here, or this computer last sent one (ms): sync asks more often for a while. */
  activeAt?: number;
}

export interface SyncUi {
  online(): boolean;
  /** Show the state (message null clears the previous one; left out, it stays). */
  status(patch: { state: SyncState; message?: string | null; lastSync?: number }): void;
  /** Ask for another push round after `ms`. */
  later(ms: number): void;
  /** The session expired (HTTP 401). */
  signedOut(): void;
  /** A round finished well (`result` says what moved). */
  done(result?: RoundResult): void;
}

/** A change waits this long for the next keystroke before it is sent (and at most PUSH_MAX_WAIT while typing goes on). */
export const PUSH_DELAY = 300;
export const PUSH_MAX_WAIT = 1500;
/** Media and fonts move at least this often, even when the library did not change (files left for later, other devices' fonts). */
export const EXTRAS_INTERVAL = 5 * 60_000;
/** Files that failed or are still on their way from another device: asked for again after 3 s, 6 s, 12 s … at most 5 min (not on every poll: a file the server keeps refusing is not sent again every second). */
export const mediaRetry = (waits: number): number => Math.min(5 * 60_000, 3_000 * 2 ** Math.max(0, Math.min(waits - 1, 10)));

/**
 * Run one round with its bookkeeping. At most one round runs at a time (a second request is remembered and
 * run afterwards); every round ends in a visible state (synced / offline / error / off), never stays "syncing".
 * Another round follows only when something was asked for meanwhile or the library changed after it was sent.
 */
export async function syncOnce(ctl: SyncControl, env: SyncEnv, ui: SyncUi, reason: 'pull' | 'push', now: () => number = Date.now): Promise<void> {
  const session = env.session();
  if (!session || ctl.paused) return;
  if (!ui.online()) { ui.status({ state: 'offline', message: null }); return; }
  if (ctl.busy) { ctl.requested = true; return; }
  ctl.busy = true;
  ctl.requested = false;
  let succeeded = false;
  const extras = (ctl.extrasDue !== false && now() >= (ctl.extrasRetryAt ?? 0)) || now() - (ctl.extrasAt ?? 0) >= EXTRAS_INTERVAL;
  // A quiet poll does not flash "syncing": only a round that moves something (or the first) shows it.
  let shown = false;
  const showSyncing = () => { if (!shown) { shown = true; ui.status({ state: 'syncing', message: null }); } };
  if (reason === 'push' || extras || ctl.failures > 0) showSyncing();
  try {
    const result = await runSyncRound(env, reason, { known: ctl.lastPushed, extras });
    // The person signed out (or into another account) meanwhile: this round no longer counts.
    if (!result || env.session()?.token !== session.token) return;
    ctl.failures = 0;
    if (!result.quiet) {
      ctl.extrasAt = now();
      ctl.extrasDue = !!result.extrasWaiting;
      ctl.extrasWaits = result.extrasWaiting ? (ctl.extrasWaits ?? 0) + 1 : 0;
      ctl.extrasRetryAt = result.extrasWaiting ? now() + mediaRetry(ctl.extrasWaits) : 0;
    }
    if (result.received || result.sent) ctl.activeAt = now();
    // The library itself is in step; a few files that could not be moved are tried again next time.
    ui.status(result.quiet ? { state: 'synced' } : { state: 'synced', message: result.message, lastSync: Date.now() });
    succeeded = true;
    ui.done(result);
  } catch (e) {
    if (env.session()?.token !== session.token) return;
    const err = e as Error & { status?: number };
    // Whatever the round did not finish (files half moved) is done by the next one that works, even a quiet one.
    ctl.extrasDue = true;
    ctl.extrasRetryAt = 0;
    if (err.status === 401) ui.signedOut();
    else ctl.failures++;
    // Server unreachable = offline (not an error): edits are safe here and go out once it is back.
    if (isOfflineError(err)) ui.status({ state: 'offline', message: '교회 서버에 연결할 수 없습니다. 변경한 내용은 이 컴퓨터에 안전하게 저장되어 있고, 연결되면 자동으로 동기화합니다.' });
    else ui.status({ state: err.status === 401 ? 'off' : 'error', message: err.message });
  } finally {
    ctl.busy = false;
    // A round asked for meanwhile runs next even when it is for a new sign-in (it would otherwise wait for the next poll, showing "syncing").
    const current = env.session();
    if (current && ((ctl.requested) || (current.token === session.token && succeeded && keyOf(env.local()) !== ctl.lastPushed))) {
      ctl.requested = false;
      ui.later(PUSH_DELAY);
    }
  }
}
