// The slide show screen as PowerPoint's (ink, 검정/흰색 화면, end screen, 확대, keys), the master views edited in the
// editor, and the show settings in PowerPoint files.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { END_OF_SHOW, addStroke, clearSlideInk, eraseAt, framePoint, hasInk, inkKey, keepShowInk, screenAction, showKey, typedSlide, zoomStep, type ShowStroke } from '../src/domain/showScreen';
import { createSeedLibrary } from '../src/domain/defaults';
import { goLive } from '../src/domain/live';
import { createInitialState, reducer } from '../src/domain/reducer';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';
import { liveCanvasProps } from '../src/ui/liveProps';
import { masterPatch, masterSlide, masterSlidePatch } from '../src/ui/ppt/masterMode';
import { presenterClock } from '../src/ui/ppt/PresenterView';
import { readShowPr, showPrXml, writeShowPr } from '../src/domain/io/pptxShow';
import { buildPptx } from '../src/domain/io/pptxExport';

const stroke = (pts: [number, number][], more: Partial<ShowStroke> = {}): ShowStroke => ({ points: pts, color: '#ff0000', width: 6, ...more });

describe('show ink (펜 · 형광펜 · 지우개)', () => {
  it('adds strokes per slide, erases the stroke under the eraser, clears a slide', () => {
    let ink = addStroke(undefined, 'p#0', stroke([[0, 0], [100, 0]]));
    ink = addStroke(ink, 'p#0', stroke([[0, 200], [100, 200]]));
    ink = addStroke(ink, 'p#1', stroke([[5, 5]]));
    expect(ink['p#0']).toHaveLength(2);
    expect(ink['p#1']).toBeUndefined();
    const erased = eraseAt(ink, 'p#0', 50, 4);
    expect(erased['p#0']).toHaveLength(1);
    expect(erased['p#0'][0].points[0]).toEqual([0, 200]);
    expect(eraseAt(erased, 'p#0', 500, 500)).toBe(erased);
    expect(clearSlideInk(erased, 'p#0')).toEqual({});
    expect(hasInk(erased)).toBe(true);
    expect(hasInk({})).toBe(false);
  });

  it('유지 turns each slide\'s ink into ink objects on that slide', () => {
    const p: Presentation = { id: 'd', title: 'D', themeId: 't', slides: [{ id: 'a', group: '', text: '' }, { id: 'b', group: '', text: '' }] };
    const ink = { [inkKey('d', 1)]: [stroke([[10, 10], [60, 40], [120, 80]]), stroke([[0, 0], [30, 30]], { highlighter: true, width: 28 })], [inkKey('other', 0)]: [stroke([[0, 0], [9, 9]])] };
    const kept = keepShowInk(p, ink);
    expect([...kept.keys()]).toEqual(['b']);
    const els = kept.get('b')!;
    expect(els.map((e) => e.kind)).toEqual(['ink', 'ink']);
    expect(els[1].opacity).toBe(0.45);
  });
});

