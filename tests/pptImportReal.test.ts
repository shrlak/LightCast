import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePpt, type PptShape } from '../src/domain/io/pptBinary';
import { importPpt, transitionOf } from '../src/domain/io/pptImport';
import { detectTables } from '../src/domain/io/pptTable';
import { complexOf, customPathOf, readOpt, shadowOf, fillOf, P } from '../src/domain/io/pptEscher';
import { PPT_MAX_RECORDS, type Ctx } from '../src/domain/io/pptRecords';
import { elementMarkers } from '../src/domain/textFormat';

// Files written by LibreOffice 24.2 from python-pptx decks (see tests/fixtures/real/ppt/README.md).
const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/ppt/${name}`, import.meta.url)));
const run = async (name: string) => {
  let n = 0;
  return importPpt(load(name), name, { group: 'g', newId: (p) => `${p}${++n}`, store: async () => 'm1' });
};

describe('.ppt files written by a real application', () => {
  it('reads levels, bullets, spacing and runs per paragraph', async () => {
    const r = await run('libreoffice-text.ppt');
    const el = r.slides[0].elements![0];
    expect(el.paragraphs).toHaveLength(4);
    expect(el.paragraphs![0]).toMatchObject({ text: 'Dot item', list: 'bullet' });
    expect(el.paragraphs![1]).toMatchObject({ text: 'Sub dash item', list: 'dash', level: 1 });
    expect(el.paragraphs![1].runs![0]).toMatchObject({ bold: true, fontSize: 40 });
    expect(el.paragraphs![2].list).toBe('none');
    expect(el.paragraphs![2].spaceBefore).toBeGreaterThan(30);
    expect(el.paragraphs![3].align).toBe('center');
    const { markers, levels } = elementMarkers(el);
    expect(markers).toEqual(['•', '–', null, null]);
    expect(levels).toEqual([0, 1, 0, 0]);
  });

  it('rebuilds a group of cell rectangles as a table with a merged cell', async () => {
    const r = await run('libreoffice-table.ppt');
    const els = r.slides[0].elements!;
    expect(els).toHaveLength(1);
    const t = els[0].table!;
    expect(els[0].kind).toBe('table');
    expect(t.rows).toHaveLength(3);
    expect(t.cols).toHaveLength(3);
    expect(t.cols[0] * 2).toBeCloseTo(t.cols[1], -1);
    expect(t.rows[0][0]).toMatchObject({ text: 'Merged', span: 2, fill: '#4f81bd' });
    expect(t.rows[0][1].hMerge).toBe(true);
    expect(t.rows[2][2]).toMatchObject({ text: 'R2C2', fill: '#ffe080' });
    // 1 inch = 144 canvas px: the table starts at 1 inch and is 6 inches wide.
    expect(els[0].x).toBe(144);
    expect(els[0].w).toBe(864);
  });

  it('reads freeform paths, a gradient (Escher angle), arrowheads and rotation', async () => {
    const r = await run('libreoffice-shapes.ppt');
    const [free, line, grad, rot] = r.slides[0].elements!;
    expect(free).toMatchObject({ kind: 'shape', pathW: 2743200, pathH: 1828800, fill: '#90d060', stroke: '#005000' });
    expect(free.path).toMatch(/^M0 0L1828800 182880L/);
    expect(line).toMatchObject({ shape: 'line', arrowEnd: true, flipV: true, stroke: '#c00000' });
    // Yellow at the bottom, green at the top: Escher angle -180 degrees.
    expect(grad).toMatchObject({ gradient: ['#ffff00', '#008000'], gradientAngle: 270 });
    expect(rot).toMatchObject({ rotation: 15, fill: '#808080', dropShadow: true });
    expect(rot.shadowOpts).toMatchObject({ dir: 90 });
  });

  it('reads slide transitions with directions, hidden slides, notes and backgrounds', async () => {
    const r = await run('libreoffice-show.ppt');
    const [a, b, c] = r.slides;
    expect(a.transition).toMatchObject({ kind: 'fx:wipe', option: 'u', duration: 500 });
    expect(b.transition).toMatchObject({ kind: 'fx:push', option: 'd', duration: 1500 });
    expect(b.disabled).toBe(true);
    expect(c.transition).toMatchObject({ kind: 'fx:blinds', option: 'vert' });
    expect(c.background).toEqual({ kind: 'color', value: '#203060' });
    expect([a.notes, b.notes, c.notes]).toEqual(['Note 1', 'Note 2', 'Note 3']);
    expect(a.autoAdvance).toBeUndefined();
  });

  it('never throws on damaged copies', () => {
    for (const name of ['libreoffice-text.ppt', 'libreoffice-table.ppt', 'libreoffice-shapes.ppt', 'libreoffice-show.ppt']) {
      const bytes = load(name);
      for (let i = 0; i < 12; i++) {
        const copy = bytes.slice(0, Math.floor((bytes.length * (i + 1)) / 13));
        expect(() => parsePpt(copy)).not.toThrow();
        const noisy = bytes.slice();
        for (let k = 0; k < 40; k++) noisy[(i * 7919 + k * 104729) % noisy.length] ^= 0xff;
        expect(() => parsePpt(noisy)).not.toThrow();
      }
    }
  });
});

describe('.ppt transition ids', () => {
  it('maps the ids and directions LibreOffice and PowerPoint write', () => {
    const t = (effect: number, direction: number) => transitionOf({ effect, direction, speed: 1, onClick: true, afterMs: 0 }).transition;
    expect(t(10, 1)).toMatchObject({ kind: 'fx:wipe', option: 'u' });
    expect(t(20, 3)).toMatchObject({ kind: 'fx:push', option: 'd' });
    expect(t(13, 2)).toMatchObject({ kind: 'fx:split', option: 'vertOut' });
    expect(t(23, 0)).toMatchObject({ kind: 'fade', option: 'smoothly' });
    expect(t(27, 0)).toMatchObject({ kind: 'fx:shape', option: 'circle' });
    expect(t(99, 0)?.kind).toBe('fade');
    expect(transitionOf({ effect: 0, speed: 1, onClick: false, afterMs: 3000 })).toMatchObject({ transition: { kind: 'cut', advanceOnClick: false }, autoAdvance: 3 });
  });
});

describe('.ppt tables', () => {
  const cell = (x: number, y: number, w: number, h: number, extra: Partial<PptShape> = {}): PptShape => ({ kind: 'text', x, y, w, h, group: 1, text: 'c', ...extra });
  it('needs a full regular grid', () => {
    const grid = [cell(0, 0, 100, 50), cell(100, 0, 100, 50), cell(0, 50, 100, 50), cell(100, 50, 100, 50)];
    expect(detectTables(grid).get(1)).toMatchObject({ w: 200, h: 100, colWidths: [100, 100], rowHeights: [50, 50] });
    expect(detectTables(grid.slice(0, 3)).size).toBe(0); // a hole
    expect(detectTables([...grid, { kind: 'picture', group: 1, x: 0, y: 0, w: 5, h: 5 }]).size).toBe(0);
    expect(detectTables(grid.map((g) => ({ ...g, group: undefined }))).size).toBe(0);
    expect(detectTables([...grid, cell(20, 20, 100, 50)]).size).toBe(0); // overlap
  });
  it('merges a cell that spans columns', () => {
    const plan = detectTables([cell(0, 0, 200, 50), cell(0, 50, 100, 50), cell(100, 50, 100, 50), cell(0, 100, 100, 50), cell(100, 100, 100, 50)]).get(1);
    expect(plan?.cells[0]).toMatchObject({ row: 0, col: 0, colSpan: 2, rowSpan: 1 });
  });
});

describe('.ppt Escher complex properties', () => {
  // One OPT record: shadowColor and fillShadeColors (complex: 3 stops, header + 3 x 8 bytes).
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const opt = (props: [number, number, number[]?][]) => {
    const table: number[] = [], data: number[] = [];
    for (const [id, value, complex] of props) {
      table.push(...u16(id | (complex ? 0x8000 : 0)), ...u32(complex ? complex.length : value));
      if (complex) data.push(...complex);
    }
    const bytes = new Uint8Array([...table, ...data]);
    const c: Ctx = { b: bytes, v: new DataView(bytes.buffer), budget: PPT_MAX_RECORDS, warnings: new Set() };
    return { c, rec: { ver: 3, inst: props.length, type: 0xf00b, pos: 0, end: bytes.length } };
  };
  it('keeps complex data after the table and reads shade colours and shadows', () => {
    const stops = [...u16(3), ...u16(3), ...u16(8), ...u32(0x0000ff), ...u32(0), ...u32(0x00ff00), ...u32(32768), ...u32(0xff0000), ...u32(65536)];
    const { c, rec } = opt([[P.fillType, 7], [P.fillColor, 0x0000ff], [P.fillBack, 0xff0000], [P.fillAngle, -270 * 65536], [P.fillShadeColors, 0, stops], [P.shadowFlags, 0x20002], [P.shadowOffX, 12700], [P.shadowOffY, 25400], [P.shadowOpacity, 32768]]);
    const props = new Map<number, number>();
    readOpt(c, rec, props);
    expect(complexOf(props, P.fillShadeColors)?.length).toBe(stops.length);
    const fill = fillOf(props, undefined);
    expect(fill?.gradient).toMatchObject({ from: '#ff0000', to: '#0000ff', angle: 0 });
    expect(fill?.gradient?.stops?.map((s) => [s.pos, s.color])).toEqual([[0, '#ff0000'], [50, '#00ff00'], [100, '#0000ff']]);
    expect(shadowOf(props, undefined)).toMatchObject({ dx: 12700, dy: 25400, transparency: 0.5 });
  });
  it('turns pVertices and pSegmentInfo into a path and refuses damaged arrays', () => {
    const verts = [...u16(3), ...u16(3), ...u16(8), ...u32(0), ...u32(0), ...u32(100), ...u32(0), ...u32(50), ...u32(80)];
    const segs = [...u16(4), ...u16(4), ...u16(2), ...u16(0x4000), ...u16(2), ...u16(0x6001), ...u16(0x8000)];
    const { c, rec } = opt([[P.geoRight, 100], [P.geoBottom, 80], [P.pVertices, 0, verts], [P.pSegmentInfo, 0, segs]]);
    const props = new Map<number, number>();
    readOpt(c, rec, props);
    expect(customPathOf(props)).toMatchObject({ path: 'M0 0L100 0L50 80Z', w: 100, h: 80 });
    const bad = opt([[P.pVertices, 0, verts.slice(0, 10)], [P.pSegmentInfo, 0, segs]]);
    const p2 = new Map<number, number>();
    readOpt(bad.c, bad.rec, p2);
    expect(customPathOf(p2)).toBeNull();
  });
});
