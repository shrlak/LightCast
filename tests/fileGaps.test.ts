import { describe, expect, it } from 'vitest';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';
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

describe('Photo album (DeckCraft album.rs)', async () => {
  const pa = await import('../src/domain/photoAlbum');
  const pic = (n: string, more: Record<string, unknown> = {}) => ({ mediaId: `m-${n}`, name: `${n}.jpg`, w: 400, h: 300, ...more });
  const O = { per: 2 as const, frame: '', titles: false, captions: false };

  it('plans slides: a text box ends the group before it and gets its own slide', () => {
    const plan = pa.albumPlan([pic('a'), pic('b'), pic('c'), { text: 'Hello' }, pic('d')], 2);
    expect(plan.map((x) => (x.kind === 'text' ? 'T' : x.pics.map((p) => p.name[0]).join('')))).toEqual(['ab', 'c', 'T', 'd']);
  });
  it('places cells inside the slide; fit uses the smaller margin and titles reserve a band', () => {
    const grid = pa.placeAlbum({ per: 4, titles: false, captions: false }, 4);
    expect(grid.cells).toHaveLength(4);
    for (const [x, y, w, h] of grid.cells) { expect(x).toBeGreaterThanOrEqual(0); expect(x + w).toBeLessThanOrEqual(1440); expect(y + h).toBeLessThanOrEqual(1080); }
    const fit = pa.placeAlbum({ per: 1, fit: true, titles: false, captions: false }, 1).cells[0];
    const one = pa.placeAlbum({ per: 1, titles: false, captions: false }, 1).cells[0];
    expect(fit[2]).toBeGreaterThan(one[2]);
    const titled = pa.placeAlbum({ per: 1, titles: true, captions: false }, 1);
    expect(titled.title).not.toBeNull();
    expect(titled.cells[0][1]).toBeGreaterThan(one[1]);
    expect(pa.placeAlbum({ per: 2, titles: false, captions: true }, 2).cells[0][3]).toBeLessThan(pa.placeAlbum({ per: 2, titles: false, captions: false }, 2).cells[0][3]);
  });
  it('fits a picture to its box by aspect', () => {
    const [fw, fh] = pa.fitIn(800, 400, 400, 300);
    expect(fw).toBeCloseTo(533.33, 1);
    expect(fh).toBe(400);
    expect(pa.fitIn(300, 600, 400, 300)).toEqual([300, 225]);
    expect(pa.fitIn(300, 300)).toEqual([300, 225]);
  });
  it('builds rotated, framed pictures, text slides and keeps the settings for Edit Photo Album', () => {
    const items = [pic('a', { rot: 90, brightness: 0.2 }), { text: '제목 슬라이드' }, pic('b')];
    const album = pa.albumSlides(items, { ...O, per: 1, frame: 'rect', gray: true }, 'G', 'al9');
    expect(album).toHaveLength(3);
    const img = album[0].elements!.find((e) => e.kind === 'image')!;
    expect(img.rotation).toBe(90);
    expect(img.stroke).toBe('#1a1a1a');
    expect(album[0].album).toMatchObject({ id: 'al9', gray: true });
    expect(album[1].elements![0]).toMatchObject({ kind: 'text', text: '제목 슬라이드' });
    const read = pa.readAlbum(album, 'al9')!;
    expect(read.items).toHaveLength(3);
    expect(read.pictures[0]).toMatchObject({ rot: 90, name: 'a.jpg' });
    expect(read.options.gray).toBe(true);
    expect('text' in read.items[1] && read.items[1].text).toBe('제목 슬라이드');
  });
  it('clamps and rotates per-picture settings like the dialog', () => {
    expect(pa.clampUnit(0.95 + 0.1)).toBe(1);
    expect(pa.clampUnit(-0.95 - 0.1)).toBe(-1);
    expect(pa.rotateBy(0, -90)).toBe(270);
    expect(pa.rotateBy(270, 90)).toBe(0);
    expect(pa.needsAdjust(pic('a'), {})).toBe(false);
    expect(pa.needsAdjust(pic('a'), { gray: true })).toBe(true);
    expect(pa.needsAdjust(pic('a', { contrast: -0.1 }), {})).toBe(true);
    expect(pa.albumAdjust(pic('a', { brightness: 0.3 }), { gray: true })).toEqual({ recolor: 'grayscale', brightness: 0.3 });
  });
});

