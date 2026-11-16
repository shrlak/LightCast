// The parts of metafiles that used to be skipped or drawn as placeholders: flood fills (a recording
// software rasteriser), MaskBlt's background operation, EMF+ path gradients, blend factors and gamma,
// EMF+ image effects, glyph-index text through a known font's cmap and text widths from its hmtx.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { metafileToSvg } from '../src/domain/metafile';
import { addMetafileFont, clearMetafileFonts, fontWidthEm, metafileFont } from '../src/domain/metafile/fonts';
import { textWidth } from '../src/domain/metafile/metrics';
import { effectGuid } from '../src/domain/metafile/effects';
import { B, RED, BLUE, argb, comment, emf, emfBrush, emfFont, emfRec, emfRect, emfSelect, plusHeader, plusRec, wmf, wmfRec } from './fixtures/metafileBytes';

const rects = (d: string) => [...d.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H/g)].map((m) => m.slice(1).map(Number));
const area = (d: string) => rects(d).reduce((a, [x0, y0, x1, y1]) => a + (x1 - x0) * (y1 - y0), 0);

describe('flood fills', () => {
  const nullBrush = [wmfRec(0x02fc, 1, 0, 0, 0), wmfRec(0x012d, 0)];
  const redBrush = [wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0), wmfRec(0x012d, 1)];
  const frame = [wmfRec(0x020c, 100, 200), wmfRec(0x020b, 0, 0)];

  it('FLOODFILLBORDER fills inside a black outline up to it, with the current brush, as pixel rectangles', () => {
    const r = metafileToSvg(wmf(...frame, ...nullBrush, wmfRec(0x041b, 60, 110, 10, 10), ...redBrush, wmfRec(0x0419, 0, 0, 30, 50)))!;
    const fill = /<path d="(M[^"]+)" fill="#ff0000" shape-rendering="crispEdges"\/>/.exec(r.svg);
    expect(fill).not.toBeNull();
    // the interior of the 100 x 50 rectangle less its 1-px outline (1 px = 200/192 units)
    const a = area(fill![1]);
    expect(a).toBeGreaterThan(95 * 46);
    expect(a).toBeLessThan(100 * 50);
    const [x0, y0, x1, y1] = rects(fill![1])[0];
    expect(x0).toBeGreaterThan(10); expect(y0).toBeGreaterThan(10); expect(x1).toBeLessThan(110); expect(y1).toBeLessThan(60);
  });

  it('FLOODFILLSURFACE fills only the area of exactly the given colour (an ellipse of white inside black)', () => {
    const r = metafileToSvg(wmf(...frame, ...nullBrush, wmfRec(0x0418, 90, 190, 50, 120), ...redBrush, wmfRec(0x0548, 1, 0xffff, 0xff, 70, 155)))!;
    const fill = /<path d="(M[^"]+)" fill="#ff0000" shape-rendering="crispEdges"\/>/.exec(r.svg)!;
    // an ellipse of radii 35 x 20: about pi * 35 * 20 = 2199 units, a little less inside the outline
    expect(area(fill[1])).toBeGreaterThan(1900);
    expect(area(fill[1])).toBeLessThan(2200);
    expect(rects(fill[1]).length).toBeGreaterThan(10); // rows of the ellipse, merged where they repeat
  });

  it('a border fill on the blank page fills the whole frame, and what is drawn after it stays on top', () => {
    const blue = [wmfRec(0x02fc, 0, BLUE & 0xffff, BLUE >>> 16, 0), wmfRec(0x012d, 1)];
    const red0 = [wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0), wmfRec(0x012d, 0)];
    const r = metafileToSvg(wmf(...frame, ...red0, wmfRec(0x0419, 0, 0, 5, 5), ...blue, wmfRec(0x041b, 60, 110, 10, 10)))!;
    const iRed = r.svg.indexOf('fill="#ff0000"'), iBlue = r.svg.indexOf('fill="#0000ff"');
    expect(iRed).toBeGreaterThan(0);
    expect(iBlue).toBeGreaterThan(iRed);
    const d = /<path d="(M[^"]+)" fill="#ff0000"/.exec(r.svg)![1];
    expect(area(d)).toBeCloseTo(200 * 100, -2);
  });

  it('EMF EXTFLOODFILL: a second fill sees the first one (incremental raster), clip limits the fill', () => {
    const flood = (x: number, y: number, c: number, mode: number) => emfRec(53, (b) => b.u32(x, y, c, mode));
    const outline = emfRec(43, (b) => b.u32(20, 20, 120, 80));
    const r = metafileToSvg(emf([emfRec(39, (b) => b.u32(1, 1, 0, 0)), emfSelect(1), outline, emfBrush(2, RED), emfSelect(2), flood(50, 50, 0, 0), emfBrush(3, BLUE), emfSelect(3), flood(50, 50, RED, 1)]))!;
    const red = /<path d="(M[^"]+)" fill="#ff0000"/.exec(r.svg)![1], blue = /<path d="(M[^"]+)" fill="#0000ff"/.exec(r.svg)![1];
    expect(area(red)).toBeCloseTo(area(blue), 0); // the blue surface fill replaced exactly the red area
    expect(area(red)).toBeGreaterThan(98 * 58);
    // clipped to a smaller rectangle
    const clip = emfRec(30, (b) => b.u32(0, 0, 60, 60));
    const c = metafileToSvg(emf([emfRec(39, (b) => b.u32(1, 1, 0, 0)), emfSelect(1), outline, emfBrush(2, RED), emfSelect(2), clip, flood(50, 50, 0, 0)]))!;
    expect(area(/<path d="(M[^"]+)" fill="#ff0000"/.exec(c.svg)![1])).toBeLessThan(40 * 40 + 1);
  });

  it('never throws and keeps its limits on hostile input', () => {
    const many = Array.from({ length: 300 }, (_, i) => wmfRec(0x0419, 0, 0, i % 100, i % 200));
    const r = metafileToSvg(wmf(...frame, ...redBrush, ...many));
    expect(r).not.toBeNull();
    expect(r!.warnings?.some((w) => /limit/.test(w))).toBe(true);
    expect(metafileToSvg(wmf(wmfRec(0x0419, 0, 0, 30000, -30000)))).not.toBeUndefined();
  });
});

