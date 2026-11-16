// Legacy .ppt has no table object before PowerPoint 2000's OLE tables: tables were groups of one rectangle per
// cell (with its text, fill and outline) and, from some writers, loose border lines. This finds such groups when
// their cells form a regular grid, so the importer can rebuild them as a LightCast table.
import type { PptShape } from './pptBinary';

export interface TablePlan {
  /** Master units. */
  x: number; y: number; w: number; h: number;
  colWidths: number[];
  rowHeights: number[];
  /** Cells by their top-left grid slot. */
  cells: { row: number; col: number; rowSpan: number; colSpan: number; shape: PptShape }[];
  /** Indexes (into the shapes of the slide) of every member the table replaces. */
  members: number[];
  /** Outline of the border lines / cell outlines, if any. */
  border?: { color: string; width: number };
}

const TOL = 6;
const MAX_COLS = 30, MAX_ROWS = 100;

function edges(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
  return out;
}
const slot = (list: number[], v: number) => {
  let best = -1, d = TOL + 1;
  list.forEach((e, i) => { if (Math.abs(e - v) < d) { d = Math.abs(e - v); best = i; } });
  return d <= TOL ? best : -1;
};

const isLine = (s: PptShape) => s.kind === 'shape' && s.shape === 'line';
const isCell = (s: PptShape) => (s.kind === 'text' || (s.kind === 'shape' && (s.shape === 'rect' || s.shape === undefined))) && !s.path && (!s.shape || s.shape === 'rect') && !!s.group;

/** The table-shaped groups among a slide's shapes (keyed by group number). */
export function detectTables(shapes: PptShape[]): Map<number, TablePlan> {
  const byGroup = new Map<number, number[]>();
  shapes.forEach((s, i) => { if (s.group) { const l = byGroup.get(s.group) ?? []; l.push(i); byGroup.set(s.group, l); } });
  const out = new Map<number, TablePlan>();
  for (const [g, idx] of byGroup) {
    const members = idx.map((i) => shapes[i]);
    if (members.length < 4 || members.length > MAX_COLS * MAX_ROWS * 2) continue;
    const cellIdx = idx.filter((i) => isCell(shapes[i]));
    const lineIdx = idx.filter((i) => isLine(shapes[i]));
    if (cellIdx.length + lineIdx.length !== idx.length || cellIdx.length < 4) continue;
    const cells = cellIdx.map((i) => shapes[i]);
    if (cells.some((c) => c.x === undefined || c.y === undefined || !c.w || !c.h || c.rotation || c.flipH || c.flipV)) continue;
    const xs = edges(cells.flatMap((c) => [c.x!, c.x! + c.w!]));
    const ys = edges(cells.flatMap((c) => [c.y!, c.y! + c.h!]));
    const cols = xs.length - 1, rows = ys.length - 1;
    if (cols < 2 || rows < 2 || cols > MAX_COLS || rows > MAX_ROWS) continue;
    const taken = new Uint8Array(cols * rows);
    const placed: TablePlan['cells'] = [];
    let ok = true;
    for (const c of cells) {
      const c0 = slot(xs, c.x!), c1 = slot(xs, c.x! + c.w!), r0 = slot(ys, c.y!), r1 = slot(ys, c.y! + c.h!);
      if (c0 < 0 || c1 <= c0 || r0 < 0 || r1 <= r0) { ok = false; break; }
      for (let r = r0; r < r1 && ok; r++) for (let k = c0; k < c1; k++) { if (taken[r * cols + k]) { ok = false; break; } taken[r * cols + k] = 1; }
      if (!ok) break;
      placed.push({ row: r0, col: c0, rowSpan: r1 - r0, colSpan: c1 - c0, shape: c });
    }
    if (!ok || taken.some((v) => !v)) continue;
    // Lines must lie on the grid (a loose line elsewhere means this is a drawing, not a table).
    const onGrid = lineIdx.every((i) => {
      const l = shapes[i];
      if (l.x === undefined || l.y === undefined) return false;
      return (!l.h && slot(ys, l.y) >= 0) || (!l.w && slot(xs, l.x) >= 0);
    });
    if (!onGrid) continue;
    const lineShape = lineIdx.map((i) => shapes[i]).find((l) => l.line);
    const outline = lineShape?.line ?? cells.find((c) => c.line)?.line;
    out.set(g, {
      x: xs[0], y: ys[0], w: xs[cols] - xs[0], h: ys[rows] - ys[0],
      colWidths: xs.slice(1).map((v, i) => v - xs[i]), rowHeights: ys.slice(1).map((v, i) => v - ys[i]),
      cells: placed, members: idx,
      ...(outline ? { border: { color: outline.color, width: outline.width } } : {}),
    });
  }
  return out;
}
