// Design tab: Design Ideas, custom theme colours / fonts, Background Styles 1–12, picture background options, Slide Size.
import { describe, expect, it } from 'vitest';
import type { Slide, SlideElement } from '../src/domain/types';
import { CANVAS_H, CANVAS_W } from '../src/domain/canvas';
import { COLOR_SLOTS, applyBackgroundStyle, applyFontScheme, backgroundStyles, colorsOf, contrast, customSchemeId, nextCustomName, normalizeHex, parseCustomScheme, upsertByName } from '../src/domain/themeStyles';
import { ALIGNS, patchPicture, pictureOpacity, tileLayout } from '../src/domain/pictureBackground';
import { colorSchemes } from '../src/engine';
import { applyIdea, coverCrop, ideasFor, insideCanvas, textHeight, BAND_PREFIX } from '../src/domain/designIdeas';

const title = (o: Partial<SlideElement> = {}): SlideElement => ({ id: 't', kind: 'text', placeholder: 'title', text: '항구의 새벽', x: 100, y: 60, w: 1240, h: 160, fontSize: 88, color: '#ffffff', ...o });
const body = (o: Partial<SlideElement> = {}): SlideElement => ({ id: 'b', kind: 'text', text: '하나\n둘', x: 100, y: 260, w: 1240, h: 600, fontSize: 56, color: '#ffffff', ...o });
const pic = (o: Partial<SlideElement> = {}): SlideElement => ({ id: 'p', kind: 'image', mediaId: 'm1', x: 0, y: 0, w: 1200, h: 600, ...o });
const slide = (elements: SlideElement[], o: Partial<Slide> = {}): Slide => ({ id: 's', group: 'g', text: '', elements, ...o } as Slide);
const el = (s: Slide, id: string) => s.elements!.find((e) => e.id === id)!;
const overlaps = (a: SlideElement, b: SlideElement) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

