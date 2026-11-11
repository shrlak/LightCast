import { describe, expect, it } from 'vitest';
import type { Library, Presentation, Slide, SlideElement } from '../src/domain/types';
import { refreshZooms } from '../src/domain/zoomRefresh';
import { actionAt, actionOf, liveActionFor } from '../src/domain/showActions';

const s = (id: string, more: Partial<Slide> = {}): Slide => ({ id, group: 'G', text: id, ...more });
const pres = (slides: Slide[]): Presentation => ({ id: 'p', title: 'P', themeId: 't', slides } as unknown as Presentation);

describe('Zoom objects follow their target slide', () => {
  it('refreshes a zoom snapshot when the target changes, and leaves it alone otherwise', () => {
    const zoom: SlideElement = { id: 'z', kind: 'zoom', x: 0, y: 0, w: 100, h: 75, targetSlideId: 'b', zoomOf: { slide: s('b', { text: 'old' }), theme: {} as never, background: null } };
    const p = pres([s('a', { elements: [zoom] }), s('b', { text: 'new' })]);
    const once = refreshZooms(p);
    expect(once.slides[0].elements![0].zoomOf!.slide.text).toBe('new');
    expect(refreshZooms(once)).toBe(once);
    const edited = { ...once, slides: [once.slides[0], { ...once.slides[1], text: 'newer' }] };
    expect(refreshZooms(edited).slides[0].elements![0].zoomOf!.slide.text).toBe('newer');
  });
});

describe('Slide show clicks', () => {
  const btn: SlideElement = { id: 'n', kind: 'shape', x: 10, y: 10, w: 50, h: 50, action: { kind: 'slide', slideId: 'c' } };
  const zoom: SlideElement = { id: 'z', kind: 'zoom', x: 200, y: 200, w: 100, h: 75, targetSlideId: 'b' };
  const deck = pres([s('a', { elements: [btn, zoom] }), s('b'), s('c', { disabled: true }), s('d')]);
  const state = { cursor: { presentationId: 'p', seq: 0, playlistIndex: null }, library: { presentations: [deck] } as unknown as Library };
  it('maps clicked objects to live actions on the console', () => {
    expect(actionOf(actionAt(deck.slides[0], 20, 20)!)).toEqual({ kind: 'slide', slideId: 'c' });
    expect(actionOf(actionAt(deck.slides[0], 250, 230)!)).toEqual({ kind: 'zoom', slideId: 'b' });
    expect(liveActionFor(state, { kind: 'zoom', slideId: 'b' })).toMatchObject({ type: 'live/go', presentationId: 'p', seq: 1 });
    expect(liveActionFor(state, { kind: 'last' })).toMatchObject({ type: 'live/go', seq: 3 });
    expect(liveActionFor(state, { kind: 'next' })).toMatchObject({ type: 'live/next' });
    expect(liveActionFor(state, { kind: 'url', url: 'https://x' })).toBeNull();
  });
});

describe('SmartArt in Korean', async () => {
  const { smartArtCatalog } = await import('../src/engine');
  const { SMARTART_LAYOUT, SMARTART_STYLE, SMARTART_CATEGORIES } = await import('../src/ui/ppt/ko');
  it('names every layout and style, in a known category', () => {
    const cat = smartArtCatalog()!;
    for (const l of cat.layouts) {
      expect(SMARTART_LAYOUT[l.id], l.id).toBeTruthy();
      expect(SMARTART_CATEGORIES).toContain(SMARTART_LAYOUT[l.id][1]);
    }
    for (const st of cat.styles) expect(SMARTART_STYLE[st.id], st.id).toBeTruthy();
  });
});

describe('Character formatting in the slide text', async () => {
  const { slideLineRuns, slideTextPatch } = await import('../src/domain/richText');
  it('keeps runs only where formatted and still spelling the line', () => {
    const p = slideTextPatch([[{ text: 'H' }, { text: '2', baseline: 'sub' }, { text: 'O' }], [{ text: 'plain' }]]);
    expect(p.text).toBe('H2O\nplain');
    expect(slideLineRuns(p)[0]?.[1]).toEqual({ text: '2', baseline: 'sub' });
    expect(slideLineRuns(p)[1]).toBeNull();
    expect(slideTextPatch([[{ text: 'x' }]]).textRuns).toBeUndefined();
    expect(slideLineRuns({ text: 'H3O\nplain', textRuns: p.textRuns })[0]).toBeNull();
  });
});

