// What the PowerPoint commands do to a slide's objects: Arrange (order, align, distribute, group,
// rotate, flip), clipboard, duplicate, nudge, Format Painter, and the objects Insert makes. The
// geometry of every one of them is worked out by the Rust engine (src/engine); these functions
// apply its answers to FreeCast's slide objects.
import type { Slide, SlideAnimation, SlideElement } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { uid } from './lyrics';
import {
  alignBoxes, boundsOf, distributeBoxes, flipBoxes, newTable, orderIds, recognizeInk, rotateBoxes, shapeCatalog, smoothInk,
  type AlignEdge, type ChartData, type ChartKind, type EBox, type OrderHow,
} from '../engine';

export type Elements = SlideElement[];

export const boxOf = (e: SlideElement): EBox => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rotation ?? 0 });

/** The ids to act on for a selection: every member of a group any selected object belongs to. */
export function expandSelection(els: Elements, sel: string[]): string[] {
  const groups = new Set(els.filter((e) => sel.includes(e.id) && e.groupId).map((e) => e.groupId));
  return els.filter((e) => sel.includes(e.id) || (e.groupId && groups.has(e.groupId))).map((e) => e.id);
}

/**
 * The selection as the units Arrange works on: each group counts as one box (its bounds), each
 * other object as itself. `members` are the object ids a unit moves.
 */
export function selectionUnits(els: Elements, sel: string[]): { box: EBox; members: string[] }[] {
  const ids = expandSelection(els, sel);
  const seen = new Set<string>();
  const out: { box: EBox; members: string[] }[] = [];
  for (const e of els) {
    if (!ids.includes(e.id) || seen.has(e.id)) continue;
    if (e.groupId) {
      const members = els.filter((x) => x.groupId === e.groupId);
      members.forEach((m) => seen.add(m.id));
      const b = boundsOf(members.map(boxOf)) ?? boxOf(e);
      out.push({ box: { id: `group:${e.groupId}`, x: b.x, y: b.y, w: b.w, h: b.h, rot: 0 }, members: members.map((m) => m.id) });
    } else {
      seen.add(e.id);
      out.push({ box: boxOf(e), members: [e.id] });
    }
  }
  return out;
}

const moveBy = (els: Elements, deltas: Map<string, { dx: number; dy: number }>): Elements =>
  els.map((e) => { const d = deltas.get(e.id); return d && (d.dx || d.dy) ? { ...e, x: Math.round(e.x + d.dx), y: Math.round(e.y + d.dy) } : e; });

function applyUnitDeltas(els: Elements, units: { box: EBox; members: string[] }[], deltas: { id: string; dx: number; dy: number }[]): Elements {
  const map = new Map<string, { dx: number; dy: number }>();
  for (const d of deltas) units.find((u) => u.box.id === d.id)?.members.forEach((m) => map.set(m, d));
  return moveBy(els, map);
}

/** 맞춤: one object (or 슬라이드에 맞춤) aligns to the slide, several align to each other. */
export function alignSelection(els: Elements, sel: string[], edge: AlignEdge, toSlide = false): Elements {
  const units = selectionUnits(els, sel);
  if (!units.length) return els;
  return applyUnitDeltas(els, units, alignBoxes(units.map((u) => u.box), edge, toSlide || units.length < 2 ? 'slide' : 'selection'));
}

/** 가로 / 세로 간격을 동일하게. */
export function distributeSelection(els: Elements, sel: string[], dir: 'horizontal' | 'vertical', toSlide = false): Elements {
  const units = selectionUnits(els, sel);
  if (!units.length) return els;
  return applyUnitDeltas(els, units, distributeBoxes(units.map((u) => u.box), dir, toSlide || units.length < 3 ? 'slide' : 'selection'));
}

/** 맨 앞으로 / 앞으로 / 뒤로 / 맨 뒤로 가져오기. */
export function orderSelection(els: Elements, sel: string[], how: OrderHow): Elements {
  const ids = expandSelection(els, sel);
  const order = orderIds(els.map((e) => e.id), ids, how);
  const byId = new Map(els.map((e) => [e.id, e]));
  const next = order.map((id) => byId.get(id)).filter((e): e is SlideElement => !!e);
  return next.length === els.length ? next : els;
}

/** 그룹: the selected objects become one unit (kept next to each other in the stacking order). */
export function groupSelection(els: Elements, sel: string[]): Elements {
  const ids = expandSelection(els, sel);
  if (ids.length < 2) return els;
  const groupId = uid('g');
  const lastAt = Math.max(...ids.map((id) => els.findIndex((e) => e.id === id)));
  const members = els.filter((e) => ids.includes(e.id)).map((e) => ({ ...e, groupId }));
  const before = els.slice(0, lastAt + 1).filter((e) => !ids.includes(e.id));
  return [...before, ...members, ...els.slice(lastAt + 1)];
}

/** 그룹 해제. */
export function ungroupSelection(els: Elements, sel: string[]): Elements {
  const ids = expandSelection(els, sel);
  return els.map((e) => (ids.includes(e.id) && e.groupId ? { ...e, groupId: undefined } : e));
}

