import { useEffect, useMemo } from 'react';
import type { StageLayout } from '../domain/types';
import { useLiveFeed, useNow } from '../ui/hooks';
import { formatClock, timerValue } from '../domain/timers';
import { hasChords, stripChords } from '../domain/lyrics';
import { liveChordShower } from '../domain/chordChart';
import { StageChords } from '../ui/StageChords';
import { DEFAULT_STAGE_LAYOUTS } from '../domain/defaults';
import { SlideCanvas } from '../ui/SlideCanvas';
import { liveCanvasProps } from '../ui/liveProps';

/**
 * Confidence monitor. `?layout=<id>` picks a stage layout (edit them in 🖥 Screens):
 * clock, timers, current/next slide, notes, live screen preview, chords, video countdown.
 */
export function StageView() {
  const live = useLiveFeed();
  const now = useNow(250);
  const id = new URLSearchParams(location.search).get('layout') ?? 'lyrics';
  useEffect(() => {
    document.title = 'LightCast — Stage';
  }, []);

  const layouts = (live as { stageLayouts?: StageLayout[] } | null)?.stageLayouts ?? DEFAULT_STAGE_LAYOUTS;
  const L = layouts.find((l) => l.id === id) ?? DEFAULT_STAGE_LAYOUTS.find((l) => l.id === id) ?? DEFAULT_STAGE_LAYOUTS[0];
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const running = (live?.timers ?? []).filter((t) => t.running || t.kind === 'countdownTo');
  const slide = live?.slide;
  // Key change and capo from the operator: the chords shown are the shapes to play.
  const show = useMemo(() => liveChordShower(live ?? {}), [live?.songKey, live?.chordShift, live?.capo]);
  const current = slide ? [slide.title, slide.text.replace(/\*\*/g, '')].filter(Boolean).join('\n') : null;
  const videoLeft = live?.video.endsAt ? live.video.endsAt - now : null;
  const onlyClock = !L.current && !L.next && !L.notes && !L.preview;

  return (
    <div className="stage-root" style={{ fontSize: `${L.scale * 100}%` }}>
      <header className="stage-top">
        {L.clock && <span className="stage-clock">{clock}</span>}
        <span className="stage-title">{live?.title ?? ''}{slide?.group ? ` · ${slide.group}` : ''}</span>
        {L.chords && (!!live?.chordShift || !!live?.capo) && (
          <span className="stage-timer"><small>Key</small> {live?.chordShift ? `${live.chordShift > 0 ? '+' : ''}${live.chordShift}` : '±0'}{live?.capo ? ` · Capo ${live.capo}` : ''}</span>
        )}
        {L.videoCountdown && videoLeft != null && videoLeft > 0 && <span className="stage-timer"><small>Video</small> {formatClock(-videoLeft)}</span>}
        {L.timers && running.slice(0, 3).map((t) => {
          const v = timerValue(t, now);
          return <span key={t.id} className={`stage-timer ${v < 0 && t.kind !== 'elapsed' ? 'over' : ''}`}><small>{t.name}</small> {formatClock(v)}</span>;
        })}
      </header>
      {onlyClock ? (
        <section className="stage-big-clock">
          <div>{clock}</div>
          {running[0] && <div className="stage-big-timer">{formatClock(timerValue(running[0], now))}</div>}
        </section>
      ) : (
        <div className={`stage-body ${L.preview ? 'with-preview' : ''}`}>
          {L.preview && live && <div className="stage-preview"><SlideCanvas {...liveCanvasProps(live)} /></div>}
          <div className="stage-text">
            {L.current && <section className="stage-current">{current ? (L.chords && hasChords(current) ? <StageChords text={current} show={show} /> : stripChords(current)) : <span className="dim">—</span>}</section>}
            {L.notes && <section className="stage-next stage-notes"><label>Notes</label><div>{slide?.notes || <span className="dim">No notes</span>}</div></section>}
            {L.next && <section className="stage-next"><label>Next</label><div>{live?.nextText ? stripChords(live.nextText.replace(/\*\*/g, '')) : <span className="dim">End</span>}</div></section>}
          </div>
        </div>
      )}
      {live?.stageMessage && <footer className="stage-message stage-only">🎤 {live.stageMessage}</footer>}
      {live?.message && <footer className="stage-message">{live.message}</footer>}
    </div>
  );
}
