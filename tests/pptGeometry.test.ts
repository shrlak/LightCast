import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateGeometry, makeEvaluator, readGuides } from '../src/domain/io/pptGeometry';
import { importPpt } from '../src/domain/io/pptImport';

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/ppt/${name}`, import.meta.url)));

/** An IMsoArray: count, allocated, element size, then the elements. */
function arr(size: number, elems: number[][]): Uint8Array {
  const per = size === 0xfff0 ? 4 : size;
  const out = new Uint8Array(6 + elems.length * per);
  const v = new DataView(out.buffer);
  v.setUint16(0, elems.length, true); v.setUint16(2, elems.length, true); v.setUint16(4, size, true);
  elems.forEach((e, i) => e.forEach((x, k) => (per === 8 || per === 4 && false ? v.setInt32(6 + i * per + k * 4, x, true) : v.setInt16(6 + i * per + k * 2, x, true))));
  return out;
}
const segs = (list: number[]) => { const o = new Uint8Array(6 + list.length * 2); const v = new DataView(o.buffer); v.setUint16(0, list.length, true); v.setUint16(2, list.length, true); v.setUint16(4, 2, true); list.forEach((s, i) => v.setUint16(6 + i * 2, s, true)); return o; };
const guides = (list: { op: number; a?: number; b?: number; c?: number; ref?: string }[]) => {
  const o = new Uint8Array(6 + list.length * 8); const v = new DataView(o.buffer);
  v.setUint16(0, list.length, true); v.setUint16(2, list.length, true); v.setUint16(4, 8, true);
  list.forEach((g, i) => {
    const r = g.ref ?? '';
    v.setUint16(6 + i * 8, g.op | (r.includes('a') ? 0x2000 : 0) | (r.includes('b') ? 0x4000 : 0) | (r.includes('c') ? 0x8000 : 0), true);
    v.setInt16(6 + i * 8 + 2, g.a ?? 0, true); v.setInt16(6 + i * 8 + 4, g.b ?? 0, true); v.setInt16(6 + i * 8 + 6, g.c ?? 0, true);
  });
  return o;
};

describe('Escher guide formulas', () => {
  const ev = (list: Parameters<typeof guides>[0], adjust: number[] = []) => makeEvaluator(readGuides(guides(list)), { adjust }, { left: 0, top: 0, right: 21600, bottom: 21600 });

  it('evaluates every operation of MS-ODRAW', () => {
    const e = ev([
      { op: 0, a: 10, b: 5, c: 3 },                 // 0 sum a+b-c = 12
      { op: 1, a: 6, b: 7, c: 2 },                  // 1 product a*b/c = 21
      { op: 2, a: 10, b: 20 },                      // 2 mid = 15
      { op: 3, a: -9 },                             // 3 abs = 9
      { op: 4, a: 4, b: 9 },                        // 4 min = 4
      { op: 5, a: 4, b: 9 },                        // 5 max = 9
      { op: 6, a: 1, b: 11, c: 22 },                // 6 if = 11
      { op: 6, a: -1, b: 11, c: 22 },               // 7 if = 22
      { op: 7, a: 3, b: 4, c: 12 },                 // 8 mod = 13
      { op: 8, a: 1, b: 1 },                        // 9 atan2 = 45 degrees (16.16)
      { op: 9, a: 100, b: 0x400 + 21, ref: 'b' },   // 10 sin(30 degrees) = 50
      { op: 10, a: 100, b: 0x400 + 22, ref: 'b' },  // 11 cos(60 degrees) = 50
      { op: 11, a: 100, b: 1, c: 1 },               // 12 cosatan2 = 70.7
      { op: 12, a: 100, b: 1, c: 1 },               // 13 sinatan2 = 70.7
      { op: 13, a: 144 },                           // 14 sqrt = 12
      { op: 14, a: 0, b: 70, c: 0 },                // 15 sumangle = 70 degrees (16.16)
      { op: 15, a: 3, b: 5, c: 10 },                // 16 ellipse = 10 * sqrt(1 - 9/25) = 8
      { op: 16, a: 100, b: 0x400 + 23, ref: 'b' },  // 17 tan(45 degrees) = 100
      { op: 0x80, a: 77 },                          // 18 val
      { op: 0, a: 0x400 + 0, b: 0x400 + 1, c: 0, ref: 'ab' }, // 19 g0 + g1 = 33 (references)
      { op: 1, a: 0x147, b: 2, c: 4, ref: 'a' },    // 20 adjust1 * 2 / 4
      { op: 14, a: 0, b: 30, c: 0 },                // 21 30 degrees
      { op: 14, a: 0, b: 60, c: 0 },                // 22 60 degrees
      { op: 14, a: 0, b: 45, c: 0 },                // 23 45 degrees
    ], [1000]);
    const want = [12, 21, 15, 9, 4, 9, 11, 22, 13, 45 * 65536, 50, 50, 70.71, 70.71, 12, 70 * 65536, 8, 100, 77, 33, 500];
    want.forEach((w, i) => expect(e(i)).toBeCloseTo(w, i === 9 || i === 15 ? -1 : 1));
  });

  it('survives reference cycles and unknown operations', () => {
    const e = ev([{ op: 0, a: 0x401, ref: 'a' }, { op: 0, a: 0x400, ref: 'a' }, { op: 99, a: 5 }]);
    expect(Number.isFinite(e(0))).toBe(true);
    expect(e(2)).toBe(0);
  });
});

describe('custom geometry paths', () => {
  it('formula points: r = adjust1, the rectangle between r and 21600 - r', () => {
    const g = guides([{ op: 0, a: 0x147, ref: 'a' }, { op: 0, a: 21600, c: 0x400, ref: 'c' }]); // g0 = r, g1 = 21600 - r
    const F = (i: number) => -32768 + i; // formula reference (high bit) to guide i
    const v = arr(4, [[F(0), 0], [F(1), 0], [F(1), 21600], [F(0), 21600]]);
    const r = evaluateGeometry({ vertices: v, segments: segs([0x4000, 0x0003, 0x6001, 0x8000]), guides: g, adjust: [3600] });
    expect(r).not.toBeNull();
    // No stated space: the extent of the points, so the path starts at the origin.
    expect(r!.path).toBe('M0 0L14400 0L14400 21600L0 21600Z');
    expect([r!.left, r!.top, r!.w, r!.h]).toEqual([3600, 0, 14400, 21600]);
    expect(r!.guessedSpace).toBe(true);
  });

  it('draws a stated geometry rectangle as the space', () => {
    const v = arr(4, [[0, 0], [100, 0], [100, 50]]);
    const r = evaluateGeometry({ vertices: v, segments: segs([0x4000, 0x0002, 0x6001, 0x8000]), adjust: [], rect: { left: 0, top: 0, right: 200, bottom: 100 } });
    expect(r).toMatchObject({ path: 'M0 0L100 0L100 50Z', w: 200, h: 100, guessedSpace: false });
  });

  it('ANGLEELLIPSE: a full circle as four quarter arcs', () => {
    // centre (100, 100), radii (50, 50), from 0 to 360 degrees (angles as 16.16 fixed in the point's x and y).
    const v = new Uint8Array(6 + 3 * 8);
    const dv = new DataView(v.buffer);
    dv.setUint16(0, 3, true); dv.setUint16(2, 3, true); dv.setUint16(4, 8, true);
    [[100, 100], [50, 50], [0, 359 * 65536]].forEach(([x, y], i) => { dv.setInt32(6 + i * 8, x, true); dv.setInt32(6 + i * 8 + 4, y, true); });
    const r = evaluateGeometry({ vertices: v, segments: segs([0xa201, 0x8000]), adjust: [] });
    expect(r).not.toBeNull();
    expect(r!.path.startsWith('M100 50A50 50 0 0 1')).toBe(true);
    expect((r!.path.match(/A/g) ?? []).length).toBe(4);
    expect(r!.w).toBeCloseTo(100, 0);
    expect(r!.h).toBeCloseTo(100, 0);
  });

  it('ARC escapes: clockwise draws the short way, counter-clockwise the long way round', () => {
    // Box (0,0)-(100,50); from the point right of centre to the point below it.
    const pts = [[0, 0], [100, 50], [100, 25], [50, 50]];
    const b = new Uint8Array(6 + pts.length * 8);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, pts.length, true); dv.setUint16(2, pts.length, true); dv.setUint16(4, 8, true);
    pts.forEach(([x, y], i) => { dv.setInt32(6 + i * 8, x, true); dv.setInt32(6 + i * 8 + 4, y, true); });
    const cw = evaluateGeometry({ vertices: b, segments: segs([0xa601, 0x8000]), adjust: [] });
    expect(cw).not.toBeNull();
    expect(cw!.path).toMatch(/^M100 25A50 25 0 0 1 50 50$/);
    const ccw = evaluateGeometry({ vertices: b, segments: segs([0xa401, 0x8000]), adjust: [] });
    expect(ccw).not.toBeNull();
    expect((ccw!.path.match(/A/g) ?? []).length).toBe(3);
    expect(ccw!.path.endsWith('50 50')).toBe(true);
  });

  it('refuses damaged arrays without throwing', () => {
    expect(evaluateGeometry({ vertices: new Uint8Array(3), adjust: [] })).toBeNull();
    expect(evaluateGeometry({ vertices: arr(4, [[1, 1]]), segments: segs([0x0005, 0x8000]), adjust: [] })).toBeNull();
  });
});

describe('presets written by LibreOffice as custom geometry', () => {
  it('are recognised from their formulas and keep their adjust values', async () => {
    let n = 0;
    const r = await importPpt(load('libreoffice-presets.ppt'), 'p', { group: 'g', newId: (p) => `${p}${++n}`, store: async () => 'm' });
    const els = r.slides.flatMap((s) => s.elements ?? []);
    expect(els.map((e) => e.shape)).toEqual(['roundRect', 'triangle', 'star5', 'rightArrow', 'heart', 'blockArc', 'wave', 'chevron']);
    expect(els[0].adj).toEqual([16667]);
    expect(els[2].adj).toEqual([19098, 105146, 110557]);
    // python-pptx put them on a 2.35 inch grid, 2 inches wide: 144 px per inch.
    expect(els[0]).toMatchObject({ x: 58, w: 288 });
    expect(r.warnings).toEqual([]);
  });
});
