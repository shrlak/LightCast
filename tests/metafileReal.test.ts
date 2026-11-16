// The metafile reader against real files (tests/fixtures/real/metafile, see its README) and the
// byte layouts the reader depends on. The real files were written by LibreOffice 24.2 from a
// drawing (EMF and WMF) and by Microsoft Office (the two icons); everything else is built here.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { metafileToSvg } from '../src/domain/metafile';
import { importPptx } from '../src/domain/io/pptxImport';
import { B, RED, argb, comment, emf, emfBrush, emfRec, emfRect, emfSelect, plusFillRects, plusHeader, plusRec, wmf, wmfRec } from './fixtures/metafileBytes';

const real = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/metafile/${name}`, import.meta.url)));
const svgOf = (name: string) => metafileToSvg(real(name))!;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const pngColorType = (svg: string) => {
  const m = /href="data:image\/png;base64,([^"]+)"/.exec(svg);
  return m ? Buffer.from(m[1], 'base64')[25] : -1;
};

/** The pixels of the first PNG image in the SVG as rows of [r, g, b, a] (our PNGs use filter 0 only). */
const pngPixels = (svg: string) => {
  const m = /href="data:image\/png;base64,([^"]+)"/.exec(svg);
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), bpp = b[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length;) { const n = b.readUInt32BE(o); if (b.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const raw = inflateSync(Buffer.concat(idat));
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => { const o = y * (w * bpp + 1) + 1 + x * bpp; return [raw[o], raw[o + 1], raw[o + 2], bpp === 4 ? raw[o + 3] : 255]; }));
};

describe('real files written by LibreOffice', () => {
  it('reads shapes from both formats and sizes them like the slide (3 x 2 in = 288 x 192 px)', () => {
    for (const name of ['lo-shapes.emf', 'lo-shapes.wmf']) {
      const r = svgOf(name);
      expect(r.width).toBeCloseTo(288, 0);
      expect(r.height).toBeCloseTo(192, 0);
      // a red rectangle, a green ellipse with a blue outline, a blue dashed line (LibreOffice writes the
      // outlines and dashes as filled polygons), the arrow and the freeform curve
      expect(r.svg).toContain('fill="#ff0000"');
      expect(r.svg).toContain('fill="#00aa00"');
      expect(r.svg).toContain('fill="#0000ff"');
      expect(r.svg).toContain('fill="#4472c4"');
      expect(r.svg).toContain('fill="#ffcc99"');
      expect(count(r.svg, /<path /g)).toBeGreaterThan(30);
    }
  });

  it('a WMF hairline pen is one pixel wide, not one logical unit (2540 units across 288 px)', () => {
    const svg = svgOf('lo-hatch.wmf').svg;
    // The hatch lines are hairlines: 20320 / 288 ... units per px; one unit would not show at all.
    const widths = [...svg.matchAll(/stroke="#cc0000"[^>]*stroke-width="([\d.]+)"/g)].map((m) => +m[1]);
    expect(widths.length).toBeGreaterThan(5);
    const unitsPerPx = 7620 / 288;
    for (const w of widths) expect(w).toBeCloseTo(unitsPerPx, 1);
    // the EMF draws in pixels already: 1 wide
    const e = [...svgOf('lo-hatch.emf').svg.matchAll(/stroke="#cc0000"[^>]*stroke-width="([\d.]+)"/g)].map((m) => +m[1]);
    expect(e.length).toBeGreaterThan(5);
    for (const w of e) expect(w).toBe(1);
  });

  it('a gradient drawn as slivers narrower than a pixel is painted without anti-aliasing', () => {
    for (const name of ['lo-gradient.emf']) {
      const svg = svgOf(name).svg;
      expect(count(svg, /shape-rendering="crispEdges"/g)).toBeGreaterThan(100);
    }
    // ordinary shapes keep their anti-aliased edges
    expect(svgOf('lo-shapes.emf').svg).not.toContain('crispEdges');
  });

  it('Korean text in a double-byte WMF keeps one advance per character (the dx array has one entry per byte)', () => {
    const svg = svgOf('lo-text.wmf').svg;
    const t = /<text [^>]*x="([^"]+)"[^>]*>한글 텍스트 맑은 고딕<\/text>/.exec(svg);
    expect(t).not.toBeNull();
    const xs = t![1].split(' ').map(Number);
    expect(xs.length).toBe('한글 텍스트 맑은 고딕'.length);
    // the Hangul advance is a full em (423 units for 12 pt) and the spaces are narrower: strictly increasing, no zeros between letters
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it('draws Latin, Korean and rotated text from the EMF too', () => {
    const svg = svgOf('lo-text.emf').svg;
    expect(svg).toContain('>Hello Arial 16<');
    expect(svg).toContain('>한글 텍스트 맑은 고딕<');
    expect(svg).toMatch(/rotate\(-?30/);
  });

  it('draws the embedded raster picture (12 x 9) as one image in both formats', () => {
    for (const name of ['lo-picture.emf', 'lo-picture.wmf']) {
      const r = svgOf(name);
      expect(count(r.svg, /<image /g)).toBe(1);
      expect(r.svg).toMatch(/<image href="data:image\/png;base64,iVBORw0KGgo/);
    }
  });
});

describe('real files written by Microsoft Office', () => {
  it('draws the generic page icon (EMF)', () => {
    const r = svgOf('office-icon.emf');
    expect(r.format).toBe('emf');
    expect(r.width).toBeCloseTo(104, 0);
    expect(r.items).toBeGreaterThan(0);
  });

  it('keeps the alpha of an AlphaBlend bitmap in a 32-bit BI_BITFIELDS DIB (it was drawn on a black box)', () => {
    const r = svgOf('office-icon-alpha.emf');
    expect(r.svg).toContain('<image ');
    expect(pngColorType(r.svg)).toBe(6); // RGBA, not opaque RGB
    expect(r.svg).toContain('>Microsoft <');
  });
});

describe('PowerPoint import with metafile pictures', () => {
  it('reads a real deck holding an .emf and a .wmf picture without losing either', async () => {
    const slides = await importPptx(new Blob([real('deck-with-emf.pptx')]));
    expect(slides).toHaveLength(1);
    expect(slides[0].image).toBeDefined();
    // no DOM here, so the metafile comes back as SVG
    expect(slides[0].image!.type).toBe('image/svg+xml');
    expect(await slides[0].image!.text()).toContain('<svg');
  });
});

// ---- the byte layouts checked against the specifications ------------------------------------

describe('WMF region object (MS-WMF 2.2.1.5)', () => {
  // Region: Next(2) Type(2)=6 Count(4) RegionSize(2) ScanCount(2) MaxScan(2) Bounds(4x2) then scans.
  // Scan: Count(2) Top(2) Bottom(2) [Left(2) Right(2)]x(Count/2) Count(2). Count is the number of X values.
  const region = (scans: { top: number; bottom: number; xs: number[] }[]) => {
    const body = new B();
    let max = 0;
    for (const s of scans) { body.u16(s.xs.length, s.top, s.bottom, ...s.xs, s.xs.length); max = Math.max(max, s.xs.length); }
    const size = 22 + body.length;
    return new B().u16(0, 6).u32(1).u16(size, scans.length, max, 0, 0, 100, 100).u8(...body.a).a;
  };
  const file = (...scans: { top: number; bottom: number; xs: number[] }[]) => wmf(
    wmfRec(0x020c, 100, 200), wmfRec(0x020b, 0, 0),
    wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0),
    [...new B().u32(3 + region(scans).length / 2).u16(0x06ff).a, ...region(scans)],
    wmfRec(0x0228, 1, 0),
  );
  it('two scans, the second with two spans, fill four rectangles in the right places', () => {
    const svg = metafileToSvg(file({ top: 10, bottom: 20, xs: [10, 50] }, { top: 20, bottom: 40, xs: [10, 30, 40, 60] }))!.svg;
    expect(svg).toContain('M10 10L50 10L50 20L10 20Z');
    expect(svg).toContain('M10 20L30 20L30 40L10 40Z');
    expect(svg).toContain('M40 20L60 20L60 40L40 40Z');
  });
});

describe('EMF+ relative paths (EmfPlusInteger7 / EmfPlusInteger15)', () => {
  // Value: 7 bits two's complement behind a 0 bit, or 15 bits two's complement behind a 1 bit (big endian).
  const int7 = (v: number) => [v & 0x7f];
  const int15 = (v: number) => [0x80 | ((v >> 8) & 0x7f), v & 0xff];
  const enc = (v: number) => (v >= -64 && v <= 63 ? int7(v) : int15(v));
  const pathOf = (deltas: [number, number][]) => {
    const path = plusRec(0x4008, (3 << 8) | 2, (b) => {
      b.u32(0xdbc01002, deltas.length, 0x800).u8(...deltas.flatMap(([dx, dy]) => [...enc(dx), ...enc(dy)])).u8(0, ...deltas.slice(1).map(() => 1));
    });
    const draw = plusRec(0x4014, 0x8000 | 2, (b) => b.u32(argb(255, 0, 0, 0)));
    return metafileToSvg(emf([comment(plusHeader(false), path, draw)]))!.svg;
  };
  it('7-bit values: -64 and 63 are the extremes, negative values sign-extend', () => {
    expect(pathOf([[63, -64], [-64, 63], [-1, -1]])).toContain('d="M63 -64L-1 -1L-2 -2"');
  });
  it('15-bit values: -16384 and 16383 are the extremes; 64 and -65 need two bytes', () => {
    expect(pathOf([[16383, -16384], [64, -65]])).toContain('d="M16383 -16384L16447 -16449"');
  });
  it('a byte with the high bit set starts a 15-bit number whatever follows', () => {
    expect(pathOf([[300, 0], [0, 300]])).toContain('d="M300 0L300 300"');
  });
});

describe('EMF+ texture brush (EmfPlusTextureBrushData)', () => {
  // Brush object: Version, Type=2, then Flags, WrapMode, [Transform 24 bytes if flag 0x2], EmfPlusImage.
  const brushWith = (flags: number, matrix: number[] | null) => plusRec(0x4008, (1 << 8) | 1, (b) => {
    b.u32(0xdbc01002, 2, flags, 0);
    if (matrix) b.f32(...matrix);
    b.u32(0xdbc01002, 1, 2, 2, 8, 0x26200a, 0).u8(0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255);
  });
  const rects = plusRec(0x400a, 0, (b) => b.u32(1, 1).f32(0, 0, 40, 40));
  it('with the transform flag, the six floats come before the image', () => {
    const svg = metafileToSvg(emf([comment(plusHeader(false), brushWith(0x2, [3, 0, 0, 3, 5, 7]), rects)]))!.svg;
    expect(svg).toMatch(/<pattern id="p\d+" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="matrix\(3 0 0 3 5 7\)">/);
  });
  it('without the flag, the image starts right after the wrap mode', () => {
    const svg = metafileToSvg(emf([comment(plusHeader(false), brushWith(0, null), rects)]))!.svg;
    expect(svg).toMatch(/<pattern id="p\d+" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="matrix\(1 0 0 1 0 0\)"><image/);
  });
});

// ---- clips ----------------------------------------------------------------------------------

describe('clip combine modes are exact however many clips are open', () => {
  const region = (mode: number, rects: [number, number, number, number][]) => {
    const d = new B().u32(32, 1, rects.length, rects.length * 16, 0, 0, 0, 0);
    for (const [l, t, r, b] of rects) d.u32(l, t, r, b);
    return emfRec(75, (b) => b.u32(d.length, mode).u8(...d.a));
  };
  const red = [emfBrush(1, RED), emfSelect(1), emfRect(0, 0, 100, 100)];
  it('OR under an intersected clip makes a union, XOR a mask, and a restored clip comes back', () => {
    const intersect = (l: number, t: number, r: number, b: number) => emfRec(30, (x) => x.u32(l, t, r, b));
    const or = metafileToSvg(emf([intersect(0, 0, 60, 60), intersect(20, 20, 80, 80), region(2, [[70, 0, 100, 10]]), ...red]))!.svg;
    expect(or).toContain('<mask'); // (A and A2) or B cannot be one clipPath
    const xor = metafileToSvg(emf([intersect(0, 0, 60, 60), region(3, [[40, 40, 100, 100]]), ...red]))!.svg;
    expect(xor).toContain('<mask');
    const saved = metafileToSvg(emf([intersect(0, 0, 30, 30), emfRec(33, () => undefined), region(5, [[50, 50, 100, 100]]), emfRec(34, (b) => b.u32(0xffffffff)), ...red]))!.svg;
    expect(saved).toContain('M0 0L30 0L30 30L0 30Z'); // RestoreDC brought the first clip back
    expect(saved).not.toContain('M50 50');
  });
  it('RGN_COPY replaces the whole clip, also one set before a SaveDC', () => {
    const svg = metafileToSvg(emf([emfRec(30, (b) => b.u32(0, 0, 30, 30)), emfRec(33, () => undefined), region(5, [[50, 50, 100, 100]]), ...red]))!.svg;
    expect(svg).toContain('M50 50L100 50L100 100L50 100Z');
    expect(svg).not.toContain('M0 0L30 0');
  });
  it('a hostile run of clip operations stays bounded', () => {
    const recs: number[][] = [];
    for (let i = 0; i < 3000; i++) recs.push(region(3, [[i % 90, 0, 100, 100]]), emfRect(0, 0, 5, 5));
    const r = metafileToSvg(emf(recs));
    expect(r === null || r.svg.length < 20_000_000).toBe(true);
  });
});

// ---- EMF+ regions with path nodes, complement, image attributes ------------------------------

describe('EMF+ regions drawn exactly', () => {
  const V = 0xdbc01002;
  // a path node: type 0x10000001, byte size, then an EmfPlusPath (version, count, flags, points, types)
  const pathNode = (pts: [number, number][]) => {
    const p = new B().u32(V, pts.length, 0);
    for (const [x, y] of pts) p.f32(x, y);
    p.u8(0, ...pts.slice(1).map((_, i) => (i === pts.length - 2 ? 1 | 0x80 : 1))).pad4();
    return new B().u32(0x10000001, p.length).u8(...p.a).a;
  };
  const rectNode = (r: [number, number, number, number]) => new B().u32(0x10000000).f32(...r).a;
  const region = (id: number, ...parts: (number | number[])[]) => plusRec(0x4008, (4 << 8) | id, (b) => {
    b.u32(V, parts.filter((p) => typeof p === 'number' || (p as number[])[0] === 0x10000000 || (p as number[])[0] === 0x10000001).length);
    for (const p of parts) { if (typeof p === 'number') b.u32(p); else b.u8(...p); }
  });
  const fill = (id: number) => plusRec(0x4013, 0x8000 | id, (b) => b.u32(argb(255, 0, 0, 255)));
  it('a triangle path node is the triangle, not its bounding box', () => {
    const svg = metafileToSvg(emf([comment(plusHeader(false), region(1, pathNode([[0, 0], [100, 0], [0, 100]])), fill(1))]))!.svg;
    expect(svg).toContain('M0 0L100 0L0 100Z');
    expect(svg).toContain('<clipPath');
  });
  it('a path node excluded from a rectangle leaves a hole of that shape', () => {
    const svg = metafileToSvg(emf([comment(plusHeader(false), region(1, 4, rectNode([0, 0, 100, 100]), pathNode([[20, 20], [80, 20], [50, 80]])), fill(1))]))!.svg;
    expect(svg).toContain('<mask');
    expect(svg).toContain('M20 20L80 20L50 80Z');
  });
  it('complement (shape minus clip) under an open clip keeps only what the clip lacks; with no clip it is empty', () => {
    const setClip = (id: number, mode: number) => plusRec(0x4034, (mode << 8) | id, () => undefined);
    const open = plusRec(0x4032, 1 << 8, (b) => b.f32(0, 0, 50, 50)); // intersect rectangle
    const r1 = region(1, rectNode([25, 25, 75, 75]));
    const under = metafileToSvg(emf([comment(plusHeader(false), r1, open, setClip(1, 5), plusFillRects(argb(255, 255, 0, 0), 0, 0, 200, 200))]))!.svg;
    expect(under).toContain('<mask'); // (25..100) minus (0..50)
    const none = metafileToSvg(emf([comment(plusHeader(false), r1, setClip(1, 5), plusFillRects(argb(255, 255, 0, 0), 0, 0, 200, 200))]))!.svg;
    expect(none).toContain('d="M0 0"'); // the shape minus everything is nothing
  });
  it('a region of too many nodes is skipped, not drawn wrongly or thrown on', () => {
    const parts: (number | number[])[] = [];
    for (let i = 0; i < 600; i++) parts.push(2, rectNode([i, 0, 1, 1]));
    parts.push(rectNode([0, 0, 1, 1]));
    expect(() => metafileToSvg(emf([comment(plusHeader(false), region(1, ...parts), fill(1))]))).not.toThrow();
  });
});

describe('EMF+ image attributes', () => {
  const V = 0xdbc01002;
  const image = plusRec(0x4008, (5 << 8) | 1, (b) => b.u32(V, 1, 2, 2, 8, 0x26200a, 0).u8(0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255));
  const attrs = (wrap: number, clamp: number) => plusRec(0x4008, (8 << 8) | 2, (b) => b.u32(V, 0, wrap, clamp, 0, 0));
  const draw = (attrId: number) => plusRec(0x401a, 1, (b) => b.u32(attrId, 2).f32(-2, -2, 6, 6).f32(0, 0, 60, 60)); // source is 3x3 times the image around it
  const run = (wrap: number, clamp = 0) => metafileToSvg(emf([comment(plusHeader(false), image, attrs(wrap, clamp), draw(2))]))!.svg;
  it('tile wrap repeats the image over the source rectangle (9 tiles for a 3 x 3 area)', () => {
    expect(count(run(0), /<image /g)).toBe(9);
  });
  it('TileFlipX mirrors every other column; TileFlipXY mirrors in both directions', () => {
    // the source spans tiles -1, 0, 1 in both directions: the odd ones (-1 and 1) are mirrored
    expect(count(run(1), /matrix\(-1 0 0 1 /g)).toBe(6);
    expect(count(run(3), /matrix\(-1 0 0 1 /g)).toBe(2);
    expect(count(run(3), /matrix\(1 0 0 -1 /g)).toBe(2);
    expect(count(run(3), /matrix\(-1 0 0 -1 /g)).toBe(4);
  });
  it('clamp wrap fills what lies outside the image with the clamp colour', () => {
    const svg = run(4, argb(255, 255, 128, 0));
    expect(svg).toContain('<rect x="-2" y="-2" width="6" height="6" fill="#ff8000"');
    expect(count(svg, /<image /g)).toBe(1);
  });
  it('with no attributes the outside stays empty and the image is drawn once', () => {
    const svg = metafileToSvg(emf([comment(plusHeader(false), image, draw(0))]))!.svg;
    expect(count(svg, /<image /g)).toBe(1);
    expect(svg).not.toContain('<rect');
  });
});

// ---- MaskBlt, PlgBlt, flood fills -----------------------------------------------------------

describe('MaskBlt, PlgBlt and flood fills', () => {
  const bmi = (w: number, h: number, bpp: number, palette: number[] = []) => new B().u32(40, w, h).u16(1, bpp).u32(0, 0, 0, 0, palette.length / 4, 0).u8(...palette);
  const color2x2 = () => ({ bmi: bmi(2, 2, 24), bits: new B().u8(0, 0, 255, 255, 0, 0, 0, 0).u8(255, 0, 0, 0, 0, 255, 0, 0) });
  // 1-bit 2x2 mask, white (1) top-left and bottom-right: rows are padded to 4 bytes; bottom-up
  const mask2x2 = () => ({ bmi: bmi(2, 2, 1, [0, 0, 0, 0, 255, 255, 255, 0]), bits: new B().u8(0x40, 0, 0, 0).u8(0x80, 0, 0, 0) });
  const maskBlt = (withMask: boolean) => emfRec(78, (b) => {
    const c = color2x2(), m = mask2x2();
    const head = 128;
    b.u32(0, 0, 0, 0); // bounds
    b.u32(10, 20, 40, 40, 0xcaaa0029 | 0); // dest, ROP4: foreground SRCCOPY, background DST
    b.u32(0, 0); b.f32(1, 0, 0, 1, 0, 0); // source x, y; transform
    b.u32(0, 0, head, c.bmi.length, head + c.bmi.length, c.bits.length); // background colour, usage, bmi and bits offsets and sizes
    b.u32(0, 0, 0); // mask x, y, usage
    const mo = head + c.bmi.length + c.bits.length;
    b.u32(withMask ? mo : 0, withMask ? m.bmi.length : 0, withMask ? mo + m.bmi.length : 0, withMask ? m.bits.length : 0);
    b.u8(...c.bmi.a, ...c.bits.a, ...(withMask ? [...m.bmi.a, ...m.bits.a] : []));
  });
  it('MaskBlt draws the source with the mask holes transparent (two of four pixels remain)', () => {
    const svg = metafileToSvg(emf([maskBlt(true)]))!.svg;
    expect(svg).toMatch(/<image href="data:image\/png;base64,/);
    expect(pngColorType(svg)).toBe(6); // alpha: the masked-out pixels are transparent
    expect(svg).toContain('matrix(20 0 0 20 10 20)');
    const px = pngPixels(svg)!;
    // the mask keeps the top-left and bottom-right pixels (blue and blue) of the 2 x 2 source
    expect(px.map((row) => row.map((p) => p[3]))).toEqual([[255, 0], [0, 255]]);
    expect(px[0][0].slice(0, 3)).toEqual([0, 0, 255]);
  });
  it('MaskBlt without a mask bitmap is a plain BitBlt', () => {
    const svg = metafileToSvg(emf([maskBlt(false)]))!.svg;
    expect(pngColorType(svg)).toBe(2); // opaque RGB
  });
  it('PlgBlt maps the source onto the parallelogram given by three corners', () => {
    const c = color2x2();
    const rec = emfRec(79, (b) => {
      b.u32(0, 0, 0, 0, 50, 10, 90, 30, 40, 70, 0, 0, 2, 2);
      b.f32(1, 0, 0, 1, 0, 0);
      b.u32(0, 0, 140, c.bmi.length, 140 + c.bmi.length, c.bits.length); // background colour, usage, bmi and bits
      b.u32(0, 0, 0, 0, 0, 0, 0); // mask: x, y, usage, bmi and bits offsets and sizes (none)
      b.u8(...c.bmi.a, ...c.bits.a);
    });
    const svg = metafileToSvg(emf([rec]))!.svg;
    // x axis: (90-50)/2 = 20 per pixel along (20, 10)/... ; y axis from the lower left
    expect(svg).toContain('matrix(20 10 -5 30 50 10)');
  });
  it('an EXTCREATEREGION in the old numbering is still read as a region', () => {
    const d = new B().u32(32, 1, 1, 16, 0, 0, 0, 0).u32(10, 10, 60, 60);
    const create = emfRec(79, (b) => b.u32(1, d.length).u8(...d.a));
    const fill = emfRec(71, (b) => b.u32(0, 0, 0, 0, d.length, 2).u8(...d.a)); // FILLRGN with the brush made below
    const svg = metafileToSvg(emf([emfBrush(2, RED), create, fill]))!.svg;
    expect(svg).toContain('M10 10L60 10L60 60L10 60Z');
  });
  it('a flood fill that finds nothing to fill draws nothing and does not disturb what follows', () => {
    const flood = emfRec(53, (b) => b.u32(5, 5, 0x00ff00, 1)); // EXTFLOODFILL surface: the (white) page is not green
    const withFill = metafileToSvg(emf([flood, emfBrush(1, RED), emfSelect(1), emfRect(0, 0, 10, 10)]))!;
    expect(withFill.items).toBe(1);
    // WMF ExtFloodFill, FLOODFILLSURFACE of green on the white page: nothing is filled
    const w = metafileToSvg(wmf(wmfRec(0x020c, 100, 200), wmfRec(0x020b, 0, 0), wmfRec(0x0548, 1, 0xff00, 0, 5, 5), wmfRec(0x0324, 3, 20, 20, 90, 20, 55, 80)))!;
    expect(w.items).toBe(1);
  });
});
