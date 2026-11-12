// Object animations in a slide show, as PowerPoint plays them: a click starts the next "click step"
// (an effect that starts 클릭할 때, with every 이전 효과와 함께 / 이전 효과 다음에 effect after it);
// when no step is left the click goes on to the next slide. The timeline itself — which effect is in
// which step, how long each step runs, what every object looks like at a moment — comes from the
// engine (DeckCraft's timeline).
import type { Slide, SlideAnimation, SlideElement } from './types';
import { prepareTimeline, sampleTimeline, type AnimPara, type AnimSpec, type AnimState, type PreparedTimeline, type TriggerPlayhead } from '../engine';

/** Timing › Repeat › Until Next Click (DeckCraft stores it as `u32::MAX`). */
export const REPEAT_UNTIL_CLICK = 4294967295;

/** Where a triggered sequence is: clicks on its object fully played, and when the playing one started. */
export interface TriggerRun { done: number; startedAt: number | null }

/** Where a slide's builds are while it is on screen. */
export interface LiveBuild {
  /** The click step being played (or, with `startedAt` null, waiting for its click). */
  step: number;
  /** When that step started (ms); null = it waits for a click. */
  startedAt: number | null;
  /** Preview: play every step straight through without waiting for clicks. */
  all?: boolean;
  /** Animations › Trigger: the interactive sequences started by clicking their objects, by object id. */
  triggers?: Record<string, TriggerRun>;
}

/** The paragraphs (lines) of an object's text, as its text box or shape draws them. */
export const textParagraphs = (el: SlideElement): string[] => (el.paragraphs ? el.paragraphs.map((p) => p.text) : el.text ? el.text.split('\n') : []);

/** Can the object be built paragraph by paragraph (Effect Options › 순서)? A text box or a shape with text. */
export const canBuildByParagraph = (el: SlideElement | undefined): boolean =>
  !!el && (el.kind === 'text' || el.kind === 'shape') && !el.warp && textParagraphs(el).some((l) => l.trim());

/** Outline level and text of each paragraph: leading tabs are the level, as in PowerPoint's outline. */
export const paragraphLevels = (el: SlideElement): AnimPara[] =>
  textParagraphs(el).map((l) => ({ level: Math.min(8, /^\t*/.exec(l)![0].length), filled: !!l.trim() }));

/** Does this effect build its object paragraph by paragraph? (Motion paths move the whole object.) */
export const byParagraph = (a: SlideAnimation, el: SlideElement | undefined) => a.sequence === 'paragraph' && a.class !== 'path' && canBuildByParagraph(el);

/** The animations the timeline plays: those whose object is on the slide and shown. */
const playedAnimations = (slide: Slide, elements: SlideElement[]) => (slide.animations ?? []).filter((a) => elements.some((e) => e.id === a.elementId && !e.hidden));

export function animSpec(slide: Slide, elements: SlideElement[] = slide.elements ?? []): AnimSpec | null {
  const anims = playedAnimations(slide, elements);
  if (!anims.length) return null;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const paraIds = new Set(anims.filter((a) => byParagraph(a, byId.get(a.elementId))).map((a) => a.elementId));
  return {
    anims: anims.map((a) => ({
      elementId: a.elementId, effect: a.effect, class: a.class, option: a.option ?? '', start: a.start, durationMs: a.durationMs, delayMs: a.delayMs, repeat: a.repeat ?? 1, ...(a.path ? { path: a.path } : {}),
      ...(a.rewind ? { rewind: true } : {}),
      // A trigger counts only while its object is on the slide and shown.
      ...(a.trigger && a.trigger !== a.elementId && byId.get(a.trigger) && !byId.get(a.trigger)!.hidden ? { trigger: a.trigger } : {}),
      ...(byParagraph(a, byId.get(a.elementId)) ? { sequence: 'paragraph' as const } : {}),
    })),
    boxes: elements.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rotation ?? 0, ...(paraIds.has(e.id) ? { paras: paragraphLevels(e) } : {}) })),
  };
}

export const slideTimeline = (slide: Slide): PreparedTimeline | null => {
  const spec = animSpec(slide);
  return spec ? prepareTimeline(spec) : null;
};

/** The builds of a slide as it comes on screen: its first step plays at once unless it waits for a click. */
export function initialBuild(slide: Slide, now: number): LiveBuild | undefined {
  const tl = slideTimeline(slide);
  if (!tl) return undefined;
  // Only triggered effects: nothing plays on the clicks, but their objects start as the triggers leave them.
  if (!tl.steps) return tl.triggers?.length ? { step: 0, startedAt: null } : undefined;
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
  if (!tl || build.step >= tl.steps) return null;
  if (build.startedAt === null) return { ...build, step: build.step, startedAt: now };
  const at = buildPosition(tl, build, now).step;
  return at + 1 < tl.steps ? { ...build, step: at + 1, startedAt: now } : null;
}

/** Back (previous): a slide part-way through its builds starts them again; null = go to the previous slide. */
export function rewindBuild(slide: Slide, build: LiveBuild | undefined, now: number): LiveBuild | null {
  if (!build || (build.step === 0 && build.startedAt === null)) return null;
  const first = initialBuild(slide, now);
  if (!first || (build.step === 0 && first.startedAt !== null)) return null;
  return first;
}

/**
 * Animations › Animation Painter (DeckCraft animation.painterApply): the targets get every
 * animation picked from the source, replacing their own (painting a shape onto itself does not
 * double them); the copies go to the end of the sequence.
 */
