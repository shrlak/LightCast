// Clicking an object in the slide show (Insert › Action, links, slide zooms): what it does. Shared
// by the in-app slide show (Reading view) and the projector window, which asks the console to act.
import type { ElementAction, Slide, SlideElement } from './types';
import type { Action, AppState } from './reducer';
import { sequence } from './arrangement';
import { findPres } from './live';

export type ShowAction = ElementAction | { kind: 'zoom'; slideId: string };

/** The object with a click action (Action Settings, a link or a slide zoom) under a canvas point. */
export function actionAt(slide: Slide | null | undefined, x: number, y: number): SlideElement | null {
  const els = [...(slide?.elements ?? [])].reverse();
  return els.find((e) => !e.hidden && (e.action || e.href || (e.kind === 'zoom' && e.targetSlideId)) && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + Math.max(e.h, 1)) ?? null;
}

export function actionOf(el: SlideElement): ShowAction | null {
  if (el.kind === 'zoom' && el.targetSlideId) return { kind: 'zoom', slideId: el.targetSlideId };
  return el.action ?? (el.href ? { kind: 'url', url: el.href } : null);
}

/** The console's live action for a show action (null: nothing to do there — a link opens where it was clicked). */
export function liveActionFor(s: Pick<AppState, 'cursor' | 'library'>, a: ShowAction): Action | null {
  if (a.kind === 'next') return { type: 'live/next', now: Date.now() };
  if (a.kind === 'prev') return { type: 'live/prev' };
  if (a.kind === 'url' || a.kind === 'end' || !s.cursor) return null;
  const p = findPres(s.library, s.cursor.presentationId);
  if (!p) return null;
  const pages = sequence(p);
  const go = (seq: number): Action | null => (seq >= 0 && seq < pages.length ? { type: 'live/go', presentationId: p.id, seq, playlistIndex: s.cursor!.playlistIndex ?? null, now: Date.now() } : null);
  if (a.kind === 'first') return go(pages.findIndex((x) => !x.slide.disabled));
  if (a.kind === 'last') { for (let i = pages.length - 1; i >= 0; i--) if (!pages[i].slide.disabled) return go(i); return null; }
  const id = a.kind === 'zoom' ? a.slideId : a.slideId;
  return id ? go(pages.findIndex((x) => x.slide.id === id)) : null;
}
