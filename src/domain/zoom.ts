// Insert › Zoom (port of DeckCraft's zoom.rs): Slide, Section and Summary Zoom. A zoom is a picture of
// its target slide that jumps to it in the slide show; with Return to Zoom (on for section and summary
// zooms, as in PowerPoint) the show comes back to the zoom's slide after the target slide, or the
// target section's last slide.
import type { Slide, SlideElement } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { sectionRange, sections } from './sections';
import { uid } from './lyrics';

export type ZoomKind = 'slide' | 'section' | 'summary';

/** One zoom tile: the slide it shows and jumps to, and the slide after which the show returns. */
export interface ZoomTarget { slide: Slide; last: Slide }

/** Slide Zoom: each picked slide on its own (returns after that slide). */
export function slideTargets(slides: Slide[], ids: string[]): ZoomTarget[] {
  return slides.filter((s) => ids.includes(s.id)).map((s) => ({ slide: s, last: s }));
}

/** Section Zoom: the picked sections (by first slide id); each returns after its section's last slide. */
export function sectionTargets(slides: Slide[], firstIds: string[]): ZoomTarget[] {
  return slides.flatMap((s) => {
    if (!firstIds.includes(s.id)) return [];
    const r = sectionRange(slides, s.id);
    return r ? [{ slide: slides[r[0]], last: slides[r[1] - 1] }] : [];
  });
}

/** The slides a Summary Zoom starts with when none are picked: the first slide of every section. */
export const defaultSummaryStarts = (slides: Slide[]): string[] => sections(slides).map((s) => slides[s.start].id);

/**
 * Summary Zoom: each picked slide starts a part that runs to the slide before the next picked one
 * (the last part to the end), in slide order. No picks: the first slide of every section.
 */
export function summaryTargets(slides: Slide[], picked: string[] = []): ZoomTarget[] {
  const ids = picked.length ? picked : defaultSummaryStarts(slides);
  const starts = slides.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i >= 0);
  return starts.map((i, k) => ({ slide: slides[i], last: slides[Math.max(i, k + 1 < starts.length ? starts[k + 1] - 1 : slides.length - 1)] }));
}

type Box = { x: number; y: number; w: number; h: number };

/** `n` tiles of `aspect` (w / h) laid out in a centred grid inside `area`. */
export function zoomGrid(n: number, area: Box, aspect = CANVAS_W / CANVAS_H): Box[] {
  if (n <= 0) return [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(n))), rows = Math.max(1, Math.ceil(n / cols));
  const gap = 24;
  const cw = (area.w - gap * (cols - 1)) / cols, ch = (area.h - gap * (rows - 1)) / rows;
  let [w, h] = cw / ch > aspect ? [ch * aspect, ch] : [cw, cw / aspect];
  // A single slide zoom is a quarter of the slide wide, as PowerPoint inserts it.
  if (n === 1) [w, h] = [Math.min(w, area.w / 2), Math.min(h, area.w / 2 / aspect)];
  const used = Math.min(cols, n);
  const totalW = used * w + gap * (used - 1), totalH = rows * h + gap * (rows - 1);
  const x0 = area.x + (area.w - totalW) / 2, y0 = area.y + (area.h - totalH) / 2;
  return Array.from({ length: n }, (_, k) => ({ x: x0 + (k % cols) * (w + gap), y: y0 + Math.floor(k / cols) * (h + gap), w, h }));
}

/** Where the tiles go: below the title on a summary slide, over most of the slide for several, a corner for one. */
export function zoomArea(kind: ZoomKind, n: number): Box {
  if (kind === 'summary') return { x: CANVAS_W * 0.06, y: CANVAS_H * 0.26, w: CANVAS_W * 0.88, h: CANVAS_H * 0.66 };
  if (n === 1) return { x: CANVAS_W * 0.5, y: CANVAS_H * 0.5, w: CANVAS_W * 0.45, h: CANVAS_H * 0.45 };
  return { x: CANVAS_W * 0.08, y: CANVAS_H * 0.12, w: CANVAS_W * 0.84, h: CANVAS_H * 0.8 };
}

/** The zoom objects for `targets`; `make` builds each one's snapshot (the slide, theme and background it is drawn from). */
export function zoomElements(kind: ZoomKind, targets: ZoomTarget[], returnToZoom: boolean, zoomOf: (s: Slide) => NonNullable<SlideElement['zoomOf']>): SlideElement[] {
  const boxes = zoomGrid(targets.length, zoomArea(kind, targets.length));
  const prefix = kind === 'summary' ? '요약' : kind === 'section' ? '구역' : '슬라이드';
  return targets.map((t, i) => ({
    id: uid('el'), kind: 'zoom' as const, ...boxes[i], targetSlideId: t.slide.id, zoomOf: zoomOf(t.slide),
    name: `${prefix} 확대/축소: ${(t.slide.title || t.slide.group || '').split('\n')[0]}`.trim(),
    ...(returnToZoom ? { zoomReturn: t.last.id } : {}),
  }));
}

/** Where the summary slide goes: before the section holding the first target, so no section is cut in two. */
export function summaryInsertIndex(slides: Slide[], targets: ZoomTarget[]): number {
  const first = Math.min(...targets.map((t) => slides.indexOf(t.slide)));
  const r = Number.isFinite(first) && first >= 0 ? sectionRange(slides, slides[first].id) : null;
  return r ? r[0] : slides.length;
}

/** The title of a summary slide (DeckCraft: "Summary"). */
export const SUMMARY_TITLE = '요약';

/**
 * Return to Zoom in the slide show: `back` is where to go after the slide `after` (the target slide or
 * its section's last one). `pending` is set when a zoom with Return to Zoom is clicked.
 */
export interface ZoomReturn { from: number; after: string }
export function returnAfter(pending: ZoomReturn | null, currentId: string | undefined): number | null {
  return pending && currentId && pending.after === currentId ? pending.from : null;
}
