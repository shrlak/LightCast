// Slide Show › 설교 시간(페이싱): a target-time countdown with optional checkpoints and a pace indicator.
// Pure logic only: settings (kept per presentation), the running clock, planned time per slide, the pace
// (ahead / on track / behind), colour zones, the 5- and 1-minute flash marks and the small `timer` message that
// goes to phones and stage displays.

export const DEFAULT_TARGET_MIN = 30;
export const MIN_TARGET_MIN = 1;
export const MAX_TARGET_MIN = 600;
export const MAX_CHECKPOINTS = 40;

/** Planned elapsed minutes when the speaker should ARRIVE at a slide (slide = its number in the show, counting from 1). */
export interface Checkpoint { slide: number; min: number }
export interface PacingSettings { targetMin: number; checkpoints: Checkpoint[]; flash: boolean }
export const defaultPacing = (targetMin = DEFAULT_TARGET_MIN): PacingSettings => ({ targetMin, checkpoints: [], flash: true });

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Anything read back from storage: a bad value falls back to the default. Checkpoints are rounded, kept inside the
 * target, sorted by slide and by time (a later slide never has an earlier time), one per slide.
 */
export function parsePacing(raw: unknown, fallbackTargetMin = DEFAULT_TARGET_MIN): PacingSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = num(o.targetMin);
  const targetMin = t === null ? fallbackTargetMin : Math.min(MAX_TARGET_MIN, Math.max(MIN_TARGET_MIN, Math.round(t)));
  const bySlide = new Map<number, number>();
  if (Array.isArray(o.checkpoints)) {
    for (const c of o.checkpoints.slice(0, MAX_CHECKPOINTS * 2)) {
      const slide = num((c as Checkpoint)?.slide);
      const min = num((c as Checkpoint)?.min);
      if (slide === null || min === null || slide < 2 || slide > 9999) continue; // arriving at slide 1 is minute 0
      bySlide.set(Math.round(slide), Math.min(targetMin, Math.max(0, Math.round(min * 10) / 10)));
    }
  }
  let last = 0;
  const checkpoints = [...bySlide.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_CHECKPOINTS).map(([slide, min]) => {
    last = Math.max(last, min);
    return { slide, min: last };
  });
  return { targetMin, checkpoints, flash: o.flash !== false };
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────
export interface PacingClock { running: boolean; startedAt: number | null; accumulatedMs: number }
export const idleClock = (): PacingClock => ({ running: false, startedAt: null, accumulatedMs: 0 });
export const elapsedMs = (c: PacingClock, now: number): number => Math.max(0, c.accumulatedMs + (c.running && c.startedAt != null ? now - c.startedAt : 0));
export const startClock = (c: PacingClock, now: number): PacingClock => (c.running ? c : { ...c, running: true, startedAt: now });
export const pauseClock = (c: PacingClock, now: number): PacingClock => (c.running ? { running: false, startedAt: null, accumulatedMs: elapsedMs(c, now) } : c);
export const resetClock = (): PacingClock => idleClock();

// ── Planned time ─────────────────────────────────────────────────────────────────────────────────
/**
 * Planned elapsed ms when the speaker arrives at slide index `i` (0-based) of `total` slides. Between checkpoints the
 * plan is linear; with no checkpoints it is linear over the whole show (slide 0 at 0, the end at the target).
 */
export function plannedAt(i: number, total: number, targetMs: number, checkpoints: Checkpoint[]): number {
  const last = Math.max(1, total);
  const points: [number, number][] = [[0, 0]];
  for (const c of checkpoints) {
    const idx = c.slide - 1;
    if (idx > 0 && idx < last && idx > points[points.length - 1][0]) points.push([idx, Math.min(targetMs, c.min * 60_000)]);
  }
  points.push([last, targetMs]);
  const x = Math.min(Math.max(i, 0), last);
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return targetMs;
}

export type PaceKind = 'ahead' | 'on' | 'behind';
export interface Pace { kind: PaceKind; /** Positive = behind the plan, negative = ahead. Zero while the time is inside the slide's own window. */ deltaMs: number }

/**
 * Pace on slide `slideIndex`: the speaker is on track while the elapsed time lies between the planned arrival at this
 * slide and at the next one. Earlier is ahead, later is behind; a small tolerance (30 s, or 3 % of the target) is allowed.
 */
export function paceOf(elapsed: number, slideIndex: number, total: number, targetMs: number, checkpoints: Checkpoint[]): Pace {
  const from = plannedAt(slideIndex, total, targetMs, checkpoints);
  const to = plannedAt(slideIndex + 1, total, targetMs, checkpoints);
  const delta = elapsed < from ? elapsed - from : elapsed > to ? elapsed - to : 0;
  const tol = Math.max(30_000, targetMs * 0.03);
  return { kind: delta > tol ? 'behind' : delta < -tol ? 'ahead' : 'on', deltaMs: delta };
}

export const PACE_LABEL: Record<PaceKind, string> = { ahead: '빠름', on: '순조', behind: '늦음' };

/** "2분 빠름", "순조", "1분 30초 늦음". */
export function paceText(p: Pace): string {
  if (p.kind === 'on') return PACE_LABEL.on;
  const s = Math.round(Math.abs(p.deltaMs) / 1000);
  const m = Math.floor(s / 60);
  const span = m ? `${m}분${s % 60 ? ` ${s % 60}초` : ''}` : `${s}초`;
  return `${span} ${PACE_LABEL[p.kind]}`;
}