describe('Design Ideas', () => {
  it('offers picture layouts for a picture slide and text layouts for a title + text slide', () => {
    expect(ideasFor(slide([title(), body(), pic()])).map((i) => i.id)).toEqual(['fullBleed', 'pictureLeft', 'pictureRight', 'framed']);
    expect(ideasFor(slide([title(), body()])).map((i) => i.id)).toEqual(['titleColumn', 'centred', 'titleBottom']);
    expect(ideasFor(slide([body()])).map((i) => i.id)).toEqual(['textCentred', 'textLeft']);
    expect(ideasFor(slide([]))).toEqual([]);
    expect(ideasFor(null)).toEqual([]);
  });
  it('builds ideas from the slide’s own title and text, not only from boxes', () => {
    const s: Slide = { id: 's', group: 'g', title: '제목', text: '내용' } as Slide;
    expect(ideasFor(s).length).toBe(3);
    const out = applyIdea(s, 'titleColumn')!;
    expect(out.title).toBeUndefined();
    expect(out.text).toBe('');
    expect(out.elements!.map((e) => e.text)).toEqual(['제목', '내용']);
  });
  it('gives no ideas when other graphics, two pictures, front templates or imported pages are in the way', () => {
    expect(ideasFor(slide([title(), body(), { id: 'x', kind: 'shape', x: 0, y: 0, w: 10, h: 10 }]))).toEqual([]);
    expect(ideasFor(slide([title(), body(), { id: 'x', kind: 'shape', x: 0, y: 0, w: 10, h: 10, hidden: true }])).length).toBe(3);
    expect(ideasFor(slide([title(), pic(), pic({ id: 'p2' })]))).toEqual([]);
    expect(ideasFor(slide([title(), body()], { preserveTextLayout: true }))).toEqual([]);
    expect(ideasFor(slide([title(), body()], { importSource: { format: 'pdf', name: 'a', page: 1 } }))).toEqual([]);
  });
  it('Picture left puts the text beside the picture, cropped to fill, picture at the back', () => {
    const out = applyIdea(slide([title(), body(), pic()]), 'pictureLeft')!;
    const p = el(out, 'p');
    expect([p.x, p.y, p.w, p.h]).toEqual([0, 0, CANVAS_W / 2, CANVAS_H]);
    expect(overlaps(p, el(out, 't'))).toBe(false);
    expect(overlaps(p, el(out, 'b'))).toBe(false);
    expect(overlaps(el(out, 't'), el(out, 'b'))).toBe(false);
    // 2:1 picture into a 2:3 box: equal cuts left and right.
    expect(p.crop![0]).toBeGreaterThan(0.25);
    expect(p.crop![0]).toBeCloseTo(p.crop![2], 9);
    expect(p.crop![1]).toBe(0);
    expect(out.elements![0].id).toBe('p');
  });
  it('uses the picture’s real aspect when it is known', () => {
    const out = applyIdea(slide([title(), pic()]), 'pictureLeft', { aspects: { m1: 1 } })!;
    // square picture into a 2:3 box: cut left and right by (1 - (2/3)/1)/2.
    expect(el(out, 'p').crop![0]).toBeCloseTo((1 - 2 / 3) / 2, 6);
  });
  it('Full-bleed covers the slide and puts the title on a band; other ideas remove the band again', () => {
    const full = applyIdea(slide([title(), body(), pic()]), 'fullBleed')!;
    const p = el(full, 'p');
    expect([p.w, p.h]).toEqual([CANVAS_W, CANVAS_H]);
    const bands = full.elements!.filter((e) => e.id.startsWith(BAND_PREFIX));
    expect(bands).toHaveLength(1);
    expect(full.elements!.indexOf(bands[0])).toBe(full.elements!.indexOf(el(full, 't')) - 1);
    // Applying Full-bleed twice keeps one band.
    expect(applyIdea(full, 'fullBleed')!.elements!.filter((e) => e.id.startsWith(BAND_PREFIX))).toHaveLength(1);
    expect(applyIdea(full, 'framed')!.elements!.some((e) => e.id.startsWith(BAND_PREFIX))).toBe(false);
  });
  it('the band on a dark title is light, and dark behind white text', () => {
    const light = applyIdea(slide([title({ color: '#ffffff' }), pic()]), 'fullBleed')!.elements!.find((e) => e.id.startsWith(BAND_PREFIX))!;
    const dark = applyIdea(slide([title({ color: '#111111' }), pic()]), 'fullBleed')!.elements!.find((e) => e.id.startsWith(BAND_PREFIX))!;
    expect(light.fill).toContain('0,0,0');
    expect(dark.fill).toContain('255,255,255');
  });
  it('every idea keeps every object on the slide, with text that fits, and refuses unknown or unavailable ideas', () => {
    for (const withPic of [true, false]) {
      const base = slide(withPic ? [title(), body(), pic()] : [title(), body()]);
      for (const i of ideasFor(base)) {
        const out = applyIdea(base, i.id)!;
        expect(insideCanvas(out.elements!)).toBe(true);
        for (const e of out.elements!.filter((x) => x.kind === 'text')) expect(textHeight(e.text!, e.fontSize!, e.w, e.lineHeight)).toBeLessThanOrEqual(e.h + 1);
      }
    }
    expect(applyIdea(slide([title(), body()]), 'fullBleed')).toBeNull();
    expect(applyIdea(slide([title(), body()]), 'nope' as never)).toBeNull();
  });
  it('leaves the master’s copies and hidden objects alone, and puts the picture just above the master', () => {
    const m = { id: 'master:x', kind: 'shape', master: true, x: 5, y: 5, w: 50, h: 50 } as SlideElement;
    const h = body({ id: 'h', hidden: true, x: 7, y: 7, w: 70, h: 70 });
    const out = applyIdea(slide([m, title(), body(), pic(), h]), 'pictureRight')!;
    expect(el(out, 'master:x')).toEqual(m);
    expect(el(out, 'h')).toEqual(h);
    expect(out.elements![0].id).toBe('master:x');
    expect(out.elements![1].id).toBe('p');
  });
  it('coverCrop matches the box aspect', () => {
    expect(coverCrop(2, 1)[0]).toBeCloseTo(0.25, 12);
    expect(coverCrop(1, 2)[1]).toBeCloseTo(0.25, 12);
    expect(coverCrop(NaN, 1)).toEqual([0, 0, 0, 0]);
  });
});

