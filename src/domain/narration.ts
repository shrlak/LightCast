// Slide Show › Record Slide Show: per-slide narration clips and slide timings.
// Timings reuse the rehearsal storage (`slide.autoAdvance`, seconds); a clip is an audio media id in `slide.narration`.
import type { Presentation, Slide } from './types';

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

/** Puts the recorded timings and narration clips (slide id → media id) on the slides; others stay as they were. */
export function applyRecording(slides: Slide[], timings: Record<string, number>, clips: Record<string, string>): Slide[] {
  return slides.map((s) => {
    const t = timings[s.id], c = clips[s.id];
    if (!t && !c) return s;
    return { ...s, ...(t ? { autoAdvance: t } : {}), ...(c ? { narration: c } : {}) };
  });
}

export type ClearScope = 'all' | { slideId: string };
/** 녹화 지우기: removes narrations and timings (all slides, or one). Returns the media ids no slide uses any more. */
export function clearRecording(slides: Slide[], scope: ClearScope): { slides: Slide[]; orphaned: string[] } {
  const hit = (s: Slide) => scope === 'all' || s.id === scope.slideId;
  const next = slides.map((s) => (hit(s) && (s.narration || s.autoAdvance) ? { ...s, narration: undefined, autoAdvance: undefined } : s));
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

export const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