describe('MaskBlt background operation', () => {
  const bmi = (w: number, h: number, bpp: number, palette: number[] = []) => new B().u32(40, w, h).u16(1, bpp).u32(0, 0, 0, 0, palette.length / 4, 0).u8(...palette);
  const maskBlt = (rop4: number) => emfRec(78, (b) => {
    const cb = bmi(2, 2, 24), cbits = new B().u8(0, 0, 255, 255, 0, 0, 0, 0).u8(255, 0, 0, 0, 0, 255, 0, 0);
    const mb = bmi(2, 2, 1, [0, 0, 0, 0, 255, 255, 255, 0]), mbits = new B().u8(0x40, 0, 0, 0).u8(0x80, 0, 0, 0);
    const head = 128;
    b.u32(0, 0, 0, 0).u32(10, 20, 40, 40, rop4 >>> 0).u32(0, 0).f32(1, 0, 0, 1, 0, 0);
    b.u32(0, 0, head, cb.length, head + cb.length, cbits.length).u32(0, 0, 0);
    const mo = head + cb.length + cbits.length;
    b.u32(mo, mb.length, mo + mb.length, mbits.length).u8(...cb.a, ...cbits.a, ...mb.a, ...mbits.a);
  });
  it('background DSTCOPY (0xAA) leaves the holes alone: one image', () => {
    expect((metafileToSvg(emf([maskBlt(0xaacc0020)]))!.svg.match(/<image /g) ?? []).length).toBe(1);
  });
  it('background BLACKNESS (ROP4 0x00CC0020) paints the holes black; WHITENESS white; SRCCOPY the source', () => {
    const black = metafileToSvg(emf([maskBlt(0x00cc0020)]))!.svg;
    expect((black.match(/<image /g) ?? []).length).toBe(2);
    const white = metafileToSvg(emf([maskBlt(0xffcc0020)]))!.svg;
    expect((white.match(/<image /g) ?? []).length).toBe(2);
    const src = metafileToSvg(emf([maskBlt(0xcccc0020)]))!.svg;
    expect((src.match(/<image /g) ?? []).length).toBe(2);
    expect(metafileToSvg(emf([maskBlt(0x55cc0020)]))!.svg).toContain('mix-blend-mode:difference'); // DSTINVERT
  });
});

