// DeckCraft sync 3, charts / tables / picture export: the table cell cap (DeckCraft 1629e4d9) on LightCast's
// own table code — the PPTX and ODP readers, the pencil and the eraser.
import { describe, expect, it } from 'vitest';
import type { TableCell, TableData } from '../src/engine';
import { MAX_TABLE_CELLS, capTable, drawTableLine, eraseTableLine, maxTableRows, tableOverCap } from '../src/domain/drawTable';
import { readTable } from '../src/domain/io/pptxTable';
import { parseMarkup } from '../src/domain/io/markup';
import type { DmlTheme } from '../src/domain/io/drawingml';

const grid = (nr: number, nc: number, cell: () => TableCell = () => ({ text: '' })): TableData => ({
  rows: Array.from({ length: nr }, () => Array.from({ length: nc }, cell)),
  cols: Array(nc).fill(10), heights: Array(nr).fill(10),
  style: 'none', firstRow: false, firstCol: false, lastRow: false, lastCol: false, bandRow: false, bandCol: false,
});

const theme = { colors: { accent1: '#4472c4', tx1: '#000000', dk1: '#000000', lt1: '#ffffff' } } as unknown as DmlTheme;

describe('table cell cap', () => {
  it('sits above PowerPoint’s 75 × 75 and clamps an oversized grid, clipping its merges', () => {
    expect(MAX_TABLE_CELLS).toBeGreaterThanOrEqual(75 * 75);
    const small = grid(4, 4);
    expect(capTable(small)).toEqual({ table: small, capped: false });
    const big = grid(maxTableRows(1000) + 5, 1000);
    big.rows[0][0] = { text: 'a', rowSpan: big.rows.length };
    big.rows[0][1] = { text: 'b', span: 5000 };
    expect(tableOverCap(big)).toBe(true);
    const { table, capped } = capTable(big);
    expect(capped).toBe(true);
    expect(table.rows.length * table.cols.length).toBeLessThanOrEqual(MAX_TABLE_CELLS);
    expect(table.heights).toHaveLength(table.rows.length);
    expect(table.rows[0][0].rowSpan).toBe(table.rows.length);
    expect(table.rows[0][1].span).toBe(999);
    expect(tableOverCap(table)).toBe(false);
  });

  it('a file naming many rows and a wide grid keeps its leading rows, and says so', () => {
    const cols = '<a:gridCol w="91440"/>'.repeat(1000);
    const xml = `<a:tbl xmlns:a="a"><a:tblGrid>${cols}</a:tblGrid><a:tr h="91440"><a:tc rowSpan="5000"><a:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody></a:tc></a:tr>${'<a:tr h="91440"/>'.repeat(200)}</a:tbl>`;
    const tbl = parseMarkup(xml).children.find((c) => c.name === 'a:tbl') ?? parseMarkup(xml);
    const t0 = performance.now();
    const res = readTable(tbl, 1000, 500, theme, null);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(res.capped).toBe(true);
    expect(res.table.rows).toHaveLength(maxTableRows(1000));
    expect(res.table.rows.every((r) => r.length === 1000)).toBe(true);
    expect(res.table.rows[0][0]).toMatchObject({ text: 'x', rowSpan: maxTableRows(1000) });
    // A normal table is read as it was.
    const ok = parseMarkup(`<a:tbl xmlns:a="a"><a:tblGrid><a:gridCol w="91440"/><a:gridCol w="91440"/></a:tblGrid><a:tr h="91440"><a:tc/><a:tc/></a:tr></a:tbl>`);
    const okTbl = ok.children.find((c) => c.name === 'a:tbl') ?? ok;
    expect(readTable(okTbl, 100, 50, theme, null).capped).toBeUndefined();
  });

  it('the pencil refuses a row past the cap', () => {
    const t = grid(maxTableRows(1000), 1000);
    expect(drawTableLine(t, 10_000, t.rows.length * 10, [0, 5], [10_000, 5])).toBeNull();
  });

  it('the eraser still merges neighbours, and a large table answers quickly', () => {
    const t = grid(2, 2, () => ({ text: '', span: 1, rowSpan: 1 }));
    const m = eraseTableLine(t, 20, 20, [10, 5], 3)!;
    expect(m.rows[0][0].span).toBe(2);
    expect(m.rows[0][1].hMerge).toBe(true);
    const below = eraseTableLine(t, 20, 20, [5, 10], 3)!;
    expect(below.rows[0][0].rowSpan).toBe(2);
    const big = grid(300, 300, () => ({ text: '', span: 1, rowSpan: 1 }));
    const t0 = performance.now();
    expect(eraseTableLine(big, 3000, 3000, [1500, 5], 3)).not.toBeNull();
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('overlapping spans from a file are laid out in bounded work', () => {
    const n = 150;
    const t = grid(n, n, () => ({ text: '', span: 1e9, rowSpan: 1e9 }));
    const t0 = performance.now();
    // The line lands on the grid line under row 1 and splits the one merge that covers the grid.
    const next = drawTableLine(t, n * 10, n * 10, [0, 12], [n * 10, 12]);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(next?.rows).toHaveLength(n);
    expect(next?.rows[0][0]).toMatchObject({ span: n, rowSpan: 1 });
  });
});
