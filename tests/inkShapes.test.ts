import { describe, expect, it } from 'vitest';
import { recognizeStroke, type Pt } from '../src/domain/inkShapes';

/** A hand-drawn run along the corners: sampled every ~4px with a little wobble. */
function trace(corners: Pt[], closed: boolean, wobble = 1.5): Pt[] {
  const out: Pt[] = [];
  const n = corners.length;
  const segs = closed ? n : n - 1;
  let k = 0;
  for (let i = 0; i < segs; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    const steps = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t + Math.sin(k * 1.7) * wobble, a[1] + (b[1] - a[1]) * t + Math.cos(k * 2.3) * wobble]);
      k++;
    }
  }
  out.push(closed ? [out[0][0] + 3, out[0][1] + 2] : [corners[n - 1][0], corners[n - 1][1]]);
  return out;
}
const ellipse = (cx: number, cy: number, a: number, b: number): Pt[] =>
  Array.from({ length: 80 }, (_, i) => [cx + a * Math.cos((i / 80) * 2 * Math.PI) + Math.sin(i) * 1.2, cy + b * Math.sin((i / 80) * 2 * Math.PI)] as Pt).concat([[cx + a, cy + 2]]);

describe('recognizeStroke', () => {
  it('a straight stroke is a line, in either direction', () => {
    expect(recognizeStroke(trace([[100, 100], [500, 160]], false))?.kind).toBe('line');
    const r = recognizeStroke(trace([[500, 400], [100, 120]], false));
    expect(r).toMatchObject({ kind: 'line' });
    if (r?.kind === 'line') { expect(r.x0).toBeCloseTo(500, -1); expect(r.y0).toBeCloseTo(400, -1); }
  });
  it('a closed square-cornered loop is a rectangle with its bounding box', () => {
    const r = recognizeStroke(trace([[100, 100], [500, 100], [500, 300], [100, 300]], true));
    expect(r?.kind).toBe('rect');
    if (r?.kind === 'rect') { expect(r.w).toBeGreaterThan(380); expect(r.h).toBeGreaterThan(180); }
  });
  it('a round loop is an ellipse', () => {
    expect(recognizeStroke(ellipse(300, 300, 200, 120))?.kind).toBe('ellipse');
    expect(recognizeStroke(ellipse(300, 300, 150, 150))?.kind).toBe('ellipse');
  });
  it('an upright three-corner loop is a triangle, an upside-down one is flipped', () => {
    expect(recognizeStroke(trace([[300, 100], [500, 400], [100, 400]], true))).toMatchObject({ kind: 'triangle', flipV: false });
    expect(recognizeStroke(trace([[100, 100], [500, 100], [300, 400]], true))).toMatchObject({ kind: 'triangle', flipV: true });
  });
  it('a lopsided three-corner loop is a polygon', () => {
    const r = recognizeStroke(trace([[100, 100], [520, 330], [150, 420]], true));
    expect(r?.kind).toBe('polygon');
  });
  it('a pentagon and a hexagon are polygons with that many corners', () => {
    const reg = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [400 + 200 * Math.cos((i / n) * 2 * Math.PI - Math.PI / 2), 400 + 200 * Math.sin((i / n) * 2 * Math.PI - Math.PI / 2)] as Pt);
    const p5 = recognizeStroke(trace(reg(5), true));
    expect(p5?.kind).toBe('polygon');
    if (p5?.kind === 'polygon') expect(p5.points).toHaveLength(5);
    const p6 = recognizeStroke(trace(reg(6), true));
    expect(p6?.kind).toBe('polygon');
    if (p6?.kind === 'polygon') expect(p6.points).toHaveLength(6);
  });
  it('a tilted square is a polygon, not an upright rectangle', () => {
    const r = recognizeStroke(trace([[300, 100], [500, 300], [300, 500], [100, 300]], true));
    expect(r?.kind).toBe('polygon');
  });
  it('a shaft with a head swept back is an arrow pointing at the tip', () => {
    const r = recognizeStroke(trace([[100, 300], [500, 300], [440, 250], [500, 300], [440, 350]], false, 1));
    expect(r?.kind).toBe('arrow');
    if (r?.kind === 'arrow') { expect(r.x1).toBeGreaterThan(490); expect(Math.abs(r.y1 - 300)).toBeLessThan(10); }
  });
  it('scribbles and tiny marks stay ink', () => {
    expect(recognizeStroke([[0, 0], [3, 3], [5, 1], [6, 6]])).toBeNull();
    const squiggle: Pt[] = Array.from({ length: 60 }, (_, i) => [i * 8, Math.sin(i / 2) * 60] as Pt);
    expect(recognizeStroke(squiggle)).toBeNull();
  });
});
