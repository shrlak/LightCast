// Tab stops and the ruler, as in PowerPoint (DeckCraft format.tabs / format.ruler): a tab in a line
// of text moves what follows it to the next stop, aligned at that stop's left, centre, right or
// decimal point; past the last stop it goes to the next multiple of the default tab spacing.
// Positions are canvas pixels from the left of the text area (inside the box's margins).
import { CANVAS_W } from './canvas';
import type { SlideElement } from './types';
import { INDENT_PX } from './textFormat';

export type TabAlign = 'left' | 'center' | 'right' | 'decimal';
export interface TabStop { pos: number; align: TabAlign }

/** PowerPoint's default tab spacing: 1 inch (2.54 cm, 72 pt). */
export const DEFAULT_TAB = 144;
export const MAX_TABS = 32;
const MAX_POS = 8000;
/** The 4:3 slide is 25.4 cm wide on a 1440-pixel canvas. */
export const PX_PER_CM = CANVAS_W / 25.4;
export const cmToPx = (cm: number) => cm * PX_PER_CM;
export const pxToCm = (px: number) => px / PX_PER_CM;

export const TAB_ALIGNS: [TabAlign, string][] = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['decimal', '소수점']];

/** An alignment by any of its names (DeckCraft's l / ctr / r / dec too); null for anything else. */
export function tabAlignOf(s: unknown): TabAlign | null {
  switch (s) {
    case 'l': case 'left': return 'left';
    case 'ctr': case 'center': return 'center';
    case 'r': case 'right': return 'right';
    case 'dec': case 'decimal': return 'decimal';
    default: return null;
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 1;
const clampPos = (n: number) => Math.min(MAX_POS, Math.max(0, n));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface TabEdit {
  /** Replace every stop (entries without a usable position are dropped). */
  set?: { pos: unknown; align?: unknown }[];
  add?: { pos: number; align?: TabAlign };
  move?: { from: number; to: number };
  remove?: number;
  clear?: boolean;
}

/**
 * The stops after an edit, as DeckCraft's format.tabs: a stop added where one already is (within a
 * pixel) replaces it, the result is sorted, duplicates collapse and at most 32 are kept.
 */
export function editTabs(stops: readonly TabStop[] | undefined, edit: TabEdit): TabStop[] {
  let out: TabStop[] = edit.clear ? [] : edit.set
    ? edit.set.filter((t) => finite(t.pos)).map((t) => ({ pos: clampPos(t.pos as number), align: tabAlignOf(t.align) ?? 'left' }))
    : (stops ?? []).map((t) => ({ ...t }));
  if (edit.set) {
    // Stops set at (nearly) the same place: the last one wins.
    const merged: TabStop[] = [];
    for (const t of out) {
      const prev = merged.findIndex((m) => Math.abs(m.pos - t.pos) < 0.1);
      if (prev >= 0) merged[prev] = t; else merged.push(t);
    }
    out = merged;
  }
  if (finite(edit.remove)) out = out.filter((t) => !near(t.pos, clampPos(edit.remove!)));
  if (edit.move && finite(edit.move.from) && finite(edit.move.to)) {
    const t = out.find((s) => near(s.pos, clampPos(edit.move!.from)));
    if (t) t.pos = clampPos(edit.move.to);
  }
  if (edit.add && finite(edit.add.pos)) {
    const pos = clampPos(edit.add.pos);
    out = out.filter((t) => !near(t.pos, pos));
    out.push({ pos, align: edit.add.align ?? 'left' });
  }
  out.sort((a, b) => a.pos - b.pos);
  return out.filter((t, i) => i === 0 || !near(t.pos, out[i - 1].pos)).slice(0, MAX_TABS);
}

/** The element patch for new stops (no stops: the property goes). */
export const tabsPatch = (stops: TabStop[]): Partial<SlideElement> => ({ tabStops: stops.length ? stops : undefined });

/** Default tab spacing kept to something usable (1 px … 22 inches). */
export const clampDefaultTab = (px: number) => (Number.isFinite(px) ? Math.min(3168, Math.max(2, px)) : DEFAULT_TAB);

/** A piece of a line after a tab: its width and its width before the first '.' (decimal stops). */
export interface TabSegment { w: number; dec: number }

/**
 * How far a tab at `x` advances: to the next stop past x, placing the text after it (`seg`) as the
 * stop aligns it but never moving back; past the last stop, to the next default stop.
 */
export function tabAdvance(x: number, stops: readonly TabStop[], defaultTab: number, seg: TabSegment): number {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const next = Number.isNaN(x) ? undefined : sorted.find((s) => s.pos > x + 1);
  if (next) {
    const to = next.pos - x;
    switch (next.align) {
      case 'right': return Math.max(0, to - seg.w);
      case 'center': return Math.max(0, to - seg.w / 2);
      case 'decimal': return Math.max(0, to - seg.dec);
      default: return to;
    }
  }
  const d = defaultTab > 1 ? defaultTab : DEFAULT_TAB;
  const at = Number.isFinite(x) ? x : 0;
  return Math.max(1, (Math.floor(at / d) + 1) * d - at);
}

/**
 * A line split at its tabs, laid out from `start` (where the line begins in the text area): the x of
 * each segment and the width each tab takes.
 */
export function layoutTabLine(start: number, segs: readonly TabSegment[], stops: readonly TabStop[], defaultTab: number): { x: number[]; gaps: number[] } {
  const x: number[] = [], gaps: number[] = [];
  let cur = start;
  segs.forEach((s, i) => {
    if (i > 0) {
      const gap = tabAdvance(cur, stops, defaultTab, s);
      gaps.push(gap);
      cur += gap;
    }
    x.push(cur);
    cur += s.w;
  });
  return { x, gaps };
}

/** Where the text before the first '.' ends in a segment (its whole length when it has none). */
export const decimalAt = (text: string) => { const i = text.indexOf('.'); return i < 0 ? text.length : i; };

/** A line's runs split at its tabs: one list of runs per segment (tabs themselves dropped). */
export function splitRunsAtTabs<R extends { text: string }>(runs: readonly R[]): R[][] {
  const out: R[][] = [[]];
  for (const r of runs) {
    r.text.split('\t').forEach((part, i) => {
      if (i > 0) out.push([]);
      if (part) out[out.length - 1].push({ ...r, text: part });
    });
  }
  return out;
}

// ── The ruler ─────────────────────────────────────────────────────────────────────────────────

export interface RulerTick { px: number; kind: 'major' | 'half' | 'minor'; label?: number }

/**
 * Ruler marks every quarter centimetre between `from` and `to` (canvas px), counted from `origin`
 * (PowerPoint numbers both ways from it): whole centimetres are labelled.
 */
export function rulerTicks(from: number, to: number, origin: number): RulerTick[] {
  const out: RulerTick[] = [];
  const q = PX_PER_CM / 4;
  for (let i = Math.ceil((from - origin) / q - 1e-9); origin + i * q <= to + 1e-9; i++) {
    const px = origin + i * q;
    const kind = i % 4 === 0 ? 'major' : i % 2 === 0 ? 'half' : 'minor';
    out.push({ px, kind, ...(kind === 'major' ? { label: Math.abs(i / 4) } : {}) });
  }
  return out;
}

/** Snap to the ruler's eighth-centimetre steps. */
export const snapRuler = (px: number) => Math.round(px / (PX_PER_CM / 8)) * (PX_PER_CM / 8);

/** Where a text box's indents sit on its ruler (px from the text area's left). */
export function indentMarkers(el: Pick<SlideElement, 'indent' | 'firstIndent'>): { left: number; first: number } {
  const left = (el.indent ?? 0) * INDENT_PX;
  return { left, first: left + (el.firstIndent ?? 0) };
}

/**
 * Dragging an indent marker, as in PowerPoint: the first-line triangle moves the first line only;
 * the hanging triangle moves the other lines and leaves the first line where it is; the box under
 * it moves both.
 */
export function dragIndent(el: Pick<SlideElement, 'indent' | 'firstIndent'>, marker: 'first' | 'hanging' | 'left', to: number): Pick<SlideElement, 'indent' | 'firstIndent'> {
  const cur = indentMarkers(el);
  const pos = Math.max(0, to);
  let left = cur.left, first = cur.first;
  if (marker === 'first') first = pos;
  else if (marker === 'hanging') left = pos;
  else { first = Math.max(0, pos + (cur.first - cur.left)); left = pos; }
  const level = Math.round((left / INDENT_PX) * 1000) / 1000;
  const fi = Math.round((first - left) * 100) / 100;
  return { indent: level || undefined, firstIndent: fi || undefined };
}
