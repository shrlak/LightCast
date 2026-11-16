// One round of cloud sync (pull, merge, push, media, fonts), free of React and of the browser so that
// tests can run several simulated computers against a fake server. useCloudSync.ts owns the status,
// the timers and the retry/backoff; everything it needs from the outside comes in through `SyncEnv`.
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
  /** Put the merged library into the app. */
  merge(lib: Library): void;
  /** The server was reset: replace the app's library and forget pending edits and conflicts. */
  cloudReset(lib: Library): void;
  addConflicts(pairs: { title: string; localId: string; copyId: string }[]): void;
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
}

/**
 * The library in the form every read gives it (normalizeLibrary: lyrics centred, templates, defaults). A library
 * this window made and never reloaded (a fresh install, a song made this session) is otherwise read differently
 * on every other computer, and the two forms overwrite each other forever.
 */
export function syncForm(lib: Library): Library {
  const plain = syncable(lib);
  return normalizeLibrary(JSON.parse(JSON.stringify(plain))) ?? plain;
}

/** How often one round may retry a write that another computer got in ahead of. */
export const MAX_CONFLICT_RETRIES = 3;

/**
 * Merge a server library into this computer's; returns the merged syncable library and the version it is in.
 * Resolves to null when the person signed out (or into another account) meanwhile.
 */
export async function absorb(env: SyncEnv, remoteData: unknown, remoteVersion: number, session: CloudSession): Promise<{ merged: Library; version: number } | null> {
  const same = () => env.session()?.token === session.token;
  const remote = normalizeLibrary(remoteData);
  // An empty server (no library yet) has nothing to merge; one we cannot read must never be overwritten with ours.
  if (!remote && (remoteData === null || remoteData === undefined)) return { merged: syncable(env.local()), version: remoteVersion };
  if (!remote) throw new Error('서버의 라이브러리를 읽지 못했습니다. 다른 기기의 LightCast를 업데이트했는지 확인하세요. 이 컴퓨터의 자료는 그대로입니다.');
  const base = await env.loadBase();
  if (!same()) return null;
  const local = syncForm(env.local());
  const { library: merged, conflicts, conflictPairs } = mergeLibrary(base, local, remote);
  if (remote.cloudResetId && remote.cloudResetId !== local.cloudResetId) env.cloudReset(remote);
  else {
    env.merge(merged);
    if (conflictPairs.length) env.addConflicts(conflictPairs);
  }
  await env.saveBase(remote);
  if (!same()) return null;
  env.setSession({ ...session, version: remoteVersion });
  if (conflicts.length) env.notify(`두 기기에서 동시에 고친 프레젠테이션은 둘 다 남겼습니다: ${conflicts.join(', ')} — ☁ 동기화 상태에서 고르세요`);
  return { merged, version: remoteVersion };
}

