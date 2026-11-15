import { describe, expect, it } from 'vitest';
import { bookmarksReached, clickTriggerObjects, fireBookmarkTriggers, hasBookmarkTriggers } from '../src/domain/mediaBookmarkTriggers';
import { animSpec } from '../src/domain/animations';
import type { Slide, SlideAnimation, SlideElement } from '../src/domain/types';

const marks = [{ name: 'A', t: 5 }, { name: 'B', t: 10 }];
const el = (id: string, o: Partial<SlideElement> = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 100, text: id, ...o }) as unknown as SlideElement;
const anim = (o: Partial<SlideAnimation>): SlideAnimation => ({ id: 'a1', elementId: 'txt', effect: 'fade', class: 'entrance', start: 'click', durationMs: 500, delayMs: 0, ...o }) as SlideAnimation;
const slide = (animations: SlideAnimation[]): Slide => ({ id: 's', elements: [el('vid', { kind: 'video' } as Partial<SlideElement>), el('txt')], animations }) as unknown as Slide;

describe('bookmarksReached', () => {
  it('fires bookmarks passed during normal playback once', () => {
    expect(bookmarksReached(marks, 4.9, 5.1).map((b) => b.name)).toEqual(['A']);
    expect(bookmarksReached(marks, 5.1, 5.3)).toEqual([]);
    expect(bookmarksReached(marks, 4, 11)).toEqual([]); // a seek
    expect(bookmarksReached(marks, 6, 3)).toEqual([]); // backwards
    expect(bookmarksReached(undefined, 0, 1)).toEqual([]);
  });
});

describe('bookmark triggers', () => {
  const s = slide([anim({ trigger: 'vid', bookmark: 'A' })]);
  it('the timeline treats it as a trigger of the media object', () => {
    expect(animSpec(s)?.anims[0].trigger).toBe('vid');
    expect(hasBookmarkTriggers(s, 'vid')).toBe(true);
  });
  it('reaching the bookmark plays the triggered sequence; other bookmarks do nothing', () => {
    const b = fireBookmarkTriggers(s, null, 'vid', marks, 4.9, 5.1, 1000);
    expect(b?.triggers?.vid).toBeTruthy();
    expect(fireBookmarkTriggers(s, null, 'vid', marks, 9.9, 10.1, 1000)).toBeNull();
    expect(fireBookmarkTriggers(s, null, 'vid', marks, 0, 1, 1000)).toBeNull();
  });
  it('a click on the media object does not start a bookmark-only sequence', () => {
    expect(clickTriggerObjects(s)).toEqual([]);
    expect(clickTriggerObjects(slide([anim({ trigger: 'vid' })]))).toEqual(['vid']);
  });
});
