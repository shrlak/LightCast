import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_TITLE_MIN_SCALE, announcementTitleParts, layoutAnnouncementTitle, tableLines } from '../src/domain/announcementTitle';
import { prepareAnnouncementSlide, relayoutEditedAnnouncements } from '../src/domain/announcementSizing';
import { announcementSlides } from '../src/domain/templates/fill';
import { elementTextStyle } from '../src/domain/textBoxLayout';
import { createInitialState, reducer } from '../src/domain/reducer';
import { createSeedLibrary } from '../src/domain/defaults';
import { textElementBounds } from '../src/domain/textBox';
import type { ServiceTemplates } from '../src/domain/templates/serviceTemplates';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';

const ARIAL = '"Arial", Arimo, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
// The church's service-template.pptx slide 33 as templates/convert.ts reads it (canvas px): the
// "광고 / Announcements" heading, the "1. <제목>" line (28 pt bold) and the text (25 pt).
const para = (text: string, fontSize: number, bold?: boolean) => ({ text, fontSize, ...(bold ? { bold } : {}) });
const heading = (): SlideElement => ({ id: 'h', kind: 'text', x: 77, y: 74, w: 1287, h: 134, text: '광고\nAnnouncements\n\n\n', fontSize: 40, fontFamily: ARIAL, autoFit: true,
  paragraphs: [para('광고', 40, true), para('Announcements', 40, true), para('', 50), para('', 44), para('', 42)] });
const titleBox = (text = '1. <새가족 환영>'): SlideElement => ({ id: 't', kind: 'text', x: 71, y: 236, w: 1287, h: 75, text, fontSize: 56, fontFamily: ARIAL, autoFit: true, paragraphs: [para(text, 56, true)] });
const bodyBox = (): SlideElement => ({ id: 'b', kind: 'text', x: 77, y: 339, w: 1287, h: 573, text: '오늘 처음 오신 분들을 진심으로 환영합니다!', fontSize: 50, fontFamily: ARIAL, autoFit: true,
  paragraphs: [para('오늘 처음 오신 분들을 진심으로 환영합니다!', 50)] });
const adSlide = (title?: string): Slide => ({ id: 'ad', group: '광고', text: '', elements: [heading(), titleBox(title), bodyBox()] });
const parts = (s: Slide) => {
  const [, t, b] = s.elements!;
  return { t, b };
};
/** How the slide reads: title size, title lines (from its box height), boxes. */
const lineH = (size: number) => size * 1.2;

const KO_SHORT = '1. <새가족 환영>';
const KO_LONG = '1. <청년부 여름 수련회 등록 안내와 회비 납부 방법 및 마감 일정>';
const KO_VERY_LONG = '1. <청년부 여름 수련회 등록 안내와 회비 납부 방법 및 마감 일정, 숙소 배정과 차량 운행 시간표 및 준비물 안내>';
const KO_EXTREME = `1. <${'청년부 여름 수련회 등록 안내와 회비 납부 방법 '.repeat(5)}>`;
const EN_SHORT = '2. <Welcome>';
const EN_LONG = '2. <Summer retreat registration is now open for all young adults>';
const EN_VERY_LONG = '2. <Summer retreat registration is now open for all young adults, families and newcomers this year>';

describe('광고 title: line breaking', () => {
  it('breaks at spaces, keeping Korean words whole, and breaks a word wider than the line anywhere', () => {
    // 10 Hangul at 1.06 em (bold) = 10.6 em.
    expect(tableLines('가나다라마 바사아자차', 12 * 10, 10, 'Arial', true)).toBe(1);
    expect(tableLines('가나다라마 바사아자차', 8 * 10, 10, 'Arial', true)).toBe(2);
    expect(tableLines('가나다라마바사아자차', 6 * 10, 10, 'Arial', true)).toBe(2);
    expect(tableLines('one two three', 1000, 10, 'Arial', false)).toBe(1);
  });
  it('draws the title box with keep-all and balanced lines', () => {
    expect(elementTextStyle({ ...titleBox(), role: 'announcementTitle' })).toMatchObject({ wordBreak: 'keep-all', textWrap: 'balance' });
    expect(elementTextStyle(titleBox())).not.toHaveProperty('textWrap');
  });
});

