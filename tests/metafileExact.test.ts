// Flood fills that see text (glyph outlines from glyf / CFF), dashes, decoded PNG / JPEG pattern brushes
// and an unknown page; the PNG / JPEG decoders; EMF+ effects as tables and pixels. Files are built from
// the specification tables (fixtures/metafileBytes.ts).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { metafileToSvg } from '../src/domain/metafile';
import { addMetafileFont, addMetafileFontFile, clearMetafileFonts, metafileFont, parseMetafileFont } from '../src/domain/metafile/fonts';
import { applyEffect, effectLut, type Effect } from '../src/domain/metafile/effects';
import { decodeImage } from '../src/domain/metafile/decode';
import { decodeBudget } from '../src/domain/metafile/png';
import { RED, comment, emf, emfBrush, emfFont, emfRec, emfSelect, emfTextW, plusHeader, plusRec, wmf, wmfRec } from './fixtures/metafileBytes';
import * as IMG from './fixtures/metafileImages';

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const rects = (d: string) => [...d.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H/g)].map((m) => m.slice(1).map(Number));
const area = (d: string) => rects(d).reduce((a, [x0, y0, x1, y1]) => a + (x1 - x0) * (y1 - y0), 0);
const floodOf = (svg: string, color = '#ff0000') => new RegExp(`<path d="(M[^"]+)" fill="${color}" shape-rendering="crispEdges"/>`).exec(svg)?.[1] ?? null;

// ---- font builders (big-endian sfnt tables) ----