/** Run one sync round. Resolves to null when the session ended meanwhile; throws errors carrying `status` / `network`. */
export async function runSyncRound(env: SyncEnv, reason: 'pull' | 'push'): Promise<RoundResult | null> {
  const session = env.session();
  if (!session) return null;
  const same = () => env.session()?.token === session.token;
  let version = session.version;
  let current = syncForm(env.local());
  // This window's library in the form the other computers will read it, so both sides compare like with like.
  if (libraryKey(current) !== libraryKey(syncable(env.local()))) env.merge(current);
  // Keep the exact local state before any network request or incoming merge.
  try { await env.restorePoint(current); }
  catch { throw new Error('동기화 전 복원 지점을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 동기화하세요.'); }
  const remote = await cloudApi.getLibrary(session.token, reason === 'push' ? version : version || undefined);
  if (!same()) return null;
  if (remote && remote.version !== version) {
    const got = await absorb(env, remote.data, remote.version, session);
    if (!got) return null;
    ({ merged: current, version } = got);
  }
  if (!same()) return null;
  const base = await env.loadBase();
  if (!base || libraryKey(base) !== libraryKey(current) || version === 0) {
    // Merging may have incorporated newer edits; preserve the submitted state too.
    await env.restorePoint(current);
    let res = await cloudApi.putLibrary(session.token, version, current);
    // Another computer wrote first: merge what it wrote and send again (a few times at most).
    for (let n = 0; res.status === 409 && res.data.data && n < MAX_CONFLICT_RETRIES; n++) {
      const got = await absorb(env, res.data.data, res.data.version, session);
      if (!got) return null;
      ({ merged: current, version } = got);
      await env.restorePoint(current);
      res = await cloudApi.putLibrary(session.token, version, current);
    }
    if (res.status !== 200) throw new Error('다른 기기의 수정과 충돌했습니다. 복원 지점은 보관했으며 다음 동기화에서 다시 시도합니다.');
    if (!same()) return null;
    if (res.data.data) {
      const canonical = normalizeLibrary(res.data.data);
      if (!canonical) throw new Error('서버의 미디어 정리 결과가 올바르지 않습니다.');
      const { library: merged } = mergeLibrary(current, syncForm(env.local()), canonical);
      env.merge(merged);
      current = canonical;
    }
    version = res.data.version;
    await env.saveBase(current);
    if (!same()) return null;
    env.setSession({ ...session, version });
  }
  // Never mark edits made during an in-flight request as already uploaded.
  env.pushed(current);
  const { failed } = await syncMedia(session.token, current, env.progress, env.media);
  if (!same()) return null;
  const fontNote = env.fonts ? await env.fonts(current) : null;
  if (!same()) return null;
  const skippedMedia = failed.length ? `미디어 ${failed.length}개를 주고받지 못해 다음 동기화에서 다시 시도합니다: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' …' : ''}` : null;
  return { message: [skippedMedia, fontNote].filter(Boolean).join(' · ') || null };
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
}

export interface SyncUi {
  online(): boolean;
  /** Show the state (message null clears the previous one). */
  status(patch: { state: SyncState; message: string | null; lastSync?: number }): void;
  /** Ask for another push round after `ms`. */
  later(ms: number): void;
  /** The session expired (HTTP 401). */
  signedOut(): void;
  /** A round finished well. */
  done(): void;
}

export const PUSH_DELAY = 1000;

/**
 * Run one round with its bookkeeping. At most one round runs at a time (a second request is remembered and
 * run afterwards); every round ends in a visible state (synced / offline / error / off), never stays "syncing".
 * Another round follows only when something was asked for meanwhile or the library changed after it was sent.
 */
export async function syncOnce(ctl: SyncControl, env: SyncEnv, ui: SyncUi, reason: 'pull' | 'push'): Promise<void> {
  const session = env.session();
  if (!session || ctl.paused) return;
  if (!ui.online()) { ui.status({ state: 'offline', message: null }); return; }
  if (ctl.busy) { ctl.requested = true; return; }
  ctl.busy = true;
  ctl.requested = false;
  ui.status({ state: 'syncing', message: null });
  let succeeded = false;
  try {
    const result = await runSyncRound(env, reason);
    // The person signed out (or into another account) meanwhile: this round no longer counts.
    if (!result || env.session()?.token !== session.token) return;
    ctl.failures = 0;
    // The library itself is in step; a few files that could not be moved are tried again next time.
    ui.status({ state: 'synced', message: result.message, lastSync: Date.now() });
    succeeded = true;
    ui.done();
  } catch (e) {
    if (env.session()?.token !== session.token) return;
    const err = e as Error & { status?: number };
    if (err.status === 401) ui.signedOut();
    else ctl.failures++;
    // Server unreachable = offline (not an error): edits are safe here and go out once it is back.
    if (isOfflineError(err)) ui.status({ state: 'offline', message: '교회 서버에 연결할 수 없습니다. 변경한 내용은 이 컴퓨터에 안전하게 저장되어 있고, 연결되면 자동으로 동기화합니다.' });
    else ui.status({ state: err.status === 401 ? 'off' : 'error', message: err.message });
  } finally {
    ctl.busy = false;
    // A round asked for meanwhile runs next even when it is for a new sign-in (it would otherwise wait for the next poll, showing "syncing").
    const now = env.session();
    if (now && ((ctl.requested) || (now.token === session.token && succeeded && libraryKey(syncable(env.local())) !== ctl.lastPushed))) {
      ctl.requested = false;
      ui.later(PUSH_DELAY);
    }
  }
}