describe('광고 title: two lines, the text under it moved down', () => {
  it('finds the title and the text box under the 광고 heading', () => {
    const found = announcementTitleParts(adSlide().elements!);
    expect(found?.title.id).toBe('t');
    expect(found?.body?.id).toBe('b');
    expect(announcementTitleParts([bodyBox()])).toBeNull();
  });

  for (const [name, text] of [['Korean', KO_SHORT], ['English', EN_SHORT]] as const) {
    it(`leaves a short ${name} title exactly as the template has it`, () => {
      const s = adSlide(text);
      const out = layoutAnnouncementTitle(s);
      const { t, b } = parts(out);
      expect(t).toMatchObject({ x: 71, y: 236, w: 1287, h: 75, fontSize: 56, role: 'announcementTitle', announceBase: { fontSize: 56, h: 75, bodyY: 339 } });
      expect(t.paragraphs![0].fontSize).toBe(56);
      expect(b).toBe(s.elements![2]);
      expect(layoutAnnouncementTitle(out)).toBe(out);
    });
  }

  for (const [name, text] of [['Korean', KO_LONG], ['English', EN_LONG]] as const) {
    it(`wraps a long ${name} title onto two lines at its size and moves the text down by a line`, () => {
      const out = layoutAnnouncementTitle(adSlide(text));
      const { t, b } = parts(out);
      expect(t.fontSize).toBe(56);
      expect(t.h).toBe(Math.ceil(75 + lineH(56)));
      // The text starts the same distance under the title as before, and ends where it did.
      expect(b.y - (t.y + t.h)).toBe(339 - (236 + 75));
      expect(b.y + b.h).toBe(339 + 573);
      expect(b.fontSize).toBe(50);
      expect(textElementBounds(b, out.elements).y).toBeGreaterThanOrEqual(t.y + t.h);
      expect(layoutAnnouncementTitle(out)).toBe(out);
    });
  }

  for (const [name, text] of [['Korean', KO_VERY_LONG], ['English', EN_VERY_LONG]] as const) {
    it(`draws a very long ${name} title smaller (not below ${ANNOUNCEMENT_TITLE_MIN_SCALE * 100} %) to keep it on two lines`, () => {
      const out = layoutAnnouncementTitle(adSlide(text));
      const { t, b } = parts(out);
      expect(t.fontSize).toBeLessThan(56);
      expect(t.fontSize).toBeGreaterThanOrEqual(56 * ANNOUNCEMENT_TITLE_MIN_SCALE);
      expect(t.paragraphs![0].fontSize).toBe(t.fontSize);
      expect(t.h).toBe(Math.ceil(75 - lineH(56) + 2 * lineH(t.fontSize!)));
      expect(b.y).toBe(339 + (t.h - 75));
      expect(b.y + b.h).toBe(912);
      expect(layoutAnnouncementTitle(out)).toBe(out);
    });
  }

  it('at the smallest size a title that still does not fit takes more lines, the text kept below it', () => {
    const out = layoutAnnouncementTitle(adSlide(KO_EXTREME));
    const { t, b } = parts(out);
    // The smallest size, in half pixels: 56 px (28 pt) × 0.8 → 45 px (22.5 pt).
    expect(t.fontSize).toBe(45);
    expect(t.h).toBeGreaterThan(Math.ceil(75 - lineH(56) + 2 * lineH(t.fontSize!)));
    expect(b.y).toBeGreaterThan(t.y + t.h);
    expect(b.y + b.h).toBe(912);
  });

  it('goes back to the template layout when the title is shortened again', () => {
    const long = layoutAnnouncementTitle(adSlide(KO_VERY_LONG));
    const [h, t, b] = long.elements!;
    const short = layoutAnnouncementTitle({ ...long, elements: [h, { ...t, text: KO_SHORT, paragraphs: [{ ...t.paragraphs![0], text: KO_SHORT }] }, b] });
    const fresh = layoutAnnouncementTitle(adSlide(KO_SHORT));
    expect(short.elements!.map((e) => [e.y, e.h, e.fontSize])).toEqual(fresh.elements!.map((e) => [e.y, e.h, e.fontSize]));
    expect(short.elements![2]).toMatchObject({ y: 339, h: 573 });
  });

  it('leaves boxes placed by hand, and a title given its own size, as they are', () => {
    const long = layoutAnnouncementTitle(adSlide(KO_LONG));
    const moved: Slide = { ...long, elements: long.elements!.map((e) => (e.id === 'b' ? { ...e, y: 600 } : e)) };
    expect(layoutAnnouncementTitle(moved)).toBe(moved);
    const sized = layoutAnnouncementTitle(adSlide(KO_SHORT));
    sized.elements![1] = { ...sized.elements![1], text: KO_LONG, paragraphs: [para(KO_LONG, 56, true)], autoFit: false };
    expect(layoutAnnouncementTitle(sized)).toBe(sized);
    // Read from a file with autofit off (never laid out): laid out, with LightCast's fit.
    const read = adSlide(KO_LONG);
    read.elements![1] = { ...read.elements![1], autoFit: false };
    expect(parts(layoutAnnouncementTitle(read)).t).toMatchObject({ autoFit: true, h: Math.ceil(75 + lineH(56)) });
  });

  it('fixes a title an earlier version shrank into its box', () => {
    const s = adSlide(KO_LONG);
    s.elements![1] = { ...s.elements![1], fontSize: 38, preferredFontSize: 56, h: 103, paragraphs: [para(KO_LONG, 38, true)] };
    const { t, b } = parts(layoutAnnouncementTitle(s));
    expect(t.fontSize).toBe(56);
    expect(t.preferredFontSize).toBeUndefined();
    expect(t.h).toBe(Math.ceil(Math.ceil(lineH(56) + 8) + lineH(56)));
    expect(b.y).toBe(339 + t.h - Math.ceil(lineH(56) + 8));
  });
});