export const canGroup = (els: Elements, sel: string[]) => selectionUnits(els, sel).length > 1;
export const canUngroup = (els: Elements, sel: string[]) => els.some((e) => sel.includes(e.id) && e.groupId);

/** 회전: 오른쪽 / 왼쪽으로 90도. A group turns about its own centre. */
export function rotateSelection(els: Elements, sel: string[], by: number): Elements {
  let next = els;
  for (const u of selectionUnits(els, sel)) {
    const members = next.filter((e) => u.members.includes(e.id));
    const placed = rotateBoxes(members.map(boxOf), by, members.length > 1);
    next = next.map((e) => { const p = placed.find((x) => x.id === e.id); return p ? { ...e, x: Math.round(p.x), y: Math.round(p.y), rotation: p.rot || undefined } : e; });
  }
  return next;
}

/** 상하 / 좌우 대칭. */
export function flipSelection(els: Elements, sel: string[], axis: 'horizontal' | 'vertical'): Elements {
  let next = els;
  for (const u of selectionUnits(els, sel)) {
    const members = next.filter((e) => u.members.includes(e.id));
    const placed = flipBoxes(members.map(boxOf), axis, members.length > 1);
    next = next.map((e) => {
      const p = placed.find((x) => x.id === e.id);
      if (!p) return e;
      const flipped = axis === 'horizontal' ? { flipH: e.flipH ? undefined : true } : { flipV: e.flipV ? undefined : true };
      return { ...e, x: Math.round(p.x), y: Math.round(p.y), rotation: p.rot || undefined, ...flipped };
    });
  }
  return next;
}

export function nudgeSelection(els: Elements, sel: string[], dx: number, dy: number): Elements {
  const ids = expandSelection(els, sel);
  return els.map((e) => (ids.includes(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e));
}

export function deleteSelection(slide: Slide, sel: string[]): Partial<Slide> {
  const els = slide.elements ?? [];
  const ids = expandSelection(els, sel);
  const elements = els.filter((e) => !ids.includes(e.id));
  const animations = slide.animations?.filter((a) => !ids.includes(a.elementId));
  return { elements: elements.length ? elements : undefined, animations: animations?.length ? animations : undefined };
}

/** Copies of `source` with fresh ids (groups stay grouped among themselves), moved by `offset`. */
export function cloneElements(source: Elements, offset = 0): Elements {
  const groups = new Map<string, string>();
  return source.map((e) => {
    let groupId = e.groupId;
    if (groupId) {
      if (!groups.has(groupId)) groups.set(groupId, uid('g'));
      groupId = groups.get(groupId);
    }
    return { ...e, id: uid('el'), groupId, x: e.x + offset, y: e.y + offset };
  });
}

/** 복제 (Ctrl+D): the copies and their ids, to select. */
export function duplicateSelection(els: Elements, sel: string[]): { elements: Elements; ids: string[] } {
  const ids = expandSelection(els, sel);
  const copies = cloneElements(els.filter((e) => ids.includes(e.id)), 30);
  return { elements: [...els, ...copies], ids: copies.map((c) => c.id) };
}

/** The look Format Painter (서식 복사) carries from one object to another. */
const STYLE_KEYS = [
  'fill', 'stroke', 'strokeWidth', 'dash', 'gradient', 'gradientAngle', 'dropShadow', 'glow', 'opacity',
  'fontFamily', 'fontSize', 'color', 'bold', 'italic', 'underline', 'strike', 'shadow', 'align', 'vAlign', 'letterSpacing', 'lineHeight', 'highlight',
] as const;
export type CopiedStyle = Partial<Pick<SlideElement, (typeof STYLE_KEYS)[number]>>;
export function copyStyle(el: SlideElement): CopiedStyle {
  const out: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) out[k] = el[k];
  return out as CopiedStyle;
}
export function pasteStyle(els: Elements, sel: string[], style: CopiedStyle): Elements {
  const ids = expandSelection(els, sel);
  return els.map((e) => {
    if (!ids.includes(e.id)) return e;
    const textOnly = e.kind === 'text';
    const patch: Record<string, unknown> = {};
    for (const k of STYLE_KEYS) {
      // A text box takes the text look only; its transparent frame stays.
      if (textOnly && ['fill', 'stroke', 'strokeWidth', 'dash', 'gradient', 'gradientAngle'].includes(k)) continue;
      if (style[k] !== undefined) patch[k] = style[k];
    }
    return { ...e, ...patch, ...(patch.fontSize !== undefined ? { paragraphs: e.paragraphs?.map((p) => ({ ...p, fontSize: undefined })) } : {}) };
  });
}

// ── Insert ────────────────────────────────────────────────────────────────────────────────────
const centred = (w: number, h: number) => ({ x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w, h });

