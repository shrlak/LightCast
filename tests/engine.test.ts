import { describe, expect, it } from 'vitest';
import {
  alignBoxes, chartSvg, colorPalette, editTable, engineCall, engineReady, findText, iconCatalog, layoutTable, newTable, prepareTimeline,
  replaceText, resizeBox, sampleTimeline, shapeCatalog, shapeGeometry, transitionCatalog, transitionFrame,
} from '../src/engine';
import { advanceBuild, initialBuild, rewindBuild } from '../src/domain/animations';
import { alignSelection, distributeSelection, duplicateSelection, flipSelection, groupSelection, makeShape, orderSelection, rotateSelection, ungroupSelection } from '../src/domain/editOps';
import { lineRuns, normalizeRuns, withRichLines } from '../src/domain/richText';
import { patchElement } from '../src/domain/templates/convert';
import { quadMatrix } from '../src/ui/ShowEffects';
import type { Slide, SlideElement } from '../src/domain/types';

const el = (id: string, x: number, y: number, w = 100, h = 100, more: Partial<SlideElement> = {}): SlideElement => ({ id, kind: 'shape', shape: 'rect', x, y, w, h, ...more });

describe('Rust engine (WebAssembly)', () => {
  it('loads and answers', () => {
    expect(engineReady()).toBe(true);
    expect(engineCall<{ engine: string }>('version')?.engine).toBe('1.0.0');
    expect(engineCall('no.such.op')).toBeNull();
  });

  it('draws all of DeckCraft\'s preset shapes', () => {
    const cat = shapeCatalog();
    expect(cat.length).toBeGreaterThanOrEqual(180);
    for (const name of ['rect', 'ellipse', 'star5', 'rightArrow', 'heart', 'wedgeRoundRectCallout', 'flowChartDecision', 'cloud']) {
      const g = shapeGeometry(name, 300, 200);
      expect(g?.paths.length, name).toBeGreaterThan(0);
    }
    expect(iconCatalog().length).toBeGreaterThan(50);
  });

  it('aligns, resizes and snaps through the engine', () => {
    const d = alignBoxes([{ id: 'a', x: 10, y: 10, w: 100, h: 100 }], 'center', 'slide');
    expect(d[0].dx).toBe(670 - 10);
    const r = resizeBox({ id: 'a', x: 0, y: 0, w: 100, h: 50 }, 'se', 100, 0, true, false);
    expect(r).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('tables, charts, colours, find and transitions', () => {
    const t = newTable(2, 3)!;
    expect(t.rows).toHaveLength(2);
    const t2 = editTable(t, 'insertColRight', 0, 2)!;
    expect(t2.rows[0]).toHaveLength(4);
    expect(layoutTable(t2, 800, 200)).toHaveLength(8);
    expect(chartSvg({ kind: 'pie', categories: ['a', 'b'], series: [{ name: 's', values: [1, 3] }] }, 400, 300)).toMatch(/^<svg/);
    expect(colorPalette()?.theme).toHaveLength(10);
    expect(findText([{ key: 'k', text: '예수 사랑 예수' }], '예수')).toHaveLength(2);
    expect(replaceText([{ key: 'k', text: 'a b a' }], 'a', 'c').items[0].text).toBe('c b c');
    expect(transitionCatalog().length).toBeGreaterThan(40);
    expect(transitionFrame('wipe', 'r', 0.5)?.length).toBeGreaterThan(0);
  });
});

describe('Arrange', () => {
  const els = [el('a', 100, 100), el('b', 500, 300, 200), el('c', 1000, 600)];
  it('aligns a selection to its left edge and centres one object on the slide', () => {
    const left = alignSelection(els, ['a', 'b', 'c'], 'left');
    expect(left.map((e) => e.x)).toEqual([100, 100, 100]);
    const one = alignSelection(els, ['a'], 'middle');
    expect(one[0].y).toBe(490);
  });
  it('distributes evenly', () => {
    const d = distributeSelection(els, ['a', 'b', 'c'], 'horizontal');
    // Span 100..1100, widths 400, two gaps of 300: b starts at 500.
    expect(d[1].x).toBe(500);
  });
  it('orders, groups and ungroups', () => {
    expect(orderSelection(els, ['a'], 'front').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    const g = groupSelection(els, ['a', 'c']);
    expect(g.filter((e) => e.groupId).length).toBe(2);
    // Aligning a group moves it as one.
    const moved = alignSelection(g, ['a'], 'left', true);
    expect(moved.find((e) => e.id === 'a')!.x).toBe(0);
    expect(moved.find((e) => e.id === 'c')!.x).toBe(900);
    expect(ungroupSelection(g, ['a']).every((e) => !e.groupId)).toBe(true);
  });
  it('rotates, flips and duplicates', () => {
    expect(rotateSelection(els, ['a'], 90)[0].rotation).toBe(90);
    expect(flipSelection(els, ['a'], 'horizontal')[0].flipH).toBe(true);
    const dup = duplicateSelection(els, ['b']);
    expect(dup.elements).toHaveLength(4);
    expect(dup.elements[3].x).toBe(524); // 12 pt off, as DeckCraft's edit.duplicate
  });
  it('inserts preset shapes', () => {
    expect(makeShape('star5').shape).toBe('star5');
    expect(makeShape('textBox').kind).toBe('text');
  });
});

describe('Animations', () => {
  const slide: Slide = {
    id: 's', group: '', text: '',
    elements: [el('t', 100, 100), el('p', 600, 600)],
    animations: [
      { id: '1', elementId: 't', effect: 'fade', class: 'entrance', start: 'click', durationMs: 500, delayMs: 0 },
      { id: '2', elementId: 'p', effect: 'fly', class: 'entrance', option: 'b', start: 'click', durationMs: 500, delayMs: 0 },
    ],
  };
  it('waits for clicks, then runs out into the next slide', () => {
    const b0 = initialBuild(slide, 0)!;
    expect(b0).toEqual({ step: 0, startedAt: null });
    const b1 = advanceBuild(slide, b0, 1000)!;
    expect(b1).toEqual({ step: 0, startedAt: 1000 });
    const b2 = advanceBuild(slide, b1, 3000)!;
    expect(b2.step).toBe(1);
    expect(advanceBuild(slide, b2, 5000)).toBeNull();
    expect(rewindBuild(slide, b2, 6000)).toEqual({ step: 0, startedAt: null });
  });
  it('samples states from the timeline', () => {
    const spec = { anims: slide.animations!.map((a) => ({ ...a, option: a.option ?? '' })), boxes: slide.elements!.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h })) };
    expect(prepareTimeline(spec)?.steps).toBe(2);
    expect(sampleTimeline(spec, 0, 0)?.t.visible).toBe(false);
    expect(sampleTimeline(spec, 2, 0)?.p.visible).toBe(true);
  });
  it('maps a transition quad to a CSS matrix', () => {
    expect(quadMatrix(100, 100, [[0, 0], [100, 0], [100, 100], [0, 100]])).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');
  });
});