describe('광고 title: everywhere 광고 slides are made or edited', () => {
  const tpl = { announceTitle: { id: 'at', group: '광고', text: '', elements: [{ ...heading(), id: 'a' }] }, announceItem: adSlide() } as unknown as ServiceTemplates;

  it('new slides from the wizard', () => {
    const slides = announcementSlides(tpl, [{ title: '새가족 환영', body: ['환영합니다'], links: [] }, { title: KO_LONG.slice(4, -1), body: ['등록'], links: [] }]);
    const short = slides[1].elements!.filter((e) => e.kind === 'text'), long = slides[2].elements!.filter((e) => e.kind === 'text');
    expect(short[1]).toMatchObject({ h: 75, role: 'announcementTitle' });
    expect(short[2]).toMatchObject({ y: 339, h: 573 });
    expect(long[1].text).toBe(`2. <${KO_LONG.slice(4, -1)}>`);
    expect(long[1].h).toBe(Math.ceil(75 + lineH(56)));
    expect(long[2].y).toBe(339 + long[1].h - 75);
  });

  it('slides opened or imported (prepareAnnouncementSlide)', () => {
    const out = prepareAnnouncementSlide(adSlide(KO_LONG));
    const { t, b } = parts(out);
    expect(t).toMatchObject({ x: 120, role: 'announcementTitle', h: Math.ceil(75 + lineH(56)) });
    expect(b.y).toBe(339 + t.h - 75);
    expect(prepareAnnouncementSlide(out)).toBe(out);
  });

  it('a title edited in the editor (slide/update) wraps and pushes the text down, and back', () => {
    const deck: Presentation = { id: 'ads', title: '광고', themeId: 'theme_classic', slides: [adSlide()] };
    const lib = createSeedLibrary(); lib.presentations = [deck];
    let state = createInitialState(lib);
    const ad = () => state.library.presentations.find((p) => p.id === 'ads')!.slides[0];
    expect(parts(ad()).b.y).toBe(339);
    const edit = (text: string) => {
      const els = ad().elements!.map((e) => (e.id === 't' ? { ...e, text, paragraphs: [{ ...e.paragraphs![0], text }] } : e));
      state = reducer(state, { type: 'slide/update', presentationId: 'ads', slideId: 'ad', patch: { elements: els } });
    };
    edit(KO_LONG);
    expect(parts(ad()).t.h).toBe(Math.ceil(75 + lineH(56)));
    expect(parts(ad()).b.y).toBe(339 + Math.ceil(75 + lineH(56)) - 75);
    edit(KO_SHORT);
    expect(parts(ad()).t.h).toBe(75);
    expect(parts(ad()).b).toMatchObject({ y: 339, h: 573 });
  });

  it('only slides that changed are laid out again after an edit', () => {
    const a = adSlide(KO_LONG), b = adSlide(KO_LONG);
    const before: Presentation = { id: 'p', title: '광고', themeId: 't', slides: [a, { ...b, id: 'b2' }] };
    const after: Presentation = { ...before, slides: [{ ...a }, before.slides[1]] };
    const out = relayoutEditedAnnouncements(before, after);
    expect(out.slides[0].elements![1].role).toBe('announcementTitle');
    expect(out.slides[1]).toBe(before.slides[1]);
  });
});
