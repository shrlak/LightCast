// Object animations in a slide show, as PowerPoint plays them: a click starts the next "click step"
// (an effect that starts 클릭할 때, with every 이전 효과와 함께 / 이전 효과 다음에 effect after it);
// when no step is left the click goes on to the next slide. The timeline itself — which effect is in
// which step, how long each step runs, what every object looks like at a moment — comes from the
// engine (DeckCraft's timeline).
import type { Slide, SlideElement } from './types';
import { prepareTimeline, sampleTimeline, type AnimSpec, type AnimState, type PreparedTimeline } from '../engine';

/** Where a slide's builds are while it is on screen. */
export interface LiveBuild {
  /** The click step being played (or, with `startedAt` null, waiting for its click). */
  step: number;
  /** When that step started (ms); null = it waits for a click. */
  startedAt: number | null;
  /** Preview: play every step straight through without waiting for clicks. */
  all?: boolean;
}

export function animSpec(slide: Slide, elements: SlideElement[] = slide.elements ?? []): AnimSpec | null {
  const anims = (slide.animations ?? []).filter((a) => elements.some((e) => e.id === a.elementId && !e.hidden));
  if (!anims.length) return null;
  return {
    anims: anims.map((a) => ({ elementId: a.elementId, effect: a.effect, class: a.class, option: a.option ?? '', start: a.start, durationMs: a.durationMs, delayMs: a.delayMs, repeat: a.repeat ?? 1 })),
    boxes: elements.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rotation ?? 0 })),
  };
}

export const slideTimeline = (slide: Slide): PreparedTimeline | null => {
  const spec = animSpec(slide);
  return spec ? prepareTimeline(spec) : null;
};

/** The builds of a slide as it comes on screen: its first step plays at once unless it waits for a click. */
export function initialBuild(slide: Slide, now: number): LiveBuild | undefined {
  const tl = slideTimeline(slide);
  if (!tl || !tl.steps) return undefined;
  return { step: 0, startedAt: tl.auto[0] ? now : null };
}

/** The step actually playing at `now` (steps that start by themselves follow on) and seconds into it. */
export function buildPosition(tl: PreparedTimeline, build: LiveBuild, now: number): { step: number; t: number; settled: boolean } {
  if (build.startedAt === null) return { step: build.step, t: 0, settled: true };
  let step = build.step;
  let t = Math.max(0, (now - build.startedAt) / 1000) + 1e-4;
  while (step + 1 < tl.steps && t >= (tl.durations[step] ?? 0) && (build.all || tl.auto[step + 1])) {
    t -= tl.durations[step] ?? 0;
    step++;
  }
  return { step, t, settled: t >= (tl.durations[step] ?? 0) + 0.05 };
}

/** A click (next): the builds after it, or null when the slide has none left (go to the next slide). */
export function advanceBuild(slide: Slide, build: LiveBuild | undefined, now: number): LiveBuild | null {
  if (!build) return null;
  const tl = slideTimeline(slide);
  if (!tl) return null;
  if (build.startedAt === null) return { step: build.step, startedAt: now };
  const at = buildPosition(tl, build, now).step;
  return at + 1 < tl.steps ? { step: at + 1, startedAt: now } : null;
}

/** Back (previous): a slide part-way through its builds starts them again; null = go to the previous slide. */
export function rewindBuild(slide: Slide, build: LiveBuild | undefined, now: number): LiveBuild | null {
  if (!build || (build.step === 0 && build.startedAt === null)) return null;
  const first = initialBuild(slide, now);
  if (!first || (build.step === 0 && first.startedAt !== null)) return null;
  return first;
}

/** What every animated object looks like now. */
export function buildStates(slide: Slide, elements: SlideElement[], build: LiveBuild, now: number): { states: Record<string, AnimState>; settled: boolean } | null {
  const spec = animSpec(slide, elements);
  const tl = spec && prepareTimeline(spec);
  if (!spec || !tl) return null;
  const pos = buildPosition(tl, build, now);
  const states = sampleTimeline(spec, pos.step, pos.t);
  return states ? { states, settled: pos.settled } : null;
}

/** The click number shown beside each animated object in the editor (0 = starts with the slide). */
export function animationBadges(slide: Slide): Record<string, number[]> {
  const tl = slideTimeline(slide);
  const out: Record<string, number[]> = {};
  if (!tl) return out;
  for (const e of tl.effects) {
    const n = tl.auto[0] ? e.step : e.step + 1;
    (out[e.elementId] ??= []).includes(n) || out[e.elementId].push(n);
  }
  return out;
}
