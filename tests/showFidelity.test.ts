// The slide show drawn as PowerPoint (and DeckCraft) draws it: what was compared slide by slide against
// DeckCraft's renderer on tests/fixtures/real/pptx and fixed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readPptxDeck } from '../src/domain/io/pptxDeck';
import { colorOf, OFFICE_THEME } from '../src/domain/io/drawingml';
import { applyPictureColor, pictureColorOf } from '../src/domain/pictureColor';
import { parseMarkup } from '../src/domain/io/markup';
import { powerPointRamp } from '../src/domain/shapeEffects';
import { ShapeElement } from '../src/ui/EngineElements';
import type { Slide, SlideElement } from '../src/domain/types';

const read = async (name: string) => (await readPptxDeck(readFileSync(`tests/fixtures/real/pptx/${name}`), { file: name, group: 'D', store: async (_b, n, t) => `${t}-${n}` })).slides;
const all = (slides: Slide[]) => slides.flatMap((s) => s.elements ?? []);
const color = (xml: string) => colorOf(parseMarkup(xml).children[0], OFFICE_THEME)!;

describe('colours as PowerPoint mixes them', () => {
  it('tint and shade work in linear light', () => {
    expect(color('<a:srgbClr val="000000"><a:tint val="75000"/></a:srgbClr>').hex).toBe('#898989');
    expect(color('<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>').hex).toBe('#bcbcbc');
  });

  it('reads the other colour transforms DeckCraft knows', () => {
    expect(color('<a:srgbClr val="FF0000"><a:comp/></a:srgbClr>').hex).toBe('#00ffff');
    expect(color('<a:srgbClr val="FF0000"><a:inv/></a:srgbClr>').hex).toBe('#00ffff');
    expect(color('<a:srgbClr val="FF0000"><a:hueOff val="7200000"/></a:srgbClr>').hex).toBe('#00ff00');
    expect(color('<a:srgbClr val="FFFFFF"><a:redMod val="0"/></a:srgbClr>').hex).toBe('#00ffff');
    expect(color('<a:srgbClr val="808080"><a:gray/></a:srgbClr>').hex).toBe('#808080');
    expect(color('<a:srgbClr val="FF0000"><a:alpha val="50000"/><a:alphaMod val="50000"/></a:srgbClr>').alpha).toBeCloseTo(0.25);
  });

  it('a two-colour gradient follows PowerPoint\'s ramp; others stay as they are', () => {
    const ramp = powerPointRamp([{ pos: 0, color: '#000000' }, { pos: 100, color: '#ffffff' }]);
    expect(ramp).toHaveLength(17);
    const at = (pos: number) => parseInt(ramp.find((s) => s.pos === pos)!.color.slice(1, 3), 16);
    // Measured on PowerPoint's export: 105, 186 and 238 a quarter, half and three quarters of the way.
    expect(Math.abs(at(25) - 105)).toBeLessThanOrEqual(2);
    expect(Math.abs(at(50) - 186)).toBeLessThanOrEqual(2);
    expect(Math.abs(at(75) - 238)).toBeLessThanOrEqual(2);
    const three = [{ pos: 0, color: '#ff0000' }, { pos: 50, color: '#00ff00' }, { pos: 100, color: '#0000ff' }];
    expect(powerPointRamp(three)).toBe(three);
  });
});

