// Slide Show › 슬라이드 쇼 녹화 (narration + timings) and 레이저 포인터. Both work on the live show:
// the presenter's window records / points, the audience window shows the dot.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Dispatch } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import { openLiveChannel } from '../../domain/sync';
import { LASER_STALE_MS, laserFromMessage, laserMessage, laserPoint, laserShown, type LaserPoint } from '../../domain/laserPointer';
import { applyRecording, clearRecording, clock, enterSlide, finishRecording, hasRecording, narrationCount, narrationToPlay, slideTimings, startRecording, type Recording } from '../../domain/narration';
import { deleteMedia, mediaUrl, putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { useNow } from '../hooks';
import type { Ed } from './editor';
import type { Commands } from './commands';
import { Col, DropButton, Group, MenuItem, MenuSep, Small } from './ribbonParts';

// ── Tiny shared stores (the ribbon and the presenter window both read them) ─────────────────────
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => { value = v; subs.forEach((f) => f()); },
    use: () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => value),
  };
}
const laserOn = store(false);
const recordingOn = store(false);
export const toggleLaser = () => laserOn.set(!laserOn.get());
export const startNarrationRecording = () => recordingOn.set(true);
export const stopNarrationRecording = () => recordingOn.set(false);

// ── Laser pointer ───────────────────────────────────────────────────────────────────────────────
let channel: ReturnType<typeof openLiveChannel> | null = null;
let lastSent = false;
function sendLaser(p: LaserPoint | null) {
  if (!p && !lastSent) return;
  lastSent = !!p;
  try { (channel ??= openLiveChannel(() => undefined)).post(laserMessage(p)); } catch { /* no channel: no audience window to point on */ }
}

/** The presenter's current slide: Ctrl + moving the mouse over it (or the menu's toggle) points on the audience view. */
export function LaserArea({ children, cmd }: { children: ReactNode; cmd: Commands }) {
  const on = laserOn.use();
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key === 'Control' && !laserOn.get()) sendLaser(null); };
    const blur = () => sendLaser(null);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); sendLaser(null); };
  }, []);
  useEffect(() => { if (!on) sendLaser(null); }, [on]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);
  const move = (e: React.MouseEvent) => {
    const frame = ref.current?.querySelector('.canvas-frame') ?? ref.current;
    sendLaser(frame && laserShown(e.ctrlKey, on) ? laserPoint(frame.getBoundingClientRect(), e.clientX, e.clientY) : null);
  };
  return (
    <div ref={ref} className={`laser-area ${on ? 'laser-on' : ''}`} onMouseMove={move} onMouseLeave={() => sendLaser(null)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      title="Ctrl을 누른 채 마우스를 움직이면 청중 화면에 레이저 포인터가 보입니다">
      {children}
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { toggleLaser(); setMenu(null); }}>{on ? '✓ ' : ''}레이저 포인터 (Ctrl+이동)</button>
          <button type="button" onClick={() => { setMenu(null); cmd.endShow(); }}>쇼 마침</button>
        </div>
      )}
    </div>
  );
}

/** Audience window: the red dot, from the presenter's window or from Ctrl + moving the mouse right here. */
export function useLaserDot(): LaserPoint | null {
  const [pt, setPt] = useState<LaserPoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const show = (p: LaserPoint | null) => {
      clearTimeout(timer.current);
      setPt(p);
      if (p) timer.current = setTimeout(() => setPt(null), LASER_STALE_MS);
    };
    const ch = openLiveChannel((m) => { if (m.type === 'laser') show(laserFromMessage(m)); });
    const move = (e: MouseEvent) => {
      if (!e.ctrlKey) return;
      const r = document.querySelector('.output-canvas')?.getBoundingClientRect();
      show(r ? laserPoint(r, e.clientX, e.clientY) : null);
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Control') show(null); };
    window.addEventListener('mousemove', move);
    window.addEventListener('keyup', up);
    return () => { clearTimeout(timer.current); ch.close(); window.removeEventListener('mousemove', move); window.removeEventListener('keyup', up); };
  }, []);
  return pt;
}

export function LaserDot({ point }: { point: LaserPoint | null }) {
  const r = point ? document.querySelector('.output-canvas')?.getBoundingClientRect() : null;
  if (!point || !r) return null;
  return <div className="laser-dot" style={{ left: r.left + point.x * r.width, top: r.top + point.y * r.height }} />;
}

// ── Record Slide Show ───────────────────────────────────────────────────────────────────────────
interface Clip { mr: MediaRecorder; slideId: string; done: Promise<Blob> }

