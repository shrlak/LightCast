import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { isMetafile, metafileToSvg } from '../src/domain/metafile';
import { isMetafileName, metafileToBlob, pictureBlob } from '../src/domain/metafile/image';
import { readGvml } from '../src/domain/io/drawingml';

// ---- byte builders -------------------------------------------------------------------------

class B {
  a: number[] = [];
  u8(...v: number[]) { this.a.push(...v.map((x) => x & 255)); return this; }
  u16(...v: number[]) { for (const x of v) this.u8(x, x >> 8); return this; }
  u32(...v: number[]) { for (const x of v) this.u8(x, x >> 8, x >> 16, x >>> 24); return this; }
  f32(...v: number[]) { for (const x of v) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); this.u8(...new Uint8Array(d.buffer)); } return this; }
  utf16(s: string) { for (const c of s) this.u16(c.charCodeAt(0)); return this; }
  pad4() { while (this.a.length % 4) this.a.push(0); return this; }
  get bytes() { return Uint8Array.from(this.a); }
  get length() { return this.a.length; }
}
const RED = 0x0000ff, BLUE = 0xff0000; // COLORREF is 0x00BBGGRR

// WMF: a record is size (words), function, parameters (16-bit words).
const wmfRec = (fn: number, ...words: number[]) => new B().u32(3 + words.length).u16(fn).u16(...words.map((w) => w & 0xffff)).a;
function wmf(...records: number[][]): Uint8Array {
  const body = records.flat();
  const total = 9 + 3 + body.length / 2; // header words + EOF record + records
  const b = new B();
  b.u32(0x9ac6cdd7).u16(0).u16(0, 0, 200, 100).u16(100).u32(0).u16(0); // placeable header: 200 x 100 units at 100 per inch
  b.u16(1, 9, 0x300).u32(total).u16(2).u32(10).u16(0); // METAHEADER
  b.u8(...body);
  b.u32(3).u16(0); // EOF
  return b.bytes;
}
const WMF_SAMPLE = wmf(
  wmfRec(0x020c, 100, 200), // SetWindowExt (y, x)
  wmfRec(0x020b, 0, 0), // SetWindowOrg
  wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0), // CreateBrushIndirect: solid red
  wmfRec(0x012d, 0), // SelectObject 0
  wmfRec(0x041b, 60, 110, 10, 10), // Rectangle bottom, right, top, left
  wmfRec(0x0324, 3, 20, 20, 90, 20, 55, 80), // Polygon, 3 points
);

// EMF: header (88 bytes), records, EOF.
const emfRec = (type: number, build: (b: B) => void) => { const b = new B(); b.u32(type, 0); build(b); b.pad4(); const a = b.a; a.splice(4, 4, ...new B().u32(a.length).a); return a; };
function emf(records: number[][]): Uint8Array {
  const h = new B();
  // 250 x 250 mm on 1000 x 1000 device pixels: 4 px per mm; the frame is 50 x 25 mm.
  h.u32(1, 88).u32(0, 0, 200, 100).u32(0, 0, 5000, 2500).u32(0x464d4520, 0x10000, 0, 0).u16(1, 0).u32(0, 0, 0).u32(1000, 1000, 250, 250);
  const body = records.flat();
  const eof = emfRec(14, (b) => b.u32(0, 16, 20));
  const all = [...h.a, ...body, ...eof];
  const out = new Uint8Array(all);
  new DataView(out.buffer).setUint32(48, out.length, true);
  return out;
}
const emfBrush = (slot: number, color: number) => emfRec(39, (b) => b.u32(slot, 0, color, 0));
const emfSelect = (slot: number) => emfRec(37, (b) => b.u32(slot));
const emfRect = (l: number, t: number, r: number, b2: number) => emfRec(43, (b) => b.u32(l, t, r, b2));
const emfFont = (slot: number, face: string, height: number) => emfRec(82, (b) => {
  b.u32(slot, height, 0, 0, 0, 400).u8(0, 0, 0, 0, 0, 0, 0, 0); // italic.. pitch
  const name = new B().utf16(face);
  while (name.length < 64) name.u8(0);
  b.u8(...name.a);
});
function emfTextW(x: number, y: number, text: string) {
  return emfRec(84, (b) => {
    b.u32(0, 0, 189, 94, 1, 0, 0); // bounds, graphics mode, scales
    b.u32(x, y, text.length, 76, 0, 0, 0, 0, 0, 0); // EmrText: ref, chars, string offset, options, rect(4), dx offset
    b.utf16(text);
  });
}

