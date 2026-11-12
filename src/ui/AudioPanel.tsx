import { useEffect, useRef, useState, type Dispatch } from 'react';
import { atEnd, playStart, playVolume } from '../domain/mediaPlayback';
import type { Action, AppState } from '../domain/reducer';
import { putMedia } from '../domain/media';
import { uid } from '../domain/lyrics';
import { useMediaUrl } from './hooks';
import { MarkerEditor, useMarkerTrigger } from './markers';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
}

/** Background music / walk-in audio played from the operator computer. */
export function AudioPanel({ state, dispatch }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const tracks = state.library.media.filter((m) => m.type === 'audio');
  const add = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (!file.type.startsWith('audio/')) continue;
      const id = uid('m');
      await putMedia(id, file);
      dispatch({ type: 'media/add', media: { id, name: file.name, type: 'audio' } });
    }
    if (input.current) input.current.value = '';
  };
  return (
    <div className="stack">
      {tracks.map((t) => (
        <div key={t.id} className={`list-item ${state.audio.mediaId === t.id ? 'selected' : ''}`} onClick={() => dispatch({ type: 'audio/play', mediaId: t.id })}>
          <span className="truncate">♪ {t.name}</span>
          <button className="mini-btn" onClick={(e) => { e.stopPropagation(); dispatch({ type: 'media/remove', id: t.id }); }}>✕</button>
        </div>
      ))}
      {!tracks.length && <div className="empty">No audio yet</div>}
      <button onClick={() => input.current?.click()}>＋ Add audio</button>
      <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}

/** Always-mounted player that follows `state.audio`, with fade-out on stop. */
export function AudioPlayer({ state, dispatch }: Props) {
  const url = useMediaUrl(state.audio.mediaId);
  const ref = useRef<HTMLAudioElement>(null);
  const [volume, setVolume] = useState(0.8);
  const [time, setTime] = useState({ cur: 0, dur: 0, paused: true });
  const [auto, setAuto] = useState(() => localStorage.getItem('freecast.audioAuto') === '1');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [sink, setSink] = useState(() => localStorage.getItem('freecast.audioSink') ?? '');
  const tracks = state.library.media.filter((m) => m.type === 'audio');
  const track = state.library.media.find((m) => m.id === state.audio.mediaId);
  const fireMarkers = useMarkerTrigger(track?.markers, dispatch);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audiooutput'))).catch(() => undefined);
  }, [url]);
  useEffect(() => {
    const a = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    a?.setSinkId?.(sink).catch(() => undefined);
  }, [sink, url]);
  const onEnded = () => {
    if (state.audio.playback?.loop && ref.current) { ref.current.currentTime = playStart(state.audio.playback); void ref.current.play().catch(() => undefined); return; }
    const i = tracks.findIndex((t) => t.id === state.audio.mediaId);
    if (auto && i >= 0 && i + 1 < tracks.length) dispatch({ type: 'audio/play', mediaId: tracks[i + 1].id });
  };

  useEffect(() => {
    const a = ref.current;
    if (!a || !url) return;
    const pb = state.audio.playback;
    a.volume = playVolume(pb, playStart(pb), a.duration || 0, volume);
    a.currentTime = playStart(pb);
    a.play().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, state.audio.nonce]);

  // An audio object's own playback: its trimmed span, fades, volume and loop (Insert › Audio › 재생).
  useEffect(() => {
    const a = ref.current;
    const pb = state.audio.playback;
    if (!a) return;
    if (!pb) { a.volume = volume; return; }
    const t = setInterval(() => {
      if (a.paused) return;
      const d = a.duration || 0;
      a.volume = playVolume(pb, a.currentTime, d, volume);
      const end = atEnd(a.currentTime, pb, d);
      if (end === 'loop') a.currentTime = playStart(pb);
      else if (end !== 'play') { a.pause(); a.currentTime = playStart(pb); }
    }, 50);
    return () => clearInterval(t);
  }, [volume, url, state.audio.nonce, state.audio.playback]);

  const fadeOut = () => {
    const a = ref.current;
    if (!a) return;
    const start = a.volume;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 2500);
      a.volume = start * (1 - k);
      if (k < 1) requestAnimationFrame(step);
      else dispatch({ type: 'audio/play', mediaId: null });
    };
    requestAnimationFrame(step);
  };

  if (!url) return null;
  return (
    <div className="audio-bar">
      <audio ref={ref} src={url} onEnded={onEnded} onTimeUpdate={(e) => { fireMarkers(e.currentTarget.currentTime); setTime({ cur: e.currentTarget.currentTime, dur: e.currentTarget.duration || 0, paused: e.currentTarget.paused }); }} onPause={(e) => setTime((t) => ({ ...t, paused: e.currentTarget.paused }))} onPlay={() => setTime((t) => ({ ...t, paused: false }))} />
      <span className="truncate small">♪ {track?.name}</span>
      <button className="mini-btn" onClick={() => (ref.current?.paused ? ref.current.play() : ref.current?.pause())}>{time.paused ? '▶' : '❚❚'}</button>
      <progress max={time.dur || 1} value={time.cur} />
      <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} title="Volume" />
      <label className="check small" title="Play the next track automatically"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); localStorage.setItem('freecast.audioAuto', e.target.checked ? '1' : '0'); }} />next</label>
      {devices.length > 1 && (
        <select className="small" value={sink} title="Audio output" onChange={(e) => { setSink(e.target.value); localStorage.setItem('freecast.audioSink', e.target.value); }}>
          {devices.map((d) => <option key={d.deviceId} value={d.deviceId === 'default' ? '' : d.deviceId}>{d.label || 'Output'}</option>)}
        </select>
      )}
      <button className="mini-btn" title="Fade out" onClick={fadeOut}>Fade</button>
      <button className="mini-btn" title="Stop" onClick={() => dispatch({ type: 'audio/play', mediaId: null })}>■</button>
      {track && <MarkerEditor media={track} t={time.cur} macros={state.library.macros} dispatch={dispatch} />}
    </div>
  );
}
