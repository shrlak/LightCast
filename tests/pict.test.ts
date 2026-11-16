import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pictToImage } from '../src/domain/io/pict';
import { inflateZlib } from '../src/domain/io/inflate';
import { parsePpt } from '../src/domain/io/pptBinary';
import { buildPpt } from './fixtures/pptBuilder';

// PICT files written by ImageMagick 6 (see tests/fixtures/pict/README.md); *.raw are the expected RGB pixels.
const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/pict/${name}`, import.meta.url)));

/** Pixels of an unfiltered RGB PNG (what the reader's encoder writes). */
function pngRgb(png: Uint8Array): { w: number; h: number; rgb: Uint8Array } {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (o + 8 <= png.length) {
    const len = v.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') { w = v.getUint32(o + 8); h = v.getUint32(o + 12); expect(png[o + 17]).toBe(2); }
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const z = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of idat) { z.set(p, k); k += p.length; }
  const raw = inflateZlib(z, 1 << 24)!;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) rgb.set(raw.subarray(y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1)), y * w * 3);
  return { w, h, rgb };
}

const maxDiff = (a: Uint8Array, b: Uint8Array) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

describe('QuickDraw PICT v2', () => {
  it('reads a 32-bit DirectBitsRect picture (PackBits planes)', () => {
    const img = pictToImage(load('rgb.pict'))!;
    expect(img.mime).toBe('image/png');
    const { w, h, rgb } = pngRgb(img.bytes);
    expect([w, h]).toEqual([40, 30]);
    expect(maxDiff(rgb, load('rgb.raw'))).toBeLessThanOrEqual(1);
  });

  it('reads an 8-bit PackBitsRect picture with its colour table', () => {
    const { w, h, rgb } = pngRgb(pictToImage(load('pal.pict'))!.bytes);
    expect([w, h]).toEqual([40, 30]);
    expect(maxDiff(rgb, load('pal.raw'))).toBeLessThanOrEqual(1);
  });

  it('reads a 1-bit picture', () => {
    const { w, h, rgb } = pngRgb(pictToImage(load('mono.pict'))!.bytes);
    expect([w, h]).toEqual([37, 9]);
    const at = (x: number, y: number) => rgb[(y * w + x) * 3];
    expect(at(0, 0)).toBe(255);
    expect(at(10, 4)).toBe(0);
    expect(at(30, 4)).toBe(255);
  });

  it('keeps a JPEG wrapped in a QuickTime opcode as it is', () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9];
    const qt = [...new Array(20).fill(0), ...jpeg];
    const body = [0x00, 0x11, 0x02, 0xff, 0x0c, 0x00, ...new Array(24).fill(0), 0x82, 0x00, 0, 0, 0, qt.length, ...qt, ...(qt.length % 2 ? [0] : []), 0x00, 0xff];
    const pict = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 10, 0, 10, ...body]);
    const img = pictToImage(pict)!;
    expect(img.mime).toBe('image/jpeg');
    expect([...img.bytes]).toEqual(jpeg);
  });

  it('draws filled rectangles in the foreground colour', () => {
    // frame 0,0-10,10; RGBFgCol red; PaintRect 2,2-6,6.
    const body = [0x00, 0x11, 0x02, 0xff, 0x0c, 0x00, ...new Array(24).fill(0), 0x00, 0x1a, 0xff, 0xff, 0, 0, 0, 0, 0x00, 0x31, 0, 2, 0, 2, 0, 6, 0, 6, 0x00, 0xff];
    const { w, rgb } = pngRgb(pictToImage(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 10, 0, 10, ...body]))!.bytes);
    const px = (x: number, y: number) => [...rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
    expect(px(3, 3)).toEqual([255, 0, 0]);
    expect(px(8, 8)).toEqual([255, 255, 255]);
  });

  it('is read from a .ppt PICT blip (deflated, after the 512-byte file header) as a PNG picture', () => {
    const doc = parsePpt(buildPpt({ pictures: [{ type: 'pict', bytes: [...load('rgb.pict')] }], slides: [{ shapes: [{ picture: 1, anchor: [0, 0, 400, 300] }] }] }));
    expect(doc.pictures[0]?.mime).toBe('image/png');
    expect(pngRgb(doc.pictures[0]!.bytes).w).toBe(40);
    expect(doc.slides[0].shapes[0]).toMatchObject({ kind: 'picture', picture: 1 });
  });

  it('never throws on damaged data', () => {
    const b = load('rgb.pict');
    for (const cut of [0, 10, 600, 700, b.length - 3]) expect(() => pictToImage(b.subarray(0, cut))).not.toThrow();
    expect(pictToImage(new Uint8Array(3))).toBeNull();
  });
});
