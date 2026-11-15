import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { Library } from '../domain/types';
import { cloudApi, loadBase, loadSession, saveBase, saveSession, getCloudStorageUsage, type CloudSession } from '../domain/cloud';
import { syncable } from '../domain/cloudMerge';
import { PUSH_DELAY, syncOnce, type SyncControl, type SyncEnv } from '../domain/cloudSyncRound';
import { getDevice, initializeDevice, saveDeviceProfile } from '../domain/device';
import { type CloudStorageUsage } from '../domain/cloudStorage';
import { saveSyncRestorePoint } from '../domain/restorePoints';
import { normalizeLibrary } from '../domain/persistence';
import { runFontSync, loadFontSyncSettings, fontKnownScope, freeBytesOf, FONT_SYNC_EVENT, type FontSyncReport, type CloudFont } from '../domain/fontSync';
import { createFontCloud, createFontStore } from '../domain/fontSyncStore';
import { refreshImportedFonts, subscribeImportedFonts } from '../domain/importedFonts';
import { usedFamilies } from '../domain/io/pptxFonts';
import { addConflicts, loadConflicts, openConflicts, pendingChanges, retryDelay, saveConflicts, type PendingChanges, type SyncState } from '../domain/syncStatus';

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


/**
 * Keeps this computer's library in step with the church cloud library while signed in:
 * pull + merge on start and every 20 s, push 1 s after any change, media both ways.
 * Offline-first: the library is always saved on this computer first, so nothing waits on the network.
 * Without a connection it just says so and keeps the edits; it asks again when the connection returns
 * (and less often while the server stays unreachable). A presentation that two computers changed at the
 * same time is kept twice and listed in `conflicts` until someone chooses.
 */
