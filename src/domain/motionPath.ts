import type { Slide, SlideAnimation, SlideElement } from './types';
import { customMotionPath, motionPathPoints } from './animations';
import { addAnimation, setAnimation } from './editOps';
import { sampleTimeline, type AnimSpec } from '../engine';

type Pt = [number, number];

/** The Custom Path effect as the gallery knows it (PowerPoint's default: 2 s, on click). */
const CUSTOM_PATH = { id: 'customPath', class: 'path' as const, durationMs: 2000, options: [] as string[] };

/** The object's centre — where a motion path starts. */
export const centreOf = (el: Pick<SlideElement, 'x' | 'y' | 'w' | 'h'>): Pt => [el.x + el.w / 2, el.y + el.h / 2];

/**
 * The drawn points as they start: a path always leaves from the object's centre, so a first click
 * elsewhere gets the centre put in front of it (PowerPoint does the same).
 */
export function startAtCentre(points: Pt[], centre: Pt, near = 4): Pt[] {
  if (!points.length) return [centre];
  return Math.hypot(points[0][0] - centre[0], points[0][1] - centre[1]) <= near ? [centre, ...points.slice(1)] : [centre, ...points];
}

/** Points drawn on the canvas (a double-click lands twice, a drag lands many times on one spot) cleaned up. */
export function dedupePoints(points: Pt[], min = 2): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) >= min) out.push(p);
  return out;
}

/** What a finished drawing stores: the engine path (slide fractions from the centre), or null when nothing was drawn. */
export function drawnMotionPath(points: Pt[], centre: Pt, closed: boolean): string | null {
  const pts = dedupePoints(startAtCentre(points, centre));
  if (pts.length < 2) return null;
  return customMotionPath(pts, closed && pts.length > 2);
}

/**
 * The slide's animations with a Custom Path for `elementId`: it replaces what the object does
 * (Animation gallery) or comes after it (Add Animation).
 */
export function withCustomPath(slide: Slide, elementId: string, path: string, add: boolean): SlideAnimation[] {
  const list = (add ? addAnimation(slide, [elementId], CUSTOM_PATH) : setAnimation(slide, [elementId], CUSTOM_PATH)) ?? [];
  const last = list[list.length - 1];
  return list.map((a) => (a === last ? { ...a, start: 'click', durationMs: 2000, delayMs: 0, path } : a));
}

/** A preset motion path (Lines, Arcs, Shapes…) traced by the engine itself: where the centre goes over the effect. */
export function presetMotionPoints(a: SlideAnimation, el: SlideElement, samples = 48): Pt[] {
  const spec: AnimSpec = {
    anims: [{ elementId: el.id, effect: a.effect, class: 'path', option: a.option ?? '', start: 'click', durationMs: a.durationMs, delayMs: 0, repeat: 1 }],
    boxes: [{ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rotation ?? 0 }],
  };
  const [cx, cy] = centreOf(el);
  const out: Pt[] = [];
  const secs = Math.max(0.01, a.durationMs / 1000);
  for (let i = 0; i <= samples; i++) {
    const st = sampleTimeline(spec, 0, (secs * i) / samples)?.[el.id];
    if (!st) return [];
    out.push([cx + st.dx, cy + st.dy]);
  }
  return dedupePoints(out, 0.5);
}

export interface MotionPathOverlay { id: string; elementId: string; points: Pt[]; closed: boolean }

/** The motion paths of the given objects as the editor draws them (dashed, green start, red end). */
export function motionPathOverlays(slide: Slide, elements: SlideElement[], ids: string[]): MotionPathOverlay[] {
  const out: MotionPathOverlay[] = [];
  for (const a of slide.animations ?? []) {
    if (a.class !== 'path' || !ids.includes(a.elementId)) continue;
    const el = elements.find((e) => e.id === a.elementId);
    if (!el) continue;
    const [cx, cy] = centreOf(el);
    const points = a.path ? motionPathPoints(a.path, cx, cy) : presetMotionPoints(a, el);
    if (points.length < 2) continue;
    const closed = a.path ? /Z/.test(a.path) : Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) < 1;
    out.push({ id: a.id, elementId: el.id, points, closed });
  }
  return out;
}

/** The arrowhead at a point of the path, pointing along it (the start, or the end when `atEnd`). */
export function pathArrow(points: Pt[], atEnd: boolean, size: number): Pt[] {
  const n = points.length;
  const tip = atEnd ? points[n - 1] : points[0];
  // The direction of travel there (skipping points on top of each other).
  let from = tip, to = tip;
  if (atEnd) { for (let i = n - 2; i >= 0; i--) if (Math.hypot(points[i][0] - tip[0], points[i][1] - tip[1]) > 0.5) { from = points[i]; break; } }
  else { for (let i = 1; i < n; i++) if (Math.hypot(points[i][0] - tip[0], points[i][1] - tip[1]) > 0.5) { to = points[i]; break; } }
  const ang = atEnd ? Math.atan2(tip[1] - from[1], tip[0] - from[0]) : Math.atan2(to[1] - tip[1], to[0] - tip[0]);
  const c = Math.cos(ang), s = Math.sin(ang);
  const r = (x: number, y: number): Pt => [tip[0] + x * c - y * s, tip[1] + x * s + y * c];
  // An arrowhead centred on the point: tip ahead, base behind.
  return [r(size * 0.6, 0), r(-size * 0.5, -size * 0.55), r(-size * 0.5, size * 0.55)];
}
