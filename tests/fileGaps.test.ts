import { describe, expect, it } from 'vitest';
import type { Presentation, Slide } from '../src/domain/types';
import { DEFAULT_PRINT, colorFilter, docStats, exportFileName, exportHeight, formatBytes, mediaIdsOf, parseSlideRange, printPages } from '../src/domain/filePrint';

const s = (id: string, more: Partial<Slide> = {}): Slide => ({ id, group: 'G', text: id, ...more });
const pres = (slides: Slide[]): Presentation => ({ id: 'p', title: 'P', themeId: 't', slides } as unknown as Presentation);

describe('Print › Slides range (DeckCraft parse_slide_range)', () => {
  it('parses numbers and ranges, 1-based, in order without repeats', () => {
    expect(parseSlideRange('1-3, 5', 9)).toEqual({ ok: true, indices: [0, 1, 2, 4] });
    expect(parseSlideRange('5;3-1,2', 9)).toEqual({ ok: true, indices: [4, 0, 1, 2] });
    expect(parseSlideRange(' 2 ', 3)).toEqual({ ok: true, indices: [1] });
  });
  it('refuses text, empty and out-of-range input', () => {
    expect(parseSlideRange('a-3', 9).ok).toBe(false);
    expect(parseSlideRange('1-', 9).ok).toBe(false);
    expect(parseSlideRange(' , ', 9).ok).toBe(false);
    expect(parseSlideRange('0', 9).ok).toBe(false);
    expect(parseSlideRange('2-10', 9)).toMatchObject({ ok: false });
  });
  it('selects pages: range first, hidden slides only when included', () => {
    const p = pres([s('a'), s('b', { disabled: true }), s('c'), s('d')]);
    expect(printPages(p, { range: '', includeHidden: false }).pages.map((x) => x.number)).toEqual([1, 3, 4]);
    expect(printPages(p, { range: '', includeHidden: true }).pages.map((x) => x.number)).toEqual([1, 2, 3, 4]);
    expect(printPages(p, { range: '2-3', includeHidden: false }).pages.map((x) => x.slide.id)).toEqual(['c']);
    expect(printPages(p, { range: '9', includeHidden: false })).toMatchObject({ pages: [], error: expect.any(String) });
    expect(DEFAULT_PRINT.includeHidden).toBe(false);
  });
});

describe('Colour modes and export names', () => {
  it('maps print colour to a CSS filter', () => {
    expect(colorFilter('color')).toBeUndefined();
    expect(colorFilter('gray')).toBe('grayscale(1)');
    expect(colorFilter('bw')).toContain('contrast');
  });
  it('sizes and names slide pictures', () => {
    expect(exportHeight(1920)).toBe(1440);
    expect(exportFileName('주일/예배: 1', 3, 12, 'png')).toBe('주일 예배 1-03.png');
    expect(exportFileName('', 7, 120, 'jpg')).toBe('slides-007.jpg');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('File › Info statistics', () => {
  it('counts hidden slides, sections, words, media', () => {
    const p = pres([
      s('a', { group: 'A', text: 'one two', title: 'Hi', notes: 'a b c', elements: [{ id: 'e', kind: 'image', mediaId: 'm1', x: 0, y: 0, w: 1, h: 1 }, { id: 'v', kind: 'video', mediaId: 'm2', x: 0, y: 0, w: 1, h: 1 }] }),
      s('b', { group: 'A', disabled: true, text: '' }),
      s('c', { group: 'B', text: 'x', background: { kind: 'media', mediaId: 'm1', mediaType: 'image' } }),
    ]);
    const st = docStats(p);
    expect(st).toMatchObject({ slides: 3, hidden: 1, sections: 2, words: 4, noteWords: 3, pictures: 1, videos: 1, media: 2 });
    expect(mediaIdsOf(p).sort()).toEqual(['m1', 'm2']);
  });
});

describe('Picture export embeds only the font slices a slide uses', () => {
  it('reads unicode-range values', async () => {
    const { unicodeRangeCovers, familiesOf } = await import('../src/domain/fontEmbed');
    expect(unicodeRangeCovers('', 'a')).toBe(true);
    expect(unicodeRangeCovers('U+0000-00FF, U+0131', 'abc')).toBe(true);
    expect(unicodeRangeCovers('U+AC00-D7A3', 'abc')).toBe(false);
    expect(unicodeRangeCovers('U+AC00-D7A3', 'a가')).toBe(true);
    expect(unicodeRangeCovers('U+4??', 'ā')).toBe(false);
    expect(unicodeRangeCovers('U+1??', 'ā')).toBe(true);
    expect([...familiesOf(['"Nanum Gothic", sans-serif'])]).toEqual(['nanum gothic', 'sans-serif']);
  });
});