describe('Media bookmarks and poster frame', async () => {
  const mm = await import('../src/domain/mediaMarks');
  it('adds bookmarks in time order, ignores a second one at the same moment, removes and steps', () => {
    let list = mm.addBookmark(undefined, 12.34, '후렴');
    list = mm.addBookmark(list, 3);
    list = mm.addBookmark(list, 3.02);
    expect(list).toEqual([{ name: '책갈피 2', t: 3 }, { name: '후렴', t: 12.3 }]);
    expect(mm.stepBookmark(list, 0, 1)).toEqual(list[0]);
    expect(mm.stepBookmark(list, 3, 1)).toEqual(list[1]);
    expect(mm.stepBookmark(list, 12.3, 1)).toBeNull();
    expect(mm.stepBookmark(list, 12.3, -1)).toEqual(list[0]);
    expect(mm.stepBookmark(list, 3, -1)).toBeNull();
    expect(mm.removeBookmark(list, 0)).toEqual([list[1]]);
  });
  it('formats clock times', () => {
    expect(mm.formatClock(7.9)).toBe('0:07');
    expect(mm.formatClock(62)).toBe('1:02');
    expect(mm.formatClock(3723)).toBe('1:02:03');
  });
});

describe('Projector window: the new action kinds', async () => {
  const sa = await import('../src/domain/showActions');
  const el = (id: string, more: Partial<SlideElement>): SlideElement => ({ id, kind: 'shape', x: 0, y: 0, w: 100, h: 100, ...more });
  const slides = [s('a'), s('b'), s('c', { disabled: true }), s('d')];
  const deck = { ...pres(slides), customShows: [{ id: 'cs', name: 'Short', slideIds: ['gone', 'd', 'b'] }] };
  const state = { cursor: { presentationId: 'p', seq: 3, playlistIndex: null }, library: { presentations: [deck] } as unknown as import('../src/domain/types').Library };

  it('lastViewed goes back to the page visited before, via the console history', () => {
    expect(sa.lastViewed([0, 1, 3], 3)).toBe(1);
    expect(sa.lastViewed([3], 3)).toBeNull();
    expect(sa.liveActionFor(state, { kind: 'lastViewed' }, [0, 1, 3])).toMatchObject({ type: 'live/go', seq: 1 });
    expect(sa.liveActionFor(state, { kind: 'lastViewed' }, [3])).toBeNull();
  });
  it('records visits without repeats and caps the list', () => {
    expect(sa.noteVisit([0, 1], 1)).toEqual([0, 1]);
    expect(sa.noteVisit([0, 1], 2)).toEqual([0, 1, 2]);
    expect(sa.noteVisit([0, 1], null)).toEqual([0, 1]);
    expect(sa.noteVisit([0, 1, 2], 3, 3)).toEqual([1, 2, 3]);
  });
  it('customShow jumps to the first slide of the show that is still in the deck', () => {
    expect(sa.liveActionFor(state, { kind: 'customShow', show: 'cs' })).toMatchObject({ type: 'live/go', seq: 3 });
    expect(sa.liveActionFor(state, { kind: 'customShow', show: 'nope' })).toBeNull();
  });
  it('playMedia: an audio object plays through the console, a video plays in the window itself', () => {
    const audio = el('au', { kind: 'audio', mediaId: 'm1', action: { kind: 'playMedia' } });
    const video = el('vi', { kind: 'video', mediaId: 'm2', action: { kind: 'playMedia' } });
    expect(sa.liveActionFor(state, sa.actionOf(audio)!)).toEqual({ type: 'audio/play', mediaId: 'm1' });
    expect(sa.liveActionFor(state, sa.actionOf(video)!)).toBeNull();
    expect(sa.actionOf(video)).toMatchObject({ kind: 'playMedia', target: { id: 'vi', kind: 'video' } });
  });
  it('Mouse Over: finds the object under the pointer and its action', () => {
    const hot = el('h', { x: 10, y: 10, w: 50, h: 50, hoverAction: { kind: 'next' }, tooltip: '다음' });
    const sl = s('a', { elements: [hot] });
    expect(sa.hoverAt(sl, 20, 20)?.id).toBe('h');
    expect(sa.hoverAt(sl, 200, 200)).toBeNull();
    expect(sa.hoverActionOf(hot)).toEqual({ kind: 'next' });
    expect(sa.liveActionFor(state, sa.hoverActionOf(hot)!)).toMatchObject({ type: 'live/next' });
  });
});
