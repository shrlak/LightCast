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
