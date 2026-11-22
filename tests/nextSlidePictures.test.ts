// The output decodes the next slide's pictures while the current one is up (the slide change no longer waits).
import { describe, expect, it } from 'vitest';
import { slidePictures } from '../src/domain/live';
import type { Slide } from '../src/domain/types';

describe('next slide pictures', () => {
  it('lists the background picture and the image objects, once each; nothing for a slide without pictures', () => {
    const slide: Slide = { id: 's', group: 'G', title: '', text: '', elements: [
      { id: 'a', kind: 'image', mediaId: 'm1', x: 0, y: 0, w: 10, h: 10 },
      { id: 'b', kind: 'image', mediaId: 'm1', x: 0, y: 0, w: 10, h: 10 },
      { id: 'c', kind: 'image', mediaId: 'm2', x: 0, y: 0, w: 10, h: 10, hidden: true },
      { id: 'd', kind: 'text', text: 'x', x: 0, y: 0, w: 10, h: 10 },
    ] };
    expect(slidePictures(slide, { kind: 'media', mediaId: 'bg', mediaType: 'image' })).toEqual({ ids: ['bg', 'm1'], urls: [] });
    expect(slidePictures(slide, { kind: 'image', url: 'backgrounds/a.jpg' })).toEqual({ ids: ['m1'], urls: ['backgrounds/a.jpg'] });
    expect(slidePictures({ id: 't', group: 'G', title: '', text: 'x' }, { kind: 'color', value: '#000' })).toBeNull();
  });
});
