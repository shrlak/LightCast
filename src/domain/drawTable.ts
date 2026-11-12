// Insert › Table › Draw Table (port of DeckCraft's drawtable.rs): the pencil splits the cells a drawn
// line crosses, the table eraser merges the two cells on either side of a border. Pure operations on
// LightCast's TableData in its own coordinates (canvas px from the table's top-left corner).
//
// Both work on the table's anchors (each visible cell with its row and column span): edit that list,
// then lay the grid back out, so merges anywhere in the table survive.
import type { CellBorders, TableCell, TableData } from '../engine';

/** A line closer than this to an existing grid line reuses it rather than adding a sliver (2 px per pt). */
export const SNAP = 8;
/** Cap on the grid so a runaway pencil can't build an enormous table. */
export const MAX_GRID = 200;

interface Anchor { r: number; c: number; rs: number; cs: number; cell: TableCell }

const covered = (c: TableCell) => !!(c.hMerge || c.vMerge);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const edges = (sizes: number[]) => sizes.reduce<number[]>((e, s) => [...e, e[e.length - 1] + s], [0]);

function anchorsOf(t: TableData): Anchor[] {
  const out: Anchor[] = [];
  t.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (covered(cell)) return;
    out.push({ r, c, rs: Math.min(Math.max(1, cell.rowSpan ?? 1), t.rows.length - r), cs: Math.min(Math.max(1, cell.span ?? 1), t.cols.length - c), cell });
  }));
  return out;
}

/** The grid laid out again from its anchors (the rows and columns are already sized). */
function rebuild(t: TableData, anchors: Anchor[]): TableData {
  const nr = t.heights.length, nc = t.cols.length;
  const rows: TableCell[][] = Array.from({ length: nr }, () => Array.from({ length: nc }, () => ({ text: '', span: 1, rowSpan: 1 }) as TableCell));
  for (const a of anchors) {
    for (let r = a.r; r < Math.min(nr, a.r + a.rs); r++) {
      for (let c = a.c; c < Math.min(nc, a.c + a.cs); c++) {
        if (r === a.r && c === a.c) continue;
        rows[r][c] = { text: '', span: 1, rowSpan: 1, ...(c > a.c ? { hMerge: true } : {}), ...(r > a.r ? { vMerge: true } : {}) };
      }
    }
    rows[a.r][a.c] = { ...a.cell, span: a.cs, rowSpan: a.rs, hMerge: undefined, vMerge: undefined };
  }
  return { ...t, rows };
}

/** Swap rows and columns, so the vertical case reuses the horizontal one. */
function transpose(t: TableData): TableData {
  const flip = (b?: CellBorders): CellBorders | undefined => (b ? { l: b.t, r: b.b, t: b.l, b: b.r } : b);
  const anchors = anchorsOf(t).map((a) => ({ r: a.c, c: a.r, rs: a.cs, cs: a.rs, cell: { ...a.cell, borders: flip(a.cell.borders) } }));
  return rebuild({ ...t, cols: [...t.heights], heights: [...t.cols] }, anchors);
}