// ---- EMF+ ----

const plusEmf = (...recs: number[][]) => emf([comment(plusHeader(false), ...recs)]);
const fillWith = (brush: number, x: number, y: number, w: number, h: number) => plusRec(0x400a, 0, (b) => b.u32(brush, 1).f32(x, y, w, h));

describe('EMF+ gradients', () => {
  it('a path gradient with four surround colours is drawn as a triangulated bitmap pattern, clipped to its boundary', () => {
    const brush = plusRec(0x4008, (1 << 8) | 1, (b) => {
      b.u32(0xdbc01002, 3, 0, 4, argb(255, 255, 255, 255)).f32(50, 25).u32(4, argb(255, 255, 0, 0), argb(255, 0, 255, 0), argb(255, 0, 0, 255), argb(255, 255, 255, 0));
      b.u32(4).f32(0, 0, 100, 0, 100, 50, 0, 50);
    });
    const svg = metafileToSvg(plusEmf(brush, fillWith(1, 0, 0, 150, 80)))!.svg;
    expect(svg).toMatch(/<pattern id="p\d+"[^>]*><image href="data:image\/png/);
    expect(svg).toMatch(/<clipPath id="c\d+"><path d="M0 0L100 0L100 50L0 50Z"/);
  });
  it('an elliptical path gradient with one surround colour is an SVG radial gradient with its blend factors and focus scale', () => {
    const pts: number[] = [];
    for (let i = 0; i < 32; i++) pts.push(50 + 40 * Math.cos((i / 32) * Math.PI * 2), 30 + 20 * Math.sin((i / 32) * Math.PI * 2));
    const brush = plusRec(0x4008, (1 << 8) | 1, (b) => {
      b.u32(0xdbc01002, 3, 0x8 | 0x40, 4, argb(255, 255, 255, 255)).f32(50, 30).u32(1, argb(255, 0, 0, 128));
      b.u32(32).f32(...pts);
      b.u32(3).f32(0, 0.5, 1).f32(0, 0.8, 1); // blend factors
      b.u32(2).f32(0.2, 0.2); // focus scales
    });
    const svg = metafileToSvg(plusEmf(brush, fillWith(1, 0, 0, 100, 60)))!.svg;
    const g = /<radialGradient [^>]*gradientTransform="matrix\(([^)]+)\)">(.*?)<\/radialGradient>/.exec(svg)!;
    expect(g).not.toBeNull();
    expect(g[1].split(' ').map(Number).slice(0, 4)).toEqual([4 * 40 / 4 * 0.25 * 4, 0, 0, 20]); // rx 40, ry 20 in px at 96 dpi (1 unit = 1 px)
    const stops = [...g[2].matchAll(/offset="([\d.]+)" stop-color="(#[0-9a-f]+)"/g)].map((m) => [+m[1], m[2]]);
    expect(stops[0]).toEqual([0, '#ffffff']); // the centre
    expect(stops[stops.length - 1]).toEqual([1, '#000080']); // the boundary
    // focus 0.2: the centre colour reaches 20 % out; the blend's middle (factor 0.8 at 0.5) sits at 0.2 + 0.8 * 0.5
    expect(stops.some(([o]) => Math.abs((o as number) - 0.6) < 1e-6)).toBe(true);
  });
  it('linear gradient blend factors become stops, gamma correction adds stops in linear light, flip-x reflects', () => {
    const lin = (flags: number, wrap: number, extra: (b: B) => void) => plusRec(0x4008, (1 << 8) | 1, (b) => {
      b.u32(0xdbc01002, 4, flags, wrap).f32(0, 0, 100, 10).u32(argb(255, 0, 0, 0), argb(255, 255, 255, 255), 0, 0);
      extra(b);
    });
    const f = metafileToSvg(plusEmf(lin(0x8, 4, (b) => b.u32(3).f32(0, 0.5, 1).f32(0, 0.9, 1)), fillWith(1, 0, 0, 100, 10)))!.svg;
    expect(f).toContain('spreadMethod="pad"');
    expect(f).toContain('<stop offset="0.5" stop-color="#e5e5e5"/>');
    const gm = metafileToSvg(plusEmf(lin(0x80, 1, () => undefined), fillWith(1, 0, 0, 100, 10)))!.svg;
    expect(gm).toContain('spreadMethod="reflect"');
    expect(gm).toContain('<stop offset="0.5" stop-color="#bcbcbc"/>'); // mid-grey in linear light is sRGB 188
  });
});

describe('EMF+ image effects', () => {
  const image = plusRec(0x4008, (5 << 8) | 2, (b) => b.u32(0xdbc01002, 1, 2, 2, 8, 0x26200a, 0).u8(0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 200, 50, 220, 255));
  const guid = (s: string) => { const h = s.replace(/-/g, ''); const b = new B(); b.u32(parseInt(h.slice(0, 8), 16)).u16(parseInt(h.slice(8, 12), 16), parseInt(h.slice(12, 16), 16)); for (let i = 16; i < 32; i += 2) b.u8(parseInt(h.slice(i, i + 2), 16)); return b.a; };
  const effect = (kind: Parameters<typeof effectGuid>[0], body: (b: B) => void) => { const p = new B(); body(p); return plusRec(0x4038, 0, (b) => b.u8(...guid(effectGuid(kind))).u32(p.length).u8(...p.a)); };
  const draw = (effectOn: boolean) => plusRec(0x401b, 2 | (effectOn ? 0x2000 : 0), (b) => b.u32(0xff, 2).f32(0, 0, 2, 2).u32(3).f32(10, 10, 50, 10, 10, 50));
  it('a colour matrix effect is an feColorMatrix on the image, transposed from the GDI+ row-vector form', () => {
    const grey = [0.3, 0.3, 0.3, 0, 0, 0.59, 0.59, 0.59, 0, 0, 0.11, 0.11, 0.11, 0, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 0, 1];
    const svg = metafileToSvg(plusEmf(image, effect('matrix', (b) => b.f32(...grey)), draw(true)))!.svg;
    const m = /<feColorMatrix type="matrix" values="([^"]+)"/.exec(svg)!;
    expect(m[1].split(' ').map(Number).slice(0, 5).map((v) => Math.round(v * 100) / 100)).toEqual([0.3, 0.59, 0.11, 0, 0.1]);
    expect(svg).toMatch(/<image [^>]*filter="url\(#f\d+\)"/);
    // without the E flag the effect is not applied
    expect(metafileToSvg(plusEmf(image, effect('matrix', (b) => b.f32(...grey)), draw(false)))!.svg).not.toContain('feColorMatrix');
  });
  it('blur, sharpen, lookup table, brightness / contrast, levels, HSL, tint, colour curve and balance become filter primitives', () => {
    const cases: [Parameters<typeof effectGuid>[0], (b: B) => void, RegExp][] = [
      ['blur', (b) => b.f32(6).u32(0), /feGaussianBlur stdDeviation="2"/],
      ['sharpen', (b) => b.f32(1).f32(50), /feConvolveMatrix order="3"/],
      ['lut', (b) => { for (let c = 0; c < 4; c++) for (let i = 0; i < 256; i++) b.u8(255 - i); }, /feFuncA type="table"/],
      ['brightnessContrast', (b) => b.u32(50, 0), /feFuncR type="linear" slope="1" intercept="0.196"/],
      ['levels', (b) => b.u32(80, 0, 10), /feComponentTransfer><feFuncR type="table"/],
      ['hsl', (b) => b.u32(90, 0, 0), /type="hueRotate" values="90"/],
      ['tint', (b) => b.u32(0, 50), /feColorMatrix type="matrix"/],
      ['colorCurve', (b) => b.u32(0, 1, 100), /<feFuncR type="table"[^/]*\/><\/feComponentTransfer>/],
      ['colorBalance', (b) => b.u32(20, 0, 0), /feFuncR type="linear" slope="1" intercept="0.1"/],
    ];
    for (const [k, body, re] of cases) expect(metafileToSvg(plusEmf(image, effect(k, body), draw(true)))!.svg, k).toMatch(re);
  });
  it('red-eye correction changes the red pixels inside its areas', () => {
    const svg = metafileToSvg(plusEmf(image, effect('redEye', (b) => b.u32(1, 0, 0, 2, 1)), draw(true)))!.svg;
    const a = /<image href="(data:[^"]+)"/.exec(svg)![1];
    const plain = /<image href="(data:[^"]+)"/.exec(metafileToSvg(plusEmf(image, draw(false)))!.svg)![1];
    expect(a).not.toBe(plain);
  });
  it('a damaged effect record is ignored', () => {
    const bad = plusRec(0x4038, 0, (b) => b.u32(1, 2, 3, 4, 999999));
    expect(metafileToSvg(plusEmf(image, bad, draw(true)))!.svg).toContain('<image ');
  });
});

