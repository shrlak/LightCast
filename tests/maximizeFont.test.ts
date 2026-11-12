import { describe, expect, it } from 'vitest';
import { textElementBounds } from '../src/domain/textBox';
import { largestFittingFont } from '../src/domain/maximizeFont';
import { prepareAnnouncementSizing, prepareAnnouncementSlide } from '../src/domain/announcementSizing';
import { patchElement } from '../src/domain/templates/convert';
import { createInitialState, reducer } from '../src/domain/reducer';
import { createSeedLibrary } from '../src/domain/defaults';
import { normalizeLibrary } from '../src/domain/persistence';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';

const box = (id: string, text: string, y: number, h = 100): SlideElement => ({ id, kind: 'text', text, x: 120, y, w: 1200, h, fontSize: 32 });
// (The heading sits where LightCast places it: 120 / 100, fixed.)
const deck = (): Presentation => ({ id: 'ads', title: '광고', themeId: 'theme_classic', slides: [{ id: 'ad', group: '광고', text: '', elements: [{ ...box('heading', '광고\nAnnouncements', 100, 85), x: 120, w: 1244, autoFit: false }, box('title', '1. 새가족 환영', 236), box('body', '환영합니다', 339, 600)] }] });

describe('initial maximum text size', () => {
  it('finds the largest fitting half-pixel size with a bounded number of layout measurements', () => {
    let calls = 0;
    const size = largestFittingFont((n) => { calls++; return n <= 129.7; }, 5760);
    expect(size).toBe(129.5); expect(calls).toBeLessThan(16);
    expect(largestFittingFont((n) => n <= 12.1, 500)).toBe(12);
  });
  it('does not assume the original font fits and stays usable for extremely long content', () => {
    expect(largestFittingFont((n) => n < 2, 500)).toBe(1.5);
    expect(largestFittingFont(() => false, 500)).toBe(1);
  });
  it('retains original announcement sizes and clears legacy enlargement requests', () => {
    const p = deck();
    expect(prepareAnnouncementSizing(p)).toBe(p);
    p.slides[0].maximizeFont = true;
    p.slides[0].elements![1].maximizeFont = true;
    const next = prepareAnnouncementSizing(p);
    expect(next.slides[0].maximizeFont).toBe(false);
    expect(next.slides[0].elements![1]).toMatchObject({ fontSize: 32, maximizeFont: false, w: 1200, h: 100 });
    expect(prepareAnnouncementSizing(next)).toBe(next);
    const protectedDeck = { ...p, protected: true };
    expect(prepareAnnouncementSizing(protectedDeck)).toBe(protectedDeck);
  });
  it('reserves neighbor space at layout time, while QR codes sit over the boxes and reserve none', () => {
    const old: Slide = { id: 'ad', group: '광고', text: '', qr: ['https://example.org'], elements: [box('title', '제목', 180), box('body', '본문', 320, 600)] };
    // The old corner QR code becomes an object on the slide, where it was drawn; the boxes stay.
    const s = prepareAnnouncementSlide(old);
    expect(s.qr).toBeUndefined();
    expect(s.elements!.slice(0, 2)).toEqual(old.elements);
    expect(s.elements![2]).toMatchObject({ kind: 'qr', link: 'https://example.org', x: 1140, y: 780, w: 240, h: 240 });
    expect(prepareAnnouncementSlide(s)).toBe(s);
    const [title, body] = s.elements!;
    const titleBounds = textElementBounds(title, s.elements), bodyBounds = textElementBounds(body, s.elements);
    expect((titleBounds.y ?? 0) + titleBounds.h).toBeLessThan(body.y);
    expect(bodyBounds.y).toBeGreaterThan(title.y + title.h);
    expect(bodyBounds).toMatchObject({ x: 0, w: 1440 });
  });
  it('moves boxes an earlier version pushed against the left edge for the QR strip back to the middle', () => {
    const pushed = { ...box('body', '본문', 320, 600), x: 0, w: 1140 };
    const s: Slide = { id: 'ad', group: '광고', text: '', qr: ['https://example.org'], elements: [pushed] };
    const fixed = prepareAnnouncementSlide(s);
    expect(fixed.elements![0]).toMatchObject({ x: 77, w: 1287, y: pushed.y, h: pushed.h });
    expect(prepareAnnouncementSlide(fixed)).toBe(fixed);
    // Without QR codes, or placed there by hand elsewhere, a box stays where it is.
    const plain = { ...s, qr: undefined };
    expect(prepareAnnouncementSlide(plain)).toBe(plain);
  });
  // The church template's 광고 item slide (canvas px): heading, "1. <제목>", text.
  const heading = (): SlideElement => ({ id: 'h', kind: 'text', text: '광고\nAnnouncements\n\n\n', x: 77, y: 74, w: 1287, h: 134, fontSize: 40 });
  const adSlide = (): Slide => ({ id: 'ad', group: '광고', text: '', elements: [heading(), { ...box('title', '1. <새가족 환영>', 236, 75), x: 71, w: 1287 }, { ...box('body', '환영합니다', 339, 573), x: 77, w: 1287 }] });
  it('moves the 광고 heading out of the top-left corner, with the boxes under it lined up', () => {
    const fixed = prepareAnnouncementSlide(adSlide());
    const [h, title, body] = fixed.elements!;
    // A fixed box, without the template's trailing empty lines, just tall enough for its two lines.
    expect(h).toMatchObject({ x: 120, y: 100, w: 1244, h: 104, autoFit: false, text: '광고\nAnnouncements' });
    expect(title).toMatchObject({ x: 120, y: 236, w: 1238 });
    expect(body).toMatchObject({ x: 120, y: 339, w: 1244, h: 573 });
    // Right edges stay where the template has them.
    expect([h.x + h.w, body.x + body.w]).toEqual([1364, 1364]);
    expect(prepareAnnouncementSlide(fixed)).toBe(fixed);
  });
  it('brings back a heading the growing box spread over the whole top of the slide', () => {
    // As saved by the editor: the empty template lines counted as overflow, so the box took the
    // full width and the space above the title, at 0 / 0, and its font was shrunk.
    const s = adSlide();
    s.elements![0] = { ...heading(), x: 0, y: 0, w: 1440, h: 220, fontSize: 30, preferredFontSize: 40,
      paragraphs: [{ text: '광고', fontSize: 30 }, { text: 'Announcements', fontSize: 30, bold: true }, { text: '', fontSize: 30 }, { text: '', fontSize: 30 }, { text: '', fontSize: 30 }] };
    s.elements![1] = { ...s.elements![1], x: 120, w: 1238 };
    s.elements![2] = { ...s.elements![2], x: 120, w: 1244 };
    const fixed = prepareAnnouncementSlide(s);
    expect(fixed.elements![0]).toMatchObject({ x: 120, y: 100, w: 1244, h: 104, autoFit: false, fontSize: 40, text: '광고\nAnnouncements' });
    expect(fixed.elements![0].paragraphs).toEqual([{ text: '광고', fontSize: 40 }, { text: 'Announcements', fontSize: 40, bold: true }]);
    expect(fixed.elements![0].preferredFontSize).toBeUndefined();
    expect(fixed.elements!.slice(1)).toEqual(s.elements!.slice(1));
    expect(prepareAnnouncementSlide(fixed)).toBe(fixed);
  });
  it('fixes a QR slide pushed to the left edge by an earlier version the same way', () => {
    const s = adSlide(); s.qr = ['https://example.org'];
    s.elements = s.elements!.map((e) => ({ ...e, x: 0, w: 1140 }));
    expect(prepareAnnouncementSlide(s).elements!.filter((e) => e.kind === 'text').map((e) => [e.x, e.x + e.w])).toEqual([[120, 1364], [120, 1364], [120, 1364]]);
  });
  it('leaves a heading moved by hand, and slides without the heading, as they are', () => {
    const moved = adSlide(); moved.elements![0] = { ...moved.elements![0], x: 300, y: 40 };
    expect(prepareAnnouncementSlide(moved)).toBe(moved);
    const other: Slide = { id: 'x', group: '광고', text: '', elements: [{ ...box('body', '본문', 74), x: 77 }] };
    expect(prepareAnnouncementSlide(other)).toBe(other);
  });
  it('preserves plain-text ads and explicit manual font choices', () => {
    const p = deck(); p.slides = [{ id: 'plain', group: '광고', text: '광고 본문', style: { fontSize: 32 } }];
    expect(prepareAnnouncementSizing(p)).toBe(p);
    const manual = patchElement({ ...box('body', '수정한 본문', 320), fontSize: 40, preferredFontSize: 80 }, { fontSize: 64 });
    expect(manual).toMatchObject({ fontSize: 64, maximizeFont: false });
    expect(manual.preferredFontSize).toBeUndefined();
  });
  it('preserves font sizes for loaded/imported ads and retains preferred sizes after reload', () => {
    const lib = createSeedLibrary(); lib.presentations = [deck()];
    const state = createInitialState(lib);
    expect(state.library.presentations[0].slides[0].elements![1].fontSize).toBe(32);
    const created = reducer(createInitialState(createSeedLibrary()), { type: 'presentation/create', presentation: deck() });
    expect(created.library.presentations.at(-1)!.slides[0].elements![1].maximizeFont).toBeUndefined();
    state.library.presentations[0].slides[0].elements![1].preferredFontSize = 64;
    expect(normalizeLibrary(JSON.parse(JSON.stringify(state.library)))!.presentations[0].slides[0].elements![1].preferredFontSize).toBe(64);
  });
});