describe('Arrange › Regroup', async () => {
  const { groupSelection, ungroupSelection, regroupSelection } = await import('../src/domain/editOps');
  it('puts ungrouped objects back into one group', () => {
    const els: SlideElement[] = ['a', 'b', 'c'].map((id, i) => ({ id, kind: 'shape', x: i * 10, y: 0, w: 5, h: 5 }));
    const g = groupSelection(els, ['a', 'b']);
    const u = ungroupSelection(g, ['a']);
    expect(u.every((e) => !e.groupId)).toBe(true);
    const r = regroupSelection(u, ['b']);
    expect(r.ids.sort()).toEqual(['a', 'b']);
    expect(r.elements.find((e) => e.id === 'a')!.groupId).toBe(r.elements.find((e) => e.id === 'b')!.groupId);
    expect(r.elements.find((e) => e.id === 'c')!.groupId).toBeUndefined();
  });
});

describe('Edit Points operations', async () => {
  const pe = await import('../src/domain/pathEdit');
  const sq = () => pe.parsePath('M0 0 L100 0 L100 100 L0 100 Z');
  it('adds a point on a segment and deletes it again', () => {
    const added = pe.insertPoint(sq(), 1, 0.5);
    expect(pe.anchors(added).map((a) => a.p)).toContainEqual([50, 0]);
    expect(pe.writePath(pe.deletePoint(added, 1))).toBe(pe.writePath(sq()));
  });
  it('splits a curve where clicked, keeping its shape', () => {
    const c = pe.parsePath('M0 0 C0 100 100 100 100 0');
    const mid = pe.pointOn(c, 1, 0.5)!;
    const split = pe.insertPoint(c, 1, 0.5);
    expect(split[1].pts[2][0]).toBeCloseTo(mid[0]);
    expect(split[1].pts[2][1]).toBeCloseTo(mid[1]);
    expect(pe.pointOn(split, 2, 0.5)![1]).toBeCloseTo(pe.pointOn(c, 1, 0.75)![1]);
  });
  it('changes segment and point types', () => {
    const curved = pe.setSegmentType(sq(), 1, 'curve');
    expect(curved[1].cmd).toBe('C');
    expect(pe.setSegmentType(curved, 1, 'line')[1].cmd).toBe('L');
    const smooth = pe.setPointType(pe.parsePath('M0 0 C10 0 40 0 50 50 C60 0 90 0 100 0'), 1, 'smooth');
    const [inH, p] = [smooth[1].pts[1], smooth[1].pts[2]], outH = smooth[2].pts[0];
    // Collinear and equal arms.
    expect(Math.hypot(p[0] - inH[0], p[1] - inH[1])).toBeCloseTo(Math.hypot(outH[0] - p[0], outH[1] - p[1]));
    expect((p[0] - inH[0]) * (outH[1] - p[1]) - (p[1] - inH[1]) * (outH[0] - p[0])).toBeCloseTo(0);
  });
  it('opens, closes and deletes segments', () => {
    const opened = pe.openPath(sq(), 2);
    expect(opened.some((s) => s.cmd === 'Z')).toBe(false);
    expect(opened[0].pts[0]).toEqual([100, 100]);
    expect(pe.anchors(opened)).toHaveLength(5);
    expect(pe.closePath(opened, 1).at(-1)!.cmd).toBe('Z');
    const cut = pe.deleteSegment(sq(), 1);
    expect(cut.some((s) => s.cmd === 'Z')).toBe(false);
    expect(pe.anchors(cut)).toHaveLength(4);
    const nearest = pe.nearestOnPath(sq(), [50, 2]);
    expect(nearest?.seg).toBe(1);
  });
});

describe('Korean shape names', async () => {
  const { shapeCatalog } = await import('../src/engine');
  const { shapeLabel } = await import('../src/ui/ppt/ko');
  it('names every preset shape in Korean', () => {
    expect(shapeCatalog().filter((s) => shapeLabel(s.name, '') === '').map((s) => s.name)).toEqual([]);
  });
});

describe('Korean animation and transition names', async () => {
  const { animationCatalog, transitionCatalog } = await import('../src/engine');
  const { ANIMATION, TRANSITION, optionLabel, animOptionLabel } = await import('../src/ui/ppt/ko');
  it('names every effect and option in Korean', () => {
    expect(animationCatalog().filter((e) => !ANIMATION[e.id]).map((e) => e.id)).toEqual([]);
    expect(transitionCatalog().filter((e) => !TRANSITION[e.id]).map((e) => e.id)).toEqual([]);
    expect([...new Set(animationCatalog().flatMap((e) => e.options).filter((o) => animOptionLabel(o) === o))]).toEqual([]);
    expect([...new Set(transitionCatalog().flatMap((e) => e.options.map((o) => o.label)).filter((l) => /[A-Za-z]/.test(optionLabel(l))))]).toEqual([]);
  });
});
