import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { Library } from '../domain/types';
import { baseOwnerChanges, clearBase, cloudApi, loadBase, loadSession, saveBase, saveSession, getCloudStorageUsage, type CloudSession } from '../domain/cloud';
import { libraryKey, syncable } from '../domain/cloudMerge';
import { keyOf, PUSH_DELAY, PUSH_MAX_WAIT, syncOnce, type SyncControl, type SyncEnv } from '../domain/cloudSyncRound';
import { getDevice, initializeDevice, saveChurchDevice, saveDeviceProfile } from '../domain/device';
import { serverNow } from '../domain/serverClock';
import { type CloudStorageUsage } from '../domain/cloudStorage';
import { saveSyncRestorePoint } from '../domain/restorePoints';
import { normalizeLibrary } from '../domain/persistence';
import { runFontSync, loadFontSyncSettings, saveFontSyncSettings, fontKnownScope, freeBytesOf, conflictNotice, FONT_SYNC_EVENT, type FontSyncReport, type CloudFont } from '../domain/fontSync';
import { addToFontTrash, restoreFontEntry, type CloudFontTrash } from '../domain/fontTrash';
import { setFontConflicts } from '../domain/fontConflictStore';
import { createFontCloud, createFontStore } from '../domain/fontSyncStore';
import { refreshImportedFonts, subscribeImportedFonts } from '../domain/importedFonts';
import { refreshEmbeddedFonts } from '../domain/embeddedFonts';
import { usedFamilies } from '../domain/io/pptxFonts';
import { forgetOldConflicts, pendingChanges, pollDelay, type PendingChanges, type SyncState } from '../domain/syncStatus';

export interface CloudStatus {
  session: CloudSession | null;
  state: SyncState;
  /** Edits not sent to the church server yet (counted while offline or after an error). */
  pending?: PendingChanges | null;
  message: string | null;
  lastSync: number | null;
  storageUsage?: CloudStorageUsage | null;
  storageError?: string | null;
  /** The last font sync round (imported fonts follow the church cloud). */
  fonts?: FontSyncReport | null;
}


/** The status without a re-render when a quiet round changed nothing in it. */
function patchStatus(s: CloudStatus, patch: Partial<CloudStatus>): CloudStatus {
  for (const [k, v] of Object.entries(patch)) if ((s as unknown as Record<string, unknown>)[k] !== v) return { ...s, ...patch };
  return s;
}

/**
 * Keeps this computer's library in step with the church cloud library while signed in: pull + merge on start and
 * every 1–2 s (every second while someone is editing, slower when idle or hidden), push 0.3 s after a change,
 * media and fonts both ways when something changed. Offline-first: the library is always saved on this computer
 * first, so nothing waits on the network. Without a connection it just says so and keeps the edits; it asks again
 * when the connection returns (and less often while the server stays unreachable). When two devices changed the
 * same thing, the later edit (by the server's clock) wins by itself — nothing is kept twice, nothing is asked.
 */
