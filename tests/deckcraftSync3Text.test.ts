// DeckCraft 3a1a74d2 / e39e693d / 1a16bf97 (a run's East Asian and complex-script typefaces), ba63277c (text in
// scaled groups) and 53044b2c (text effects inherited from defRPr / the default text style), as LightCast has them.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Presentation, SlideElement } from '../src/domain/types';
import { drawingToElements, OFFICE_THEME } from '../src/domain/io/drawingml';
import { parseMarkup } from '../src/domain/io/markup';
import { buildPptx, splitScriptFaces } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import { officeFont, scriptOf, scriptPieces } from '../src/domain/fonts';
import { formatAllRuns, lineRuns, normalizeRuns } from '../src/domain/richText';
import { usedFamilies } from '../src/domain/io/pptxFonts';
import { RunSpan } from '../src/ui/RunSpan';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"';
const canvas = (inner: string, group = '<a:off x="0" y="0"/><a:ext cx="4572000" cy="1524000"/><a:chOff x="0" y="0"/><a:chExt cx="4572000" cy="1524000"/>') => `<a:graphic ${NS}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas>
<a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm>${group}</a:xfrm></a:grpSpPr>${inner}</lc:lockedCanvas></a:graphicData></a:graphic>`;
const box = (body: string, lst = '<a:lstStyle/>', xfrm = '<a:off x="0" y="0"/><a:ext cx="4572000" cy="1524000"/>') => `<a:sp><a:nvSpPr><a:cNvPr id="2" name="TextBox 1"/><a:cNvSpPr txBox="1"/></a:nvSpPr>
<a:spPr><a:xfrm>${xfrm}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></a:spPr>
<a:txBody><a:bodyPr wrap="square"/>${lst}${body}</a:txBody></a:sp>`;
const read = (xml: string, defaults?: string) => drawingToElements(xml, { theme: OFFICE_THEME, ...(defaults ? { defaults: parseMarkup(defaults).children[0] } : {}) });
const runsOf = (el: SlideElement) => (el.paragraphs ? el.paragraphs.map((p) => p.runs ?? []) : el.runs ?? []);

