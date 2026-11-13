// Slide Show › 슬라이드 쇼 녹화 (narration + timings) and 레이저 포인터. Both work on the live show:
// the presenter's window records / points, the audience window shows the dot.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Dispatch } from 'react';
import type { Action, AppState } from '../../domain/reducer';
import { openLiveChannel } from '../../domain/sync';
import { LASER_STALE_MS, laserFromMessage, laserMessage, laserPoint, laserShown, type LaserPoint } from '../../domain/laserPointer';
import { applyRecording, clearRecording, clock, cuesFromRecording, enterSlide, finishRecording, hasRecording, narrationClip, narrationCount, planNarration, slideTimings, startRecording, type Recording } from '../../domain/narration';
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
// One MediaRecorder runs for the whole show, so there is no break in the sound where the slide changes; each slide's
// part of it is stored as cue offsets (slide.narrationCue).
interface Track { mr: MediaRecorder; done: Promise<Blob>; startedAt: number }

function Recorder({ state, dispatch, notify }: { state: AppState; dispatch: Dispatch<Action>; notify: (m: string) => void }) {
  const now = useNow(1000);
  const latest = useRef(state);
  latest.current = state;
  const presId = useRef(state.cursor?.presentationId ?? null);
  const slideId = state.live.slide?.id ?? null;
  const session = useRef<Recording>(startRecording());
  const stream = useRef<MediaStream | null>(null);
  const track = useRef<Track | null>(null);
  const startedAt = useRef(Date.now());
  const [micError, setMicError] = useState(false);

  const beginTrack = () => {
    if (!stream.current || track.current) return;
    const mr = new MediaRecorder(stream.current);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((res) => { mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); });
    const t: Track = { mr, done, startedAt: Date.now() };
    mr.onstart = () => { t.startedAt = Date.now(); };
    mr.start();
    track.current = t;
  };

  // The microphone: the show is timed even when it cannot be opened.
  useEffect(() => {
    let dead = false;
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => {
      if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      beginTrack();
    }).catch(() => setMicError(true));
    if (!navigator.mediaDevices?.getUserMedia) setMicError(true);
    return () => { dead = true; void finish(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every slide change is only noted (when it happened); the recorder keeps running.
  useEffect(() => { session.current = enterSlide(session.current, slideId, Date.now()); }, [slideId]);

  async function finish() {
    const t = track.current;
    track.current = null;
    if (t && t.mr.state !== 'inactive') t.mr.stop();
    session.current = finishRecording(session.current, Date.now());
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    const timings = slideTimings(session.current);
    const pres = latest.current.library.presentations.find((x) => x.id === presId.current);
    if (!pres || !Object.keys(timings).length) return;
    if (pres.protected) { notify('보호된 자료라 녹화를 저장하지 않았습니다'); return; }
    let audio: { mediaId: string; cues: ReturnType<typeof cuesFromRecording> } | undefined;
    const blob = t ? await t.done : null;
    if (t && blob && blob.size >= 200) {
      const cues = cuesFromRecording(session.current, t.startedAt);
      if (Object.keys(cues).length) {
        const mediaId = uid('m');
        await putMedia(mediaId, blob);
        dispatch({ type: 'media/add', media: { id: mediaId, name: '슬라이드 쇼 녹음', type: 'audio', backgroundHidden: true } });
        audio = { mediaId, cues };
      }
    }
    const fresh = latest.current.library.presentations.find((x) => x.id === presId.current) ?? pres;
    dispatch({ type: 'presentation/update', id: pres.id, patch: { slides: applyRecording(fresh.slides, timings, {}, audio), showSetup: { ...fresh.showSetup, manual: undefined } } });
    notify(`슬라이드 쇼 녹화를 저장했습니다 — 슬라이드 ${Object.keys(timings).length}장의 시간, 내레이션 ${audio ? Object.keys(audio.cues).length : 0}장`);
  }

  return (
    <div className="rec-badge" role="status">
      <span className="rec-dot" /> 녹화 중 {clock((now - startedAt.current) / 1000)}
      {micError && <span className="rec-warn" title="마이크를 사용할 수 없어 슬라이드 시간만 기록합니다">마이크 없음</span>}
      <button type="button" onClick={stopNarrationRecording}>녹화 중지</button>
    </div>
  );
}

/**
 * Plays the narration of the slide on screen. A part of a continuous recording is played from a decoded buffer (a
 * recorded WebM cannot be seeked reliably) and runs on across slide changes where the next part follows on, so there
 * is no gap; a clip of its own (older recordings) simply starts with its slide.
 */
class NarrationPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private src: AudioBufferSourceNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private mediaId = '';
  private offset = 0;
  private startedAt = 0;
  private token = 0;

  private position(): number | null {
    return this.src && this.ctx ? this.offset + (this.ctx.currentTime - this.startedAt) : null;
  }
  private stopAll() {
    try { this.src?.stop(); } catch { /* already ended */ }
    this.src = null;
    this.audio?.pause();
    this.audio = null;
  }
  private load(mediaId: string): Promise<AudioBuffer | null> {
    let b = this.buffers.get(mediaId);
    if (!b) {
      b = (async () => {
        const url = await mediaUrl(mediaId);
        if (!url || !this.ctx) return null;
        return this.ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      })().catch(() => null);
      this.buffers.set(mediaId, b);
    }
    return b;
  }

  async play(clip: ReturnType<typeof narrationClip>) {
    const token = ++this.token;
    const pos = this.position();
    const plan = planNarration(pos === null ? null : { mediaId: this.mediaId, position: pos }, clip);
    if (plan.kind === 'keep') { this.stopAt(plan.stopAt); return; }
    this.stopAll();
    if (plan.kind === 'stop') return;
    if (!clip?.cue) {
      // A clip of its own: from its start, as before.
      const url = await mediaUrl(plan.mediaId);
      if (!url || token !== this.token) return;
      this.audio = new Audio(url);
      void this.audio.play().catch(() => undefined);
      return;
    }
    this.ctx ??= new AudioContext();
    const buffer = await this.load(plan.mediaId);
    if (!buffer || token !== this.token || !this.ctx) return;
    void this.ctx.resume().catch(() => undefined);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.start(0, Math.min(plan.offset, Math.max(0, buffer.duration - 0.01)));
    this.src = src;
    this.mediaId = plan.mediaId;
    this.offset = plan.offset;
    this.startedAt = this.ctx.currentTime;
    this.stopAt(plan.stopAt);
  }

  /** Stop a little after the slide's part ends (the next slide may carry it on, which moves this again). */
  private stopAt(trackSec: number | null) {
    if (!this.src || !this.ctx) return;
    try { this.src.stop(trackSec === null ? undefined : this.startedAt + (trackSec - this.offset) + 0.4); } catch { /* not started yet */ }
  }

  close() {
    this.token++;
    this.stopAll();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** Mounted in the presenter window: the recorder while 슬라이드 쇼 녹화 is on, and playback of the narrations otherwise. */
export function NarrationHost({ state, dispatch, cmd }: { state: AppState; dispatch: Dispatch<Action>; cmd: Commands }) {
  const recording = recordingOn.use();
  const pres = state.cursor ? state.library.presentations.find((x) => x.id === state.cursor!.presentationId) : null;
  const clip = recording ? null : narrationClip(state.live.slide, pres);
  const seq = state.cursor?.seq;
  const player = useRef<NarrationPlayer | null>(null);
  useEffect(() => {
    player.current ??= new NarrationPlayer();
    void player.current.play(clip);
  }, [clip?.mediaId, clip?.cue?.startSec, clip?.cue?.endSec, seq, state.live.slide?.id]);
  useEffect(() => () => { player.current?.close(); player.current = null; }, []);
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