// EMF+ records ride in EMR_COMMENT.
const plusRec = (type: number, flags: number, build: (b: B) => void) => { const d = new B(); build(d); d.pad4(); return new B().u16(type, flags).u32(12 + d.length, d.length).u8(...d.a).a; };
const comment = (...recs: number[][]) => { const body = recs.flat(); return emfRec(70, (b) => b.u32(4 + body.length, 0x2b464d45).u8(...body)); };
const plusHeader = (dual: boolean) => plusRec(0x4001, dual ? 1 : 0, (b) => b.u32(0xdbc01002, 1, 96, 96));
const argb = (a: number, r: number, g: number, bl: number) => ((a << 24) | (r << 16) | (g << 8) | bl) >>> 0;
const plusFillRects = (color: number, x: number, y: number, w: number, h: number) => plusRec(0x400a, 0x8000, (b) => b.u32(color, 1).f32(x, y, w, h));

// ---- tests ---------------------------------------------------------------------------------

describe('WMF', () => {
  it('draws a filled rectangle and a polygon in the picture frame', () => {
    const r = metafileToSvg(WMF_SAMPLE);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('wmf');
    expect(r!.svg).toContain('viewBox="0 0 200 100"');
    expect(r!.svg).toContain('d="M10 10L110 10L110 60L10 60Z"');
    expect(r!.svg).toContain('fill="#ff0000"');
    expect(r!.svg).toContain('d="M20 20L90 20L55 80Z"');
    // 200 units at 100 per inch = 2 in = 192 px.
    expect(r!.width).toBeCloseTo(192, 5);
    expect(r!.height).toBeCloseTo(96, 5);
    expect(r!.items).toBe(2);
    expect(isMetafile(WMF_SAMPLE)).toBe(true);
  });

  it('draws text (Korean through the 949 code page) and ellipses', () => {
    const hangul = new Uint8Array([0xb0, 0xa1]); // 가 in EUC-KR / CP949
    const textOut = new B().u32(0).u16(0x0521, 2).u8(...hangul).u16(40, 20).a; // length, string, y, x
    textOut.splice(0, 4, ...new B().u32(textOut.length / 2).a);
    const font = new B().u32(0).u16(0x02fb).u16(-16, 0, 0, 0, 400).u8(0, 0, 0, 129, 0, 0, 0, 0);
    const name = new B().u8(...'Gulim'.split('').map((c) => c.charCodeAt(0))).u8(0);
    while (name.length < 32) name.u8(0);
    font.u8(...name.a);
    font.a.splice(0, 4, ...new B().u32(font.length / 2).a);
    const r = metafileToSvg(wmf(wmfRec(0x020c, 100, 200), wmfRec(0x020b, 0, 0), font.a, wmfRec(0x012d, 0), textOut, wmfRec(0x0418, 50, 150, 10, 100)));
    expect(r!.svg).toContain('>가</text>');
    expect(r!.svg).toContain('Gulim');
    expect(r!.svg).toContain('font-size="16"');
    expect(r!.svg).toContain('<path d="M150 30C');
  });
});

