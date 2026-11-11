import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB, MAX_TABS, PX_PER_CM, cmToPx, decimalAt, dragIndent, editTabs, indentMarkers, layoutTabLine, pxToCm,
  rulerTicks, snapRuler, splitRunsAtTabs, tabAdvance, tabAlignOf, type TabStop,
} from '../src/domain/tabStops';

const stops = (t: TabStop[]) => t.map((s) => [s.pos, s.align]);

describe('tab stop editing (DeckCraft format.tabs)', () => {
  it('adds, sorts, replaces a stop at the same place, moves, removes and clears', () => {
    let t = editTabs(undefined, { add: { pos: 288, align: 'center' } });
    t = editTabs(t, { add: { pos: 144 } });
    expect(stops(t)).toEqual([[144, 'left'], [288, 'center']]);
    t = editTabs(t, { add: { pos: 144.4, align: 'right' } });
    expect(stops(t)).toEqual([[144.4, 'right'], [288, 'center']]);
    t = editTabs(t, { move: { from: 288, to: 400 } });
    t = editTabs(t, { remove: 144.4 });
    expect(stops(t)).toEqual([[400, 'center']]);
    expect(editTabs(t, { clear: true })).toEqual([]);
  });

  it('does not change the stops it was given', () => {
    const before: TabStop[] = [{ pos: 100, align: 'left' }];
    editTabs(before, { move: { from: 100, to: 300 } });
    expect(before[0].pos).toBe(100);
  });

  it('clamps huge positions and keeps at most 32 stops', () => {
    expect(editTabs([], { add: { pos: Number.MAX_VALUE } })[0].pos).toBe(8000);
    let t: TabStop[] = [];
    for (let i = 0; i < 100; i++) t = editTabs(t, { add: { pos: i * 6 } });
    expect(t.length).toBe(MAX_TABS);
  });

  it('set replaces every stop, sorted, dropping bad entries; stops at the same place collapse (last wins)', () => {
    const t = editTabs([{ pos: 10, align: 'left' }], { set: [{ pos: 180, align: 'dec' }, { pos: 60, align: 'right' }, { pos: 'x' }, { pos: 60.05, align: 'center' }] });
    expect(stops(t)).toEqual([[60.05, 'center'], [180, 'decimal']]);
  });

  it('reads DeckCraft and long alignment names', () => {
    expect(['l', 'ctr', 'r', 'dec', 'center', 'sparkle'].map(tabAlignOf)).toEqual(['left', 'center', 'right', 'decimal', 'center', null]);
  });
});

describe('tab layout', () => {
  const seg = (w: number, dec = w) => ({ w, dec });

  it('goes to the next default stop without custom stops', () => {
    expect(tabAdvance(10, [], DEFAULT_TAB, seg(0))).toBe(134);
    expect(tabAdvance(144, [], DEFAULT_TAB, seg(0))).toBe(144);
    expect(tabAdvance(100, [], 50, seg(0))).toBe(50);
    expect(Number.isFinite(tabAdvance(Number.NaN, [{ pos: 100, align: 'left' }], 144, seg(0)))).toBe(true);
  });

  it('aligns the text after a tab at the stop: left, centre, right and on the decimal point', () => {
    const at = (align: TabStop['align']) => tabAdvance(20, [{ pos: 300, align }], DEFAULT_TAB, seg(100, 60));
    expect(at('left')).toBe(280);
    expect(at('center')).toBe(230);
    expect(at('right')).toBe(180);
    expect(at('decimal')).toBe(220);
    // Text too wide to end at the stop does not move back.
    expect(tabAdvance(250, [{ pos: 300, align: 'right' }], DEFAULT_TAB, seg(100))).toBe(0);
  });

  it('lays a line out at its stops and then at default stops', () => {
    const t: TabStop[] = [{ pos: 200, align: 'left' }, { pos: 500, align: 'right' }];
    const { x, gaps } = layoutTabLine(0, [seg(50), seg(80), seg(120), seg(10)], t, DEFAULT_TAB);
    expect(x).toEqual([0, 200, 380, 576]);
    expect(gaps).toEqual([150, 100, 76]);
    // A line indented by 60 px measures its tabs from the text area's left, not its own start.
    expect(layoutTabLine(60, [seg(10), seg(10)], t, DEFAULT_TAB).x).toEqual([60, 200]);
  });

  it('splits runs at tabs and finds the decimal point', () => {
    expect(splitRunsAtTabs([{ text: 'a\tb', bold: true }, { text: 'c\t' }])).toEqual([[{ text: 'a', bold: true }], [{ text: 'b', bold: true }, { text: 'c' }], []]);
    expect(decimalAt('12.50')).toBe(2);
    expect(decimalAt('125')).toBe(3);
  });
});

describe('ruler', () => {
  it('measures the 4:3 slide as 25.4 × 19.05 cm', () => {
    expect(pxToCm(1440)).toBeCloseTo(25.4);
    expect(pxToCm(1080)).toBeCloseTo(19.05);
    expect(cmToPx(2.54)).toBeCloseTo(DEFAULT_TAB);
  });

  it('marks quarter centimetres and numbers whole ones both ways from the origin', () => {
    const t = rulerTicks(0, 1440, 720);
    const majors = t.filter((m) => m.kind === 'major');
    expect(majors.find((m) => Math.abs(m.px - 720) < 1e-6)?.label).toBe(0);
    expect(majors[0].label).toBe(12);
    expect(majors[majors.length - 1].label).toBe(12);
    expect(t[1].px - t[0].px).toBeCloseTo(PX_PER_CM / 4);
    // A half-centimetre mark sits halfway between two whole ones.
    const half = t.find((m) => m.kind === 'half')!;
    expect(Math.abs(((half.px - 720) / PX_PER_CM) % 1)).toBeCloseTo(0.5);
  });

  it('snaps to eighth centimetres', () => {
    expect(snapRuler(cmToPx(1.06))).toBeCloseTo(cmToPx(1));
    expect(snapRuler(cmToPx(1.1))).toBeCloseTo(cmToPx(1.125));
  });

  it('places and drags the indent markers like PowerPoint', () => {
    expect(indentMarkers({ indent: 1, firstIndent: -20 })).toEqual({ left: 60, first: 40 });
    // First-line triangle: only the first line moves.
    expect(dragIndent({ indent: 1 }, 'first', 100)).toEqual({ indent: 1, firstIndent: 40 });
    // Hanging triangle: the other lines move, the first line stays.
    expect(dragIndent({ indent: 1, firstIndent: 0 }, 'hanging', 120)).toEqual({ indent: 2, firstIndent: -60 });
    // The box moves both.
    expect(dragIndent({ indent: 1, firstIndent: -20 }, 'left', 120)).toEqual({ indent: 2, firstIndent: -20 });
    expect(dragIndent({ indent: 1 }, 'left', -50)).toEqual({ indent: undefined, firstIndent: undefined });
  });
});
