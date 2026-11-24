/**
 * 애니메이션 창 › 고급 타임라인 (DeckCraft's panels/animtimeline.rs): a bar per effect showing when it starts
 * within its click step (delay included) and how long it plays, and the maths of dragging a bar to retime it.
 * Pure, so the layout and the drag results are tested without a pane.
 */
import type { SlideAnimation } from './types';
import { REPEAT_UNTIL_CLICK } from './animations';

/** Drags snap to this step (ms), PowerPoint's 0.05 s granularity. */
export const SNAP_MS = 50;
/** The shortest duration a drag can make (ms). */
export const MIN_DURATION_MS = 50;
/** Upper bound for delay and duration (ms), as DeckCraft's animation.timing clamps them. */
export const MAX_MS = 600_000;
const MIN_PPS = 8;
const MAX_PPS = 120;

export interface TimelineBar {
  /** The animation's id. */
  id: string;
  /** Click step in the slide's main sequence (0 = plays as the slide comes on), or null for a triggered effect. */
  step: number | null;
  /** Seconds from the step's start to when the effect begins (its delay included). */
  start: number;
  /** Seconds from its start to its end, all repeats included. */
  span: number;
  /** Seconds the step starts the effect from before its delay (With / After Previous): a drag moves the delay from here. */
  base: number;
}

const plays = (a: SlideAnimation) => (a.repeat && a.repeat > 1 && a.repeat !== REPEAT_UNTIL_CLICK ? a.repeat : 1);
const spanOf = (a: SlideAnimation) => (Math.max(0, a.durationMs) * plays(a)) / 1000;

/**
 * One bar per animation, in the slide's order. On Click starts a new step; With Previous starts with the
 * effect before it; After Previous starts when the effect before it has ended. Triggered effects are each
 * their own sequence.
 */
export function timelineBars(anims: SlideAnimation[]): TimelineBar[] {
  const out: TimelineBar[] = [];
  let step = -1;
  let prevBase = 0;
  let prevEnd = 0;
  const trig = new Map<string, { base: number; end: number }>();
  for (const a of anims) {
    const delay = Math.max(0, a.delayMs) / 1000;
    const span = spanOf(a);
    if (a.trigger) {
      const key = `${a.trigger}|${a.bookmark ?? ''}`;
      const t = trig.get(key);
      const base = !t || a.start === 'click' ? 0 : a.start === 'with' ? t.base : t.end;
      trig.set(key, { base, end: base + delay + span });
      out.push({ id: a.id, step: null, start: base + delay, span, base });
      continue;
    }
    let base: number;
    if (a.start === 'click') {
      // Clicks count from 1; effects before the first click play as the slide comes on (step 0).
      step = Math.max(step, 0) + 1;
      base = 0;
      prevEnd = 0;
    } else if (step < 0) {
      step = 0;
      base = 0;
      prevEnd = 0;
    } else base = a.start === 'with' ? prevBase : prevEnd;
    const start = base + delay;
    out.push({ id: a.id, step, start, span, base });
    prevBase = base;
    prevEnd = Math.max(a.start === 'with' ? prevEnd : 0, start + span);
  }
  return out;
}

/** Pixels per second for a track `width` px wide showing `seconds` (kept between 8 and 120). */
export function pixelsPerSecond(width: number, seconds: number): number {
  const s = Math.max(1, seconds);
  return Math.max(MIN_PPS, Math.min(MAX_PPS, width / s));
}

const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;

/**
 * A drag of `dx` seconds on a bar: its body moves the start (the delay, never before its base); its right edge
 * stretches the duration (each repeat equally). The patch for the animation, or null when nothing changes.
 */
export function dragBar(a: SlideAnimation, bar: TimelineBar, part: 'move' | 'end', dx: number): Partial<SlideAnimation> | null {
  if (part === 'move') {
    const delayMs = Math.max(0, Math.min(MAX_MS, snap((bar.start + dx - bar.base) * 1000)));
    return delayMs === a.delayMs ? null : { delayMs };
  }
  const spanMs = Math.max(MIN_DURATION_MS, (bar.span + dx) * 1000);
  const durationMs = Math.max(MIN_DURATION_MS, Math.min(MAX_MS, snap(spanMs / plays(a))));
  return durationMs === a.durationMs ? null : { durationMs };
}

/** The tick marks under the timeline: whole seconds, every 2 / 5 / 10 s when they would crowd. */
export function timelineTicks(seconds: number, pps: number): number[] {
  const every = [1, 2, 5, 10, 30, 60].find((n) => n * pps >= 28) ?? 60;
  const out: number[] = [];
  for (let s = 0; s <= Math.ceil(seconds) + 0.001; s += every) out.push(s);
  return out;
}
