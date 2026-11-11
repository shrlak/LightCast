import { TeamRequestsModal } from '../ui/TeamRequestsModal';
import { blockedProtectedAction, protectedMediaIds, PROTECTED_MESSAGE } from '../domain/materialProtection';
import type { TeamRequest } from '../domain/teamRequests';
import { TrashModal } from '../ui/TrashModal';
import { RehearsalModal } from '../ui/RehearsalModal';
import { RemoteControlModal } from '../ui/RemoteControlModal';
import type { RemoteControlState } from '../domain/remoteControl';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, type Action, type AppState } from '../domain/reducer';
import { loadLibrary, normalizeLibrary, saveLibrary } from '../domain/persistence';
import { activePlaylist } from '../domain/live';
import { sequence } from '../domain/arrangement';
import { getDevice } from '../domain/device';
import { loadSession } from '../domain/cloud';
import { uid } from '../domain/lyrics';
import { presentationFromSongFile } from '../domain/io/songFormats';
import { exportBackup, importBackup } from '../domain/io/backup';
import { exportPptx } from '../domain/io/pptxExport';
import type { Library, Presentation } from '../domain/types';
import { AUTO_INTERVAL, newestRestorePointAt, saveRestorePoint } from '../domain/restorePoints';
import { ActivityModal } from '../ui/ActivityModal';
import { ServicePreparationModal } from '../ui/ServicePreparationModal';
import { FindPalette } from '../ui/FindPalette';
import { RestorePointsModal } from '../ui/RestorePointsModal';
import { useLiveBroadcast, useRelay } from '../ui/hooks';
import { SlideEditorModal } from '../ui/SlideEditorModal';
import { isSong } from '../domain/templates/fill';
import { EditorModal } from '../ui/EditorModal';
import { ThemeModal } from '../ui/ThemeModal';
import { BibleModal } from '../ui/BibleModal';
import { AiModal } from '../ui/AiModal';
import { SettingsModal } from '../ui/SettingsModal';
import { SongLibraryModal } from '../ui/sunday/SongLibraryModal';
import { SundayWizard } from '../ui/sunday/SundayWizard';
import { RetreatWizard } from '../ui/RetreatWizard';
import { RetreatBackgroundModal } from '../ui/RetreatBackgroundModal';
import { ChordSheetModal } from '../ui/ChordSheetModal';
import { SyncStatusModal } from '../ui/SyncStatusModal';
import { buildVerseDeck, loadVerseDefaults, verseActions } from '../domain/bible/liveVerse';
import { fetchOnlineSongs } from '../domain/online';
import { runExternal } from '../domain/effects';
import type { Macro, SlideAction } from '../domain/types';
import { AudioPlayer } from '../ui/AudioPanel';
import { filesToSlides } from '../ui/importFiles';
import { remoteInfoMessages, remotePositionMessage, remoteSlideInfo } from '../domain/remoteSlides';
import { mediaIdsFor, resetSentMedia, sendMediaToRemotes } from '../domain/remoteMedia';
import { x32 } from '../ui/x32';
import { loadX32Settings, saveX32Settings, type X32Settings } from '../domain/x32';
import { UpdateBanner } from '../ui/UpdateBanner';
import { useCloudSync } from '../ui/useCloudSync';
import { deleteMedia, forgetMediaUrl } from '../domain/media';
import { finishedServices } from '../domain/sunday/cleanup';
import { useServiceUploads } from '../ui/ppt/useServiceUploads';
import { AccountModal } from '../ui/AccountModal';
import { DeviceSetupDialog } from '../ui/DeviceSetupDialog';
import { deviceProfileSaved } from '../domain/device';
import { ConfessionSetting } from '../ui/sunday/ConfessionSetting';
import { AiUsage } from '../ui/AiUsage';
import { PrayerSetting } from '../ui/sunday/PrayerSetting';
import { SongEditor } from '../ui/sunday/SongEditor';
import { reviewNote } from '../ui/ppt/contiReview';
import { PptLayout } from '../ui/ppt/PptLayout';
import { presentOutput } from '../ui/outputWindows';
import { desktop } from '../domain/desktop';
import type { Commands, Modal, PptViewMode } from '../ui/ppt/commands';
import { FollowDock } from '../ui/FollowDock';
import { SongStatsModal } from '../ui/SongStatsModal';
import { CcliModal } from '../ui/CcliModal';
import { SafeModeModal } from '../ui/SafeModeModal';
import { StandbyBar, StandbyModal } from '../ui/StandbyModal';
import { TemplateMarketModal } from '../ui/TemplateMarketModal';
import { loadSafeMode, safeModeBlock, saveSafeMode, type SafeModeState } from '../domain/safeMode';
import { loadStandby, saveStandby, useStandby, type StandbyConfig } from '../ui/useStandby';
import { takeoverActions } from '../domain/standby';
import { featureEnabled } from '../domain/features';