describe('EMF', () => {
  it('draws a filled rectangle and text', () => {
    const file = emf([
      emfBrush(1, BLUE), emfSelect(1), emfRect(10, 20, 110, 70),
      emfFont(2, 'Arial', -16), emfSelect(2),
      emfRec(24, (b) => b.u32(RED)), // text colour
      emfTextW(15, 30, 'Hello'),
    ]);
    const r = metafileToSvg(file);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('emf');
    expect(r!.svg).toContain('d="M10 20L110 20L110 70L10 70Z"');
    expect(r!.svg).toContain('fill="#0000ff"');
    expect(r!.svg).toMatch(/<text [^>]*font-size="16"[^>]*fill="#ff0000">Hello<\/text>/);
    expect(r!.svg).toContain('Arial');
    // The frame is 50 x 25 mm: 200 x 100 device pixels at 4 px/mm, shown at 96 dpi.
    expect(r!.svg).toContain('viewBox="0 0 200 100"');
    expect(r!.width).toBeCloseTo((50 / 25.4) * 96, 2);
  });

  it('maps through the window and viewport (anisotropic) and the world transform', () => {
    const file = emf([
      emfRec(17, (b) => b.u32(8)), // MM_ANISOTROPIC
      emfRec(9, (b) => b.u32(100, 100)), // window extent
      emfRec(11, (b) => b.u32(200, 400)), // viewport extent: x2, y4
      emfBrush(1, RED), emfSelect(1), emfRect(10, 10, 20, 20),
      emfRec(35, (b) => b.f32(1, 0, 0, 1, 5, 5)), // SetWorldTransform: translate 5, 5 (before the page mapping)
      emfRect(0, 0, 10, 10),
    ]);
    const r = metafileToSvg(file)!;
    expect(r.svg).toContain('d="M20 40L40 40L40 80L20 80Z"');
    expect(r.svg).toContain('d="M10 20L30 20L30 60L10 60Z"');
  });

  it('draws paths and polygons (16-bit points) with the current pen and brush', () => {
    const poly16 = emfRec(86, (b) => { b.u32(0, 0, 100, 100, 3).u16(10, 10, 60, 10, 35, 50); });
    const file = emf([
      emfBrush(1, RED), emfSelect(1), poly16,
      emfRec(59, () => undefined), emfRec(27, (b) => b.u32(5, 5)), emfRec(54, (b) => b.u32(50, 5)), emfRec(54, (b) => b.u32(50, 50)), emfRec(61, () => undefined), emfRec(60, () => undefined), emfRec(62, () => undefined),
    ]);
    const r = metafileToSvg(file)!;
    expect(r.svg).toContain('d="M10 10L60 10L35 50Z"');
    expect(r.svg).toContain('d="M5 5L50 5L50 50Z"');
  });

  it('draws a StretchDIBits picture as a PNG image', () => {
    // 2 x 2, 24-bit, bottom-up: bottom row red, blue; top row blue, red. Rows padded to 4 bytes.
    const bmi = new B().u32(40, 2, 2).u16(1, 24).u32(0, 16, 0, 0, 0, 0);
    const bits = new B().u8(0, 0, 255, 255, 0, 0, 0, 0).u8(255, 0, 0, 0, 0, 255, 0, 0);
    const rec = emfRec(81, (b) => {
      b.u32(0, 0, 0, 0); // bounds
      b.u32(10, 20); // dest x, y
      b.u32(0, 0, 2, 2); // source x, y, w, h
      b.u32(80, bmi.length, 80 + bmi.length, bits.length); // offsets and sizes
      b.u32(0, 0xcc0020, 40, 40); // usage, rop, dest w, h
      b.u8(...bmi.a, ...bits.a);
    });
    const r = metafileToSvg(emf([rec]))!;
    expect(r.svg).toMatch(/<image href="data:image\/png;base64,iVBORw0KGgo/);
    expect(r.svg).toContain('matrix(20 0 0 20 10 20)');
  });
});

describe('EMF+', () => {
  it('draws FillRects from an EMF+-only file', () => {
    const file = emf([comment(plusHeader(false), plusFillRects(argb(255, 0, 255, 0), 10, 20, 100, 50))]);
    const r = metafileToSvg(file)!;
    expect(r.format).toBe('emf+');
    expect(r.svg).toContain('d="M10 20L110 20L110 70L10 70Z"');
    expect(r.svg).toContain('fill="#00ff00"');
  });

  it('prefers EMF+ over the GDI fallback in a dual file, and plays GDI records only after GetDC', () => {
    const file = emf([
      comment(plusHeader(true), plusFillRects(argb(255, 0, 255, 0), 10, 20, 100, 50)),
      emfBrush(1, RED), emfSelect(1), emfRect(10, 20, 110, 70), // the fallback, ignored
      comment(plusRec(0x4004, 0, () => undefined)), // GetDC
      emfBrush(2, BLUE), emfSelect(2), emfRect(0, 0, 5, 5), // drawn
      comment(plusFillRects(argb(128, 255, 255, 0), 1, 1, 2, 2)),
      emfRect(30, 30, 40, 40), // GDI again, ignored
    ]);
    const svg = metafileToSvg(file)!.svg;
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).not.toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#0000ff"');
    expect(svg).toContain('fill="#ffff00" fill-opacity="0.502"');
    expect(svg).not.toContain('M30 30');
  });

  it('draws a path with a pen, a world transform and a string', () => {
    const penObj = plusRec(0x4008, (2 << 8) | 1, (b) => b.u32(0xdbc01002, 0, 0, 2).f32(3).u32(0xdbc01002, 0, argb(255, 255, 0, 0)));
    const pathObj = plusRec(0x4008, (3 << 8) | 2, (b) => {
      b.u32(0xdbc01002, 3, 0).f32(0, 0, 40, 0, 40, 40).u8(0, 1, 1 | 0x80);
    });
    const fontObj = plusRec(0x4008, (6 << 8) | 3, (b) => { b.u32(0xdbc01002).f32(12).u32(2, 0, 0, 3).utf16('Abc'); });
    const world = plusRec(0x402d, 0, (b) => b.f32(100, 50)); // translate
    const drawPath = plusRec(0x4015, 2, (b) => b.u32(1));
    const str = plusRec(0x401c, 3 | 0x8000, (b) => { b.u32(argb(255, 0, 0, 0), 0, 3).f32(0, 0, 100, 20).utf16('Hi!'); });
    const r = metafileToSvg(emf([comment(plusHeader(false), penObj, pathObj, fontObj, world, drawPath, str)]))!;
    expect(r.svg).toContain('d="M100 50L140 50L140 90Z"');
    expect(r.svg).toContain('stroke="#ff0000" stroke-width="3"');
    expect(r.svg).toMatch(/<text [^>]*translate\(100 [\d.]+\)[^>]*font-size="12"[^>]*>Hi!<\/text>/);
  });

  it('falls back to the GDI records when EMF+ draws nothing', () => {
    const file = emf([comment(plusHeader(true)), emfBrush(1, RED), emfSelect(1), emfRect(10, 20, 110, 70)]);
    const r = metafileToSvg(file)!;
    expect(r.format).toBe('emf');
    expect(r.svg).toContain('fill="#ff0000"');
  });
});