describe('show keys, zoom and screen commands', () => {
  const s = { count: 10 };
  it('maps PowerPoint\'s keys', () => {
    expect(showKey('n', '', s)).toEqual({ do: 'next' });
    expect(showKey(' ', '', { ...s, ended: true })).toEqual({ do: 'end' });
    expect(showKey('Backspace', '', s)).toEqual({ do: 'prev' });
    expect(showKey('w', '', s)).toEqual({ do: 'white' });
    expect(showKey(',', '', s)).toEqual({ do: 'white' });
    expect(showKey('.', '', s)).toEqual({ do: 'black' });
    expect(showKey('E', '', s)).toEqual({ do: 'clearInk' });
    expect(showKey('g', '', s)).toEqual({ do: 'all' });
    expect(showKey('-', '', s)).toEqual({ do: 'all' });
    expect(showKey('-', '', { ...s, zoomed: true })).toEqual({ do: 'zoom', dir: -1 });
    expect(showKey('Escape', '', { ...s, zoomed: true })).toEqual({ do: 'unzoom' });
    expect(showKey('Escape', '', s)).toEqual({ do: 'end' });
    expect(showKey('Home', '', s)).toEqual({ do: 'first' });
    expect(showKey('x', '', s)).toBeNull();
  });
  it('a typed number and Enter go to that slide', () => {
    expect(showKey('1', '', s)).toEqual({ do: 'type', typed: '1' });
    expect(showKey('0', '1', s)).toEqual({ do: 'type', typed: '10' });
    expect(showKey('Enter', '7', s)).toEqual({ do: 'go', seq: 6 });
    expect(showKey('Enter', '42', s)).toEqual({ do: 'type', typed: '' });
    expect(typedSlide('3', 2)).toBeNull();
  });
  it('zooms in steps and maps a click on the zoomed slide back to the slide', () => {
    const z = zoomStep(null, 1, 720, 540)!;
    expect(z.scale).toBe(1.5);
    expect(zoomStep({ x: 0, y: 0, scale: 1.5 }, -1, 0, 0)).toBeNull();
    expect(framePoint(0.5, 0.5, { x: 720, y: 540, scale: 2 }, 1440, 1080)).toEqual([720, 540]);
    expect(framePoint(0, 0, { x: 720, y: 540, scale: 2 }, 1440, 1080)).toEqual([360, 270]);
    // Near the edge the view stays inside the slide.
    expect(framePoint(0, 0, { x: 0, y: 0, scale: 2 }, 1440, 1080)).toEqual([0, 0]);
  });
  it('checks screen commands from another window before they reach the show', () => {
    expect(screenAction({ kind: 'white' })).toEqual({ type: 'live/white' });
    expect(screenAction({ kind: 'ink', stroke: stroke([[0, 0], [1, 1]]) })).toMatchObject({ type: 'live/ink', op: 'add' });
    expect(screenAction({ kind: 'ink', stroke: { ...stroke([[0, 0], [1, 1]]), color: 'red;' } })).toBeNull();
    expect(screenAction({ kind: 'ink', stroke: stroke([[0, 0]]) })).toBeNull();
    expect(screenAction({ kind: 'zoom', zoom: { x: 1, y: 1, scale: 99 } })).toBeNull();
    expect(screenAction({ kind: 'zoom', zoom: null })).toEqual({ type: 'live/zoom', zoom: null });
    expect(screenAction({ kind: 'delete everything' })).toBeNull();
    expect(screenAction(null)).toBeNull();
  });
});

describe('the show on the live feed', () => {
  const slides: Slide[] = [{ id: 'a', group: 'S', text: 'one' }, { id: 'b', group: 'S', text: 'two' }];
  const start = () => {
    const lib = createSeedLibrary();
    lib.presentations = [{ id: 'd', title: 'D', themeId: 'theme_classic', slides } as Presentation];
    lib.playlists = [];
    return goLive(createInitialState(lib), { presentationId: 'd', seq: 0 }, 0);
  };
  it('after the last slide shows the black end screen; back goes to the slide again', () => {
    let s = reducer(start(), { type: 'live/next' });
    expect(s.live.slide?.id).toBe('b');
    expect(s.live.inkKey).toBe('d#1');
    s = reducer(s, { type: 'live/next' });
    expect(s.live.ended).toBe(true);
    expect(liveCanvasProps(s.live).ended).toBe(true);
    expect(reducer(s, { type: 'live/next' })).toBe(s);
    s = reducer(s, { type: 'live/prev' });
    expect(s.live.ended).toBe(false);
    expect(s.live.slide?.id).toBe('b');
    expect(END_OF_SHOW).toContain('슬라이드 쇼 마지막입니다');
  });
  it('흰색 화면 and 검정 화면 replace each other; ink stays with its slide', () => {
    let s = reducer(start(), { type: 'live/white' });
    expect(s.live.white).toBe(true);
    s = reducer(s, { type: 'live/toggleBlack' });
    expect([s.live.black, s.live.white]).toEqual([true, false]);
    s = reducer(s, { type: 'live/ink', op: 'add', stroke: stroke([[0, 0], [10, 10]]) });
    expect(liveCanvasProps(s.live).ink).toHaveLength(1);
    s = reducer(s, { type: 'live/next' });
    expect(liveCanvasProps(s.live).ink).toBeUndefined();
    s = reducer(s, { type: 'live/prev' });
    expect(liveCanvasProps(s.live).ink).toHaveLength(1);
    s = reducer(s, { type: 'live/zoom', zoom: { x: 10, y: 10, scale: 2 } });
    expect(liveCanvasProps(s.live).zoom).toEqual({ x: 10, y: 10, scale: 2 });
    s = reducer(s, { type: 'live/clearAll' });
    expect([s.live.ink, s.live.zoom, s.live.ended]).toEqual([undefined, null, false]);
  });
  it('the presenter view timer reads h:mm:ss', () => {
    expect(presenterClock(0)).toBe('0:00:00');
    expect(presenterClock(3725)).toBe('1:02:05');
  });
});

