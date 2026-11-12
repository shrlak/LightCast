// Draw Table, Slide Master placeholders and Summary Zoom (DeckCraft table.rs / master_view.rs / zoom.rs).
import { describe, expect, it } from 'vitest';
import { newTable, type TableData } from '../src/engine';
import { drawTableLine, eraseTableLine } from '../src/domain/drawTable';

/** The grid as text: o = a cell, M = a merged cell's anchor, . = covered. */
const grid = (t: TableData) => t.rows.map((r) => r.map((c) => (c.hMerge || c.vMerge ? '.' : (c.span ?? 1) > 1 || (c.rowSpan ?? 1) > 1 ? 'M' : 'o')).join('')).join('/');
const one = (w = 300, h = 100): TableData => ({ ...newTable(1, 1)!, cols: [w], heights: [h] });

describe('Draw Table pencil', () => {
  it('splits only the cells the line crosses', () => {
    let t = one();
    t = drawTableLine(t, 300, 100, [0, 40], [300, 40])!;
    expect([grid(t), t.heights]).toEqual(['o/o', [40, 60]]);
    t = drawTableLine(t, 300, 100, [120, 40], [120, 100])!;
    expect(grid(t)).toBe('M./oo');
    expect(t.cols).toEqual([120, 180]);
    t = drawTableLine(t, 300, 100, [120, 0], [120, 40])!;
    expect(grid(t)).toBe('oo/oo');
    expect(drawTableLine(t, 300, 100, [0, 1], [300, 1])).toBeNull();
    expect(drawTableLine(t, 300, 100, [NaN, 1], [300, 1])).toBeNull();
  });
  it('works when the table is drawn stretched', () => {
    const t = drawTableLine(one(150, 50), 300, 100, [0, 40], [300, 40])!;
    expect(t.heights[0]).toBeCloseTo(20);
    expect(t.heights[1]).toBeCloseTo(30);
  });
});

describe('Draw Table eraser', () => {
  it('merges neighbours, keeps their text and refuses a non-rectangle', () => {
    let t = newTable(2, 2)!;
    t = { ...t, cols: [100, 100], heights: [50, 50], rows: t.rows.map((r, ri) => r.map((c, ci) => ({ ...c, text: `${ri}${ci}` }))) };
    const m = eraseTableLine(t, 200, 100, [100, 25], 6)!;
    expect(grid(m)).toBe('M./oo');
    expect(m.rows[0][0].text).toBe('00\n01');
    // A border nowhere near a line is not erased.
    expect(eraseTableLine(t, 200, 100, [50, 80], 6)).toBeNull();
    // Row 1's two cells together with the merged cell above would not make a rectangle.
    expect(eraseTableLine(m, 200, 100, [150, 50], 6)).toBeNull();
    const all = eraseTableLine(m, 200, 100, [100, 75], 6)!;
    expect(grid(all)).toBe('M./M.');
  });
});