/** A new preset shape, in the box dragged on the slide (or a default one in the middle). */
export function makeShape(name: string, box?: { x: number; y: number; w: number; h: number }): SlideElement {
  const info = shapeCatalog().find((p) => p.name === name);
  const line = !!info?.line;
  const b = box ?? (line ? centred(480, 0.001) : centred(360, 270));
  if (name === 'textBox') {
    return { id: uid('el'), kind: 'text', text: '텍스트', ...(box ?? centred(800, 200)), fontSize: 64, color: '#ffffff', align: 'center', bold: false, autoFit: !box };
  }
  return {
    id: uid('el'), kind: 'shape', shape: name, ...b, h: line && b.h < 1 ? 0 : b.h,
    ...(line ? { stroke: '#ffffff', strokeWidth: 6, ...(name === 'straightConnector1' ? { arrowEnd: true } : {}) } : { fill: '#2E6FD8', stroke: '#1B4FA8', strokeWidth: 3 }),
  };
}

export function makeTable(rows: number, cols: number): SlideElement | null {
  const table = newTable(rows, cols);
  if (!table) return null;
  const w = Math.min(1240, cols * 240), h = Math.min(900, rows * 90);
  return { id: uid('el'), kind: 'table', table, ...centred(w, h), fontSize: 32, color: '#ffffff' };
}

export const CHART_SAMPLE: Record<'categories' | 'series', never> | ChartData = {
  kind: 'column', title: '', legend: true, dataLabels: false,
  categories: ['항목 1', '항목 2', '항목 3', '항목 4'],
  series: [{ name: '계열 1', values: [4.3, 2.5, 3.5, 4.5] }, { name: '계열 2', values: [2.4, 4.4, 1.8, 2.8] }, { name: '계열 3', values: [2, 2, 3, 5] }],
};
export function makeChart(kind: ChartKind): SlideElement {
  const sample = CHART_SAMPLE as ChartData;
  const single = kind === 'pie' || kind === 'doughnut';
  return { id: uid('el'), kind: 'chart', chart: { ...sample, kind, series: single ? sample.series.slice(0, 1) : sample.series }, ...centred(960, 640), color: '#ffffff' };
}

export const makeIcon = (name: string): SlideElement => ({ id: uid('el'), kind: 'icon', icon: name, ...centred(240, 240), color: '#ffffff' });

/** A pen stroke (canvas points) as an ink object; null when it is too short to keep. */
export function makeInk(points: [number, number][], color: string, width: number, highlighter: boolean): SlideElement | null {
  const s = smoothInk(points, highlighter ? 2.5 : 1.5);
  if (!s || !s.d) return null;
  const pad = width;
  // The path is kept in its own box's coordinates so the object can be moved and stretched.
  const shifted = s.d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${Math.round((Number(x) - s.x + pad) * 10) / 10} ${Math.round((Number(y) - s.y + pad) * 10) / 10}`);
  const w = Math.max(1, s.w + pad * 2), h = Math.max(1, s.h + pad * 2);
  return { id: uid('el'), kind: 'ink', path: shifted, pathW: w, pathH: h, x: Math.round(s.x - pad), y: Math.round(s.y - pad), w: Math.round(w), h: Math.round(h), stroke: color, strokeWidth: width, opacity: highlighter ? 0.45 : undefined, name: highlighter ? '형광펜' : '잉크' };
}

/** 잉크를 셰이프로: a recognised stroke becomes the shape it draws; anything else stays ink. */
export function inkToShape(points: [number, number][], color: string, width: number): SlideElement | null {
  const r = recognizeInk(points);
  if (!r) return null;
  const look = { stroke: color, strokeWidth: width, fill: 'transparent' };
  if (r.kind === 'line') {
    const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
    const rising = (r.x1 - r.x0) * (r.y1 - r.y0) < 0;
    return { id: uid('el'), kind: 'shape', shape: 'line', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), ...look, flipV: rising ? true : undefined };
  }
  const shape = r.kind === 'rect' ? 'rect' : r.kind === 'ellipse' ? 'ellipse' : 'triangle';
  return { id: uid('el'), kind: 'shape', shape, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), ...look, flipV: r.kind === 'triangle' && r.flipV ? true : undefined };
}

// ── Animations ────────────────────────────────────────────────────────────────────────────────
export function addAnimation(slide: Slide, elementIds: string[], effect: { id: string; class: SlideAnimation['class']; durationMs: number; options: string[] }): SlideAnimation[] {
  const list = slide.animations ?? [];
  const added = elementIds.map((elementId, i): SlideAnimation => ({
    id: uid('an'), elementId, effect: effect.id, class: effect.class, option: effect.options[0], start: i === 0 ? 'click' : 'with', durationMs: effect.durationMs || 500, delayMs: 0,
  }));
  return [...list, ...added];
}

/** Replace what the selected objects do (the gallery click) — or add when they have no effect yet. */
export function setAnimation(slide: Slide, elementIds: string[], effect: { id: string; class: SlideAnimation['class']; durationMs: number; options: string[] } | null): SlideAnimation[] | undefined {
  const rest = (slide.animations ?? []).filter((a) => !elementIds.includes(a.elementId));
  if (!effect) return rest.length ? rest : undefined;
  return addAnimation({ ...slide, animations: rest }, elementIds, effect);
}

export function moveAnimation(list: SlideAnimation[], id: string, by: -1 | 1): SlideAnimation[] {
  const i = list.findIndex((a) => a.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