const OFFICE = ['#000000', '#ffffff', '#44546a', '#e7e6e6', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#0563c1', '#954f72'];

describe('custom colour schemes', () => {
  it('has the 12 slots in the engine’s order and round-trips a custom scheme name', () => {
    expect(COLOR_SLOTS.map((c) => c.key)).toEqual(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']);
    const id = customSchemeId('우리 교회 | 봄', OFFICE);
    expect(id.startsWith('custom:우리 교회 봄|')).toBe(true);
    expect(parseCustomScheme(id)).toEqual({ name: '우리 교회 봄', colors: OFFICE });
    expect(parseCustomScheme('custom:x|#000000')).toBeNull();
    expect(parseCustomScheme('Office')).toBeNull();
  });
  it('normalizes hex input', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('1F8A52')).toBe('#1f8a52');
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex('zzzzzz')).toBeNull();
  });
  it('the engine reads the custom scheme and the gallery finds its colours', () => {
    const builtin = colorSchemes();
    expect(builtin.length).toBeGreaterThan(5);
    expect(builtin[0].colors).toHaveLength(12);
    expect(colorsOf(customSchemeId('A', OFFICE), builtin)).toEqual(OFFICE);
    expect(colorsOf(builtin[1].name, builtin)).toEqual(builtin[1].colors);
    expect(colorsOf(undefined, builtin)).toEqual(builtin[0].colors);
  });
  it('saving a scheme under a taken name replaces it; new names count up', () => {
    const list = upsertByName([{ id: 'a', name: '봄', colors: [] as string[] }], { id: 'b', name: '봄', colors: ['x'] });
    expect(list).toEqual([{ id: 'a', name: '봄', colors: ['x'] }]);
    expect(upsertByName(list, { id: 'c', name: '여름', colors: [] })).toHaveLength(2);
    expect(upsertByName(list, { id: 'a', name: '봄 2', colors: [] })[0].name).toBe('봄 2');
    expect(nextCustomName(['사용자 지정 1', '사용자 지정 2'])).toBe('사용자 지정 3');
  });
});

