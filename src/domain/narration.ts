// Slide Show › Record Slide Show: narration and slide timings.
// Timings reuse the rehearsal storage (`slide.autoAdvance`, seconds). Narration is an audio media id in `slide.narration`:
//  - new recordings are ONE continuous clip for the whole run (no gap at slide changes); every slide that was shown
//    points at it and `slide.narrationCue` says which part of it belongs to the slide;
//  - older recordings have one clip per slide and no cue (the whole clip is the slide's narration).
import type { NarrationCue, Presentation, Slide } from './types';

export interface Visit { slideId: string; startMs: number; endMs: number | null }
export interface Recording { visits: Visit[] }

export const startRecording = (): Recording => ({ visits: [] });

/** The slide on screen changed (or the show started): closes the open visit and opens one for `slideId`. */
export function enterSlide(r: Recording, slideId: string | null, now: number): Recording {
  const open = r.visits.length ? r.visits[r.visits.length - 1] : null;
  if (open && open.endMs === null && open.slideId === slideId) return r;
  const visits = r.visits.map((v) => (v.endMs === null ? { ...v, endMs: now } : v));
  return { visits: slideId ? [...visits, { slideId, startMs: now, endMs: null }] : visits };
}

export const finishRecording = (r: Recording, now: number): Recording => enterSlide(r, null, now);

/** The last visit to each slide: re-recording a slide replaces its earlier take, as in PowerPoint. */
export function lastVisits(r: Recording): Map<string, Visit & { endMs: number }> {
  const out = new Map<string, Visit & { endMs: number }>();
  for (const v of r.visits) if (v.endMs !== null) out.set(v.slideId, { ...v, endMs: v.endMs });
  return out;
}

/** Whole seconds a slide stayed on screen (at least 1), keyed by slide id. */
export function slideTimings(r: Recording): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of lastVisits(r)) out[id] = Math.max(1, Math.round((v.endMs - v.startMs) / 1000));
  return out;
}

/**
 * Where each slide's last visit lies inside a continuous clip that started at `audioStartMs` (the same clock as the
 * visits): seconds from the clip's start. A slide shown only before the clip began has no cue.
 */
export function cuesFromRecording(r: Recording, audioStartMs: number): Record<string, NarrationCue> {
  const out: Record<string, NarrationCue> = {};
  for (const [id, v] of lastVisits(r)) {
    const endSec = (v.endMs - audioStartMs) / 1000;
    if (endSec <= 0.05) continue;
    out[id] = { startSec: Math.round(Math.max(0, (v.startMs - audioStartMs) / 1000) * 100) / 100, endSec: Math.round(endSec * 100) / 100 };
  }
  return out;
}

/**
 * Puts the recorded timings and narration on the slides; others stay as they were. `clips` maps a slide id to its own
 * clip (older, per-slide recordings); `cues` maps a slide id to its part of `track`, the one continuous clip.
 */
export function applyRecording(slides: Slide[], timings: Record<string, number>, clips: Record<string, string>, track?: { mediaId: string; cues: Record<string, NarrationCue> }): Slide[] {
  return slides.map((s) => {
    const t = timings[s.id], c = clips[s.id], cue = track?.cues[s.id];
    if (!t && !c && !cue) return s;
    const next: Slide = { ...s, ...(t ? { autoAdvance: t } : {}) };
    if (cue && track) { next.narration = track.mediaId; next.narrationCue = cue; }
    else if (c) { next.narration = c; delete next.narrationCue; }
    return next;
  });
}

export type ClearScope = 'all' | { slideId: string };
/** 녹화 지우기: removes narrations and timings (all slides, or one). Returns the media ids no slide uses any more. */
export function clearRecording(slides: Slide[], scope: ClearScope): { slides: Slide[]; orphaned: string[] } {
  const hit = (s: Slide) => scope === 'all' || s.id === scope.slideId;
  const next = slides.map((s) => (hit(s) && (s.narration || s.autoAdvance || s.narrationCue) ? { ...s, narration: undefined, narrationCue: undefined, autoAdvance: undefined } : s));
  const still = new Set(next.map((s) => s.narration).filter((x): x is string => !!x));
  const orphaned = [...new Set(slides.filter((s) => hit(s) && s.narration && !still.has(s.narration)).map((s) => s.narration!))];
  return { slides: next, orphaned };
}

export const hasRecording = (p: Presentation | null | undefined): boolean => !!p?.slides.some((s) => s.narration || s.autoAdvance);
export const narrationCount = (p: Presentation | null | undefined): number => p?.slides.filter((s) => s.narration).length ?? 0;

/** The clip to play for a slide being shown: none when 쇼 설정 › 녹음된 내레이션 재생 is off. */
export function narrationToPlay(slide: Slide | null | undefined, p: Pick<Presentation, 'showSetup'> | null | undefined): string | null {
  if (!slide?.narration || p?.showSetup?.noNarration) return null;
  return slide.narration;
}

/** What to play for a slide being shown: the clip and, for a continuous recording, the part that belongs to the slide. */
export function narrationClip(slide: Slide | null | undefined, p: Pick<Presentation, 'showSetup'> | null | undefined): { mediaId: string; cue?: NarrationCue } | null {
  const mediaId = narrationToPlay(slide, p);
  if (!mediaId) return null;
  const c = slide?.narrationCue;
  return c && Number.isFinite(c.startSec) && Number.isFinite(c.endSec) && c.endSec > c.startSec ? { mediaId, cue: c } : { mediaId };
}

export type PlaybackPlan =
  | { kind: 'stop' }
  /** The track is already at the right place: let it run on (no gap), and stop at `stopAt` seconds into it (null: at its end). */
  | { kind: 'keep'; stopAt: number | null }
  | { kind: 'start'; mediaId: string; offset: number; stopAt: number | null };

/**
 * Slide changed: what the narration player does. Inside one continuous recording a slide whose part starts where the
 * player already is is not restarted, so there is no audible gap; anything else (another slide order, an older
 * per-slide clip) starts the slide's part at its beginning.
 */
export function planNarration(playing: { mediaId: string; position: number } | null, next: { mediaId: string; cue?: NarrationCue } | null, tolerance = 0.8): PlaybackPlan {
  if (!next) return { kind: 'stop' };
  if (!next.cue) return { kind: 'start', mediaId: next.mediaId, offset: 0, stopAt: null };
  if (playing && playing.mediaId === next.mediaId && Math.abs(playing.position - next.cue.startSec) <= tolerance) return { kind: 'keep', stopAt: next.cue.endSec };
  return { kind: 'start', mediaId: next.mediaId, offset: next.cue.startSec, stopAt: next.cue.endSec };
}

export const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