// ---- fonts ----

/** A tiny TrueType font: glyph 1 = 'H' (advance 700), glyph 2 = 'i' (300), glyph 3 = U+1F600 (1000), 1000 units per em. */
function tinyFont(): Uint8Array {
  const be = () => { const a: number[] = []; const o = { u16: (...v: number[]) => { for (const x of v) a.push((x >> 8) & 255, x & 255); return o; }, u32: (...v: number[]) => { for (const x of v) a.push((x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255); return o; }, a }; return o; };
  const head = be().u32(0x10000, 0, 0, 0x5f0f3cf5).u16(0, 1000).u32(0, 0, 0, 0).u16(0, 0, 0, 0, 0, 0, 0, 0, 0).a;
  const hhea = be().u32(0x10000).u16(800, 0xff38, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4).a;
  const hmtx = be().u16(500, 0, 700, 0, 300, 0, 1000, 0).a;
  const segs = [[72, 72, 1 - 72], [105, 105, 2 - 105], [0xffff, 0xffff, 1]];
  const f4 = be().u16(4, 16 + segs.length * 8, 0, segs.length * 2, 4, 1, 2);
  f4.u16(...segs.map((s) => s[1])).u16(0).u16(...segs.map((s) => s[0])).u16(...segs.map((s) => s[2] & 0xffff)).u16(...segs.map(() => 0));
  const f12 = be().u16(12, 0).u32(52, 0, 3).u32(72, 72, 1, 105, 105, 2, 0x1f600, 0x1f600, 3);
  const cmap = be().u16(0, 2).u16(3, 1).u32(20).u16(3, 10).u32(20 + f4.a.length).a.concat(f4.a, f12.a);
  const tables: [string, number[]][] = [['cmap', cmap], ['head', head], ['hhea', hhea], ['hmtx', hmtx]];
  const out = be().u32(0x10000).u16(tables.length, 0, 0, 0);
  let off = 12 + tables.length * 16;
  const body: number[] = [];
  for (const [tag, t] of tables) {
    out.u32(tag.split('').reduce((v, c) => (v << 8) | c.charCodeAt(0), 0) >>> 0, 0, off, t.length);
    const pad = [...t]; while (pad.length % 4) pad.push(0);
    body.push(...pad); off += pad.length;
  }
  return Uint8Array.from([...out.a, ...body]);
}

describe('glyph-index text and widths from a known font', () => {
  afterEach(() => clearMetafileFonts());
  const glyphText = (ids: number[], dx: boolean) => emfRec(84, (b) => {
    b.u32(0, 0, 189, 94, 1, 0, 0);
    const dxOff = 76 + ids.length * 2 + (ids.length % 2 ? 2 : 0);
    b.u32(10, 30, ids.length, 76, 0x10 | 0x100, dx ? dxOff : 0).u32(0, 0, 0, 0).u16(...ids); // ETO_GLYPH_INDEX | ETO_NO_RECT: dx offset at 56, glyphs at 76
    b.pad4();
    if (dx) b.u32(...ids.map(() => 20));
  });
  it('without the font each glyph is a pale box', () => {
    const svg = metafileToSvg(emf([emfFont(1, 'TinyTest', -20), emfSelect(1), glyphText([1, 2], false)]))!.svg;
    expect(svg).not.toContain('<text');
    expect(svg).toContain('fill-opacity="0.3"');
  });
  it('with the font registered the glyphs are mapped back through its cmap (formats 4 and 12) and placed by its advances', () => {
    expect(addMetafileFont(tinyFont(), 'TinyTest')).toBe(true);
    expect(metafileFont('tinytest')!.charOf(3)).toBe(0x1f600);
    const svg = metafileToSvg(emf([emfFont(1, 'TinyTest', -20), emfSelect(1), glyphText([1, 2, 1], false)]))!.svg;
    const t = /<text [^>]*x="([^"]+)"[^>]*>([^<]+)<\/text>/.exec(svg)!;
    expect(t[2]).toBe('HiH');
    // advances 700, 300 units per 1000 at 20 px: 14 and 6 px (the EMF here maps 1 logical unit to 1 px)
    expect(t[1].split(' ').map(Number)).toEqual([0, 14, 20]);
    // an unknown glyph keeps its box; the dx array wins over the font's advances
    const mixed = metafileToSvg(emf([emfFont(1, 'TinyTest', -20), emfSelect(1), glyphText([1, 9, 2], true)]))!.svg;
    expect(/<text [^>]*x="0 40"[^>]*>Hi<\/text>/.test(mixed)).toBe(true);
    expect(mixed).toContain('fill-opacity="0.3"');
  });
  it('EMF+ DrawDriverString with glyph indices is mapped the same way', () => {
    addMetafileFont(tinyFont(), 'TinyTest');
    const font = plusRec(0x4008, (6 << 8) | 3, (b) => { b.u32(0xdbc01002).f32(20).u32(2, 0, 0, 8).utf16('TinyTest'); });
    const dds = plusRec(0x4036, 0x8000 | 3, (b) => b.u32(argb(255, 0, 0, 0), 0, 0, 2).u16(1, 2).f32(10, 40, 30, 40));
    const svg = metafileToSvg(plusEmf(font, dds))!.svg;
    expect(svg).toMatch(/<text [^>]*>Hi<\/text>/);
  });
  it('text widths come from the font\'s hmtx when its file is known', () => {
    expect(fontWidthEm('Hi', 'TinyTest')).toBeNull();
    addMetafileFont(tinyFont(), 'TinyTest');
    expect(fontWidthEm('Hi', 'TinyTest')).toBeCloseTo(1.0, 6);
    expect(textWidth('HiH', 'TinyTest', 10)).toBeCloseTo(17, 6);
  });
  it('bad font data is refused, never thrown', () => {
    expect(addMetafileFont(new Uint8Array([0, 1, 0, 0, 0, 9]))).toBe(false);
    const f = tinyFont();
    expect(addMetafileFont(f.subarray(0, 40), 'Cut')).toBe(false);
  });
  const liberation = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
  it.skipIf(!existsSync(liberation))('a real font (Liberation Sans): glyph ids from its own cmap come back as the text', () => {
    expect(addMetafileFont(new Uint8Array(readFileSync(liberation)))).toBe(true);
    const f = metafileFont('Liberation Sans')!;
    const ids = [...'Glyph 한'].slice(0, 5).map((c) => f.glyphOf(c.codePointAt(0)!));
    expect(ids.every((g) => g > 0)).toBe(true);
    const svg = metafileToSvg(emf([emfFont(1, 'Liberation Sans', -20), emfSelect(1), glyphText(ids, false)]))!.svg;
    expect(svg).toMatch(/>Glyph<\/text>/);
    expect(textWidth('Glyph', 'Liberation Sans', 100)).toBeGreaterThan(200);
  });
});