describe('slide master edited in the editor', () => {
  const title: SlideElement = { id: 't', kind: 'text', placeholder: 'title', x: 0, y: 0, w: 10, h: 10 };
  const logo: SlideElement = { id: 'logo', kind: 'shape', x: 0, y: 0, w: 10, h: 10 };
  const p: Presentation = { id: 'd', title: 'D', themeId: 't', slides: [{ id: 's', group: '', text: '' }], master: { elements: [logo], layouts: [{ id: 'L', name: '제목 슬라이드', elements: [title] }] } };
  it('shows the master or a layout as a slide', () => {
    expect(masterSlide(p, null).elements).toEqual([logo]);
    expect(masterSlide(p, 'L').elements).toEqual([title]);
    expect(masterSlide(p, null).id).not.toBe(masterSlide(p, 'L').id);
  });
  it('saves an edit to the layout it was made on, or to the master (whose objects reach every slide)', () => {
    const onLayout = masterSlidePatch(p, 'L', { elements: [] })!;
    expect(onLayout.master?.layouts?.[0].elements).toEqual([]);
    expect(onLayout.master?.elements).toEqual([logo]);
    expect(onLayout.slides).toBeUndefined();
    const onMaster = masterSlidePatch(p, null, { elements: [logo, { ...logo, id: 'x' }] })!;
    expect(onMaster.master?.elements).toHaveLength(2);
    expect(onMaster.slides?.[0].elements?.some((e) => e.master)).toBe(true);
    expect(masterSlidePatch(p, null, { background: { kind: 'color', value: '#123456' } })!.master?.background).toEqual({ kind: 'color', value: '#123456' });
    expect(masterSlidePatch(p, null, { notes: 'x' })).toBeNull();
    expect(masterPatch({ ...p, master: undefined }, { elements: [] }).master).toBeUndefined();
  });
});

describe('쇼 설정 in PowerPoint files (presProps.xml)', () => {
  it('reads loop, narration, animation, timings and media controls', () => {
    const xml = '<p:presentationPr xmlns:p="x"><p:showPr loop="1" showNarration="0" showAnimation="0" useTimings="0"><p:present/><p:sldAll/><p:extLst><p:ext uri="{2FDB2607-1784-4EEB-B798-7EB5836EED8A}"><p14:showMediaCtrls val="0"/></p:ext></p:extLst></p:showPr></p:presentationPr>';
    expect(readShowPr(xml)).toEqual({ loop: true, showSetup: { noNarration: true, noAnimation: true, manual: true, noMediaControls: true } });
    expect(readShowPr('<p:presentationPr><p:showPr showNarration="1"><p:present/></p:showPr></p:presentationPr>')).toEqual({});
    expect(readShowPr('<p:presentationPr/>')).toEqual({});
  });
  it('writes showPr in the schema\'s place and reads it back', () => {
    const p = { loop: true, showSetup: { manual: true, noMediaControls: true } };
    const xml = writeShowPr('<p:presentationPr xmlns:p="x"><p:prnPr/><p:showPr/><p:clrMru/><p:extLst/></p:presentationPr>', p);
    expect(xml.indexOf('<p:prnPr/>')).toBeLessThan(xml.indexOf('<p:showPr'));
    expect(xml.indexOf('<p:showPr')).toBeLessThan(xml.indexOf('<p:clrMru'));
    expect(xml.match(/<p:showPr/g)).toHaveLength(1);
    expect(readShowPr(xml)).toEqual(p);
    expect(writeShowPr('<p:presentationPr xmlns:p="x"/>', {})).toContain(showPrXml({}));
  });
  it('an exported presentation carries its 쇼 설정', async () => {
    const p: Presentation = { id: 'd', title: 'D', themeId: 'theme_classic', slides: [{ id: 's', group: 'S', text: 'hi' }], loop: true, showSetup: { noAnimation: true } };
    const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [p] }, { presentation: p });
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
    const props = await zip.file('ppt/presProps.xml')!.async('string');
    expect(readShowPr(props)).toEqual({ loop: true, showSetup: { noAnimation: true } });
  });
});