describe('theme fonts', () => {
  it('puts the heading font on titles and the body font on the rest', () => {
    const p = { slides: [{ id: 's', group: 'g', text: 'x', elements: [{ id: 't', kind: 'text', placeholder: 'title', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', kind: 'text', x: 0, y: 0, w: 1, h: 1 }, { id: 'i', kind: 'image', x: 0, y: 0, w: 1, h: 1 }] }] } as never;
    const out = applyFontScheme(p, { name: '교회', major: '맑은 고딕', minor: '바탕' });
    expect(out.fontScheme).toEqual({ name: '교회', major: '맑은 고딕', minor: '바탕' });
    const els = out.slides![0].elements!;
    expect(els[0].fontFamily).toContain('맑은 고딕');
    expect(els[1].fontFamily).toContain('바탕');
    expect(els[2].fontFamily).toBeUndefined();
    expect(out.slides![0].style!.fontFamily).toContain('바탕');
  });
});

describe('Background Styles 1–12', () => {
  const styles = backgroundStyles(OFFICE);
  it('are twelve, numbered in PowerPoint’s order: solid, subtle, intense × Background 1, Background 2, Text 2, Text 1', () => {
    expect(styles.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(styles.slice(0, 4).map((s) => s.background)).toEqual([OFFICE[1], OFFICE[3], OFFICE[2], OFFICE[0]].map((value) => ({ kind: 'color', value })));
    expect(styles.slice(4).every((s) => s.background.kind === 'gradient')).toBe(true);
  });
  it('follow the scheme: another scheme gives other colours, accent tints show in the gradients', () => {
    const other = backgroundStyles(['#111111', '#fafafa', '#223344', '#ddeedd', '#c00000', '#00c000', '#0000c0', '#c0c000', '#00c0c0', '#c000c0', '#0563c1', '#954f72']);
    expect(other[0].background).toEqual({ kind: 'color', value: '#fafafa' });
    expect(other[4].css).not.toBe(styles[4].css);
    expect(styles[5].css).toMatch(/^linear-gradient\(160deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/);
  });
  it('light and dark variants each get the text colour that reads on them', () => {
    for (const s of styles) {
      const first = /#[0-9a-f]{6}/i.exec(s.css)![0];
      expect(contrast(s.text, first)).toBeGreaterThan(3);
    }
    expect(styles[0].text).toBe(OFFICE[0]);
    expect(styles[3].text).toBe(OFFICE[1]);
  });
  it('applying one sets every slide’s background and keeps or fixes the text colour', () => {
    const p = { slides: [{ id: 'a', group: 'g', text: '', background: { kind: 'color', value: '#123456' } }, { id: 'b', group: 'g', text: '', style: { color: '#00ff00', fontSize: 70 } }] } as never;
    const dark = applyBackgroundStyle(p, styles[3], '#ffffff');
    expect(dark.background).toEqual(styles[3].background);
    expect(dark.slides!.every((s) => JSON.stringify(s.background) === JSON.stringify(styles[3].background))).toBe(true);
    expect(dark.slides![0].style).toBeUndefined();
    expect(dark.slides![1].style).toEqual({ fontSize: 70 });
    const light = applyBackgroundStyle(p, styles[0], '#ffffff');
    expect(light.slides![0].style!.color).toBe(OFFICE[0]);
  });
});

describe('Format Background picture options', () => {
  it('clamps like DeckCraft and drops neutral values', () => {
    expect(patchPicture(undefined, { tile: true, scaleX: 5000, offsetX: -9999 })).toEqual({ tile: true, scaleX: 1000, offsetX: -4000 });
    expect(patchPicture({ tile: true, scaleX: 50 }, { scaleX: 100, tile: false })).toBeUndefined();
    expect(patchPicture({ tile: true }, { mirror: 'xy', align: 'ctr' })).toEqual({ tile: true, mirror: 'xy', align: 'ctr' });
    expect(patchPicture({ mirror: 'x' }, { mirror: 'bogus' as never, scaleY: NaN })).toEqual({ mirror: 'x' });
    expect(patchPicture({ transparency: 40 }, { transparency: 140 })).toEqual({ transparency: 100 });
  });
  it('lays out a tile by scale, mirror, alignment and offset', () => {
    const t = tileLayout({ tile: true, scaleX: 50, scaleY: 200, mirror: 'xy', align: 'br', offsetX: 10, offsetY: -20 }, { w: 100, h: 60 });
    expect([t.cellW, t.cellH, t.mirrorX, t.mirrorY]).toEqual([100, 240, true, true]);
    expect(t.position).toBe('calc(100% + 10px) calc(100% + -20px)');
    const plain = tileLayout(undefined, { w: 100, h: 60 });
    expect([plain.cellW, plain.cellH, plain.position]).toEqual([100, 60, 'calc(0% + 0px) calc(0% + 0px)']);
    for (const a of ALIGNS) expect(tileLayout({ align: a }, { w: 1, h: 1 }).position).toMatch(/^calc\(\d+% \+ 0px\)/);
  });
  it('transparency is the share of the picture that lets the slide through', () => {
    expect(pictureOpacity({ transparency: 25 })).toBe(0.75);
    expect(pictureOpacity(undefined)).toBe(1);
  });
});
