// Receiving side of the sermon timer (phone remote and stage display): the presenter's `timer` message arrives over the
// same-computer channel or the relay; this keeps counting from the moment it arrived and draws a small coloured chip.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSpan, paceText, parseTimerMessage, viewOfTimerMessage, type PacingView, type TimerMessage } from '../domain/pacing';
import { openLiveChannel } from '../domain/sync';
import { useNow } from './hooks';

type On = Extract<TimerMessage, { running: boolean }>;

/** The presenter's timer as this device sees it, or null when none is running. `receive` takes a relay message. */
export function useTimerFeed(): { view: PacingView | null; receive: (raw: unknown) => void } {
  const [got, setGot] = useState<{ m: On; at: number } | null>(null);
  const receive = useCallback((raw: unknown) => {
    const m = parseTimerMessage(raw);
    if (!m) return;
    setGot('off' in m ? null : { m, at: Date.now() });
  }, []);
  const recv = useRef(receive);
  recv.current = receive;
  useEffect(() => {
    const ch = openLiveChannel((m) => { if (m.type === 'timer') recv.current(m); });
    const net = (e: Event) => recv.current((e as CustomEvent).detail);
    window.addEventListener('lightcast:timer', net);
    return () => { ch.close(); window.removeEventListener('lightcast:timer', net); };
  }, []);
  const now = useNow(1000);
  return { view: got ? viewOfTimerMessage(got.m, got.at, now) : null, receive };
}

/** Compact timer: remaining time in the zone colour, with the pace when the presenter reports one. */
export function PacingChip({ view, className = '' }: { view: PacingView | null; className?: string }) {
  if (!view) return null;
  const over = view.remainingMs < 0;
  return (
    <span className={`pacing-chip pacing-${view.zone} ${className}`} role="timer" aria-label={`설교 시간 ${over ? '초과' : '남음'} ${formatSpan(Math.abs(view.remainingMs))}`}>
      <small>{over ? '초과' : '남은 시간'}</small> {formatSpan(Math.abs(view.remainingMs))}
      {view.pace && <em className={`pacing-pace pacing-pace-${view.pace.kind}`}>{paceText(view.pace)}</em>}
    </span>
  );
}
