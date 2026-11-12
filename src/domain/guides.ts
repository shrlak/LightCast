// View › Guides and Grid Options as DeckCraft does them (guide.add / move / delete, view.gridOptions):
// drawing guides are part of the presentation, kept on the slide, at whole points while dragged, and
// deleted when dropped off the slide; turning guides on gives a presentation without any the two
// centre guides. Positions here are canvas px (2 px = 1 pt).
import { CANVAS_H, CANVAS_W } from './canvas';

export interface Guides { v: number[]; h: number[] }
export type GuideAxis = 'v' | 'h';

/** DeckCraft's MAX_GUIDES. */
export const MAX_GUIDES = 200;
const limit = (axis: GuideAxis) => (axis === 'v' ? CANVAS_W : CANVAS_H);
export const guideCount = (g?: Guides | null) => (g ? g.v.length + g.h.length : 0);

/** The two centre guides PowerPoint (and DeckCraft's `guide.add {defaults}`) starts with. */
export const defaultGuides = (): Guides => ({ v: [CANVAS_W / 2], h: [CANVAS_H / 2] });

/** A guide position kept on the slide. */
export const clampGuide = (axis: GuideAxis, pos: number) => Math.min(limit(axis), Math.max(0, Number.isFinite(pos) ? pos : limit(axis) / 2));

/** Guides with one more on `axis` (at the centre unless `pos`), or null when there are too many. */
export function addGuide(g: Guides | null | undefined, axis: GuideAxis, pos?: number): Guides | null {
  const cur = g ?? { v: [], h: [] };
  if (guideCount(cur) >= MAX_GUIDES) return null;
  return { ...cur, [axis]: [...cur[axis], clampGuide(axis, pos ?? limit(axis) / 2)] };
}

/** The guide within `tol` px of the point (the nearest), as DeckCraft's `guide_at`. */
export function guideAt(g: Guides | null | undefined, x: number, y: number, tol: number): { axis: GuideAxis; index: number } | null {
  if (!g) return null;
  let best: { axis: GuideAxis; index: number; d: number } | null = null;
  g.v.forEach((pos, index) => { const d = Math.abs(x - pos); if (d <= Math.max(tol, 2) && (!best || d < best.d)) best = { axis: 'v', index, d }; });
  g.h.forEach((pos, index) => { const d = Math.abs(y - pos); if (d <= Math.max(tol, 2) && (!best || d < best.d)) best = { axis: 'h', index, d }; });
  const b = best as { axis: GuideAxis; index: number; d: number } | null;
  return b ? { axis: b.axis, index: b.index } : null;
}

/** Where a dragged guide is: on whole points (2 px) unless snapping is off (Alt). */
export const dragGuidePos = (pos: number, snap = true) => (snap ? Math.round(pos / 2) * 2 : pos);

/** A guide dropped at `pos`: moved there (kept on the slide), or deleted when dropped off it. */
export function dropGuide(g: Guides, axis: GuideAxis, index: number, pos: number): Guides {
  if (index < 0 || index >= g[axis].length) return g;
  const off = pos < 0 || pos > limit(axis);
  return { ...g, [axis]: off ? g[axis].filter((_, i) => i !== index) : g[axis].map((p, i) => (i === index ? clampGuide(axis, pos) : p)) };
}

/** A guide's position as the label beside it shows it: from the slide's centre, in cm (PowerPoint). */
export function guideLabel(axis: GuideAxis, pos: number): string {
  return (Math.abs(pos - limit(axis) / 2) / 144 * 2.54).toFixed(2);
}

// ── Grid Options ─────────────────────────────────────────────────────────────────────────────────
/** The grid's spacing, in pt (DeckCraft's view.gridOptions accepts 1–288). */
export const GRID_MIN_PT = 1;
export const GRID_MAX_PT = 288;
/** LightCast's grid has always been 15 pt (30 canvas px). */
export const DEFAULT_GRID_PX = 30;

/** PowerPoint's spacing choices (Korean UI: centimetres), as pt. */
export const GRID_PRESETS: [string, number][] = [
  ['0.1 cm', 72 / 25.4], ['0.2 cm', (72 / 25.4) * 2], ['0.25 cm', (72 / 25.4) * 2.5], ['0.5 cm', (72 / 25.4) * 5],
  ['1 cm', 72 / 2.54], ['15 pt (기본)', 15], ['2 cm', (72 / 2.54) * 2], ['5 cm', (72 / 2.54) * 5],
];

/** A spacing typed in the dialog, in pt → canvas px; an error message when it is out of range. */
export function parseGridSpacing(v: string | number): { px: number } | { error: string } {
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/pt$/i, ''));
  if (!Number.isFinite(n)) return { error: '간격은 숫자(pt)로 입력하세요.' };
  if (n < GRID_MIN_PT || n > GRID_MAX_PT) return { error: `간격은 ${GRID_MIN_PT}~${GRID_MAX_PT}pt 사이여야 합니다.` };
  return { px: n * 2 };
}

/** The grid as drawn on screen: its step in screen px, or null when it would be too dense to show (DeckCraft grid_line_step). */
export function gridStep(spacingPx: number, scale: number): number | null {
  const step = spacingPx * scale;
  return Number.isFinite(step) && step >= 4 ? step : null;
}