describe('a run has a typeface per script (a:latin, a:ea, a:cs)', () => {
  it('cuts text where the script changes; only scripts with a typeface of their own are cut out', () => {
    expect(scriptOf('가')).toBe('ea');
    expect(scriptOf('漢')).toBe('ea');
    expect(scriptOf('。')).toBe('ea');
    expect(scriptOf('ש')).toBe('cs');
    expect(scriptOf('A')).toBe('latin');
    expect(scriptOf(' ')).toBe('latin');
    expect(scriptPieces('Hi 은혜', 'EA')).toEqual([{ text: 'Hi ' }, { text: '은혜', fontFamily: 'EA' }]);
    expect(scriptPieces('Hi 은혜')).toEqual([{ text: 'Hi 은혜' }]);
    expect(scriptPieces('a שלום 가', undefined, 'CS')).toEqual([{ text: 'a ' }, { text: 'שלום', fontFamily: 'CS' }, { text: ' 가' }]);
    // Astral CJK (Extension B) stays one character.
    expect(scriptPieces('𠀀x', 'EA')).toEqual([{ text: '𠀀', fontFamily: 'EA' }, { text: 'x' }]);
  });

  it('draws Hangul in the run’s 한글 글꼴 and Latin letters in its 영어 글꼴', () => {
    const html = renderToStaticMarkup(createElement(RunSpan, { r: { text: 'Grace 은혜', fontFamily: 'Arial', fontFamilyEa: '"바탕", Batang' } }));
    expect(html).toContain('font-family:Arial');
    expect(html).toMatch(/Grace <span style="font-family:&quot;바탕&quot;, Batang">은혜<\/span>/);
    // Without one, the run is one piece as before.
    expect(renderToStaticMarkup(createElement(RunSpan, { r: { text: '은혜', bold: true } }))).toBe('<span style="font-weight:700">은혜</span>');
  });

  it('PPTX import keeps a:latin, a:ea and a:cs apart', () => {
    const [el] = read(canvas(box(`<a:p>
      <a:r><a:rPr lang="ko-KR" sz="2400"><a:latin typeface="Arial"/><a:ea typeface="바탕"/><a:cs typeface="Tahoma"/></a:rPr><a:t>Hello 안녕</a:t></a:r>
      <a:r><a:rPr lang="en-US" sz="2400"><a:latin typeface="Arial"/><a:ea typeface="바탕"/><a:cs typeface="Tahoma"/></a:rPr><a:t> world</a:t></a:r>
      <a:r><a:rPr lang="he-IL" sz="2400"><a:latin typeface="Arial"/><a:cs typeface="Tahoma"/></a:rPr><a:t> שלום</a:t></a:r></a:p>`)));
    expect(el.fontFamily).toBe(officeFont('Arial'));
    // A run keeps a script typeface when it has characters of that script.
    expect(runsOf(el)[0]).toEqual([
      { text: 'Hello 안녕', fontFamilyEa: officeFont('바탕') },
      { text: ' world' },
      { text: ' שלום', fontFamilyCs: officeFont('Tahoma') },
    ]);
  });

  it('a Hangul run with only a:ea takes the theme’s Latin font for the rest, and +mn-ea the theme’s East Asian font', () => {
    const [el] = read(canvas(box(`<a:p><a:r><a:rPr lang="ko-KR"><a:ea typeface="+mn-ea"/></a:rPr><a:t>은혜 Grace</a:t></a:r></a:p>`)));
    expect(el.fontFamily).toBe(officeFont('Calibri'));
    expect(runsOf(el)[0][0].fontFamilyEa).toBe(officeFont('맑은 고딕'));
  });

  it('the same typeface for both scripts is stored once', () => {
    const [el] = read(canvas(box(`<a:p><a:r><a:rPr lang="ko-KR"><a:latin typeface="나눔고딕"/><a:ea typeface="나눔고딕"/></a:rPr><a:t>은혜</a:t></a:r></a:p>`)));
    expect(el.fontFamily).toBe(officeFont('나눔고딕'));
    expect(el.runs).toBeUndefined();
  });

  it('formatting the whole box with a 한글 글꼴 puts it on every run; runs that share it join', () => {
    const el: SlideElement = { id: 'e', kind: 'text', x: 0, y: 0, w: 100, h: 100, text: '은혜 Grace\n아멘' };
    const patch = formatAllRuns(el, { fontFamilyEa: officeFont('바탕') });
    expect(patch.runs).toEqual([[{ text: '은혜 Grace', fontFamilyEa: officeFont('바탕') }], [{ text: '아멘', fontFamilyEa: officeFont('바탕') }]]);
    expect(lineRuns({ ...el, ...patch }).every(Boolean)).toBe(true);
    expect(normalizeRuns([{ text: 'a', fontFamilyEa: 'X' }, { text: 'b', fontFamilyEa: 'Y' }])).toHaveLength(2);
    // Taking it off again leaves plain text.
    expect(formatAllRuns({ ...el, ...patch }, { fontFamilyEa: undefined }).runs).toBeUndefined();
    // The fonts a deck uses (for embedding) include the East Asian ones.
    expect(usedFamilies({ ...el, ...patch })).toContain('바탕');
  });

  it('PPTX export writes the run’s a:ea and a:cs typefaces', async () => {
    const p: Presentation = {
      id: 'p', title: 't', themeId: 'theme_classic', slides: [{
        id: 's', group: 'g', text: '', elements: [{
          id: 'e', kind: 'text', x: 100, y: 100, w: 800, h: 200, text: '은혜 Grace', fontFamily: officeFont('Arial'), fontSize: 48,
          runs: [[{ text: '은혜 Grace', fontFamilyEa: officeFont('바탕'), fontFamilyCs: officeFont('Tahoma') }]],
        }],
      }],
    };
    const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [p] }, { presentation: p });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/<a:latin typeface="Arial"[^>]*\/><a:ea typeface="바탕"[^>]*\/><a:cs typeface="Tahoma"/);
    expect(xml).not.toContain('\u2063');
    // Read back, the run has them again.
    const el = read(canvas(xml.slice(xml.indexOf('<p:sp>'), xml.lastIndexOf('</p:sp>') + 7).replace(/p:/g, 'a:'))).find((e) => e.text?.includes('은혜'))!;
    expect(runsOf(el).flat().find((r) => r.text.includes('은혜'))).toMatchObject({ fontFamilyEa: officeFont('바탕') });
  });

  it('splitScriptFaces leaves other typefaces alone and never leaves the joiner behind', () => {
    const j = 'Arial\u2063바탕\u2063Tahoma';
    expect(splitScriptFaces(`<a:latin typeface="${j}" charset="0"/><a:ea typeface="${j}"/><a:cs typeface="${j}"/><a:sym typeface="${j}"/><a:latin typeface="Calibri"/>`))
      .toBe('<a:latin typeface="Arial" charset="0"/><a:ea typeface="바탕"/><a:cs typeface="Tahoma"/><a:sym typeface="Arial"/><a:latin typeface="Calibri"/>');
    expect(splitScriptFaces('<a:latin typeface="Calibri"/>')).toBe('<a:latin typeface="Calibri"/>');
  });
});