describe('Text in a box formatted part by part', () => {
  const box: SlideElement = { id: 'x', kind: 'text', x: 0, y: 0, w: 400, h: 100, text: '주 예수\n사랑', fontSize: 60 };
  it('keeps runs only while they spell the text', () => {
    const patch = withRichLines(box, [[{ text: '주 ' }, { text: '예수', bold: true, fontSize: 90 }], [{ text: '사랑', italic: true }]]);
    expect(patch.text).toBe('주 예수\n사랑');
    const rich = { ...box, ...patch };
    expect(lineRuns(rich)[0]).toEqual([{ text: '주 ' }, { text: '예수', bold: true, fontSize: 90 }]);
    expect(lineRuns({ ...rich, text: '다른 글\n사랑' })[0]).toBeNull();
  });
  it('joins equal runs and drops plain-only formatting', () => {
    expect(normalizeRuns([{ text: 'a', bold: true }, { text: 'b', bold: true }, { text: '' }])).toEqual([{ text: 'ab', bold: true }]);
    expect(withRichLines(box, [[{ text: 'plain' }]]).runs).toBeUndefined();
  });
  it('a size or weight for the whole box replaces the parts', () => {
    const rich = { ...box, ...withRichLines(box, [[{ text: '주 ' }, { text: '예수', bold: true, fontSize: 90 }], [{ text: '사랑' }]]) };
    const all = patchElement(rich, { fontSize: 40 });
    expect(lineRuns(all)[0]).toEqual([{ text: '주 ' }, { text: '예수', bold: true }]);
    expect(lineRuns(patchElement(all, { bold: false }))[0]).toBeNull();
  });
});