const KEYS: Record<string, Action> = {
  ArrowRight: { type: 'live/next' }, ArrowDown: { type: 'live/next' }, PageDown: { type: 'live/next' }, ' ': { type: 'live/next' },
  ArrowLeft: { type: 'live/prev' }, ArrowUp: { type: 'live/prev' }, PageUp: { type: 'live/prev' },
  // As in PowerPoint's slide show: B or . turns the screen black and back.
  b: { type: 'live/toggleBlack' }, B: { type: 'live/toggleBlack' }, '.': { type: 'live/toggleBlack' },
};

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function download(name: string, data: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function OperatorView() {
  const [state, dispatchRaw] = useReducer(reducer, undefined, () => createInitialState(loadLibrary()));
  const [modal, setModal] = useState<Modal>(null);
  /** 단계별 수정: the wizard step opened alone (undefined = the whole 주일예배 마법사). */
  const [sundayStep, setSundayStep] = useState<number | undefined>(undefined);
  const [followOn, setFollowOn] = useState(false);
  const [safe, setSafeState] = useState<SafeModeState>(loadSafeMode);
  const safeRef = useRef(safe); safeRef.current = safe;
  const [standbyConfig, setStandbyConfig] = useState<StandbyConfig>(loadStandby);
  const [marketOn, setMarketOn] = useState(() => featureEnabled('templateMarket'));
  const modalRef = useRef(modal); modalRef.current = modal;
  const rehearsalCommandRef = useRef<((command: Record<string, unknown>) => void) | null>(null);
  const [rehearsalPreview, setRehearsalPreview] = useState<AppState | null>(null);
  const [teamRequests, setTeamRequests] = useState<TeamRequest[]>([]);
  const knownRequests = useRef(new Set<string>());
  const [remoteControl, setRemoteControl] = useState<RemoteControlState | null>(null);
  useEffect(() => { const expire = () => dispatchRaw({ type: 'trash/expire', now: Date.now() }); expire(); const t = setInterval(expire, 60000); return () => clearInterval(t); }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [mixer, setMixerState] = useState(loadX32Settings);
  const setMixer = (next: X32Settings) => { setMixerState(next); saveX32Settings(next); };
  const [online, setOnline] = useState<{ status: 'loading' | 'ok' | 'error'; count: number; error?: string }>({ status: 'loading', count: 0 });
  const [view, setView] = useState<PptViewMode>('normal');
  const [slideId, setSlideIdState] = useState<string | null>(null);
  const [slideSeq, setSlideSeq] = useState<number | null>(null);
  const setSlideId = (id: string | null, seq?: number) => { setSlideIdState(id); setSlideSeq(seq ?? null); };
  const [locked, setLockedState] = useState(() => localStorage.getItem('freecast.lock') !== '0');
  const setLocked = (on: boolean) => { localStorage.setItem('freecast.lock', on ? '1' : '0'); setLockedState(on); };
  const fileRef = useRef<HTMLInputElement>(null);
  const importKind = useRef<'library' | 'slides' | 'lyrics' | 'backup'>('slides');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Stamp time on actions that record usage or touch timers, keeping the reducer pure.
  // DMX steps in macros/schedules are side effects, so they run here rather than in the reducer.
  const macrosRef = useRef<Macro[]>([]);
  const schedulesRef = useRef<{ id: string; macroId: string }[]>([]);
  const dispatch = useMemo(() => (a: Action) => {
    const blocked = blockedProtectedAction(latestLib.current, a);
    if (blocked) { notifyRef.current(`${blocked}: ${PROTECTED_MESSAGE}`); return; }
    const locked = safeModeBlock(safeRef.current, a);
    if (locked) { notifyRef.current(`🛡 안전 모드 중에는 ${locked}을(를) 할 수 없습니다. 끄려면 예배 → 안전 모드`); return; }
    if ((a.type === 'live/go' || a.type === 'live/next') && a.now == null) a = { ...a, now: Date.now() };
    const macroId = a.type === 'macro/run' ? a.id : a.type === 'schedule/ran' ? schedulesRef.current.find((x) => x.id === a.id)?.macroId : undefined;
    const macro = macroId ? macrosRef.current.find((m) => m.id === macroId) : undefined;
    macro?.steps.forEach(runExternal);
    dispatchRaw({ ...a, actor: getDevice(), account: loadSession()?.username ?? null, eventId: crypto.randomUUID(), occurredAt: Date.now() });
  }, []);
  const notifyRef = useRef<(m: string) => void>(() => undefined);
  const notify = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  useEffect(() => saveLibrary(state.library), [state.library]);
  // Restore points: a snapshot of the library every 10 minutes while it keeps changing.
  const snapped = useRef<Library | null>(null);
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      const lib = latestLib.current;
      if (busy || snapped.current === lib) return;
      busy = true;
      try {
        const newest = await newestRestorePointAt();
        if (newest === null || Date.now() - newest >= AUTO_INTERVAL) {
          await saveRestorePoint(lib, 'auto');
          snapped.current = lib;
        }
      } catch {
        // IndexedDB blocked: no restore points, the app carries on.
      }
      busy = false;
    };
    const first = setTimeout(tick, 20_000);
    const t = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const cloud = useCloudSync(state.library, dispatch, (m) => notifyRef.current(m));
  // The first login on this computer (or a logged-in computer never named): register its name and user right away.
  const [deviceSetup, setDeviceSetup] = useState(false);
  useEffect(() => {
    if (!cloud.status.session || deviceProfileSaved()) return;
    setModal((m) => (m === 'account' ? null : m));
    setDeviceSetup(true);
  }, [cloud.status.session?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  // 🛡 While the service runs the library does not change underneath it: no cloud merges, and risky edits are blocked.
  useEffect(() => {
    if (!safe.on) return;
    cloud.pauseSync();
    return () => cloud.resumeSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safe.on]);
  const setSafe = (next: SafeModeState) => { saveSafeMode(next); setSafeState(next); };
  const standby = useStandby(standbyConfig, state.library, state.activePlaylistId);
  const setStandby = (next: StandbyConfig) => { saveStandby(next); setStandbyConfig(next); };
  const takeOver = () => {
    const actions = takeoverActions(standby.cursor, standby.live);
    if (!actions.length) return notifyRef.current('이 컴퓨터에 메인 화면과 같은 슬라이드가 없어 이어받을 수 없습니다');
    setStandby({ ...standbyConfig, on: false });
    dispatch({ type: 'select', id: standby.cursor!.presentationId });
    actions.forEach(dispatch);
    setView('presenter');
    presentOutput();
    setModal(null);
    notifyRef.current('💻 송출을 이어받았습니다');
  };
  // The server deletes blobs atomically with the library update; remove this device's cache too.
  const previousMedia = useRef(state.library.media);
  useEffect(() => {
    const remaining = new Set(state.library.media.map((m) => m.id));
    for (const m of previousMedia.current) if (!remaining.has(m.id)) {
      forgetMediaUrl(m.id);
      void deleteMedia(m.id).catch(() => notifyRef.current('이 기기의 미디어 캐시를 정리하지 못했습니다.'));
    }
    previousMedia.current = state.library.media;
  }, [state.library.media]);
  // Sunday 5 pm: the finished 주일예배 (playlist + its decks) is removed here and from the church server.
  useEffect(() => {
    const clear = () => {
      const done = finishedServices(latestLib.current, new Date());
      if (done.playlistIds.length || done.presentationIds.length) dispatch({ type: 'services/finish', ...done });
    };
    clear();
    const t = setInterval(clear, 60_000);
    return () => clearInterval(t);
  }, [dispatch]);
  const service = useServiceUploads(state.library, dispatch, (m) => notifyRef.current(m), state.activePlaylistId);
  // Files dragged onto the window go straight into this week's 주일예배.
  const [dragging, setDragging] = useState(false);
  const serviceRef = useRef(service);
  serviceRef.current = service;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) serviceRef.current.drop(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  macrosRef.current = state.library.macros;
  schedulesRef.current = state.library.schedules;

  // DMX steps in slide actions (directly or through a macro) run when the slide goes live.
  useEffect(() => {
    const run = (acts: SlideAction[] | undefined) => acts?.forEach((a) => {
      if (a.type === 'runMacro') macrosRef.current.find((m) => m.id === a.macroId)?.steps.forEach(runExternal);
      else runExternal(a);
    });
    run(state.live.slide?.actions);
  }, [state.live.slide]);

  // The 찬양 라이브러리 comes from the online server every session (kept in memory, never saved).
  const loadOnline = () => {
    setOnline({ status: 'loading', count: 0 });
    fetchOnlineSongs(state.library.sunday.linesPerSlide)
      .then((list) => {
        dispatch({ type: 'online/songs', presentations: list });
        setOnline({ status: 'ok', count: list.length });
      })
      .catch((e: Error) => setOnline({ status: 'error', count: 0, error: e.message }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadOnline, []);
  const latestLib = useRef(state.library);
  latestLib.current = state.library;

  const [remotes, setRemotes] = useState(0);
  const lastLibrary = useRef(state.library);
  const lastRemoteCatalog = useRef<null | { snapshot: typeof state.library; selected: typeof state.selectedId; playlist: typeof state.activePlaylistId; connected: boolean }>(null);
  const showVerseRef = useRef<(refs: string, live: boolean) => Promise<void>>(async () => undefined);
  const relay = useRelay({ type: 'hello', role: 'host' }, (m) => {
    if (m.type === 'team-requests') {
      const entries = m.requests as TeamRequest[];
      for (const r of entries) if (!knownRequests.current.has(r.id) && r.status === 'pending') notifyRef.current(`${r.name}: ${r.text}`);
      knownRequests.current = new Set(entries.map((r) => r.id)); setTeamRequests(entries);
    }
    if (m.type === 'remote-control') setRemoteControl(m as unknown as RemoteControlState);
    if (m.type === 'remotes') setRemotes(Number(m.count) || 0);
    if (m.type !== 'command' || !m.command) return;
    if (modalRef.current === 'rehearsal') { rehearsalCommandRef.current?.(m.command as Record<string, unknown>); return; }
    let c = m.command as Action & { now?: number };
    // Slide show from the remote: same as the Start / End buttons on this computer.
    const show = (m.command as { type: string }).type;
    if (show === 'show/start') return startShowRef.current(false);
    if (show === 'show/end') return endShowRef.current();
    // A verse called for from a tablet (pastor view): built here, placed after the slide on screen.
    if (show === 'bible/show') {
      const { refs, live: goLive } = m.command as { refs?: unknown; live?: unknown };
      if (typeof refs === 'string') void showVerseRef.current(refs, goLive !== false);
      return;
    }
    if (c.type === 'macro/run') {
      const id = c.id;
      const macro = latestLib.current.macros.find((x) => x.id === id) ?? latestLib.current.macros.find((x) => x.name.toLowerCase() === id.toLowerCase());
      if (!macro) return;
      c = { ...c, id: macro.id };
    }
    if (c.type === 'macro/run' || c.type === 'timer/op') dispatch({ ...c, now: Date.now() } as Action);
    else dispatch(c);
  });
  useLiveBroadcast(state.live, relay.send);
  useEffect(() => { relay.send({ type: 'rehearsal', active: !!rehearsalPreview, state: rehearsalPreview?.live, cursor: rehearsalPreview?.cursor }); }, [rehearsalPreview, relay.connected]);

  // Share the complete running order and the upcoming slides with remotes.
  const selected = state.library.presentations.find((p) => p.id === state.selectedId) ?? null;

  const playlist = activePlaylist(state);
  useEffect(() => {
    let cancelled = false;
    const info = remoteSlideInfo(rehearsalPreview ?? state, rehearsalPreview?.selectedId ?? state.selectedId);
    const source = rehearsalPreview ?? state;
    const stamp = { snapshot: source.library, selected: source.selectedId, playlist: source.activePlaylistId, connected: relay.connected };
    const previous = lastRemoteCatalog.current;
    const unchanged = previous?.snapshot === stamp.snapshot && previous.selected === stamp.selected &&
      previous.playlist === stamp.playlist && previous.connected === stamp.connected;
    const position = unchanged ? remotePositionMessage(info) : null;
    const messages = position ? [position] : remoteInfoMessages(info);
    // Current/next previews arrive first; earlier slides also need their media for browsing.
    const previews = [...info.upcoming, ...(info.all ?? [])];
    const ids = mediaIdsFor({ slides: previews.map((x) => x.slide), backgrounds: previews.map((x) => x.background) });
    const edited = lastLibrary.current !== state.library;
    lastLibrary.current = state.library;
    const t = setTimeout(() => {
      if (cancelled) return;
      for (const message of messages) relay.send(message);
      if (!position) lastRemoteCatalog.current = stamp;
      if (remotes > 0) sendMediaToRemotes(ids);
    }, edited ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.library, state.selectedId, state.cursor, state.playlistIndex, state.activePlaylistId, relay.connected, remotes, rehearsalPreview]);

  // A restarted server has forgotten the media it was given.
  useEffect(() => resetSentMedia(), [relay.connected]);

  // What is live (background, logo, props) goes to remotes too.
  useEffect(() => {
    if (remotes > 0) sendMediaToRemotes(mediaIdsFor({ live: state.live }));
  }, [remotes, state.live]);

  // The X32 link lives in the FreeCast server; the console only says which mixer to talk to.
  const mixerIp = mixer.on && mixer.ip ? mixer.ip : null;
  useEffect(() => {
    if (!mixerIp && x32.state.status === 'off') return;
    x32.connect(mixerIp);
  }, [mixerIp]);

  // Slide auto-advance ("go to next" timers) — restarts whenever a different slide goes live.
  const liveSlide = state.live.slide;
  // Set Up Slide Show › Advance slides manually: timings are kept but not used.
  const manual = !!state.library.presentations.find((p) => p.id === state.cursor?.presentationId)?.showSetup?.manual;
  useEffect(() => {
    if (!liveSlide?.autoAdvance || manual) return;
    const t = setTimeout(() => dispatch({ type: 'live/next' }), liveSlide.autoAdvance * 1000);
    return () => clearTimeout(t);
  }, [liveSlide, dispatch, manual]);

  // Announcements layer loops on its own: each slide's auto-advance, or 8 seconds.
  const ann = state.live.announcement;
  useEffect(() => {
    if (!ann) return;
    const t = setTimeout(() => dispatch({ type: 'announce/next' }), (ann.slide.autoAdvance ?? 8) * 1000);
    return () => clearTimeout(t);
  }, [ann, dispatch]);

  // Scheduled macros: checked every 15 s; each schedule fires once per day/time slot.
  const schedules = state.library.schedules;
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const slot = `${now.toISOString().slice(0, 10)} ${hhmm}`;
      for (const sc of schedules) {
        if (sc.enabled && sc.time === hhmm && sc.days.includes(now.getDay()) && sc.lastRun !== slot) {
          dispatch({ type: 'schedule/ran', id: sc.id, slot, now: Date.now() });
          notify(`Scheduled: ${sc.name}`);
        }
      }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal === 'rehearsal') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !modal) {
        e.preventDefault();
        window.dispatchEvent(new Event('freecast:find-library'));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && (!modal || modal === 'find')) {
        e.preventDefault();
        setModal(modal === 'find' ? null : 'find');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (modal || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'F5') {
        e.preventDefault();
        startShowRef.current(e.shiftKey);
        return;
      }
      if (viewRef.current !== 'presenter' && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'PageDown', 'PageUp', ' '].includes(e.key)) return;
      const action = KEYS[e.key];
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, dispatch, state.library.presentations, state.selectedId]);

  const startShow = (fromCurrent: boolean) => {
    const pres = state.library.presentations.find((x) => x.id === state.selectedId);
    if (!pres) return notify('먼저 프레젠테이션을 선택하세요');
    void saveRestorePoint(state.library, 'show', Date.now(), activePlaylist(state)?.name ?? pres.title).catch(() => notify('발표는 시작했지만 복원 지점을 저장하지 못했습니다. 저장 공간을 확인하세요.'));
    dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: Date.now(), action: 'show/start', detail: activePlaylist(state)?.name ?? pres.title, device: getDevice(), account: loadSession()?.username ?? null } });
    const seq = fromCurrent && slideId ? slideSeq ?? Math.max(0, sequence(pres).findIndex((x) => x.slide.id === slideId)) : 0;
    dispatch({ type: 'live/go', presentationId: pres.id, seq });
    setView('presenter');
    presentOutput();
  };
  const endShow = () => {
    if (view === 'presenter') dispatch({ type: 'activity/record', entry: { id: crypto.randomUUID(), at: Date.now(), action: 'show/end', detail: activePlaylist(state)?.name ?? '발표', device: getDevice(), account: loadSession()?.username ?? null } });
    dispatch({ type: 'live/clearAll' });
    setView('normal');
    desktop?.endShow();
  };
  const stateRef = useRef(state);
  stateRef.current = state;
  const showVerse = async (refs: string, live: boolean) => {
    const built = await buildVerseDeck(refs, loadVerseDefaults());
    if ('error' in built) { notify(`📖 ${built.error}`); return; }
    for (const action of verseActions(stateRef.current, built.deck, live)) dispatch(action);
    notify(`📖 ${built.label}${live ? '' : ' — 준비됨'}`);
  };
  showVerseRef.current = showVerse;
  const startShowRef = useRef(startShow);
  startShowRef.current = startShow;
  const endShowRef = useRef(endShow);
  endShowRef.current = endShow;
  const viewRef = useRef(view);
  viewRef.current = view;

  const pickFiles = (kind: typeof importKind.current, accept: string) => {
    importKind.current = kind;
    if (fileRef.current) {
      fileRef.current.accept = accept;
      fileRef.current.click();
    }
  };

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    const kind = importKind.current;
    try {
      await saveRestorePoint(state.library, 'import', Date.now(), activePlaylist(state)?.name ?? '자료 가져오기');
      if (kind === 'backup') {
        notify('Restoring backup…');
        const lib = await importBackup(files[0], protectedMediaIds(latestLib.current));
        if (confirm('Replace your current library with this backup? (You can undo with ⌘Z.)')) dispatch({ type: 'library/replace', library: lib });
      } else if (kind === 'library') {
        const lib = normalizeLibrary(JSON.parse(await files[0].text()));
        if (!lib) throw new Error('Not a FreeCast library file');
        if (confirm('Replace your current library with this file? (You can undo with ⌘Z.)')) dispatch({ type: 'library/replace', library: lib });
      } else if (kind === 'lyrics') {
        const created: Presentation[] = [];
        for (const f of files) created.push(presentationFromSongFile(f.name, await f.text(), state.library.sunday.linesPerSlide));
        dispatch({ type: 'presentation/createMany', presentations: created });
        notify(`Imported ${created.length} song${created.length === 1 ? '' : 's'}`);
      } else {
        notify('Importing…');
        const approx: string[] = [];
        const toSlides = (list: File[]) => filesToSlides(list, (m) => dispatch({ type: 'media/add', media: m }), notify, (n) => approx.push(n));
        const isPptx = (f: File) => /\.pptx?$/i.test(f.name);
        let total = 0;
        // Each PowerPoint file becomes its own presentation in a new 재생목록 named after the file.
        for (const f of files.filter(isPptx)) {
          const title = f.name.replace(/\.[^.]+$/, '');
          const existing = state.library.presentations.filter((p) => p.folder === 'Imported' && p.title === title);
          if (existing.some((p) => p.protected)) throw new Error(`${title}: ${PROTECTED_MESSAGE}`);
          const slides = await toSlides([f]);
          if (existing.length > 1) throw new Error(`같은 이름의 PPT가 여러 개입니다: ${title}. 프레젠테이션 이름을 구분해 주세요.`);
          if (!slides.length) throw new Error(`${title}: 슬라이드를 읽지 못했습니다. 기존 PPT를 유지합니다.`);
          if (existing.length === 1) {
            dispatch({ type: 'presentation/update', id: existing[0].id, patch: { slides } });
            total += slides.length;
            continue;
          }
          const id = uid('p');
          dispatch({
            type: 'presentation/createMany',
            presentations: [{ id, title, slides, themeId: 'theme_classic', folder: 'Imported' }],
            playlist: { id: uid('pl'), name: title, items: [{ id: uid('pli'), presentationId: id }] },
          });
          total += slides.length;
        }
        const others = files.filter((f) => !isPptx(f));
        if (others.length) {
          const slides = await toSlides(others);
          const title = others.length === 1 ? others[0].name.replace(/\.[^.]+$/, '') : 'Imported slides';
          dispatch({ type: 'presentation/create', presentation: { id: uid('p'), title, slides, themeId: 'theme_classic', folder: 'Imported' } });
          total += slides.length;
        }
        notify(approx.length
          ? `Imported ${total} slides — ${approx.join(', ')} was imported with simplified layout; text remains editable`
          : `Imported ${total} slides`);
      }
    } catch (e) {
      notify(`Import failed: ${(e as Error).message}`);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const exportUsage = () => {
    const rows = [['date', 'time', 'title', 'ccli'], ...state.library.usage.map((u) => {
      const d = new Date(u.at);
      return [d.toISOString().slice(0, 10), d.toTimeString().slice(0, 5), u.title, u.ccli ?? ''];
    })];
    download(`freecast-song-usage-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };

  const exportPlaylistPptx = () => {
    if (!playlist) return notify('재생목록이 없습니다');
    exportPptx(state.library, { playlist }, playlist.name.replace(/\s*주일예배$/, '') || 'playlist').catch((e) => notify(String(e)));
  };
  const exportBackupZip = async () => {
    notify('Packing backup…');
    const blob = await exportBackup(state.library);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `freecast-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
  };
  const cmd: Commands = {
    open: (m) => {
      if (m === 'follow') return setFollowOn((on) => !on);
      if (m === 'sunday') setSundayStep(undefined);
      setModal(m);
    },
    editSundayStep: (step) => { setSundayStep(step); setModal('sunday'); },
    safeModeOn: safe.on,
    standbyOn: standbyConfig.on,
    followOn,
    templateMarket: marketOn,
    notify,
    pickFiles,
    exportPlaylistPptx,
    exportBackup: exportBackupZip,
    exportLibrary: () => download(`freecast-library-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...state.library, presentations: state.library.presentations.filter((p) => !p.online) }, null, 2), 'application/json'),
    exportUsage,
    clearUsage: () => confirm('Clear the song usage log?') && dispatch({ type: 'usage/clear' }),
    reloadOnline: loadOnline,
    startShow,
    endShow,
    setView,
    online,
    relayConnected: relay.connected,
    remoteCount: remotes,
    teamRequestCount: teamRequests.filter((r) => r.status === 'pending').length,
    remoteRequests: remoteControl?.clients.filter((c) => c.connected && c.requested && c.id !== remoteControl.controllerId).length ?? 0,
    view,
    slideId,
    slideSeq,
    setSlideId,
    cloud: cloud.status,
    locked,
    setLocked,
    service,
  };
  notifyRef.current = notify;

  return (
    <div className="app app-ppt">
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
      <PptLayout state={state} dispatch={dispatch} cmd={cmd} />
      {dragging && (
        <div className="drop-overlay">
          <div>
            <b>이번 주 주일예배에 바로 넣기</b>
            <span>콘티 PDF (이름에 “콘티”) → 찬양 · 가사 파일 → 찬양 · PPTX/PDF/그림 → 설교</span>
          </div>
        </div>
      )}
      {(modal === 'preparation' || modal === 'preflight') && <ServicePreparationModal mode={modal} library={state.library} playlistId={state.activePlaylistId} onClose={() => setModal(null)} onSettings={() => setModal('screens')} />}
      {modal === 'activity' && <ActivityModal library={state.library} onClose={() => setModal(null)} />}
      {modal === 'songStats' && <SongStatsModal state={state} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} />}
      {modal === 'ccli' && <CcliModal library={state.library} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} />}
      {modal === 'safeMode' && <SafeModeModal library={state.library} playlistId={state.activePlaylistId} safe={safe} onChange={setSafe} notify={notify} onClose={() => setModal(null)} />}
      {modal === 'standby' && <StandbyModal config={standbyConfig} feed={standby} onChange={setStandby} onTakeOver={takeOver} onClose={() => setModal(null)} />}
      {modal === 'templateMarket' && marketOn && <TemplateMarketModal library={state.library} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} />}
      {followOn && <FollowDock state={state} dispatch={dispatch} onClose={() => setFollowOn(false)} />}
      <StandbyBar feed={standby} onTakeOver={takeOver} onOpen={() => setModal('standby')} />
      {safe.on && <button className="safe-badge" onClick={() => setModal('safeMode')} title="예배 당일 안전 모드 켜짐">🛡 안전 모드</button>}
      <UpdateBanner />
      <AudioPlayer state={state} dispatch={dispatch} />
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}

      {modal === 'trash' && <TrashModal state={state} dispatch={dispatch} onClose={() => setModal(null)} />}
      {modal === 'rehearsal' && <RehearsalModal state={state} onPreview={setRehearsalPreview} commandRef={rehearsalCommandRef} onClose={() => setModal(null)} />}
      {modal === 'teamRequests' && <TeamRequestsModal requests={teamRequests} send={relay.send} onClose={() => setModal(null)} />}
      {modal === 'remoteControl' && <RemoteControlModal control={remoteControl} send={relay.send} onClose={() => setModal(null)} />}
      {modal === 'edit' && selected && <SlideEditorModal key={selected.id} state={state} dispatch={dispatch} presentation={selected} slideId={slideId} slideSeq={slideSeq}
        onSelect={setSlideId} onClose={() => setModal(null)} onSource={() => setModal(isSong(selected) ? 'song' : 'source')} />}
      {(modal === 'source' || modal === 'new') && (
        <EditorModal
          presentation={modal === 'new' ? null : selected}
          themes={state.library.themes}
          onClose={() => setModal(null)}
          onSave={(p, isNew) => {
            if (isNew) dispatch({ type: 'presentation/create', presentation: p });
            else dispatch({ type: 'presentation/update', id: p.id, patch: p });
          }}
        />
      )}
      {modal === 'themes' && (
        <ThemeModal themes={state.library.themes} initialId={selected?.themeId ?? state.library.themes[0].id}
          background={selected?.background ?? state.live.background} dispatch={dispatch} onClose={() => setModal(null)} />
      )}
      {modal === 'bible' && (
        <BibleModal service={service.scripture} onClose={() => setModal(null)} onCreate={(p, live) => {
          dispatch({ type: 'presentation/create', presentation: p });
          if (live) dispatch({ type: 'live/go', presentationId: p.id, seq: 0 });
          setModal(null);
        }} />
      )}
      {modal === 'ai' && <AiModal onClose={() => setModal(null)} onCreate={(p) => { dispatch({ type: 'presentation/create', presentation: p }); setModal(null); }} />}
      {(modal === 'settings' || modal === 'screens') && (
        <SettingsModal state={state} dispatch={dispatch} relayConnected={relay.connected} mixer={mixer} initialPage={modal === 'screens' ? 'outputs' : 'general'}
          onMixer={setMixer}
          onFeatures={() => setMarketOn(featureEnabled('templateMarket'))} onClose={() => setModal(null)} />
      )}
      {modal === 'sunday' && <SundayWizard key={sundayStep ?? 'all'} only={sundayStep} state={state} dispatch={dispatch} onClose={() => setModal(null)} notify={notify} service={service} />}
      {modal === 'retreat' && <RetreatWizard state={state} dispatch={dispatch} onClose={() => setModal(null)} notify={notify} />}
      {modal === 'chords' && <ChordSheetModal state={state} dispatch={dispatch} onClose={() => setModal(null)} notify={notify} />}
      {modal === 'retreatBg' && <RetreatBackgroundModal library={state.library} dispatch={dispatch} onClose={() => setModal(null)} notify={notify} />}
      {modal === 'sync' && <SyncStatusModal cloud={cloud} library={state.library} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} onAccount={() => setModal('account')} />}
      {modal === 'account' && <AccountModal cloud={cloud} onClose={() => setModal(null)} onActivity={() => setModal('activity')} onSync={() => setModal('sync')} />}
      {deviceSetup && <DeviceSetupDialog cloud={cloud} onClose={() => setDeviceSetup(false)} />}
      {(modal === 'song' || modal === 'songNew') && (
        <SongEditor library={state.library} dispatch={dispatch} song={modal === 'song' ? selected ?? null : null} notify={notify} reloadOnline={loadOnline} onClose={() => setModal(null)} />
      )}
      {modal === 'songLibrary' && (
        <SongLibraryModal songs={state.library.presentations} dispatch={dispatch} reloadOnline={loadOnline} notify={notify} onClose={() => setModal(null)}
          onEdit={(id) => { dispatch({ type: 'select', id }); setSlideId(null); setModal('edit'); }} />
      )}
      {service.review && (() => {
        const r = service.review;
        const song = r.reading.songs[r.index];
        return (
          <SongEditor key={song.id} library={state.library} dispatch={dispatch} song={null} notify={notify} reloadOnline={loadOnline} onClose={service.cancelReview}
            review={{ draft: song.draft, index: r.index, total: r.reading.songs.length, note: reviewNote(song, r), warn: song.needsReview, pageImages: song.pageImages,
              fromLibrary: song.source === 'library', webOptions: song.webOptions,
              onAccept: service.answerReview, onSkip: () => service.answerReview(null), onCancel: () => confirm('콘티 확인을 그만둘까요? 아직 예배에 넣지 않은 곡은 버려집니다.') && service.cancelReview() }} />
        );
      })()}
      {modal === 'prayer' && <PrayerSetting library={state.library} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} />}
      {modal === 'aiUsage' && <AiUsage onClose={() => setModal(null)} />}
      {modal === 'find' && (
        <FindPalette library={state.library} onClose={() => setModal(null)}
          onLive={(f) => {
            dispatch({ type: 'select', id: f.presentationId });
            dispatch({ type: 'live/go', presentationId: f.presentationId, seq: f.seq });
            setModal(null);
          }}
          onEdit={(f) => {
            dispatch({ type: 'select', id: f.presentationId });
            setSlideId(f.slideId);
            setView('normal');
            setModal(null);
          }} />
      )}
      {modal === 'restore' && (
        <RestorePointsModal library={state.library} notify={notify} onClose={() => setModal(null)}
          onRestore={(lib) => { dispatch({ type: 'library/replace', library: lib }); notify('복원했습니다 (⌘Z로 되돌릴 수 있습니다)'); }} />
      )}
      {modal === 'confession' && <ConfessionSetting library={state.library} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} />}

    </div>
  );
}
