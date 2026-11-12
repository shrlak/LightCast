// Clicking an object in the slide show (Insert › Action, links, slide zooms): what it does. Shared
// by the in-app slide show (Reading view) and the projector window, which asks the console to act.
import type { ElementAction, Slide, SlideElement } from './types';
import type { Action, AppState } from './reducer';
import { sequence } from './arrangement';
import { findPres } from './live';

/** What an action's object is, so the console (which only receives the action) can play its own audio. */
export interface ShowTarget { id: string; kind: string; mediaId?: string }
export type ShowAction = (ElementAction & { target?: ShowTarget }) | { kind: 'zoom'; slideId: string };

/** The object with a click action (Action Settings, a link or a slide zoom) under a canvas point. */
export function actionAt(slide: Slide | null | undefined, x: number, y: number): SlideElement | null {
  const els = [...(slide?.elements ?? [])].reverse();
  return els.find((e) => !e.hidden && (e.action || e.href || (e.kind === 'zoom' && e.targetSlideId)) && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + Math.max(e.h, 1)) ?? null;
}

/** The object under a canvas point that does something when pointed at (Action › Mouse Over) or shows a ScreenTip. */
export function hoverAt(slide: Slide | null | undefined, x: number, y: number): SlideElement | null {
  const els = [...(slide?.elements ?? [])].reverse();
  return els.find((e) => !e.hidden && (e.hoverAction || e.tooltip) && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + Math.max(e.h, 1)) ?? null;
}

/** The address of a link inside text (Insert › Link on characters) under a click, if the click is on one. */
export const runLinkAt = (target: EventTarget | null): string | null =>
  (target as Element | null)?.closest?.('[data-link]')?.getAttribute('data-link') ?? null;

/** Where a show goes back to for "last slide viewed": the most recent other page in `history`. */
export function lastViewed(history: number[], current: number): number | null {
  for (let k = history.length - 1; k >= 0; k--) if (history[k] !== current) return history[k];
  return null;
}

const withTarget = (a: ElementAction, el: SlideElement): ShowAction => (a.kind === 'playMedia' ? { ...a, target: { id: el.id, kind: el.kind, mediaId: el.mediaId } } : a);

export function actionOf(el: SlideElement): ShowAction | null {
  if (el.kind === 'zoom' && el.targetSlideId) return { kind: 'zoom', slideId: el.targetSlideId };
  const a = el.action ?? (el.href ? { kind: 'url' as const, url: el.href } : null);
  return a && withTarget(a, el);
}

/** What pointing at an object does (Action › Mouse Over). */
export const hoverActionOf = (el: SlideElement): ShowAction | null => (el.hoverAction ? withTarget(el.hoverAction, el) : null);

/**
 * The pages the live show has visited (for "last slide viewed"), kept by the console as the live cursor
 * moves. Consecutive repeats are one visit; the list is capped.
 */
export const showHistory: { list: number[] } = { list: [] };
export function noteVisit(list: number[], seq: number | null | undefined, max = 60): number[] {
  if (seq == null || list[list.length - 1] === seq) return list;
  const next = [...list, seq];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * The console's live action for a show action (null: nothing to do there — a link opens where it was
 * clicked). `history` is the pages visited so far (see [showHistory]).
 */
export function liveActionFor(s: Pick<AppState, 'cursor' | 'library'>, a: ShowAction, history: number[] = showHistory.list): Action | null {
  if (a.kind === 'next') return { type: 'live/next', now: Date.now() };
  if (a.kind === 'prev') return { type: 'live/prev' };
  // playMedia: an audio object plays through the console's audio player; a video plays in the window it is shown in.
  if (a.kind === 'playMedia') return 'target' in a && a.target?.kind === 'audio' && a.target.mediaId ? { type: 'audio/play', mediaId: a.target.mediaId } : null;
  if (a.kind === 'url' || a.kind === 'end' || !s.cursor) return null;
  const p = findPres(s.library, s.cursor.presentationId);
  if (!p) return null;
  const pages = sequence(p);
  const go = (seq: number): Action | null => (seq >= 0 && seq < pages.length ? { type: 'live/go', presentationId: p.id, seq, playlistIndex: s.cursor!.playlistIndex ?? null, now: Date.now() } : null);
  if (a.kind === 'first') return go(pages.findIndex((x) => !x.slide.disabled));
  if (a.kind === 'last') { for (let i = pages.length - 1; i >= 0; i--) if (!pages[i].slide.disabled) return go(i); return null; }
  if (a.kind === 'lastViewed') { const n = lastViewed(history, s.cursor.seq); return n == null ? null : go(n); }
  // A custom show starts at its first slide that is still in the presentation (the projector follows the console's order).
  if (a.kind === 'customShow') {
    const ids = p.customShows?.find((c) => c.id === ('show' in a ? a.show : undefined))?.slideIds ?? [];
    for (const id of ids) { const n = pages.findIndex((x) => x.slide.id === id); if (n >= 0) return go(n); }
    return null;
  }
  const id = a.kind === 'zoom' ? a.slideId : a.slideId;
  return id ? go(pages.findIndex((x) => x.slide.id === id)) : null;
}