export function useCloudSync(library: Library, dispatch: Dispatch<Action>, notify: (m: string) => void) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [storage, setStorage] = useState<{ loading: boolean; usage: CloudStorageUsage | null; error: string | null }>({ loading: false, usage: null, error: null });
  const [status, setStatus] = useState<CloudStatus>(() => ({ session: loadSession(), state: loadSession() ? 'syncing' : 'off', message: null, lastSync: null }));
  const [device, setDevice] = useState(getDevice);
    const [pending, setPending] = useState<PendingChanges | null>(null);
  const [fontReport, setFontReport] = useState<FontSyncReport | null>(null);
  const [savedConflicts, setSavedConflicts] = useState(loadConflicts);
  const resumedToken = useRef(loadSession()?.token ?? null);
  useEffect(() => {
    if (!status.session || resumedToken.current !== status.session.token) return;
    resumedToken.current = null;
    const identity = getDevice();
    dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: Date.now(), action: 'app/open', detail: identity.name, device: identity, account: status.session.username } });
  }, [status.session?.token, dispatch]);
  useEffect(() => { void initializeDevice().then(setDevice).catch(() => undefined); }, []);
  useEffect(() => {
    if (!status.session) return;
    dispatch({ type: 'device/register', device: { ...device, lastSeen: Date.now(), account: status.session.username } });
  }, [device, status.session?.token, dispatch]);
  const record = (action: string, account: string | null, identity = getDevice()) => dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: Date.now(), action, detail: identity.name, device: identity, account } });
  const renameDevice = (name: string, userName: string) => {
    const identity = saveDeviceProfile(name, userName);
    setDevice(identity);
    record('device/profile', loadSession()?.username ?? null, identity);
  };
  const libRef = useRef(library);
  libRef.current = library;
  // The round's bookkeeping (busy, retries, what was last sent) lives in one object shared with domain/cloudSyncRound.ts.
  const ctl = useMemo<SyncControl>(() => ({ busy: false, requested: false, failures: 0, paused: false, lastPushed: '' }), []);
  const storageRequest = useRef(0);
  const refreshStorage = useCallback(async () => {
    const session = loadSession();
    if (!session) return;
    const request = ++storageRequest.current;
    setStorage((s) => ({ ...s, loading: true, error: null }));
    try {
      const usage = await getCloudStorageUsage(session.token);
      if (storageRequest.current === request && loadSession()?.token === session.token) setStorage({ loading: false, usage, error: null });
    } catch (e) {
      if (storageRequest.current === request && loadSession()?.token === session.token) setStorage((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    if (!status.session) return;
    void refreshStorage();
    const timer = setInterval(() => void refreshStorage(), 30000);
    return () => clearInterval(timer);
  }, [status.session?.token, refreshStorage]);

  const setSession = useCallback((s: CloudSession | null) => {
    saveSession(s);
    setStatus((st) => ({ ...st, session: s, state: s ? st.state : 'off' }));
  }, []);

  /** What a sync round needs from this window (see domain/cloudSyncRound.ts). */
  const env = useMemo<SyncEnv>(() => ({
    session: loadSession,
    setSession: (s) => setSession(s),
    local: () => libRef.current,
    merge: (lib) => dispatch({ type: 'library/merge', library: lib }),
    cloudReset: (lib) => {
      libRef.current = lib;
      dispatch({ type: 'library/cloudReset', library: lib });
      ctl.failures = 0; setPending(null); saveConflicts([]); setSavedConflicts([]);
    },
    addConflicts: (pairs) => setSavedConflicts((prev) => { const next = addConflicts(prev, pairs, Date.now()); saveConflicts(next); return next; }),
    notify: (m) => notifyRef.current(m),
    progress: (m) => setStatus((s) => ({ ...s, message: m })),
    loadBase,
    saveBase,
    restorePoint: saveSyncRestorePoint,
    pushed: (lib) => { ctl.lastPushed = JSON.stringify(lib); },
    // Imported fonts: files both ways + the font list in the library (a changed list is pushed by the next round).
    fonts: async (current) => {
      const session = loadSession();
      if (!session) return null;
      try {
        await refreshImportedFonts();
        const usage = (await getCloudStorageUsage(session.token).catch(() => null))?.server;
        const used = new Set(usedFamilies(current.presentations).map((f) => f.trim().toLowerCase()));
        const out = await runFontSync(
          { cloud: createFontCloud(session.token, current.cloudResetId), store: createFontStore(fontKnownScope(session.username, current.cloudResetId)) },
          { manifest: current.fonts ?? [], settings: loadFontSyncSettings(), used, freeBytes: freeBytesOf(usage) },
          (m) => setStatus((st) => ({ ...st, message: m })),
        );
        if (loadSession()?.token !== session.token) return null;
        setFontReport(out.report);
        if (out.manifest) {
          const fonts = out.manifest.length ? out.manifest : undefined;
          const { fonts: _old, ...rest } = syncable(libRef.current);
          dispatch({ type: 'library/merge', library: { ...rest, ...(fonts ? { fonts } : {}) } });
        }
        return out.report.failed.length ? `글꼴 ${out.report.failed.length}개를 주고받지 못해 다음 동기화에서 다시 시도합니다: ${out.report.failed.slice(0, 3).join(', ')}` : null;
      } catch (e) {
        const err = e as { status?: number; network?: boolean };
        if (err.status === 401 || err.network) throw e;
        return `글꼴 동기화를 마치지 못했습니다(${(e as Error).message}). 다음에 다시 시도합니다.`;
      }
    },
  }), [dispatch, setSession]);

  const sync = useCallback((reason: 'pull' | 'push'): Promise<void> => syncOnce(ctl, env, {
    online: () => navigator.onLine,
    status: (patch) => setStatus((s) => ({ ...s, ...patch })),
    later: (ms) => { setTimeout(() => void sync('push'), ms); },
    signedOut: () => { setSession(null); notifyRef.current('클라우드 로그인이 만료되었습니다. 다시 로그인하세요.'); },
    done: () => void refreshStorage(),
  }, reason), [ctl, env, refreshStorage, setSession]);

  // Start + poll: every 20 s, slower while the server cannot be reached, at once when the connection returns.
  useEffect(() => {
    if (!status.session) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    // One pending timer at most, however many syncs are running at once.
    const tick = async () => {
      await sync('pull');
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(tick, retryDelay(ctl.failures));
    };
    const again = () => { ctl.failures = 0; clearTimeout(timer); void tick(); };
    const lost = () => setStatus((s) => (s.session ? { ...s, state: 'offline', message: null } : s));
    void tick();
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    window.addEventListener('offline', lost);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
      window.removeEventListener('offline', lost);
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
    const soon = () => { clearTimeout(t); t = setTimeout(() => void sync('push'), 2000); };
    const off = subscribeImportedFonts(soon);
    window.addEventListener(FONT_SYNC_EVENT, soon);
    return () => { clearTimeout(t); off(); window.removeEventListener(FONT_SYNC_EVENT, soon); };
  }, [status.session?.token, sync]);

  /** Delete a font from the church cloud (its entry and its file); every computer drops its copy at its next sync. */
  const removeFont = useCallback(async (id: string) => {
    const session = loadSession();
    if (!session) throw new Error('먼저 로그인해 주세요.');
    const { fonts: old, ...rest } = syncable(libRef.current);
    const fonts = (old ?? []).filter((f) => f.id !== id);
    dispatch({ type: 'library/merge', library: { ...rest, ...(fonts.length ? { fonts } : {}) } });
    await cloudApi.deleteMedia(session.token, id).catch((e) => { if ((e as { status?: number }).status !== 404) throw e; });
    void refreshStorage();
    setTimeout(() => void sync('push'), PUSH_DELAY);
  }, [dispatch, refreshStorage, sync]);

  const conflicts = useMemo(() => openConflicts(savedConflicts, library), [savedConflicts, library]);
  useEffect(() => {
    if (conflicts.length !== savedConflicts.length) { saveConflicts(conflicts); setSavedConflicts(conflicts); }
  }, [conflicts, savedConflicts]);
  const dismissConflict = useCallback((id: string) => setSavedConflicts((prev) => { const next = prev.filter((c) => c.id !== id); saveConflicts(next); return next; }), []);

  // Push shortly after local edits.
  useEffect(() => {
    if (!status.session) return;
    const text = JSON.stringify(syncable(library));
    if (text === ctl.lastPushed) return;
    const t = setTimeout(() => sync('push'), PUSH_DELAY);
    return () => clearTimeout(t);
  }, [library, status.session, sync]);

  const login = async (username: string, password: string) => {
    const r = await cloudApi.login(username, password);
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
    ctl.lastPushed = JSON.stringify(syncable(empty)); ctl.requested = false;
    ctl.failures = 0; setPending(null); saveConflicts([]); setSavedConflicts([]);
    dispatch({ type: 'library/cloudReset', library: empty });
    await saveBase(empty).catch(() => notifyRef.current('서버 자료 삭제는 완료했지만 이 기기의 동기화 기록을 저장하지 못했습니다. 다시 로그인해 주세요.'));
    setStatus((s) => ({ ...s, state: 'synced', message: null, lastSync: Date.now() }));
    await refreshStorage();
    notifyRef.current('서버의 LightCast 자료와 미디어를 모두 삭제했습니다.');
    return result.deleted;
  };

  return { status: { ...status, pending, fonts: fontReport, storageUsage: storage.usage, storageError: storage.error }, conflicts, dismissConflict, cloudFonts: (library.fonts ?? []) as CloudFont[], removeFont, storage, refreshStorage, device, registeredDevices: library.devices ?? [], renameDevice, login, logout, pauseSync, resumeSync, clearAll, syncNow: () => sync('pull') };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