export function useCloudSync(library: Library, dispatch: Dispatch<Action>, notify: (m: string) => void) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [storage, setStorage] = useState<{ loading: boolean; usage: CloudStorageUsage | null; error: string | null }>({ loading: false, usage: null, error: null });
  const [status, setStatus] = useState<CloudStatus>(() => ({ session: loadSession(), state: loadSession() ? 'syncing' : 'off', message: null, lastSync: null }));
  const [device, setDevice] = useState(getDevice);
    const [pending, setPending] = useState<PendingChanges | null>(null);
  const [fontReport, setFontReport] = useState<FontSyncReport | null>(null);
  useEffect(() => forgetOldConflicts(), []);
  const resumedToken = useRef(loadSession()?.token ?? null);
  useEffect(() => {
    if (!status.session || resumedToken.current !== status.session.token) return;
    resumedToken.current = null;
    const identity = getDevice();
    dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: serverNow(), action: 'app/open', detail: identity.name, device: identity, account: status.session.username } });
  }, [status.session?.token, dispatch]);
  useEffect(() => { void initializeDevice().then(setDevice).catch(() => undefined); }, []);
  useEffect(() => {
    if (!status.session) return;
    dispatch({ type: 'device/register', device: { ...device, lastSeen: serverNow(), account: status.session.username } });
  }, [device, status.session?.token, dispatch]);
  const record = (action: string, account: string | null, identity = getDevice()) => dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: serverNow(), action, detail: identity.name, device: identity, account } });
  const markChurch = (on: boolean) => setDevice(saveChurchDevice(on));
  const renameDevice = (name: string, userName: string) => {
    const identity = saveDeviceProfile(name, userName);
    setDevice(identity);
    record('device/profile', loadSession()?.username ?? null, identity);
  };
  const libRef = useRef(library);
  libRef.current = library;
  // The round's bookkeeping (busy, retries, what was last sent) lives in one object shared with domain/cloudSyncRound.ts.
  const ctl = useMemo<SyncControl>(() => ({ busy: false, requested: false, failures: 0, paused: false, lastPushed: '', extrasDue: true, activeAt: 0 }), []);
  const storageRequest = useRef(0);
  const refreshStorage = useCallback(async () => {
    const session = loadSession();
    if (!session) return;
    const request = ++storageRequest.current;
    setStorage((s) => ({ ...s, loading: true, error: null }));
    try {
      const usage = await getCloudStorageUsage(session.token, loadBase);
      if (storageRequest.current === request && loadSession()?.token === session.token) setStorage({ loading: false, usage, error: null });
    } catch (e) {
      if (storageRequest.current === request && loadSession()?.token === session.token) setStorage((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    if (!status.session) return;
    void refreshStorage();
    // Every 30 s while the window is on screen (a hidden window does not need it).
    const timer = setInterval(() => { if (!document.hidden) void refreshStorage(); }, 30000);
    return () => clearInterval(timer);
  }, [status.session?.token, refreshStorage]);

  const setSession = useCallback((s: CloudSession | null) => {
    saveSession(s);
    setStatus((st) => patchStatus(st, { session: s, state: s ? st.state : 'off' }));
  }, []);

  /** What a sync round needs from this window (see domain/cloudSyncRound.ts). */
  const env = useMemo<SyncEnv>(() => ({
    session: loadSession,
    setSession: (s) => setSession(s),
    local: () => libRef.current,
    merge: (lib, from) => dispatch({ type: 'library/merge', library: lib, from }),
    cloudReset: (lib) => {
      libRef.current = lib;
      dispatch({ type: 'library/cloudReset', library: lib });
      ctl.failures = 0; setPending(null);
    },
    notify: (m) => notifyRef.current(m),
    progress: (m) => setStatus((s) => patchStatus(s, { message: m })),
    loadBase,
    saveBase,
    restorePoint: saveSyncRestorePoint,
    pushed: (lib) => { ctl.lastPushed = libraryKey(lib); },
    // Imported fonts: files both ways + the font list in the library (a changed list is pushed by the next round).
    fonts: async (current) => {
      const session = loadSession();
      if (!session) return null;
      try {
        await refreshImportedFonts();
        await refreshEmbeddedFonts();
        const usage = (await getCloudStorageUsage(session.token, loadBase).catch(() => null))?.server;
        const used = new Set(usedFamilies(current.presentations).map((f) => f.trim().toLowerCase()));
        const out = await runFontSync(
          { cloud: createFontCloud(session.token, current.cloudResetId), store: createFontStore(fontKnownScope(session.username, current.cloudResetId)) },
          { manifest: current.fonts ?? [], trash: current.fontTrash ?? [], prefs: current.fontPrefs, settings: loadFontSyncSettings(), used, freeBytes: freeBytesOf(usage) },
          (m) => setStatus((st) => patchStatus(st, { message: m })),
        );
        if (loadSession()?.token !== session.token) return null;
        setFontReport(out.report);
        setFontConflicts(out.conflicts);
        // Switches another computer changed later than this one are taken over here (keeping the other computer's change time).
        if (out.settings) saveFontSyncSettings(out.settings, false);
        if (out.manifest || out.trash || out.prefs) {
          const { fonts: oldFonts, fontTrash: oldTrash, fontPrefs: oldPrefs, ...rest } = syncable(libRef.current);
          const fonts = out.manifest ?? oldFonts;
          const fontTrash = out.trash ?? oldTrash;
          const fontPrefs = out.prefs ?? oldPrefs;
          dispatch({ type: 'library/merge', library: { ...rest, ...(fonts?.length ? { fonts } : {}), ...(fontTrash?.length ? { fontTrash } : {}), ...(fontPrefs ? { fontPrefs } : {}) } });
        }
        const failedNote = out.report.failed.length ? `글꼴 ${out.report.failed.length}개를 주고받지 못해 다음 동기화에서 다시 시도합니다: ${out.report.failed.slice(0, 3).join(', ')}` : null;
        return [conflictNotice(out.report), failedNote].filter(Boolean).join(' · ') || null;
      } catch (e) {
        const err = e as { status?: number; network?: boolean };
        if (err.status === 401 || err.network) throw e;
        return `글꼴 동기화를 마치지 못했습니다(${(e as Error).message}). 다음에 다시 시도합니다.`;
      }
    },
  }), [dispatch, setSession]);

  const sync = useCallback((reason: 'pull' | 'push'): Promise<void> => syncOnce(ctl, env, {
    online: () => navigator.onLine,
    status: (patch) => setStatus((s) => patchStatus(s, patch)),
    later: (ms) => { setTimeout(() => void sync('push'), ms); },
    signedOut: () => { setSession(null); notifyRef.current('클라우드 로그인이 만료되었습니다. 다시 로그인하세요.'); },
    // Storage use is read again only after a round that moved something (a quiet poll asks nothing more).
    done: (result) => { if (result && !result.quiet) void refreshStorage(); },
  }, reason), [ctl, env, refreshStorage, setSession]);

  // Start + poll: every 1–8 s while on screen (every second while someone edits), 30 s hidden, slower while the server
  // cannot be reached, and at once when the window comes back or the connection returns.
  useEffect(() => {
    if (!status.session) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    // One pending timer at most, however many syncs are running at once.
    const tick = async () => {
      clearTimeout(timer);
      await sync('pull');
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(tick, pollDelay({ failures: ctl.failures, hidden: document.hidden, focused: document.hasFocus(), now: Date.now(), activeAt: ctl.activeAt ?? 0 }));
    };
    const again = () => { if (document.hidden) return; ctl.failures = 0; clearTimeout(timer); void tick(); };
    const lost = () => setStatus((s) => (s.session ? patchStatus(s, { state: 'offline', message: null }) : s));
    void tick();
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    window.addEventListener('offline', lost);
    document.addEventListener('visibilitychange', again);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
      window.removeEventListener('offline', lost);
      document.removeEventListener('visibilitychange', again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.session?.token]);

  // While edits cannot be sent (offline or an error), count what is waiting.
  useEffect(() => {
    if (!status.session || (status.state !== 'offline' && status.state !== 'error')) { setPending(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const base = await loadBase();
      if (alive) setPending(pendingChanges(base, syncable(libRef.current)));
    }, 1500);
    return () => { alive = false; clearTimeout(t); };
  }, [library, status.state, status.session?.token]);

  // A font imported, removed or switched on / off sends and receives fonts soon (offline: at the next round).
  useEffect(() => {
    if (!status.session) return;
    let t: ReturnType<typeof setTimeout>;
    const soon = () => { clearTimeout(t); ctl.extrasDue = true; t = setTimeout(() => void sync('push'), 1000); };
    const off = subscribeImportedFonts(soon);
    window.addEventListener(FONT_SYNC_EVENT, soon);
    return () => { clearTimeout(t); off(); window.removeEventListener(FONT_SYNC_EVENT, soon); };
  }, [status.session?.token, sync]);

  /** Move a font to the font trash: its entry leaves the list (every computer drops its copy at its next sync) but the file stays on the server for the trash period, so it can be restored. */
  const removeFont = useCallback(async (id: string) => {
    const session = loadSession();
    if (!session) throw new Error('먼저 로그인해 주세요.');
    const { fonts: old, fontTrash: oldTrash, ...rest } = syncable(libRef.current);
    const entry = (old ?? []).find((f) => f.id === id);
    const fonts = (old ?? []).filter((f) => f.id !== id);
    const fontTrash = entry ? addToFontTrash(oldTrash ?? [], [entry], Date.now()) : oldTrash;
    dispatch({ type: 'library/merge', library: { ...rest, ...(fonts.length ? { fonts } : {}), ...(fontTrash?.length ? { fontTrash } : {}) } });
    setTimeout(() => void sync('push'), PUSH_DELAY);
  }, [dispatch, sync]);

  /** Bring a trashed font back into the list; the other computers download it again. */
  const restoreFont = useCallback((id: string) => {
    const { fonts: old, fontTrash: oldTrash, ...rest } = syncable(libRef.current);
    const r = restoreFontEntry(old ?? [], oldTrash ?? [], id, Date.now());
    dispatch({ type: 'library/merge', library: { ...rest, ...(r.manifest.length ? { fonts: r.manifest } : {}), ...(r.trash.length ? { fontTrash: r.trash } : {}) } });
    setTimeout(() => void sync('push'), PUSH_DELAY);
  }, [dispatch, sync]);

  /** Delete a trashed font for good (its file leaves the server now). */
  const purgeFont = useCallback(async (id: string) => {
    const session = loadSession();
    if (!session) throw new Error('먼저 로그인해 주세요.');
    const { fontTrash: oldTrash, ...rest } = syncable(libRef.current);
    await cloudApi.deleteMedia(session.token, id).catch((e) => { if ((e as { status?: number }).status !== 404) throw e; });
    const fontTrash = (oldTrash ?? []).filter((t) => t.id !== id);
    dispatch({ type: 'library/merge', library: { ...rest, ...(fontTrash.length ? { fontTrash } : {}) } });
    void refreshStorage();
    setTimeout(() => void sync('push'), PUSH_DELAY);
  }, [dispatch, refreshStorage, sync]);

  // Push soon after local edits: 0.3 s after the last change, and at least every 1.5 s while changes keep coming.
  // Nothing is worked out per keystroke; whether the library really differs from what was sent is checked once, when it fires.
  const pushWait = useRef<{ timer?: ReturnType<typeof setTimeout>; first?: number }>({});
  useEffect(() => {
    if (!status.session) return;
    const w = pushWait.current;
    const now = Date.now();
    w.first ??= now;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.first = undefined;
      if (keyOf(libRef.current) === ctl.lastPushed) return;
      ctl.activeAt = Date.now();
      void sync('push');
    }, Math.max(0, Math.min(PUSH_DELAY, w.first + PUSH_MAX_WAIT - now)));
  }, [library, status.session?.token, sync]);
  useEffect(() => () => clearTimeout(pushWait.current.timer), []);

  const login = async (username: string, password: string) => {
    const r = await cloudApi.login(username, password);
    // Another account than last time: no shared history with this one (its base would delete what it lacks).
    if (baseOwnerChanges(r.data.username)) await clearBase();
    setSession({ token: r.data.token, username: r.data.username, version: 0 });
    record('account/login', r.data.username);
    notify(`${r.data.username}(으)로 로그인했습니다 — 라이브러리를 동기화합니다`);
  };
  const logout = async () => {
    const s = loadSession();
    if (s) { record('account/logout', s.username); await cloudApi.logout(s.token); }
    setSession(null);
    setStorage({ loading: false, usage: null, error: null });
    setFontReport(null);
  };

  const pauseSync = useCallback(() => { ctl.paused = true; }, []);
  const resumeSync = useCallback(() => { ctl.paused = false; void sync('pull'); }, [sync]);
  const clearAll = async (password: string, revision: string) => {
    const session = loadSession();
    if (!session) throw new Error('먼저 로그인해 주세요.');
    const result = await cloudApi.clearAll(session.token, password, revision);
    const empty = normalizeLibrary(result.data);
    if (!empty?.cloudResetId) throw new Error('서버 초기화 결과를 확인하지 못했습니다. 다시 로그인하세요.');
    if (loadSession()?.token !== session.token) throw new Error('서버 자료 삭제가 완료되었습니다. 다시 로그인해 확인하세요.');
    // Rotate before awaiting local writes so old in-flight syncs can no longer commit their state.
    setSession({ token: result.token, username: result.username, version: result.version });
    libRef.current = empty;
    ctl.lastPushed = keyOf(empty); ctl.requested = false;
    ctl.failures = 0; setPending(null);
    dispatch({ type: 'library/cloudReset', library: empty });
    await saveBase(empty).catch(() => notifyRef.current('서버 자료 삭제는 완료했지만 이 기기의 동기화 기록을 저장하지 못했습니다. 다시 로그인해 주세요.'));
    setStatus((s) => patchStatus(s, { state: 'synced', message: null, lastSync: Date.now() }));
    await refreshStorage();
    notifyRef.current('서버의 LightCast 자료와 미디어를 모두 삭제했습니다.');
    return result.deleted;
  };

  const fullStatus = useMemo(() => ({ ...status, pending, fonts: fontReport, storageUsage: storage.usage, storageError: storage.error }), [status, pending, fontReport, storage.usage, storage.error]);
  return { status: fullStatus, cloudFonts: (library.fonts ?? []) as CloudFont[], fontTrash: (library.fontTrash ?? []) as CloudFontTrash[], removeFont, restoreFont, purgeFont, storage, refreshStorage, device, registeredDevices: library.devices ?? [], renameDevice, markChurch, login, logout, pauseSync, resumeSync, clearAll, syncNow: () => sync('pull') };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
