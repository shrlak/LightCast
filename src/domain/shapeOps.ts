// Shapes on the slide as DeckCraft handles them (crates/engine/src/tools/{drag,hit}.rs,
// cmd/shape/{size,freeform}.rs, cmd/edit.rs, keys.rs): drawing a new shape, sizing past the
// opposite edge, line ends, the Size and Position dialog, Tab order, Select All, duplicate,
// locked objects and the selection pane's reordering. Canvas pixels throughout (2 px per point).
import type { SlideElement } from './types';
import type { Handle } from '../engine';

export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

/** Arrow keys move objects 6 pt; with Ctrl (DeckCraft: Alt) 1 pt. */
export const NUDGE = 12;
export const FINE_NUDGE = 2;
/** Duplicate and repeated paste set copies off by 12 pt. */
export const DUPLICATE_OFFSET = 24;
/** A click with a shape tool (no drag) draws it 72 pt across, from the click. */
export const CLICK_SIZE = 144;
/** Pictures, video and the like keep their proportions unless told otherwise. */
const KEEP_ASPECT = new Set(['image', 'icon', 'qr', 'camera', 'video']);
/** 가로 세로 비율 고정: the object's own setting, or on for pictures. */
export const aspectLocked = (el: SlideElement) => el.lockAspect ?? KEEP_ASPECT.has(el.kind);

// ── Drawing a new shape ─────────────────────────────────────────────────────────────────────────

/** The end of a line from `a` towards `b`, turned to the nearest 45° (Shift while drawing a line). */
export function constrain45(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(a[0] + Math.cos(ang) * len), r(a[1] + Math.sin(ang) * len)];
}

/**
 * The box a shape-tool drag from (x0, y0) to (x1, y1) draws: Shift makes it square (circle), Ctrl
 * grows it out from the start point in every direction (DeckCraft's drag_create, Alt there).
 */