describe('the fixtures read for drawing as PowerPoint does', () => {
  it('pictures keep their colour changes (Grayscale, Brightness / Contrast, Black and White, Recolor, Set Transparent Color)', () => {
    const blip = (inner: string) => parseMarkup(`<a:blip xmlns:a="a">${inner}</a:blip>`).children[0];
    expect(pictureColorOf(blip('<a:grayscl/>'), OFFICE_THEME)).toEqual({ grayscale: true });
    expect(pictureColorOf(blip('<a:lum bright="20000" contrast="-40000"/>'), OFFICE_THEME)).toEqual({ brightness: 0.2, contrast: -0.4 });
    expect(pictureColorOf(blip('<a:biLevel thresh="25000"/>'), OFFICE_THEME)).toEqual({ bilevel: 0.25 });
    expect(pictureColorOf(blip('<a:duotone><a:prstClr val="black"/><a:srgbClr val="FF8000"/></a:duotone>'), OFFICE_THEME)).toEqual({ duotone: ['#000000', '#ff8000'] });
    expect(pictureColorOf(blip('<a:clrChange><a:clrFrom><a:srgbClr val="FFFFFF"/></a:clrFrom><a:clrTo><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>'), OFFICE_THEME)).toEqual({ clearColor: '#ffffff' });
    expect(pictureColorOf(blip(''), OFFICE_THEME)).toBeUndefined();
  });

  it('works the pixels with the formulas measured on PowerPoint', () => {
    const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
    // Grayscale: Rec. 709 on the stored values (pure red greys to 54, green to 182).
    const red = px(255, 0, 0); applyPictureColor(red, { grayscale: true }); expect([...red]).toEqual([54, 54, 54, 255]);
    const green = px(0, 255, 0); applyPictureColor(green, { grayscale: true }); expect(green[0]).toBe(182);
    // +40 % brightness and +40 % contrast take black to about 54 (DeckCraft's formula gives 52).
    const black = px(0, 0, 0); applyPictureColor(black, { brightness: 0.4, contrast: 0.4 }); expect(Math.abs(black[0] - 54)).toBeLessThanOrEqual(3);
    // Duotone: luminance between the dark and the light colour.
    const mid = px(128, 128, 128); applyPictureColor(mid, { duotone: ['#000000', '#ff0000'] }); expect([mid[0], mid[1], mid[2]]).toEqual([128, 0, 0]);
    // Black and white at the threshold; a transparent colour within 8 of it.
    const grey = px(100, 100, 100); applyPictureColor(grey, { bilevel: 0.5 }); expect(grey[0]).toBe(0);
    const white = px(250, 252, 255); applyPictureColor(white, { clearColor: '#ffffff' }); expect(white[3]).toBe(0);
  });

  it('gradients keep lin@scaled and the path focus', async () => {
    const els = all(await read('shapes-16x9.pptx'));
    const lin = els.find((e) => e.gradientStops?.length === 3)!;
    expect(lin.gradientScaled).toBe(false);
    const radial = els.find((e) => e.gradientType === 'radial')!;
    expect(radial.gradientCenter).toEqual([0.5, 0.5]);
  });

  it('two columns fill one column before the next, with the file\'s spacing', async () => {
    const box = all(await read('text.pptx')).find((e) => e.text?.startsWith('Two columns'))!;
    expect(box).toMatchObject({ columns: 2, columnSpacing: 0 });
  });

  it('charts take the deck\'s accents, their own text size and value labels; tables 18 pt in the body font', async () => {
    const els = all(await read('charts-16x9.pptx'));
    const pie = els.find((e) => e.chart?.kind === 'pie')!.chart!;
    expect(pie.scheme).toMatch(/^custom:Deck\|#[0-9a-f]{6}(,#[0-9a-f]{6}){11}$/);
    expect(pie.labelValues).toBe(true);
    // 18 pt (c:txPr) at 2 px per point, the 16:9 slide fitted into the 4:3 canvas (×0.75).
    expect(pie.fontSize).toBe(27);
    const table = all(await read('tables-16x9.pptx')).find((e) => e.kind === 'table')!;
    expect(table.fontSize).toBe(27);
    expect(table.fontFamily).toMatch(/Calibri/);
    // Its table style takes the deck's accents too.
    expect(table.table!.scheme).toBe(pie.scheme);
  });
});

describe('drawing', () => {
  it('a straight line with no height is still drawn (its svg keeps 1 px)', () => {
    const el: SlideElement = { id: 'l', kind: 'shape', shape: 'line', x: 0, y: 10, w: 400, h: 0, stroke: '#c80000', strokeWidth: 4, dash: 'dash', arrowEnd: true };
    const html = renderToStaticMarkup(createElement(ShapeElement, { el }));
    expect(html).toMatch(/<svg width="400" height="1" viewBox="0 0 400 1"/);
    expect(html).toContain('stroke-dasharray');
  });

  it('a soft edge follows the outline (an SVG mask), so a reflection still shows', () => {
    const el: SlideElement = { id: 's', kind: 'shape', shape: 'ellipse', x: 0, y: 0, w: 200, h: 100, fill: '#78c878', softEdge: 7.5, reflection: true };
    const html = renderToStaticMarkup(createElement(ShapeElement, { el }));
    expect(html).toContain('feGaussianBlur');
    expect(html).toMatch(/mask="url\(#f/);
    expect(html).not.toContain('mask-image');
    expect(html).toContain('box-reflect');
  });

  it('an unscaled linear gradient is laid out on the shape as drawn', () => {
    const el: SlideElement = { id: 'g', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, gradient: ['#ff0000', '#0000ff'], gradientAngle: 45, gradientScaled: false };
    const html = renderToStaticMarkup(createElement(ShapeElement, { el }));
    expect(html).toContain('gradientUnits="userSpaceOnUse"');
    // The two-colour ramp: 17 stops.
    expect(html.match(/<stop /g)).toHaveLength(17);
  });
});