describe('hostile and broken input', () => {
  const samples: [string, Uint8Array][] = [
    ['wmf', WMF_SAMPLE],
    ['emf', emf([emfBrush(1, RED), emfSelect(1), emfRect(1, 2, 3, 4), emfFont(2, 'Arial', -12), emfSelect(2), emfTextW(1, 1, 'Hello')])],
    ['emf+', emf([comment(plusHeader(false), plusFillRects(argb(255, 1, 2, 3), 0, 0, 5, 5))])],
  ];

  it.each(samples)('never throws on a %s cut off anywhere or with bytes flipped', (_name, file) => {
    for (let n = 0; n < file.length; n++) expect(() => metafileToSvg(file.subarray(0, n))).not.toThrow();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (let k = 0; k < 300; k++) {
      const copy = Uint8Array.from(file);
      for (let i = 0; i < 4; i++) copy[Math.floor(rnd() * copy.length)] = Math.floor(rnd() * 256);
      expect(() => metafileToSvg(copy)).not.toThrow();
    }
  });

  it('returns null for garbage, empty and non-metafile input', () => {
    expect(metafileToSvg(new Uint8Array(0))).toBeNull();
    expect(metafileToSvg(new Uint8Array(500).fill(0xff))).toBeNull();
    expect(metafileToSvg(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    const noise = new Uint8Array(4096).map((_, i) => (i * 131 + 7) & 255);
    expect(() => metafileToSvg(noise)).not.toThrow();
    expect(isMetafile(noise)).toBe(false);
  });

  it('survives huge counts, sizes and offsets inside valid headers', () => {
    const bigPoly = emfRec(86, (b) => { b.u32(0, 0, 100, 100, 0x7fffffff).u16(1, 2); });
    const bigGroups = emfRec(91, (b) => { b.u32(0, 0, 100, 100, 0x7fffffff, 0x7fffffff).u32(5); });
    const hugeText = emfRec(84, (b) => { b.u32(0, 0, 1, 1, 1, 0, 0, 5, 5, 0x7fffffff, 76, 0, 0, 0, 0, 0, 0).utf16('x'); });
    const hugeBmp = emfRec(81, (b) => { b.u32(0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 80, 40, 120, 8, 0, 0xcc0020, 5, 5); b.u32(40, 0x7fffffff, 0x7fffffff).u16(1, 32).u32(0, 0, 0, 0, 0, 0); });
    const r = metafileToSvg(emf([emfBrush(1, RED), emfSelect(1), bigPoly, bigGroups, hugeText, hugeBmp, emfRect(1, 1, 9, 9)]));
    expect(r).not.toBeNull();
    expect(r!.svg).toContain('d="M1 1L9 1L9 9L1 9Z"');
    // A record whose size field points past the end of the file stops the read, keeping what came before.
    const truncated = emf([emfBrush(1, RED), emfSelect(1), emfRect(1, 1, 9, 9), emfRec(43, (b) => b.u32(0, 0, 1, 1))]);
    new DataView(truncated.buffer).setUint32(truncated.length - 20 - 24 + 4, 0x7ffffff0, true);
    expect(metafileToSvg(truncated)!.svg).toContain('d="M1 1L9 1L9 9L1 9Z"');
  });

  it('plays a large file of random records in bounded time', () => {
    const big = new Uint8Array(2_000_000);
    let seed = 99;
    for (let i = 0; i < big.length; i++) big[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    const head = emf([]).subarray(0, 88);
    big.set(head, 0);
    // Records of plausible type and size, random content.
    for (let pos = 88, n = 0; pos + 64 < big.length; pos += 64, n++) {
      const dv = new DataView(big.buffer);
      dv.setUint32(pos, [2, 3, 4, 7, 8, 27, 37, 38, 39, 42, 43, 44, 45, 59, 62, 64, 81, 84, 85, 86, 87, 90, 91, 95][n % 24], true);
      dv.setUint32(pos + 4, 64, true);
    }
    const t = Date.now();
    expect(() => metafileToSvg(big)).not.toThrow();
    expect(Date.now() - t).toBeLessThan(20000);
  });

  it('does not loop on a zero-length record or a record that moves backwards', () => {
    const wmfLoop = wmf(wmfRec(0x041b, 10, 10, 0, 0), new B().u32(0).u16(0x041b).a, wmfRec(0x041b, 20, 20, 0, 0));
    expect(() => metafileToSvg(wmfLoop)).not.toThrow();
    const emfLoop = emf([emfBrush(1, RED), new B().u32(43, 0).a]);
    expect(() => metafileToSvg(emfLoop)).not.toThrow();
  });
});

describe('pictures', () => {
  it('recognises metafile names and sniffs bytes', async () => {
    expect(isMetafileName('a.WMF')).toBe(true);
    expect(isMetafileName('b.emf')).toBe(true);
    expect(isMetafileName('c.png')).toBe(false);
    const blob = await pictureBlob(new Blob([WMF_SAMPLE as BlobPart]), 'x.wmf');
    expect(blob.type).toBe('image/svg+xml'); // no DOM in this test: SVG
    expect(await blob.text()).toContain('<svg');
    // Other pictures are left alone.
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/png' });
    expect(await pictureBlob(png)).toBe(png);
    // A metafile that cannot be read stays as it was.
    const bad = new Blob([new Uint8Array(100)]);
    expect(await pictureBlob(bad, 'bad.emf')).toBe(bad);
    expect(await metafileToBlob(new Uint8Array(10))).toBeNull();
  });

  it('keeps a PowerPoint clipboard picture that is an EMF instead of dropping it', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('clipboard/drawings/drawing1.xml', `<?xml version="1.0"?><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas><a:pic><a:nvPicPr><a:cNvPr id="6" name="Picture 5"/><a:cNvPicPr/></a:nvPicPr><a:blipFill><a:blip r:embed="rId1"/></a:blipFill><a:spPr><a:xfrm><a:off x="3175000" y="3175000"/><a:ext cx="1905000" cy="1270000"/></a:xfrm></a:spPr></a:pic></lc:lockedCanvas></a:graphicData></a:graphic>`);
    zip.file('clipboard/drawings/_rels/drawing1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.wmf"/></Relationships>');
    zip.file('clipboard/media/image1.emf', emf([emfBrush(1, RED), emfSelect(1), emfRect(1, 1, 9, 9)]));
    zip.file('clipboard/media/image2.wmf', new Uint8Array(40)); // unreadable: skipped
    const r = await readGvml(await zip.generateAsync({ type: 'uint8array' }), () => 'm1');
    expect(r!.media).toHaveLength(1);
    expect(r!.media[0].blob.type).toBe('image/svg+xml');
    expect(r!.media[0].name).toBe('image1.svg');
    expect(r!.elements[0]).toMatchObject({ kind: 'image', mediaId: 'm1' });
  });
});