export function drawBox(x0: number, y0: number, x1: number, y1: number, opts: { square?: boolean; fromCenter?: boolean } = {}): Box {
  let dx = x1 - x0, dy = y1 - y0;
  if (opts.square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  if (opts.fromCenter) return { x: x0 - Math.abs(dx), y: y0 - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** A click with a shape tool: 72 pt with its top-left corner at the click (a line: 72 pt across). */
export const clickBox = (x: number, y: number, line: boolean): Box => ({ x: Math.round(x), y: Math.round(y), w: CLICK_SIZE, h: line ? 0 : CLICK_SIZE });

/** Path data through `pts` (shape-local): straight segments, or a Catmull-Rom curve as cubics (DeckCraft's freeform_path). */
export function freeformPath(pts: Pt[], closed: boolean, smooth: boolean): string {
  const f = (v: number) => String(Math.round(v * 100) / 100);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const n = pts.length;
  if (smooth && n > 2) {
    const at = (i: number): Pt => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
    }
  } else {
    for (const q of pts.slice(1)) d += ` L${f(q[0])} ${f(q[1])}`;
  }
  return closed ? `${d} Z` : d;
}

/** A scribble that ends back at its start (within 6 pt) closes into a filled shape. */
export const scribbleCloses = (pts: Pt[]) => pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 12;

// ── Sizing handles ──────────────────────────────────────────────────────────────────────────────
export interface FBox extends Box { rot?: number; flipH?: boolean; flipV?: boolean }

const HX: Record<Handle, number> = { nw: -1, n: 0, ne: 1, e: 1, se: 1, s: 0, sw: -1, w: -1 };
const HY: Record<Handle, number> = { nw: -1, n: -1, ne: -1, e: 0, se: 1, s: 1, sw: 1, w: 0 };

/**
 * The box after dragging sizing handle `handle` by (dx, dy) on the slide, in the object's turned
 * frame: Shift keeps the proportions, Ctrl sizes from the centre, and dragging past the opposite
 * edge flips the object (DeckCraft's resize_box).
 */
export function resizeFlip(o: FBox, handle: Handle, dx: number, dy: number, keepAspect: boolean, fromCenter: boolean, min = 1): Required<Pick<FBox, 'x' | 'y' | 'w' | 'h'>> & { flipH?: boolean; flipV?: boolean } {
  const rad = ((o.rot ?? 0) * Math.PI) / 180;
  const lx = dx * Math.cos(rad) + dy * Math.sin(rad), ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
  const hx = HX[handle], hy = HY[handle];
  let l = 0, t = 0, r = o.w, b = o.h;
  if (fromCenter) {
    // Both sides grow by what the dragged one moved.
    const gw = hx * lx, gh = hy * ly;
    l = -gw; r = o.w + gw;
    t = -gh; b = o.h + gh;
  } else {
    if (hx < 0) l += lx; else if (hx > 0) r += lx;
    if (hy < 0) t += ly; else if (hy > 0) b += ly;
  }
  if (keepAspect && o.w > 0 && o.h > 0) {
    const ar = o.w / o.h;
    let w = r - l, h = b - t;
    const sign = (v: number) => (v < 0 ? -1 : 1);
    if (hx && hy) {
      if (Math.abs(w / ar) > Math.abs(h)) h = (Math.abs(w) / ar) * sign(h); else w = Math.abs(h) * ar * sign(w);
    } else if (hx) h = Math.abs(w) / ar;
    else w = Math.abs(h) * ar;
    if (fromCenter || !hx) { l = o.w / 2 - w / 2; r = o.w / 2 + w / 2; } else if (hx < 0) l = r - w; else r = l + w;
    if (fromCenter || !hy) { t = o.h / 2 - h / 2; b = o.h / 2 + h / 2; } else if (hy < 0) t = b - h; else b = t + h;
  }
  let flipH = !!o.flipH, flipV = !!o.flipV;
  if (r < l) { [l, r] = [r, l]; flipH = !flipH; }
  if (b < t) { [t, b] = [b, t]; flipV = !flipV; }
  // Never thinner than `min`: grow about the side that moved.
  if (r - l < min) { if (hx < 0) l = r - min; else r = l + min; }
  if (b - t < min) { if (hy < 0) t = b - min; else b = t + min; }
  const w = r - l, h = b - t;
  // The new centre: the old one moved by the turned shift of the local centre.
  const ox = (l + r) / 2 - o.w / 2, oy = (t + b) / 2 - o.h / 2;
  const cx = o.x + o.w / 2 + ox * Math.cos(rad) - oy * Math.sin(rad), cy = o.y + o.h / 2 + ox * Math.sin(rad) + oy * Math.cos(rad);
  return { x: cx - w / 2, y: cy - h / 2, w, h, ...(flipH ? { flipH: true } : {}), ...(flipV ? { flipV: true } : {}) };
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────────────

/** A point of an object's own (unturned, unflipped) box on the slide. */
export function localToSlide(el: FBox, lx: number, ly: number): Pt {
  let x = lx - el.w / 2, y = ly - el.h / 2;
  if (el.flipH) x = -x;
  if (el.flipV) y = -y;
  const a = ((el.rot ?? 0) * Math.PI) / 180;
  return [el.x + el.w / 2 + x * Math.cos(a) - y * Math.sin(a), el.y + el.h / 2 + x * Math.sin(a) + y * Math.cos(a)];
}

/** Where a line starts and ends on the slide (its flips say which way it runs). */
export const lineEnds = (el: FBox): [Pt, Pt] => [localToSlide(el, 0, 0), localToSlide(el, el.w, el.h)];

/** A line's box for ends `a` → `b` (DeckCraft's line_xfrm). */
export function lineFrom(a: Pt, b: Pt): Pick<SlideElement, 'x' | 'y' | 'w' | 'h' | 'flipH' | 'flipV' | 'rotation'> {
  return { x: Math.round(Math.min(a[0], b[0])), y: Math.round(Math.min(a[1], b[1])), w: Math.round(Math.abs(b[0] - a[0])), h: Math.round(Math.abs(b[1] - a[1])), flipH: b[0] < a[0] || undefined, flipV: b[1] < a[1] || undefined, rotation: undefined };
}

/** One end of a line dragged to `to` (Shift: in 45° steps from the other end). */
export function moveLineEnd(el: SlideElement, end: 0 | 1, to: Pt, constrain = false) {
  const [p0, p1] = lineEnds({ ...el, rot: el.rotation });
  const other = end === 0 ? p1 : p0;
  const q = constrain ? constrain45(other, to) : to;
  return lineFrom(end === 0 ? q : p0, end === 0 ? p1 : q);
}

// ── Size and Position dialog (cmd/shape/size.rs) ────────────────────────────────────────────────
export interface SizeSpec { x?: number; y?: number; w?: number; h?: number; rot?: number; scaleW?: number; scaleH?: number; lockAspect?: boolean }

/** A box after the dialog's values: scale (%) then size; with the aspect locked, the width wins. */
export function applySize(b: Box & { rot?: number }, s: SizeSpec): Box & { rot: number } {
  const ar = b.h > 0 ? b.w / b.h : 1;
  let w = b.w, h = b.h;
  if (s.scaleW !== undefined) w = (b.w * s.scaleW) / 100;
  if (s.scaleH !== undefined) h = (b.h * s.scaleH) / 100;
  if (s.w !== undefined) w = s.w;
  if (s.h !== undefined) h = s.h;
  const wSet = s.w !== undefined || s.scaleW !== undefined, hSet = s.h !== undefined || s.scaleH !== undefined;
  if (s.lockAspect && (wSet || hSet)) {
    if (wSet) h = ar > 0 ? w / ar : h; else w = h * ar;
  }
  const clamp = (v: number) => Math.max(1, Math.min(31680, Number.isFinite(v) ? v : 1));
  const rot = s.rot !== undefined ? ((s.rot % 360) + 360) % 360 : (b.rot ?? 0);
  return { x: s.x ?? b.x, y: s.y ?? b.y, w: clamp(w), h: clamp(h), rot };
}

/** Canvas pixels ↔ centimetres (a 1440-wide slide is 25.4 cm). */
export const PX_PER_CM = 1440 / 25.4;
export const toCm = (px: number) => Math.round((px / PX_PER_CM) * 100) / 100;
export const fromCm = (cm: number) => cm * PX_PER_CM;

// ── Selection ───────────────────────────────────────────────────────────────────────────────────

/** Objects a click, Tab or the selection pane can reach on the slide (not hidden, not the master's). */
const onSlide = (els: SlideElement[]) => els.filter((e) => !e.hidden && !e.master);

/** Select All (Ctrl+A): every object shown, except locked ones (DeckCraft's edit.selectAll). */
export const selectAllIds = (els: SlideElement[]) => onSlide(els).filter((e) => !e.locked).map((e) => e.id);

/**
 * Tab / Shift+Tab: the next (previous) object in drawing order, a group counting once; with nothing
 * selected the first (last) one (DeckCraft's cycle_selection).
 */
export function cycleSelection(els: SlideElement[], sel: string[], forward: boolean): string | null {
  const units: { id: string; members: string[] }[] = [];
  for (const e of onSlide(els)) {
    if (e.groupId) {
      if (units.some((u) => u.id === `g:${e.groupId}`)) continue;
      units.push({ id: `g:${e.groupId}`, members: onSlide(els).filter((x) => x.groupId === e.groupId).map((x) => x.id) });
    } else units.push({ id: e.id, members: [e.id] });
  }
  if (!units.length) return null;
  const cur = units.findIndex((u) => u.members.includes(sel[0]));
  const n = units.length;
  const next = cur < 0 ? (forward ? 0 : n - 1) : (cur + (forward ? 1 : n - 1)) % n;
  return units[next].members[0];
}

/** The ids an edit that moves, sizes or turns objects may change: a locked object (or a group with one) stays put. */
export function movableIds(els: SlideElement[], ids: string[]): string[] {
  const lockedGroups = new Set(els.filter((e) => e.locked && e.groupId).map((e) => e.groupId));
  return ids.filter((id) => { const e = els.find((x) => x.id === id); return !!e && !e.locked && !(e.groupId && lockedGroups.has(e.groupId)); });
}

/**
 * Selection pane drag: object `id` (with its group) goes to where `target` is in the drawing order,
 * above it when `above` (the pane lists front to back).
 */
export function moveInOrder(els: SlideElement[], id: string, target: string, above: boolean): SlideElement[] {
  const src = els.find((e) => e.id === id);
  if (!src || id === target) return els;
  const moving = els.filter((e) => e.id === id || (src.groupId && e.groupId === src.groupId));
  if (moving.some((e) => e.id === target)) return els;
  const rest = els.filter((e) => !moving.includes(e));
  const tEl = rest.find((e) => e.id === target);
  if (!tEl) return els;
  // A target in a group: land beside the whole group, never inside it.
  const block = tEl.groupId ? rest.map((e, i) => (e.groupId === tEl.groupId ? i : -1)).filter((i) => i >= 0) : [rest.indexOf(tEl)];
  const at = above ? Math.max(...block) + 1 : Math.min(...block);
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** What a click on a hidden object in the selection pane does: shows it (DeckCraft's selection.select). */
export const revealOnPick = (els: SlideElement[], id: string) => (els.find((e) => e.id === id)?.hidden ? els.map((e) => (e.id === id ? { ...e, hidden: undefined } : e)) : els);

// ── Duplicate (cmd/edit.rs) ─────────────────────────────────────────────────────────────────────

/** The copies the last Duplicate made, by the object each was copied from. */
export interface LastDuplicate { pairs: [string, string][] }

/**
 * How far Duplicate sets the copies off: when the selection is exactly the copies the last
 * Duplicate made, the same distance they have been moved from their originals since (so duplicating
 * repeats a spacing, DeckCraft #966); otherwise 12 pt.
 */
export function duplicateOffset(els: SlideElement[], sel: string[], last: LastDuplicate | null): [number, number] {
  if (last && last.pairs.length && last.pairs.length === sel.length && last.pairs.every(([, c]) => sel.includes(c))) {
    const [src, copy] = last.pairs[0];
    const a = els.find((e) => e.id === src), b = els.find((e) => e.id === copy);
    if (a && b) return [b.x - a.x, b.y - a.y];
  }
  return [DUPLICATE_OFFSET, DUPLICATE_OFFSET];
}