function Recorder({ state, dispatch, notify }: { state: AppState; dispatch: Dispatch<Action>; notify: (m: string) => void }) {
  const now = useNow(1000);
  const latest = useRef(state);
  latest.current = state;
  const presId = useRef(state.cursor?.presentationId ?? null);
  const slideId = state.live.slide?.id ?? null;
  const session = useRef<Recording>(startRecording());
  const stream = useRef<MediaStream | null>(null);
  const cur = useRef<Clip | null>(null);
  const takes = useRef(new Map<string, Promise<Blob>>());
  const startedAt = useRef(Date.now());
  const [micError, setMicError] = useState(false);

  const endClip = () => {
    const c = cur.current;
    cur.current = null;
    if (!c) return;
    if (c.mr.state !== 'inactive') c.mr.stop();
    takes.current.set(c.slideId, c.done);
  };
  const beginClip = (id: string | null) => {
    if (!stream.current || !id) return;
    const mr = new MediaRecorder(stream.current);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((res) => { mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); });
    mr.start();
    cur.current = { mr, slideId: id, done };
  };
  const slideRef = useRef(slideId);
  slideRef.current = slideId;

  // The microphone: the show is timed even when it cannot be opened.
  useEffect(() => {
    let dead = false;
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => {
      if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      beginClip(slideRef.current);
    }).catch(() => setMicError(true));
    if (!navigator.mediaDevices?.getUserMedia) setMicError(true);
    return () => { dead = true; void finish(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every slide change closes the clip of the slide that was on screen and opens the next.
  useEffect(() => {
    session.current = enterSlide(session.current, slideId, Date.now());
    endClip();
    beginClip(slideId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  async function finish() {
    endClip();
    session.current = finishRecording(session.current, Date.now());
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    const timings = slideTimings(session.current);
    const pres = latest.current.library.presentations.find((x) => x.id === presId.current);
    if (!pres || !Object.keys(timings).length) return;
    if (pres.protected) { notify('보호된 자료라 녹화를 저장하지 않았습니다'); return; }
    const clips: Record<string, string> = {};
    for (const [id, done] of takes.current) {
      const blob = await done;
      if (blob.size < 200) continue;
      const mediaId = uid('m');
      await putMedia(mediaId, blob);
      dispatch({ type: 'media/add', media: { id: mediaId, name: '슬라이드 쇼 녹음', type: 'audio', backgroundHidden: true } });
      clips[id] = mediaId;
    }
    const fresh = latest.current.library.presentations.find((x) => x.id === presId.current) ?? pres;
    dispatch({ type: 'presentation/update', id: pres.id, patch: { slides: applyRecording(fresh.slides, timings, clips), showSetup: { ...fresh.showSetup, manual: undefined } } });
    notify(`슬라이드 쇼 녹화를 저장했습니다 — 슬라이드 ${Object.keys(timings).length}장의 시간, 내레이션 ${Object.keys(clips).length}개`);
  }

  return (
    <div className="rec-badge" role="status">
      <span className="rec-dot" /> 녹화 중 {clock((now - startedAt.current) / 1000)}
      {micError && <span className="rec-warn" title="마이크를 사용할 수 없어 슬라이드 시간만 기록합니다">마이크 없음</span>}
      <button type="button" onClick={stopNarrationRecording}>녹화 중지</button>
    </div>
  );
}

/** Mounted in the presenter window: the recorder while 슬라이드 쇼 녹화 is on, and playback of the narrations otherwise. */
export function NarrationHost({ state, dispatch, cmd }: { state: AppState; dispatch: Dispatch<Action>; cmd: Commands }) {
  const recording = recordingOn.use();
  const pres = state.cursor ? state.library.presentations.find((x) => x.id === state.cursor!.presentationId) : null;
  const clip = recording ? null : narrationToPlay(state.live.slide, pres);
  const seq = state.cursor?.seq;
  useEffect(() => {
    if (!clip) return;
    let dead = false;
    let audio: HTMLAudioElement | null = null;
    void mediaUrl(clip).then((u) => {
      if (dead || !u) return;
      audio = new Audio(u);
      void audio.play().catch(() => undefined);
    });
    return () => { dead = true; audio?.pause(); };
  }, [clip, seq, state.live.slide?.id]);
  useEffect(() => () => stopNarrationRecording(), []);
  return recording ? <Recorder state={state} dispatch={dispatch} notify={cmd.notify} /> : null;
}

// ── Ribbon: 슬라이드 쇼 › 녹화 · 레이저 포인터 ─────────────────────────────────────────────────────
export function ShowToolsGroup({ ed }: { ed: Ed }) {
  const { p, cmd, slide } = ed;
  const laser = laserOn.use();
  const recording = recordingOn.use();
  const locked = !p || !!p.protected || !ed.canEdit;
  const record = (fromCurrent: boolean) => { cmd.startShow(fromCurrent); startNarrationRecording(); };
  const clear = (scope: 'all' | { slideId: string }) => {
    if (!p) return;
    const r = clearRecording(p.slides, scope);
    ed.updatePres({ slides: r.slides });
    r.orphaned.forEach((id) => void deleteMedia(id).catch(() => undefined));
    cmd.notify(scope === 'all' ? '모든 슬라이드의 녹음과 시간을 지웠습니다' : '이 슬라이드의 녹음과 시간을 지웠습니다');
  };
  return (
    <Group label="녹화">
      <DropButton big icon="●" label="슬라이드 쇼 녹화" title="내레이션(마이크)과 슬라이드 시간을 녹화합니다" disabled={locked || recording} active={recording} render={(close) => (
        <>
          <MenuItem label="현재 슬라이드부터 녹화 시작…" onClick={() => { close(); record(true); }} />
          <MenuItem label="처음부터 녹화 시작…" onClick={() => { close(); record(false); }} />
          <MenuSep />
          <MenuItem label="현재 슬라이드의 녹음 지우기" disabled={!slide || !(slide.narration || slide.autoAdvance)} onClick={() => { close(); if (slide) clear({ slideId: slide.id }); }} />
          <MenuItem label="모든 슬라이드의 녹음 및 시간 지우기" disabled={!hasRecording(p)} onClick={() => { close(); clear('all'); }} />
        </>
      )} />
      <Col>
      <Small icon="🎙" label={`내레이션 ${narrationCount(p)}개`} title="녹음된 내레이션이 있는 슬라이드 수" disabled />
      <Small icon={'◉'} label="레이저 포인터" title="청중 화면에 빨간 점이 마우스를 따라갑니다 (쇼에서는 Ctrl을 누른 채 이동)" active={laser} onClick={toggleLaser} />
      </Col>
    </Group>
  );
}
