// Table Design › Draw Borders (DeckCraft table.borders, table.drawLine, table.eraseLine) and Table
// Layout › Cell Margins, on LightCast's table (src/engine TableData).
import { editTable, type CellBorder, type CellBorders, type TableData } from '../engine';

export type BorderMode = 'all' | 'outside' | 'inside' | 'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV' | 'none';
export interface CellRange { r: number; c: number; r1: number; c1: number }

/** The borders of the cells in `range` drawn (or removed) with `pen`. */
export function applyBorders(t: TableData, range: CellRange, mode: BorderMode, pen: CellBorder): TableData {
  const [r0, r1] = [Math.min(range.r, range.r1), Math.max(range.r, range.r1)];
  const [c0, c1] = [Math.min(range.c, range.c1), Math.max(range.c, range.c1)];
  const rows = t.rows.map((row, r) => row.map((cell, c) => {
    if (r < r0 || r > r1 || c < c0 || c > c1) return cell;
    const b: CellBorders = { ...cell.borders };
    const set = (side: keyof CellBorders, on: boolean) => { b[side] = on ? { ...pen } : null; };
    const top = r === r0, bottom = r === r1, left = c === c0, right = c === c1;
    switch (mode) {
      case 'all': set('t', true); set('b', true); set('l', true); set('r', true); break;
      case 'none': set('t', false); set('b', false); set('l', false); set('r', false); break;
      case 'outside': if (top) set('t', true); if (bottom) set('b', true); if (left) set('l', true); if (right) set('r', true); break;
      case 'inside': if (!top) set('t', true); if (!bottom) set('b', true); if (!left) set('l', true); if (!right) set('r', true); break;
      case 'insideH': if (!top) set('t', true); if (!bottom) set('b', true); break;
      case 'insideV': if (!left) set('l', true); if (!right) set('r', true); break;
      case 'top': if (top) set('t', true); break;
      case 'bottom': if (bottom) set('b', true); break;
      case 'left': if (left) set('l', true); break;
      case 'right': if (right) set('r', true); break;
    }
    return { ...cell, borders: b };
  }));
  return { ...t, rows };
}

/** The line drawn on side `side` of cell (r, c), counting the neighbour's matching side. */
export function sideOf(t: TableData, r: number, c: number, side: keyof CellBorders): CellBorder | null | undefined {
  const own = t.rows[r]?.[c]?.borders?.[side];
  if (own !== undefined) return own;
  const n = side === 't' ? t.rows[r - 1]?.[c] : side === 'b' ? t.rows[r + 1]?.[c] : side === 'l' ? t.rows[r]?.[c - 1] : t.rows[r]?.[c + 1];
  const opp = ({ t: 'b', b: 't', l: 'r', r: 'l' } as const)[side];
  return n?.borders?.[opp];
}

export const CELL_MARGINS: Record<'normal' | 'none' | 'narrow' | 'wide', [number, number, number, number]> = {
  // PowerPoint's presets in points (left, top, right, bottom), as canvas pixels (2 per point).
  normal: [14.4, 7.2, 14.4, 7.2], none: [0, 0, 0, 0], narrow: [7.2, 7.2, 7.2, 7.2], wide: [27.4, 14.4, 27.4, 14.4],
};

/** Table Design › Eraser: the line between two cells goes, so they become one. */
export function eraseLine(t: TableData, r: number, c: number, side: 'r' | 'b'): TableData | null {
  const nr = side === 'b' ? r + 1 : r, nc = side === 'r' ? c + 1 : c;
  if (nr >= t.rows.length || nc >= (t.rows[0]?.length ?? 0)) return null;
  return editTable(t, 'merge', r, c, nr, nc);
}

/**
 * Table Design › Draw Table: a vertical line drawn through cell (r, c) at fraction `at` of its
 * width splits that cell in two (a new column whose other cells stay joined), a horizontal one a row.
 */
export function drawLine(t: TableData, r: number, c: number, dir: 'v' | 'h', at: number): TableData | null {
  const f = Math.min(0.9, Math.max(0.1, at));
  if (dir === 'v') {
    let next = editTable(t, 'insertColRight', r, c);
    if (!next) return null;
    const w = t.cols[c];
    next = { ...next, cols: next.cols.map((x, i) => (i === c ? w * f : i === c + 1 ? w * (1 - f) : x)) };
    for (let row = 0; row < next.rows.length; row++) {
      if (row === r) continue;
      const merged = editTable(next, 'merge', row, c, row, c + 1);
      if (merged) next = merged;
    }
    return next;
  }
  let next = editTable(t, 'insertRowBelow', r, c);
  if (!next) return null;
  const h = t.heights[r];
  next = { ...next, heights: next.heights.map((x, i) => (i === r ? h * f : i === r + 1 ? h * (1 - f) : x)) };
  for (let col = 0; col < (next.rows[0]?.length ?? 0); col++) {
    if (col === c) continue;
    const merged = editTable(next, 'merge', r, col, r + 1, col);
    if (merged) next = merged;
  }
  return next;
}