// ── Colour and flash ─────────────────────────────────────────────────────────────────────────────
export type Zone = 'green' | 'yellow' | 'red';
/** Yellow in the last 5 minutes (a quarter of the target for short talks), red once over. */
export function zoneOf(remainingMs: number, targetMs: number): Zone {
  if (remainingMs < 0) return 'red';
  return remainingMs <= Math.min(5 * 60_000, targetMs * 0.25) ? 'yellow' : 'green';
}

export const FLASH_MARKS = [5 * 60_000, 60_000] as const;
/** The 5- or 1-minute mark that was just crossed going down (once each), or null. Short targets skip marks they start inside. */
export function flashMark(prevRemainingMs: number, remainingMs: number, targetMs: number): number | null {
  for (const mark of FLASH_MARKS) {
    if (targetMs > mark && prevRemainingMs > mark && remainingMs <= mark) return mark;
  }
  return null;
}

/** 1:05, 12:00, 1:02:03; a negative value (over time) keeps its minus sign. */
export function formatSpan(ms: number): string {
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

// ── Everything the presenter view shows, in one place ────────────────────────────────────────────
export interface PacingView {
  elapsedMs: number; remainingMs: number; targetMs: number; zone: Zone; pace: Pace | null; running: boolean;
}
export function pacingView(clock: PacingClock, s: PacingSettings, now: number, slideIndex: number | null, total: number): PacingView {
  const targetMs = s.targetMin * 60_000;
  const elapsed = elapsedMs(clock, now);
  const started = clock.running || clock.accumulatedMs > 0;
  return {
    elapsedMs: elapsed, remainingMs: targetMs - elapsed, targetMs, zone: zoneOf(targetMs - elapsed, targetMs), running: clock.running,
    pace: started && slideIndex !== null && total > 0 ? paceOf(elapsed, slideIndex, total, targetMs, s.checkpoints) : null,
  };
}

// ── The message to phones and stage displays ─────────────────────────────────────────────────────
export type TimerMessage =
  | { type: 'timer'; running: boolean; elapsedMs: number; targetMs: number; pace?: PaceKind; paceMs?: number }
  | { type: 'timer'; off: true };

export const timerMessage = (v: PacingView): TimerMessage => ({
  type: 'timer', running: v.running, elapsedMs: Math.round(v.elapsedMs), targetMs: v.targetMs,
  ...(v.pace ? { pace: v.pace.kind, paceMs: Math.round(v.pace.deltaMs) } : {}),
});
export const timerOffMessage = (): TimerMessage => ({ type: 'timer', off: true });

const MAX_MS = 100 * 3600_000;
/** A timer message from the network: anything not shaped right is dropped, numbers are clamped. */
export function parseTimerMessage(m: unknown): TimerMessage | null {
  if (!m || typeof m !== 'object' || (m as { type?: unknown }).type !== 'timer') return null;
  const o = m as { off?: unknown; running?: unknown; elapsedMs?: unknown; targetMs?: unknown; pace?: unknown; paceMs?: unknown };
  if (o.off === true) return { type: 'timer', off: true };
  const elapsed = num(o.elapsedMs);
  const target = num(o.targetMs);
  if (elapsed === null || target === null || target <= 0) return null;
  const pace: PaceKind | null = o.pace === 'ahead' || o.pace === 'on' || o.pace === 'behind' ? o.pace : null;
  const paceMs = num(o.paceMs);
  return {
    type: 'timer', running: o.running === true, elapsedMs: Math.min(MAX_MS, Math.max(0, Math.round(elapsed))), targetMs: Math.min(MAX_MS, Math.round(target)),
    ...(pace ? { pace, ...(paceMs !== null ? { paceMs: Math.max(-MAX_MS, Math.min(MAX_MS, Math.round(paceMs))) } : {}) } : {}),
  };
}

/** A receiver's own view of a timer message: elapsed keeps counting from the moment it arrived. */
export function viewOfTimerMessage(m: Extract<TimerMessage, { running: boolean }>, receivedAt: number, now: number): PacingView {
  const elapsed = m.elapsedMs + (m.running ? Math.max(0, now - receivedAt) : 0);
  const remaining = m.targetMs - elapsed;
  return { elapsedMs: elapsed, remainingMs: remaining, targetMs: m.targetMs, zone: zoneOf(remaining, m.targetMs), running: m.running, pace: m.pace ? { kind: m.pace, deltaMs: m.paceMs ?? 0 } : null };
}

/**
 * Should the presenter send a timer message now? Always when something changed (start, pause, target, pace kind),
 * otherwise as a slow heartbeat so a late-joining phone and clock drift are corrected; never faster than once a second.
 */
export const TIMER_MIN_GAP_MS = 1000;
export const TIMER_HEARTBEAT_MS = 15_000;
export function timerDue(lastSentAt: number, now: number, changed: boolean): boolean {
  const gap = now - lastSentAt;
  if (gap < TIMER_MIN_GAP_MS) return false;
  return changed || gap >= TIMER_HEARTBEAT_MS;
}

// ── Remembered per presentation ──────────────────────────────────────────────────────────────────
export const pacingKey = (presentationId: string) => `lightcast.pacing.${presentationId}`;
