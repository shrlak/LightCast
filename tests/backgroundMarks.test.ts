import { describe, expect, it } from 'vitest';
import { brushRadius, paintMarks, removeBackgroundByMarks, toleranceToStep, toPicturePoint, type Mark } from '../src/domain/backgroundMarks';

/** w x h picture filled with `bg`, with a `fg` rectangle at (x0,y0)-(x1,y1) exclusive. */
function picture(w: number, h: number, bg: number[], fg: number[], x0: number, y0: number, x1: number, y1: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = x >= x0 && x < x1 && y >= y0 && y < y1 ? fg : bg;
    d.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return d;
}
const alpha = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

describe('removeBackgroundByMarks', () => {
  it('without marks the background that touches the border goes, the subject stays', () => {
    const d = picture(20, 20, [255, 255, 255], [200, 30, 30], 6, 6, 14, 14);
    const r = removeBackgroundByMarks(d, 20, 20, 30);
    expect(alpha(r.rgba, 20, 0, 0)).toBe(0);
    expect(alpha(r.rgba, 20, 19, 10)).toBe(0);
    expect(alpha(r.rgba, 20, 10, 10)).toBe(255);
    expect(r.count).toBe(20 * 20 - 8 * 8 - 0);
  });
  it('the input picture is left untouched', () => {
    const d = picture(10, 10, [255, 255, 255], [0, 0, 0], 3, 3, 7, 7);
    const before = Array.from(d);
    removeBackgroundByMarks(d, 10, 10, 30);
    expect(Array.from(d)).toEqual(before);
  });
  it('a background pocket enclosed by the subject stays until it is marked for removal', () => {
    // A red ring (x,y 4..16) with a white hole in the middle.
    const d = picture(20, 20, [255, 255, 255], [200, 30, 30], 4, 4, 16, 16);
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) d.set([255, 255, 255, 255], (y * 20 + x) * 4);
    expect(alpha(removeBackgroundByMarks(d, 20, 20, 30).rgba, 20, 10, 10)).toBe(255);
    const marks: Mark[] = [{ kind: 'remove', points: [[10, 10]], radius: 1 }];
    const r = removeBackgroundByMarks(d, 20, 20, 30, marks);
    expect(alpha(r.rgba, 20, 10, 10)).toBe(0);
    expect(alpha(r.rgba, 20, 5, 5)).toBe(255);
    // The border is not a seed once something is marked for removal, so the outside stays too.
    expect(alpha(r.rgba, 20, 0, 0)).toBe(255);
  });
  it('a keep mark protects a part that looks like the background', () => {
    // White shirt (6..10) on a white wall, next to a dark subject (10..14).
    const d = picture(20, 20, [250, 250, 250], [20, 20, 20], 10, 4, 14, 16);
    const without = removeBackgroundByMarks(d, 20, 20, 30);
    expect(alpha(without.rgba, 20, 8, 10)).toBe(0);
    const keep: Mark[] = [{ kind: 'keep', points: [[8, 10]], radius: 2 }];
    const r = removeBackgroundByMarks(d, 20, 20, 30, keep);
    expect(alpha(r.rgba, 20, 8, 10)).toBe(255);
    expect(alpha(r.rgba, 20, 0, 0)).toBe(0);
  });
  it('a higher tolerance removes more of a gradient', () => {
    const w = 20, h = 4, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([x * 8, x * 8, x * 8, 255], (y * w + x) * 4);
    // A mark on the left edge is the only seed; steps of ~14 between neighbours.
    const seed: Mark[] = [{ kind: 'remove', points: [[0, 2]], radius: 3 }];
    const low = removeBackgroundByMarks(d, w, h, 5, seed), high = removeBackgroundByMarks(d, w, h, 40, seed);
    expect(high.count).toBeGreaterThan(low.count);
    expect(toleranceToStep(0)).toBe(0);
    expect(toleranceToStep(100)).toBe(120);
  });
  it('pixels that are already transparent count as removed', () => {
    const d = picture(10, 10, [10, 200, 10], [10, 200, 10], 0, 0, 0, 0);
    d[(5 * 10 + 5) * 4 + 3] = 0;
    const r = removeBackgroundByMarks(d, 10, 10, 0);
    expect(r.removed[5 * 10 + 5]).toBe(1);
  });
  it('the cut edge of the subject is softened', () => {
    const d = picture(20, 20, [255, 255, 255], [0, 0, 0], 6, 6, 14, 14);
    const r = removeBackgroundByMarks(d, 20, 20, 30);
    expect(alpha(r.rgba, 20, 6, 10)).toBeLessThan(255);
    expect(alpha(r.rgba, 20, 6, 10)).toBeGreaterThan(0);
  });
});

describe('marks', () => {
  it('a brush stroke paints a continuous band and later marks win', () => {
    const m = paintMarks(30, 10, [{ kind: 'keep', points: [[3, 5], [25, 5]], radius: 2 }, { kind: 'remove', points: [[15, 5]], radius: 1 }]);
    expect(m[5 * 30 + 10]).toBe(1);
    expect(m[5 * 30 + 15]).toBe(2);
    expect(m[0]).toBe(0);
  });
  it('maps canvas points to picture pixels inside the picture', () => {
    expect(toPicturePoint(50, 25, 100, 50, 400, 200)).toEqual([200, 100]);
    expect(toPicturePoint(-5, 999, 100, 50, 400, 200)).toEqual([0, 199]);
    expect(brushRadius(400, 200, 10)).toBe(5);
    expect(brushRadius(10, 10, 1)).toBe(2);
  });
});
