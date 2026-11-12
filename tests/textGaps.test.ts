import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from '../src/domain/io/pptxExport';
import { textFields } from '../src/domain/io/drawingml';
import { createSeedLibrary } from '../src/domain/defaults';
import { normalizeRuns, lineRuns } from '../src/domain/richText';
import { alignCss, directionId, directionPatch, fromPptxVert, isVerticalText, lineHeightCss, pptxVert, softToNewline, writingCss } from '../src/domain/textFormat';
import { applyFormat, copyFormat, paintElements, paintRuns, runFormatOf } from '../src/domain/formatPainter';
import { runStyle, runText } from '../src/ui/runStyle';
import { pasteStyle } from '../src/domain/editOps';
import { runLinkAt } from '../src/domain/showActions';
import type { Presentation, SlideElement } from '../src/domain/types';

const box = (over: Partial<SlideElement> = {}): SlideElement => ({ id: 'a', kind: 'text', x: 100, y: 100, w: 600, h: 200, text: '가나다', fontSize: 64, color: '#ffffff', ...over });

async function slideXml(els: SlideElement[]): Promise<string> {
  const p: Presentation = { id: 'p', title: 't', themeId: 'theme_classic', slides: [{ id: 's', group: 'G', text: '', elements: els }] };
  const lib = { ...createSeedLibrary(), presentations: [p] };
  const pptx = await buildPptx(lib, { presentation: p });
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('text direction', () => {
  it('maps the menu to the pptx vert values and back', () => {
    expect(pptxVert({})).toBeUndefined();
    expect(pptxVert({ direction: 'rotate90' })).toBe('vert');
    expect(pptxVert({ direction: 'rotate270' })).toBe('vert270');
    expect(pptxVert({ direction: 'stacked' })).toBe('wordArtVert');
    expect(pptxVert({ vertical: true })).toBe('eaVert');
    expect(fromPptxVert('vert')).toEqual({ direction: 'rotate90' });
    expect(fromPptxVert('vert270')).toEqual({ direction: 'rotate270' });
    expect(fromPptxVert('wordArtVert')).toEqual({ direction: 'stacked' });
    expect(fromPptxVert('eaVert')).toEqual({ vertical: true });
    expect(fromPptxVert('horz')).toEqual({});
  });
  it('picking an entry sets one of the two fields and clears the other', () => {
    expect(directionPatch('rotate270')).toEqual({ vertical: undefined, direction: 'rotate270' });
    expect(directionPatch('eaVert')).toEqual({ vertical: true, direction: undefined });
    expect(directionPatch('horz')).toEqual({ vertical: undefined, direction: undefined });
    expect(directionId({ direction: 'stacked', vertical: true })).toBe('stacked');
    expect(isVerticalText({ direction: 'rotate90' })).toBe(true);
    expect(isVerticalText({})).toBe(false);
  });
  it('draws each as CSS writing modes', () => {
    expect(writingCss({ direction: 'rotate90' })).toEqual({ writingMode: 'vertical-rl', textOrientation: 'sideways' });
    expect(writingCss({ direction: 'rotate270' })).toEqual({ writingMode: 'sideways-lr' });
    expect(writingCss({ direction: 'stacked' })).toEqual({ writingMode: 'vertical-rl', textOrientation: 'upright' });
    expect(writingCss({ vertical: true })).toEqual({ writingMode: 'vertical-rl' });
    expect(writingCss({})).toEqual({});
  });
  it('exports the vert attribute', async () => {
    for (const [direction, vert] of [['rotate90', 'vert'], ['rotate270', 'vert270'], ['stacked', 'wordArtVert']] as const) {
      expect(await slideXml([box({ direction })])).toContain(`vert="${vert}"`);
    }
    expect(await slideXml([box({ vertical: true })])).toContain('vert="eaVert"');
  });
});

describe('paragraph: line spacing and alignment', () => {
  it('고정 is an exact pixel height, 최소 never goes below single spacing, 배수 stays a multiple', () => {
    expect(lineHeightCss({ lineExact: { mode: 'exact', px: 90 } }, 64, 1.25)).toBe('90px');
    expect(lineHeightCss({ lineExact: { mode: 'min', px: 20 } }, 64, 1.25)).toBe(`${64 * 1.2}px`);
    expect(lineHeightCss({ lineExact: { mode: 'min', px: 200 } }, 64, 1.25)).toBe('200px');
    expect(lineHeightCss({ lineHeight: 1.5 }, 64, 1.25)).toBe(1.5);
    expect(lineHeightCss({}, 64, 1.25)).toBe(1.25);
  });
  it('exports exact spacing in points', async () => {
    expect(await slideXml([box({ lineExact: { mode: 'exact', px: 90 } })])).toContain('<a:spcPts val="4500"/>');
  });
  it('distributed spreads the last line too; justify-low is justify', () => {
    expect(alignCss('distributed')).toEqual({ textAlign: 'justify', textAlignLast: 'justify' });
    expect(alignCss('justLow')).toEqual({ textAlign: 'justify' });
    expect(alignCss('center')).toEqual({ textAlign: 'center' });
  });
  it('imports exact line spacing and the distributed alignment', () => {
    const para = { runs: [{ text: 'a' }], align: 'distributed' as const, lineExactPx: 40, empty: { text: '' } };
    const f = textFields([para]);
    expect(f.align).toBe('distributed');
    expect(f.lineExact).toEqual({ mode: 'exact', px: 40 });
  });
});

describe('format painter', () => {
  const source = box({
    id: 'src', kind: 'shape', shape: 'rect', fill: '#ff0000', stroke: '#00ff00', strokeWidth: 6, dropShadow: true, glow: '#ffff00', opacity: 0.8,
    fontFamily: 'Georgia', fontSize: 48, color: '#abcdef', bold: true, italic: true, letterSpacing: 4, align: 'right', lineHeight: 1.5, list: 'bullet', spaceAfter: 12, text: '원본',
  });
  it('copies the object look, the text look and the paragraph look', () => {
    const p = copyFormat(source);
    expect(p.object).toMatchObject({ fill: '#ff0000', stroke: '#00ff00', strokeWidth: 6, dropShadow: true, glow: '#ffff00', opacity: 0.8 });
    expect(p.text).toMatchObject({ fontFamily: 'Georgia', fontSize: 48, color: '#abcdef', bold: true, italic: true, letterSpacing: 4 });
    expect(p.para).toMatchObject({ align: 'right', lineHeight: 1.5, list: 'bullet', spaceAfter: 12 });
  });
  it('applies it by replacing: what the source lacks is cleared, run formatting is cleared', () => {
    const target: SlideElement = { ...box({ id: 't', kind: 'shape', shape: 'ellipse', fill: '#000000', softEdge: 5, glow: '#123456', underline: true, strike: true, highlight: '#ffff00', align: 'left', text: '대상', runs: [[{ text: '대', bold: false, color: '#111111' }, { text: '상' }]] }) };
    const out = applyFormat(target, copyFormat(source));
    expect(out).toMatchObject({ fill: '#ff0000', stroke: '#00ff00', glow: '#ffff00', fontSize: 48, color: '#abcdef', align: 'right', list: 'bullet' });
    expect(out.softEdge).toBeUndefined();
    expect(out.underline).toBeUndefined();
    expect(out.strike).toBeUndefined();
    expect(out.highlight).toBeUndefined();
    expect(out.runs).toBeUndefined();
  });
  it('keeps the transparent frame of a text box and takes only its text look', () => {
    const out = applyFormat(box({ id: 't', text: 'x' }), copyFormat(source));
    expect(out.fill).toBeUndefined();
    expect(out.stroke).toBeUndefined();
    expect(out).toMatchObject({ fontFamily: 'Georgia', align: 'right' });
  });
  it('takes the first characters formatting of the source, over the box formatting', () => {
    const rich = box({ id: 'r', text: '굵게 보통', bold: false, runs: [[{ text: '굵게', bold: true, color: '#ff00ff', baseline: 'super' }, { text: ' 보통' }]] });
    const p = copyFormat(rich);
    expect(p.text).toMatchObject({ bold: true, color: '#ff00ff' });
    expect(p.baseline).toBe('super');
    expect(runFormatOf(p)).toMatchObject({ bold: true, color: '#ff00ff', baseline: 'super', fontSize: 64 });
  });
  it('clears per-paragraph formatting and keeps links', () => {
    const t = box({ id: 't', text: 'a\nb', paragraphs: [{ text: 'a', fontSize: 20, color: '#111111', align: 'left' }, { text: 'b', runs: [{ text: 'b', link: 'https://x.y', bold: true }] }] });
    const out = applyFormat(t, copyFormat(source));
    expect(out.paragraphs![0]).toEqual({ text: 'a' });
    expect(out.paragraphs![1].runs).toEqual([{ text: 'b', link: 'https://x.y' }]);
  });
  it('paints only the selected objects (and their group)', () => {
    const els = [source, box({ id: 'one' }), box({ id: 'two' })];
    const out = pasteStyle(els, ['one'], copyFormat(source));
    expect(out.find((e) => e.id === 'one')!.fontSize).toBe(48);
    expect(out.find((e) => e.id === 'two')!.fontSize).toBe(64);
    expect(paintElements(els, ['two'], copyFormat(source)).find((e) => e.id === 'two')!.align).toBe('right');
  });
  it('replaces the formatting of selected characters outright but keeps their link', () => {
    const run = paintRuns({ text: 'x', bold: true, underline: true, color: '#111111', link: 'https://a.b' }, { fontSize: 40, italic: true });
    expect(run).toEqual({ text: 'x', link: 'https://a.b', fontSize: 40, italic: true });
  });
});

describe('run hyperlinks', () => {
  it('keeps runs with different links apart', () => {
    const runs = normalizeRuns([{ text: 'a', link: 'https://a' }, { text: 'b', link: 'https://b' }, { text: 'c', link: 'https://b' }, { text: 'd' }]);
    expect(runs).toEqual([{ text: 'a', link: 'https://a' }, { text: 'bc', link: 'https://b' }, { text: 'd' }]);
  });
  it('counts a link as formatting, so a link-only run is kept', () => {
    expect(lineRuns(box({ text: 'ab', runs: [[{ text: 'a' }, { text: 'b', link: 'https://x' }]] }))[0]).toHaveLength(2);
  });
  it('draws a link underlined in the theme link colour', () => {
    const css = runStyle({ text: 'x', link: 'https://x', color: '#ff0000' });
    expect(css.textDecoration).toBe('underline');
    expect(css.color).toContain('--link-color');
  });
  it('finds the link under a click', () => {
    // The tests run without a DOM: a stand-in for the element a click landed on.
    const link = { getAttribute: (k: string) => (k === 'data-link' ? 'https://x.y' : null) };
    expect(runLinkAt({ closest: (q: string) => (q === '[data-link]' ? link : null) } as unknown as EventTarget)).toBe('https://x.y');
    expect(runLinkAt({ closest: () => null } as unknown as EventTarget)).toBeNull();
    expect(runLinkAt(null)).toBeNull();
  });
  it('exports a run hyperlink', async () => {
    const xml = await slideXml([box({ text: '앞 링크 뒤', runs: [[{ text: '앞 ' }, { text: '링크', link: 'https://example.com/a' }, { text: ' 뒤' }]] })]);
    expect(xml).toContain('<a:hlinkClick');
    expect(xml.match(/<a:hlinkClick/g)).toHaveLength(1);
  });
});

describe('soft line break', () => {
  it('draws as a newline inside the paragraph', () => {
    expect(runText('a\u000bb')).toBe('a\nb');
    expect(softToNewline('plain')).toBe('plain');
  });
  it('exports as <a:br/> in the same paragraph', async () => {
    const xml = await slideXml([box({ text: '첫줄\u000b둘째줄\n새 단락' })]);
    expect(xml).toContain('<a:br');
    expect(xml).not.toContain('\u000b');
    expect(xml.match(/<a:p>/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('imports <a:br/> as a break inside the line, not a new line', () => {
    const para = { runs: [{ text: '앞' }, { text: '\v' }, { text: '뒤' }], empty: { text: '' } };
    const f = textFields([para, { runs: [{ text: '다음' }], empty: { text: '' } }]);
    expect(f.text).toBe('앞\v뒤\n다음');
  });
  it('is not merged away by run normalisation', () => {
    expect(normalizeRuns([{ text: 'a\u000b' }, { text: 'b' }])).toEqual([{ text: 'a\u000bb' }]);
  });
});