/** A horizontal line at `y` from `x0` to `x1`, in the table's own units. */
function splitRows(t: TableData, y: number, x0: number, x1: number, snap: number): TableData | null {
  const ys = edges(t.heights), xs = edges(t.cols);
  const total = ys[ys.length - 1];
  if (y <= snap || y >= total - snap || x1 - x0 < snap) return null;
  let anchors = anchorsOf(t);
  let heights = t.heights;
  // Boundary index b: an existing grid line near y, or a new one splitting row k.
  let b = ys.findIndex((e) => Math.abs(e - y) <= snap);
  if (b < 0) {
    if (t.heights.length >= MAX_GRID) return null;
    const k = ys.findIndex((e, i) => i < ys.length - 1 && e < y && y < ys[i + 1]);
    if (k < 0) return null;
    heights = [...t.heights.slice(0, k), y - ys[k], ys[k + 1] - y, ...t.heights.slice(k + 1)];
    anchors = anchors.map((a) => (a.r > k ? { ...a, r: a.r + 1 } : a.r + a.rs > k ? { ...a, rs: a.rs + 1 } : a));
    b = k + 1;
  }
  let changed = false;
  const out: Anchor[] = [];
  for (const a of anchors) {
    const l = xs[a.c] ?? 0, r = xs[a.c + a.cs] ?? 0;
    // The line divides a cell it crosses for more than half of the cell's width.
    const overlap = Math.max(0, Math.min(r, x1) - Math.max(l, x0));
    if (a.r < b && b < a.r + a.rs && overlap * 2 > r - l) {
      out.push({ ...a, rs: b - a.r }, { r: b, c: a.c, rs: a.r + a.rs - b, cs: a.cs, cell: { ...a.cell, text: '' } });
      changed = true;
    } else out.push(a);
  }
  // A new row that nothing divided is no change at all.
  return changed ? rebuild({ ...t, heights }, out) : null;
}

/**
 * Draw a line from `a` to `b` (px from the table's top-left corner, the table drawn `w` × `h`).
 * Mostly-horizontal lines split rows, mostly-vertical ones split columns; only the cells the line
 * crosses are divided. Returns the new table, or null when nothing changed.
 */
export function drawTableLine(t: TableData, w: number, h: number, a: [number, number], b: [number, number]): TableData | null {
  if (![...a, ...b].every(Number.isFinite) || !t.rows.length || !t.cols.length) return null;
  // Table units per px; the snap distance differs per axis when the table is stretched.
  const sx = sum(t.cols) / Math.max(1, w), sy = sum(t.heights) / Math.max(1, h);
  const [ax, ay, bx, by] = [a[0] * sx, a[1] * sy, b[0] * sx, b[1] * sy];
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) return splitRows(t, (ay + by) / 2, Math.min(ax, bx), Math.max(ax, bx), SNAP * sy);
  const next = splitRows(transpose(t), (ax + bx) / 2, Math.min(ay, by), Math.max(ay, by), SNAP * sx);
  return next && transpose(next);
}

/**
 * Erase the border nearest `p` (within `tol` px): the two cells it separates merge, when together
 * they make a rectangle. Their text is joined. Returns the new table, or null when no border is there.
 */
export function eraseTableLine(t: TableData, w: number, h: number, p: [number, number], tol: number): TableData | null {
  if (!p.every(Number.isFinite)) return null;
  const sx = sum(t.cols) / Math.max(1, w), sy = sum(t.heights) / Math.max(1, h);
  const q: [number, number] = [p[0] * sx, p[1] * sy];
  const ys = edges(t.heights), xs = edges(t.cols);
  const a = anchorsOf(t);
  let best: { d: number; i: number; j: number } | null = null;
  a.forEach((u, i) => a.forEach((v, j) => {
    const [ul, ut, ur, ub] = [xs[u.c], ys[u.r], xs[u.c + u.cs], ys[u.r + u.rs]];
    let d: number;
    // v directly right of u with the same rows, or directly below with the same columns.
    if (v.c === u.c + u.cs && v.r === u.r && v.rs === u.rs && q[1] > ut && q[1] < ub) d = Math.abs(q[0] - ur) / sx;
    else if (v.r === u.r + u.rs && v.c === u.c && v.cs === u.cs && q[0] > ul && q[0] < ur) d = Math.abs(q[1] - ub) / sy;
    else return;
    if (d <= tol && (!best || d < best.d)) best = { d, i, j };
  }));
  if (!best) return null;
  const { i, j } = best as { i: number; j: number };
  const v = a[j], u = { ...a[i], cell: { ...a[i].cell } };
  if (v.r === u.r) u.cs += v.cs; else u.rs += v.rs;
  if (v.cell.text) u.cell.text = u.cell.text ? `${u.cell.text}\n${v.cell.text}` : v.cell.text;
  return rebuild(t, a.flatMap((x, k) => (k === j ? [] : [k === i ? u : x])));
}
