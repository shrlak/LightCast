// Draw Table, Slide Master placeholders and Summary Zoom (DeckCraft table.rs / master_view.rs / zoom.rs).
import { describe, expect, it } from 'vitest';
import { newTable, type TableData } from '../src/engine';
import { drawTableLine, eraseTableLine } from '../src/domain/drawTable';
import { deleteLayoutBlocker, duplicateLayout, insertLayout, makePlaceholder, placeholderState, setPlaceholders, slideFromLayout, withMaster } from '../src/domain/master';
import type { MasterLayout, Slide } from '../src/domain/types';
import { returnAfter, sectionTargets, slideTargets, summaryInsertIndex, summaryTargets, zoomElements, zoomGrid, zoomArea } from '../src/domain/zoom';

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

describe('Slide Master placeholders', () => {
  it('turns title and footer placeholders on and off like Master Layout', () => {
    let els = setPlaceholders([], { title: true, date: true, footer: true, slideNumber: true });
    expect(placeholderState(els)).toEqual({ title: true, text: false, date: true, footer: true, slideNumber: true });
    expect(els.find((e) => e.placeholder === 'slideNumber')!.text).toBe('{slide}');
    // Already on: nothing is added twice.
    expect(setPlaceholders(els, { title: true }).length).toBe(els.length);
    els = setPlaceholders(els, { date: false, footer: false, slideNumber: false });
    expect(placeholderState(els)).toMatchObject({ title: true, date: false, footer: false, slideNumber: false });
    expect(setPlaceholders(els, { title: false })).toEqual([]);
  });
  it("copies the master's own placeholder with a new id and no prompt text", () => {
    const master = [{ ...makePlaceholder('title'), text: 'Master title', x: 5 }];
    const [t] = setPlaceholders([], { title: true }, master);
    expect(t).toMatchObject({ placeholder: 'title', x: 5, text: '' });
    expect(t.id).not.toBe(master[0].id);
  });
  it('makes the Insert Placeholder variants', () => {
    for (const k of ['content', 'chart', 'table', 'media', 'picture', 'date'] as const) expect(makePlaceholder(k).placeholder).toBe(k);
    expect(makePlaceholder('chart').kind).toBe('shape');
  });
  it('keeps placeholders off slides: not copied from the master, footers not from the layout', () => {
    const slide: Slide = { id: 's', group: 'g', text: '' };
    expect(withMaster(slide, [makePlaceholder('title'), { id: 'logo', kind: 'shape', x: 0, y: 0, w: 1, h: 1 }]).elements?.map((e) => e.id)).toEqual(['master:logo']);
    const layout: MasterLayout = { id: 'l', name: 'L', elements: [makePlaceholder('title'), makePlaceholder('slideNumber')] };
    expect(slideFromLayout(layout, 'g').elements?.map((e) => e.placeholder)).toEqual(['title']);
  });
});

describe('Slide Master layouts', () => {
  const L = (id: string): MasterLayout => ({ id, name: id, elements: [makePlaceholder('title')] });
  it("inserts after the current layout, kept, with the master's title", () => {
    const r = insertLayout([L('a'), L('b')], [], 'a');
    expect(r.layouts.map((l) => (l.id === r.id ? 'new' : l.id))).toEqual(['a', 'new', 'b']);
    expect(r.layouts[1]).toMatchObject({ preserve: true, name: '사용자 지정 레이아웃 3' });
    expect(r.layouts[1].elements[0].placeholder).toBe('title');
  });
  it('duplicates a layout with new ids', () => {
    const ls = [L('a'), L('b')];
    const r = duplicateLayout(ls, 'a')!;
    expect(r.layouts.map((l) => l.name)).toEqual(['a', '1_a', 'b']);
    expect(r.layouts[1].elements[0].id).not.toBe(ls[0].elements[0].id);
    expect(duplicateLayout(ls, 'x')).toBeNull();
  });
  it('refuses to delete a layout in use or the last one', () => {
    const slides: Slide[] = [{ id: 's', group: 'g', text: '', layoutId: 'a' }];
    expect(deleteLayoutBlocker([L('a'), L('b')], slides, 'a')).toMatch(/슬라이드/);
    expect(deleteLayoutBlocker([L('a')], [], 'a')).toMatch(/하나/);
    expect(deleteLayoutBlocker([L('a'), L('b')], slides, 'b')).toBeNull();
  });
});

describe('Summary and Section Zoom', () => {
  const sl = (id: string, group: string): Slide => ({ id, group, text: id });
  const deck = [sl('a1', 'A'), sl('a2', 'A'), sl('b1', 'B'), sl('b2', 'B'), sl('b3', 'B'), sl('c1', 'C')];
  const ids = (t: { slide: Slide; last: Slide }[]) => t.map((x) => `${x.slide.id}>${x.last.id}`);

  it('summary: each part runs to the slide before the next one picked', () => {
    expect(ids(summaryTargets(deck))).toEqual(['a1>a2', 'b1>b3', 'c1>c1']);
    // Picking slides (not section starts) makes parts of them, in slide order whatever order they were ticked.
    expect(ids(summaryTargets(deck, ['b2', 'a1']))).toEqual(['a1>b1', 'b2>c1']);
    expect(ids(summaryTargets(deck, ['c1']))).toEqual(['c1>c1']);
  });
  it('section zoom goes to the section start and returns after its last slide', () => {
    expect(ids(sectionTargets(deck, ['b1', 'a1']))).toEqual(['a1>a2', 'b1>b3']);
    expect(ids(slideTargets(deck, ['b2']))).toEqual(['b2>b2']);
  });
  it('lays tiles out in a grid inside the area, a single slide zoom at most half its width', () => {
    const area = zoomArea('summary', 3);
    const boxes = zoomGrid(3, area);
    expect(boxes).toHaveLength(3);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(area.x - 0.01);
      expect(b.x + b.w).toBeLessThanOrEqual(area.x + area.w + 0.01);
      expect(b.y + b.h).toBeLessThanOrEqual(area.y + area.h + 0.01);
      expect(b.w / b.h).toBeCloseTo(4 / 3);
    }
    expect(zoomGrid(1, zoomArea('slide', 1))[0].w).toBeLessThanOrEqual(zoomArea('slide', 1).w / 2 + 0.01);
    expect(zoomGrid(0, area)).toEqual([]);
  });
  it('builds zoom objects that carry the return slide only with Return to Zoom', () => {
    const t = summaryTargets(deck);
    const snap = (s: Slide) => ({ slide: s, theme: {} as never, background: null });
    const on = zoomElements('summary', t, true, snap);
    expect(on.map((e) => [e.targetSlideId, e.zoomReturn])).toEqual([['a1', 'a2'], ['b1', 'b3'], ['c1', 'c1']]);
    expect(zoomElements('slide', t, false, snap).every((e) => e.zoomReturn === undefined)).toBe(true);
  });
  it('puts the summary slide before the section of its first part', () => {
    expect(summaryInsertIndex(deck, summaryTargets(deck, ['b2', 'c1']))).toBe(2);
    expect(summaryInsertIndex(deck, summaryTargets(deck))).toBe(0);
  });
  it('returns to the zoom slide after the target slide, once', () => {
    expect(returnAfter({ from: 4, after: 'b3' }, 'b2')).toBeNull();
    expect(returnAfter({ from: 4, after: 'b3' }, 'b3')).toBe(4);
    expect(returnAfter(null, 'b3')).toBeNull();
  });
});
