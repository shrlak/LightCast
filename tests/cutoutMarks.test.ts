// 배경 제거: the marks are kept with the picture (PictureAdjust.cutoutMarks) and come back when the dialog reopens.
import { describe, expect, it } from 'vitest';
import { BG_TOLERANCE_DEFAULT, packMarks, paintMarks, unpackMarks, type Mark } from '../src/domain/backgroundMarks';
import { resetPicturePatch } from '../src/domain/pictureFormat';
import type { CutoutMarks, SlideElement } from '../src/domain/types';

const wiggle = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [100 + i * 0.5, 50 + Math.sin(i / 5) * 20] as [number, number]);

describe('keeping the marks', () => {
  const marks: Mark[] = [
    { kind: 'keep', points: [[200, 100], [220, 120], [260, 160]], radius: 12 },
    { kind: 'remove', points: [[10, 10]], radius: 5 },
  ];
  it('round-trips marks, tolerance and brush size at any picture size', () => {
    const packed = packMarks(marks, 400, 300, 42);
    expect(packed.tol).toBe(42);
    expect(packed.strokes.map((s) => s.k)).toEqual(['k', 'r']);
    const same = unpackMarks(packed, 400, 300);
    expect(same.tolerance).toBe(42);
    same.marks.forEach((m, i) => {
      expect(m.kind).toBe(marks[i].kind);
      expect(m.radius).toBeCloseTo(marks[i].radius, 0);
      m.points.forEach((p, j) => { expect(p[0]).toBeCloseTo(marks[i].points[j][0], 0); expect(p[1]).toBeCloseTo(marks[i].points[j][1], 0); });
    });
    // The same marks on a picture twice as big land at twice the pixels (they are stored relative to the picture).
    const big = unpackMarks(packed, 800, 600);
    expect(big.marks[0].points[2][0]).toBeCloseTo(520, 0);
    expect(big.marks[0].radius).toBeCloseTo(24, 0);
  });
  it('gives the same painted pixels back (marks survive reopening)', () => {
    const packed = packMarks(marks, 400, 300, 30);
    const back = unpackMarks(packed, 400, 300).marks;
    const a = paintMarks(400, 300, marks), b = paintMarks(400, 300, back);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    expect(diff / a.length).toBeLessThan(0.01);
  });
  it('is compact: a long drag is thinned, ends are kept, and the result is plain JSON of whole numbers', () => {
    const long: Mark = { kind: 'remove', points: wiggle(800), radius: 9 };
    const packed = packMarks([long], 1000, 800, 30);
    expect(packed.strokes[0].p.length).toBeLessThan(long.points.length * 2 * 0.6);
    expect(packed.strokes[0].p.every(Number.isInteger)).toBe(true);
    expect(JSON.stringify(packed).length).toBeLessThan(4500);
    expect(packed.strokes[0].p.slice(0, 2)).toEqual([Math.round((100 / 1000) * 1000), Math.round((long.points[0][1] / 800) * 1000)]);
    const last = long.points[long.points.length - 1];
    expect(packed.strokes[0].p.slice(-2)).toEqual([Math.round((last[0] / 1000) * 1000), Math.round((last[1] / 800) * 1000)]);
  });
  it('survives being stored as JSON, and skips malformed strokes', () => {
    const packed = JSON.parse(JSON.stringify(packMarks(marks, 400, 300, 55))) as CutoutMarks;
    expect(unpackMarks(packed, 400, 300).marks).toHaveLength(2);
    const bad = { tol: Number.NaN, strokes: [{ k: 'x', r: 1, p: [1, 2] }, { k: 'k', r: 5, p: [] }, { k: 'k', r: Number.NaN, p: [1, 1] }, { k: 'r', r: 50, p: [500, 500, 'a', 3] }] } as unknown as CutoutMarks;
    const r = unpackMarks(bad, 100, 100);
    expect(r.tolerance).toBe(BG_TOLERANCE_DEFAULT);
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0].points).toEqual([[50, 50]]);
    expect(unpackMarks(undefined, 10, 10)).toEqual({ marks: [], tolerance: BG_TOLERANCE_DEFAULT });
  });
  it('keeps the strokes when none were drawn (only the tolerance)', () => {
    expect(packMarks([], 100, 100, 70)).toEqual({ tol: 70, strokes: [] });
  });
});

describe('그림 원래대로', () => {
  it('brings back the original file and drops the adjustments with their marks', () => {
    const el = { id: 'e', kind: 'image', mediaId: 'cut', picture: { original: 'orig', cutout: 'cut', cutoutMarks: { tol: 30, strokes: [] } } } as unknown as SlideElement;
    const next = { ...el, ...resetPicturePatch(el) };
    expect(next.mediaId).toBe('orig');
    expect(next.picture).toBeUndefined();
    expect(resetPicturePatch({ picture: undefined })).not.toHaveProperty('mediaId');
  });
});