export function paintAnimations(list: SlideAnimation[], picked: SlideAnimation[], targets: string[], newId: () => string): SlideAnimation[] {
  if (!picked.length || !targets.length) return list;
  const kept = list.filter((a) => !targets.includes(a.elementId));
  const copies = targets.flatMap((id) => picked.map((a) => ({ ...a, id: newId(), elementId: id, trigger: a.trigger === id ? undefined : a.trigger })));
  return [...kept, ...copies];
}

/** A trigger's sequence at `now`: a step that has played to its end counts as done. */
function triggerNow(tl: PreparedTimeline, id: string, run: TriggerRun, now: number): { done: number; t: number; playing: boolean } {
  const info = tl.triggers?.find((x) => x.elementId === id);
  if (!info || run.startedAt === null) return { done: run.done, t: 0, playing: false };
  const t = Math.max(0, (now - run.startedAt) / 1000);
  if (t >= (info.durations[run.done] ?? 0)) return { done: run.done + 1, t: 0, playing: false };
  return { done: run.done, t, playing: true };
}

/** The objects whose click plays a triggered sequence on this slide. */
export const triggerObjects = (slide: Slide): string[] => slideTimeline(slide)?.triggers?.filter((t) => t.steps > 0).map((t) => t.elementId) ?? [];

/**
 * A click on trigger object `id` in a slide show (DeckCraft's interact.rs): a click while its step
 * plays finishes that step; otherwise the next step starts, and once every step has played the
 * sequence starts over. Null when the object triggers nothing.
 */
export function clickTrigger(slide: Slide, build: LiveBuild | undefined | null, id: string, now: number): LiveBuild | null {
  const tl = slideTimeline(slide);
  const info = tl?.triggers?.find((t) => t.elementId === id && t.steps > 0);
  if (!tl || !info) return null;
  const base: LiveBuild = build ?? { step: tl.steps, startedAt: null };
  const cur = triggerNow(tl, id, base.triggers?.[id] ?? { done: 0, startedAt: null }, now);
  let run: TriggerRun;
  if (cur.playing) run = { done: cur.done + 1, startedAt: null };
  else {
    const done = cur.done >= info.steps ? 0 : cur.done;
    run = (info.durations[done] ?? 0) > 0 ? { done, startedAt: now } : { done: done + 1, startedAt: null };
  }
  return { ...base, triggers: { ...base.triggers, [id]: run } };
}

/** What every animated object looks like now. */
export function buildStates(slide: Slide, elements: SlideElement[], build: LiveBuild, now: number): { states: Record<string, AnimState>; settled: boolean } | null {
  const spec = animSpec(slide, elements);
  const tl = spec && prepareTimeline(spec);
  if (!spec || !tl) return null;
  const pos = buildPosition(tl, build, now);
  const plays: TriggerPlayhead[] = [];
  let playing = false;
  for (const [id, run] of Object.entries(build.triggers ?? {})) {
    const c = triggerNow(tl, id, run, now);
    playing ||= c.playing;
    plays.push({ elementId: id, step: c.done, t: c.t });
  }
  const states = sampleTimeline(spec, pos.step, pos.t, plays);
  return states ? { states, settled: pos.settled && !playing } : null;
}

/** The click number shown beside each animated object in the editor (0 = starts with the slide). */
export function animationBadges(slide: Slide): Record<string, number[]> {
  const tl = slideTimeline(slide);
  const out: Record<string, number[]> = {};
  if (!tl) return out;
  for (const e of tl.effects.filter((x) => !x.trigger)) {
    const n = tl.auto[0] ? e.step : e.step + 1;
    (out[e.elementId] ??= []).includes(n) || out[e.elementId].push(n);
  }
  return out;
}

/**
 * Animations › Motion Paths › Custom Path: points drawn on the slide (canvas pixels, starting at
 * the object) as the engine's path — offsets from where the object sits, in slide fractions.
 */
export function customMotionPath(points: [number, number][], closed = false): string | null {
  if (points.length < 2) return null;
  const [x0, y0] = points[0];
  const f = (v: number) => (Math.round(v * 10000) / 10000).toString();
  return `M 0 0 ${points.slice(1).map(([x, y]) => `L ${f((x - x0) / 1440)} ${f((y - y0) / 1080)}`).join(' ')}${closed ? ' Z' : ''} E`;
}

/** A custom path's points back on the slide (canvas pixels), from where the object's centre is. */
export function motionPathPoints(path: string, cx: number, cy: number): [number, number][] {
  const nums = [...path.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  return nums.map(([x, y]) => [cx + x * 1440, cy + y * 1080]);
}

/**
 * The click numbers of each animation (by id), one per paragraph step of a by-paragraph build, for
 * the Animation Pane (0 = starts with the slide). `paragraphs` lists which paragraph each one builds.
 */
export function animationClicks(slide: Slide): Record<string, { clicks: number[]; paragraphs: (number | null)[] }> {
  const tl = slideTimeline(slide);
  const out: Record<string, { clicks: number[]; paragraphs: (number | null)[] }> = {};
  if (!tl) return out;
  const anims = playedAnimations(slide, slide.elements ?? []);
  for (const e of tl.effects.filter((x) => !x.trigger)) {
    const a = anims[e.index];
    if (!a) continue;
    const r = (out[a.id] ??= { clicks: [], paragraphs: [] });
    r.clicks.push(tl.auto[0] ? e.step : e.step + 1);
    r.paragraphs.push(e.paragraph);
  }
  return out;
}