describe('text in a scaled group (DeckCraft ba63277c)', () => {
  it('is laid out at the member’s size on the slide, with its font size and insets in points', () => {
    // The group draws its child space at half size: the member lands at half its child size, its text stays 24 pt.
    const group = '<a:off x="0" y="0"/><a:ext cx="2286000" cy="762000"/><a:chOff x="0" y="0"/><a:chExt cx="4572000" cy="1524000"/>';
    const [el] = read(canvas(`<a:grpSp><a:nvGrpSpPr><a:cNvPr id="9" name="Group"/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm>${group}</a:xfrm></a:grpSpPr>${box('<a:p><a:r><a:rPr sz="2400"/><a:t>은혜</a:t></a:r></a:p>')}</a:grpSp>`));
    const [plain] = read(canvas(box('<a:p><a:r><a:rPr sz="2400"/><a:t>은혜</a:t></a:r></a:p>', '<a:lstStyle/>', '<a:off x="0" y="0"/><a:ext cx="2286000" cy="762000"/>')));
    expect({ x: el.x, y: el.y, w: el.w, h: el.h }).toEqual({ x: plain.x, y: plain.y, w: plain.w, h: plain.h });
    expect(el.fontSize).toBe(plain.fontSize);
    expect(el.margins).toEqual(plain.margins);
  });
});

describe('text effects inherited from defRPr or the default text style (DeckCraft 53044b2c)', () => {
  const shadow = '<a:effectLst><a:outerShdw blurRad="38100" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="43137"/></a:srgbClr></a:outerShdw></a:effectLst>';
  it('a run’s own text shadow', () => {
    const [el] = read(canvas(box(`<a:p><a:r><a:rPr>${shadow}</a:rPr><a:t>은혜</a:t></a:r></a:p>`)));
    expect(el.shadow).toBe(true);
  });
  it('a shadow from the paragraph’s defRPr or the list style', () => {
    expect(read(canvas(box(`<a:p><a:pPr><a:defRPr>${shadow}</a:defRPr></a:pPr><a:r><a:rPr/><a:t>은혜</a:t></a:r></a:p>`)))[0].shadow).toBe(true);
    expect(read(canvas(box('<a:p><a:r><a:t>은혜</a:t></a:r></a:p>', `<a:lstStyle><a:lvl1pPr><a:defRPr>${shadow}</a:defRPr></a:lvl1pPr></a:lstStyle>`)))[0].shadow).toBe(true);
  });
  it('a shadow from the presentation’s default text style', () => {
    const defaults = `<p:defaultTextStyle xmlns:p="p" ${NS}><a:lvl1pPr><a:defRPr sz="1800">${shadow}</a:defRPr></a:lvl1pPr></p:defaultTextStyle>`;
    expect(read(canvas(box('<a:p><a:r><a:t>은혜</a:t></a:r></a:p>')), defaults)[0].shadow).toBe(true);
  });
  it('none, or a run that turns it off with an empty effect list', () => {
    expect(read(canvas(box('<a:p><a:r><a:t>은혜</a:t></a:r></a:p>')))[0].shadow).toBeUndefined();
    expect(read(canvas(box('<a:p><a:r><a:rPr><a:effectLst/></a:rPr><a:t>은혜</a:t></a:r></a:p>', `<a:lstStyle><a:lvl1pPr><a:defRPr>${shadow}</a:defRPr></a:lvl1pPr></a:lstStyle>`)))[0].shadow).toBeUndefined();
  });
});