class BE {
  a: number[] = [];
  u8(...v: number[]) { for (const x of v) this.a.push(x & 255); return this; }
  u16(...v: number[]) { for (const x of v) this.a.push((x >> 8) & 255, x & 255); return this; }
  u32(...v: number[]) { for (const x of v) this.a.push((x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255); return this; }
  i32(v: number) { return this.u32(v >>> 0); }
}
function sfnt(version: number, tables: [string, number[]][]): Uint8Array {
  const out = new BE().u32(version).u16(tables.length, 0, 0, 0);
  let off = 12 + tables.length * 16;
  const body: number[] = [];
  for (const [tag, data] of tables) {
    out.u8(...[...tag].map((c) => c.charCodeAt(0))).u32(0, off, data.length);
    const padded = [...data]; while (padded.length % 4) padded.push(0);
    body.push(...padded); off += padded.length;
  }
  return Uint8Array.from([...out.a, ...body]);
}
const head = (longLoca: number) => new BE().u32(0x10000, 0, 0, 0x5f0f3cf5).u16(0, 1000).u32(0, 0, 0, 0).u16(0, 0, 0, 0, 0, 0, 0, longLoca, 0).a;
const hhea = (n: number) => new BE().u32(0x10000).u16(800, 0xff38, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, n).a;
/** cmap format 4 mapping the code points to glyphs 1, 2, ... */
function cmap(cps: number[]): number[] {
  const segs = [...cps.map((c, i) => [c, c, (i + 1 - c) & 0xffff]), [0xffff, 0xffff, 1]];
  const f4 = new BE().u16(4, 16 + segs.length * 8, 0, segs.length * 2, 4, 1, 2);
  f4.u16(...segs.map((s) => s[1])).u16(0).u16(...segs.map((s) => s[0])).u16(...segs.map((s) => s[2])).u16(...segs.map(() => 0));
  return new BE().u16(0, 1).u16(3, 1).u32(12).a.concat(f4.a);
}

/** TrueType: glyph 1 ('O') a box with a quadratic bump on top, glyph 2 ('P') glyph 1 moved 1000 units right (a composite). */
function ttFont(): Uint8Array {
  const pts: [number, number, boolean][] = [[100, 0, true], [600, 0, true], [600, 700, true], [350, 900, false], [100, 700, true]];
  const g1 = new BE().u16(1, 100, 0, 600, 900).u16(4).u16(0);
  for (const p of pts) g1.u8(p[2] ? 1 : 0);
  let px = 0, py = 0;
  for (const p of pts) { g1.u16((p[0] - px) & 0xffff); px = p[0]; }
  for (const p of pts) { g1.u16((p[1] - py) & 0xffff); py = p[1]; }
  while (g1.a.length % 4) g1.u8(0);
  const g2 = new BE().u16(0xffff, 1100, 0, 1600, 900).u16(0x0003, 1).u16(1000, 0);
  const glyf = [...g1.a, ...g2.a];
  const loca = new BE().u32(0, 0, g1.a.length, glyf.length).a;
  return sfnt(0x10000, [['cmap', cmap([0x4f, 0x50])], ['glyf', glyf], ['head', head(1)], ['hhea', hhea(3)], ['hmtx', new BE().u16(500, 0, 700, 0, 1700, 0).a], ['loca', loca], ['maxp', new BE().u32(0x5000).u16(3).a]]);
}

/** CFF: glyph 1 ('O') a square ring (outer contour in the charstring, inner one in a local subroutine). */
function cffFont(): Uint8Array {
  const n = (v: number): number[] => (v >= -107 && v <= 107 ? [v + 139] : v >= 108 && v <= 1131 ? [247 + ((v - 108) >> 8), (v - 108) & 255] : v <= -108 && v >= -1131 ? [251 + ((-v - 108) >> 8), (-v - 108) & 255] : [28, (v >> 8) & 255, v & 255]);
  const cs1 = [...n(100), ...n(0), 21, ...n(500), ...n(0), ...n(0), ...n(700), ...n(-500), ...n(0), 5, ...n(-107), 10, 14];
  const subr = [...n(100), ...n(-600), 21, ...n(0), ...n(500), ...n(300), ...n(0), ...n(0), ...n(-500), 5, 11];
  const index = (items: number[][]) => {
    const b = new BE().u16(items.length);
    if (!items.length) return b.a;
    b.u8(1);
    let o = 1; b.u8(o);
    for (const it of items) { o += it.length; b.u8(o); }
    return [...b.a, ...items.flat()];
  };
  const int = (v: number) => [29, (v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const top = (cs: number, psize: number, poff: number) => [...int(cs), 17, ...int(psize), ...int(poff), 18];
  const hdr = [1, 0, 4, 1];
  const name = index([[0x54]]);
  const pre = hdr.length + name.length + index([top(0, 0, 0)]).length + 2 + 2;
  const chars = index([[14], cs1]);
  const priv = [...int(6), 19];
  const all = [...hdr, ...name, ...index([top(pre, priv.length, pre + chars.length)]), 0, 0, 0, 0, ...chars, ...priv, ...index([subr])];
  return sfnt(0x4f54544f, [['CFF ', all], ['cmap', cmap([0x4f])], ['head', head(0)], ['hhea', hhea(2)], ['hmtx', new BE().u16(500, 0, 700, 0).a]]);
}

afterEach(() => clearMetafileFonts());

describe('glyph outlines', () => {
  it('reads TrueType quadratic contours and composite glyphs', () => {
    const f = parseMetafileFont(ttFont(), 'TT')!;
    expect(f.outline(1)).toEqual(['M', 100, 0, 'L', 600, 0, 'L', 600, 700, 'Q', 350, 900, 100, 700, 'Z']);
    expect(f.outline(2)).toEqual(['M', 1100, 0, 'L', 1600, 0, 'L', 1600, 700, 'Q', 1350, 900, 1100, 700, 'Z']);
    expect(f.ascent).toBe(800); expect(f.descent).toBe(200);
  });
  it('reads CFF Type 2 charstrings with local subroutines', () => {
    const f = parseMetafileFont(cffFont(), 'C')!;
    expect(f.outline(1)).toEqual(['M', 100, 0, 'L', 600, 0, 'L', 600, 700, 'L', 100, 700, 'Z', 'M', 200, 100, 'L', 200, 600, 'L', 500, 600, 'L', 500, 100, 'Z']);
  });
  it('damaged outline data gives no outline, never an exception', () => {
    const bytes = ttFont();
    for (let i = 300; i < bytes.length; i += 7) bytes[i] ^= 0x5a;
    const f = parseMetafileFont(bytes, 'TT');
    expect(() => f?.outline(1)).not.toThrow();
  });
});

describe('flood fills see text', () => {
  // An 'O' of 80 px em at (20, 10), top-aligned: baseline at 10 + 0.8 * 80 = 74; the CFF ring's counter is
  // x 36..60, y 26..66 (24 x 40 px), its outer edge x 28..68, y 18..74.
  const file = (face: string, x: number, y: number) => emf([
    emfFont(1, face, -80), emfSelect(1), emfTextW(20, 10, 'O'),
    emfBrush(2, RED), emfSelect(2),
    emfRec(53, (b) => b.u32(x, y, 0, 0)), // EXTFLOODFILL border mode, border colour black
  ]);
  it('with the font file known, the glyph outline bounds the fill: a flood inside the letter fills its counter', () => {
    addMetafileFont(cffFont(), 'RingFont');
    const d = floodOf(metafileToSvg(file('RingFont', 48, 46))!.svg)!;
    expect(area(d)).toBe(24 * 40);
    const r = rects(d);
    expect(Math.min(...r.map((q) => q[0]))).toBe(36); expect(Math.max(...r.map((q) => q[2]))).toBe(60);
    expect(Math.min(...r.map((q) => q[1]))).toBe(26); expect(Math.max(...r.map((q) => q[3]))).toBe(66);
    // from outside the letter: the frame (200 x 100) less the ring and its counter
    expect(area(floodOf(metafileToSvg(file('RingFont', 150, 50))!.svg)!)).toBe(200 * 100 - 40 * 56);
  });
  it('with a TrueType font, the quadratic bump is part of the glyph', () => {
    addMetafileFont(ttFont(), 'BumpFont');
    // the bump rises to 900 units: 2 px above the cap at x = 48 (the outline's top is at 74 - 72 = 2 there)
    const d = floodOf(metafileToSvg(file('BumpFont', 5, 5))!.svg)!;
    expect(area(d)).toBeLessThan(200 * 100 - 40 * 56);
  });
  it('without the font file, each character is a box (advance by cap height) the fill stops at', () => {
    expect(floodOf(metafileToSvg(file('NoSuchFont', 48, 46))!.svg)).toBeNull(); // the start pixel is covered by the letter's box
    const d = floodOf(metafileToSvg(file('NoSuchFont', 150, 50))!.svg)!;
    expect(area(d)).toBeLessThan(200 * 100 - 30 * 50);
    expect(area(d)).toBeGreaterThan(200 * 100 - 80 * 80);
  });
  it('a real TrueType font (Arimo) leaves the counter of an O to a flood started inside it', async () => {
    const ok = await addMetafileFontFile(new Uint8Array(readFileSync('node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff')), 'Arimo');
    expect(ok).toBe(true);
    expect(metafileFont('Arimo')!.outline(metafileFont('Arimo')!.glyphOf(0x4f))!.length).toBeGreaterThan(20);
    // Arimo's O at 80 px: the counter is about 37 x 58 px around (46, 46)
    const d = floodOf(metafileToSvg(file('Arimo', 47, 44))!.svg)!;
    expect(area(d)).toBeGreaterThan(1200);
    expect(area(d)).toBeLessThan(2400);
  });
});

describe('flood fills see dashes', () => {
  const pen = (style: number) => emfRec(38, (b) => b.u32(3, style, 1, 0, 0)); // CREATEPEN: cosmetic, black
  const file = (style: number, bkMode: number) => emf([
    emfRec(18, (b) => b.u32(bkMode)), pen(style), emfSelect(3), emfSelect(0x80000005), // NULL_BRUSH
    emfRec(43, (b) => b.u32(20, 20, 180, 80)),
    emfBrush(2, RED), emfSelect(2), emfRec(53, (b) => b.u32(100, 50, 0, 0)),
  ]);
  it('a solid outline holds the fill; a dashed one (GDI cosmetic PS_DASH: 18 on, 6 off) lets it out', () => {
    const solid = area(floodOf(metafileToSvg(file(0, 1))!.svg)!);
    expect(solid).toBe(159 * 59); // inside the outline (its pixels 20..179 x 20..79)
    const svg = metafileToSvg(file(1, 1))!.svg;
    expect(svg).toContain('stroke-dasharray="18 6"');
    expect(area(floodOf(svg)!)).toBeGreaterThan(200 * 100 - 2 * (160 + 60));
  });
  it('in OPAQUE background mode a CreatePen dash fills its gaps with the background colour (the flood still runs through: white is not the border)', () => {
    const svg = metafileToSvg(file(2, 2))!.svg;
    expect(svg).toMatch(/stroke="#ffffff" stroke-width="1"[^>]*\/><path d="[^"]+" fill="none" stroke="#000000"[^>]* stroke-dasharray="3 3"/);
    expect(area(floodOf(svg)!)).toBeGreaterThan(200 * 100 - 2 * (160 + 60));
  });
  it('an ExtCreatePen PS_USERSTYLE pattern is used, and wide CreatePen pens are drawn solid', () => {
    const ext = emfRec(95, (b) => b.u32(3, 0, 0, 0, 0).u32(7, 1, 0, 0, 0, 2, 4, 2)); // cosmetic user style 4 on 2 off (style units of 3 px)
    const svg = metafileToSvg(emf([ext, emfSelect(3), emfRec(27, (b) => b.u32(10, 50)), emfRec(54, (b) => b.u32(100, 50))]))!.svg;
    expect(svg).toContain('stroke-dasharray="12 6"');
    const wide = metafileToSvg(emf([emfRec(38, (b) => b.u32(3, 1, 5, 0, 0)), emfSelect(3), emfRec(43, (b) => b.u32(20, 20, 180, 80))]))!.svg;
    expect(wide).not.toContain('stroke-dasharray');
  });
});

describe('flood fills over PNG / JPEG pattern brushes and the unknown page', () => {
  /** CREATEDIBPATTERNBRUSHPT with a BI_JPEG / BI_PNG bitmap. */
  const patternBrush = (slot: number, comp: number, bytes: Uint8Array, w: number, h: number) => emfRec(94, (b) => {
    b.u32(slot, 0, 32, 40, 72, bytes.length);
    b.u32(40, w, h).u16(1, 0).u32(comp, bytes.length, 0, 0, 0, 0);
    b.u8(...bytes);
  });
  it('a JPEG pattern is decoded: a surface flood of its exact colour fills the pattern-filled rectangle', () => {
    decodeBudget.px = 1e6;
    const px = decodeImage(b64(IMG.JPEG_UNIFORM))!.px;
    const c = px[0] | (px[1] << 8) | (px[2] << 16);
    expect(Math.abs(px[0] - 200) + Math.abs(px[1] - 30) + Math.abs(px[2] - 60)).toBeLessThan(4);
    const svg = metafileToSvg(emf([
      patternBrush(4, 4, b64(IMG.JPEG_UNIFORM), 8, 8), emfSelect(4), emfSelect(0x80000008), // NULL_PEN
      emfRec(43, (b) => b.u32(20, 20, 120, 70)),
      emfBrush(2, RED), emfSelect(2), emfRec(53, (b) => b.u32(50, 50, c, 1)), // FLOODFILLSURFACE
    ]))!.svg;
    expect(svg).toContain('data:image/jpeg;base64,');
    expect(area(floodOf(svg)!)).toBe(100 * 50);
  });
  it('a pixel the file never drew is unknown: a surface flood of white stops there unless the file set an opaque white background', () => {
    const frame = [wmfRec(0x020c, 100, 200), wmfRec(0x020b, 0, 0)];
    const red = [wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0), wmfRec(0x012d, 0)];
    const flood = wmfRec(0x0548, 1, 0xffff, 0xff, 50, 50);
    expect(floodOf(metafileToSvg(wmf(...frame, ...red, flood))!.svg)).toBeNull();
    const opaque = floodOf(metafileToSvg(wmf(...frame, wmfRec(0x0102, 2), ...red, flood))!.svg)!;
    expect(area(opaque)).toBeGreaterThan(190 * 95);
    // a border fill runs over the unknown page (it is not the border colour)
    expect(area(floodOf(metafileToSvg(wmf(...frame, ...red, wmfRec(0x0419, 0, 0, 50, 50)))!.svg)!)).toBeGreaterThan(190 * 95);
  });
});

describe('PNG and JPEG decoding', () => {
  const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
  it('decodes baseline 4:2:0 and progressive JPEG to within 2 levels of libjpeg', () => {
    decodeBudget.px = 1e6;
    for (const [jpg, ref] of [[IMG.JPEG_420, IMG.JPEG_420_RGBA], [IMG.JPEG_PROGRESSIVE, IMG.JPEG_PROGRESSIVE_RGBA]]) {
      const r = decodeImage(b64(jpg))!;
      expect(r.w).toBe(16); expect(r.h).toBe(16);
      expect(maxDiff(r.px, b64(ref))).toBeLessThanOrEqual(2);
    }
  });
  it('decodes an interlaced palette PNG exactly', () => {
    decodeBudget.px = 1e6;
    const r = decodeImage(b64(IMG.PNG_PALETTE_INTERLACED))!;
    expect(maxDiff(r.px, b64(IMG.PNG_PALETTE_INTERLACED_RGBA))).toBe(0);
  });
  it('damaged or truncated data gives null, never an exception', () => {
    decodeBudget.px = 1e6;
    for (const s of [IMG.JPEG_420, IMG.JPEG_PROGRESSIVE, IMG.PNG_PALETTE_INTERLACED]) {
      const u = b64(s);
      for (const cut of [10, 40, u.length >> 1, u.length - 3]) expect(() => decodeImage(u.subarray(0, cut))).not.toThrow();
      const bad = u.slice(); for (let i = 20; i < bad.length; i += 5) bad[i] ^= 0xff;
      expect(() => decodeImage(bad)).not.toThrow();
    }
    decodeBudget.px = 10; // over the budget: refused
    expect(decodeImage(b64(IMG.JPEG_420))).toBeNull();
  });
});

describe('EMF+ effects by the GDI+ documentation', () => {
  const one = (r: number, g: number, b: number) => ({ w: 1, h: 1, px: new Uint8ClampedArray([r, g, b, 255]) });
  const after = (e: Effect, r: number, g: number, b: number) => [...applyEffect(e, one(r, g, b))!.img.px.slice(0, 3)];
  it('white and black saturation map [0, t] and [t, 255] linearly onto [0, 255]', () => {
    const w = effectLut({ k: 'colorCurve', adjust: 6, channel: 0, intensity: 240 })![0];
    expect(w[240]).toBe(255); expect(w[250]).toBe(255); expect(w[120]).toBe(128); expect(w[0]).toBe(0);
    const k = effectLut({ k: 'colorCurve', adjust: 7, channel: 0, intensity: 15 })![0];
    expect(k[15]).toBe(0); expect(k[10]).toBe(0); expect(k[255]).toBe(255); expect(k[135]).toBe(128);
  });
  it('highlight changes only channel values above half intensity, shadow only those below; a channel curve leaves the others', () => {
    const hi = effectLut({ k: 'colorCurve', adjust: 3, channel: 0, intensity: 80 })![0];
    for (let v = 0; v <= 128; v++) expect(hi[v]).toBe(v);
    expect(hi[192]).toBeGreaterThan(192); expect(hi[255]).toBe(255);
    const sh = effectLut({ k: 'colorCurve', adjust: 4, channel: 0, intensity: -80 })![0];
    for (let v = 128; v <= 255; v++) expect(sh[v]).toBe(v);
    expect(sh[64]).toBeLessThan(64);
    const red = effectLut({ k: 'colorCurve', adjust: 0, channel: 1, intensity: 100 })!;
    expect(red[0][100]).toBe(200); expect(red[1][100]).toBe(100); expect(red[2][100]).toBe(100);
  });
  it('tint hue 0 is blue, -120 red and +120 green (TintParams)', () => {
    const [r0, g0, b0] = after({ k: 'tint', hue: 0, amount: 60 }, 128, 128, 128);
    expect(b0).toBeGreaterThan(r0); expect(b0).toBeGreaterThan(g0);
    const [r1, g1, b1] = after({ k: 'tint', hue: -120, amount: 60 }, 128, 128, 128);
    expect(r1).toBeGreaterThan(g1); expect(r1).toBeGreaterThan(b1);
    const [r2, g2, b2] = after({ k: 'tint', hue: 120, amount: 60 }, 128, 128, 128);
    expect(g2).toBeGreaterThan(r2); expect(g2).toBeGreaterThan(b2);
  });
  it('hue / saturation / lightness work in HSL: red turned by +120 is green, -100 saturation is grey, +100 lightness white', () => {
    expect(after({ k: 'hsl', hue: 120, sat: 0, light: 0 }, 255, 0, 0)).toEqual([0, 255, 0]);
    const [r, g, b] = after({ k: 'hsl', hue: 0, sat: -100, light: 0 }, 200, 50, 50);
    expect(r).toBe(g); expect(g).toBe(b);
    expect(after({ k: 'hsl', hue: 0, sat: 0, light: 100 }, 20, 90, 200)).toEqual([255, 255, 255]);
  });
  it('a blur with expandEdge grows the bitmap by the radius on every side', () => {
    const img = { w: 4, h: 3, px: new Uint8ClampedArray(48).fill(255) };
    const r = applyEffect({ k: 'blur', radius: 5, expand: true }, img)!;
    expect([r.img.w, r.img.h, r.dx, r.dy]).toEqual([14, 13, -5, -5]);
    expect(r.img.px[3]).toBeLessThan(40); // a soft, mostly transparent edge
    const same = applyEffect({ k: 'blur', radius: 5, expand: false }, img)!;
    expect([same.img.w, same.img.h]).toEqual([4, 3]);
    expect([...same.img.px.slice(0, 4)]).toEqual([255, 255, 255, 255]); // edges repeat, so a flat image stays flat
  });
  it('an expanding blur on an EMF+ bitmap draws the grown bitmap past the destination', () => {
    const obj = plusRec(0x4008, (5 << 8) | 2, (b) => b.u32(0xdbc01002, 1, 2, 2, 8, 0x26200a, 0).u8(...Array(16).fill(255)));
    const blur = plusRec(0x4038, 0, (b) => b.u8(0xa4, 0x80, 0x3c, 0x63, 0x43, 0x18, 0x2b, 0x48, 0x9e, 0xf2, 0xbe, 0x28, 0x34, 0xc5, 0xfd, 0xd4).u32(8).f32(3).u32(1));
    const draw = plusRec(0x401b, 2 | 0x2000, (b) => b.u32(0xff, 2).f32(0, 0, 2, 2).u32(3).f32(10, 10, 50, 10, 10, 50));
    const svg = metafileToSvg(emf([comment(plusHeader(false), obj, blur, draw)]))!.svg;
    expect(svg).toMatch(/<image href="data:image\/png;base64,[^"]+" x="0" y="0" width="8" height="8"/);
    expect(svg).toMatch(/transform="matrix\(20 0 0 20 -50 -50\)"/); // 2 px over 40 units, moved back by 3 px
  });
});

describe('EMF+ image attributes', () => {
  // A 2 x 2 bitmap (B G R A rows: red, green / blue, white) and an image attributes object (wrap tile).
  const pixels = [0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255];
  const image = plusRec(0x4008, (5 << 8) | 0, (b) => b.u32(0xdbc01002, 1, 2, 2, 8, 0x26200a, 0).u8(...pixels));
  const attrs = plusRec(0x4008, (8 << 8) | 1, (b) => b.u32(0xdbc01002, 0, 0, 0, 0, 0));
  const drawImage = (attrId: number) => plusRec(0x401a, 0, (b) => b.u32(attrId, 2).f32(0, 0, 2, 2).f32(10, 10, 40, 40));
  /** The GDI fallback: STRETCHDIBITS of a 2 x 2 32-bit bottom-up DIB to (10, 10, 40, 40). */
  const fallback = (bgra: number[]) => emfRec(81, (b) => {
    b.u32(10, 10, 50, 50).u32(10, 10, 0, 0, 2, 2).u32(80, 40, 120, 16, 0, 0x00cc0020, 40, 40);
    b.u32(40, 2, 2).u16(1, 32).u32(0, 16, 0, 0, 0, 0);
    b.u8(...bgra.slice(8), ...bgra.slice(0, 8)); // bottom-up rows
  });
  const dual = (...gdi: number[][]) => emf([comment(plusHeader(true)), comment(image, attrs), comment(drawImage(1)), ...gdi, comment(plusRec(0x4002, 0, () => undefined))]);
  const images = (svg: string) => [...svg.matchAll(/<image href="(data:image\/png;base64,[^"]+)"/g)].map((m) => m[1]);
  it('the EmfPlusImageAttributes object holds no colour adjustment, so a recoloured GDI fallback bitmap is drawn in the image\'s place', () => {
    const inverted = pixels.map((v, i) => (i % 4 === 3 ? v : 255 - v));
    const plain = images(metafileToSvg(dual(fallback(pixels)))!.svg);
    const recoloured = metafileToSvg(dual(fallback(inverted)))!.svg;
    expect(images(recoloured)).toHaveLength(1);
    expect(images(recoloured)[0]).not.toBe(plain[0]);
    const px = decodeImage(new Uint8Array(Buffer.from(images(recoloured)[0].slice(22), 'base64')))!;
    expect([...px.px.slice(0, 4)]).toEqual([0, 255, 255, 255]); // red inverted is cyan
    expect(recoloured).toContain('transform="matrix(20 0 0 20 10 10)"');
    // the same pixels in the fallback: the EMF+ image stays
    expect(plain).toHaveLength(1);
    const kept = decodeImage(new Uint8Array(Buffer.from(plain[0].slice(22), 'base64')))!;
    expect([...kept.px.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
  it('without image attributes, or with two fallback bitmaps, the EMF+ image is kept', () => {
    const inverted = pixels.map((v, i) => (i % 4 === 3 ? v : 255 - v));
    const red = (svg: string) => [...decodeImage(new Uint8Array(Buffer.from(images(svg)[0].slice(22), 'base64')))!.px.slice(0, 4)];
    const noAttrs = emf([comment(plusHeader(true)), comment(image, attrs), comment(drawImage(0xff)), fallback(inverted)]);
    expect(red(metafileToSvg(noAttrs)!.svg)).toEqual([255, 0, 0, 255]);
    expect(red(metafileToSvg(dual(fallback(inverted), fallback(inverted)))!.svg)).toEqual([255, 0, 0, 255]);
  });
});
