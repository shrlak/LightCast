// 그림 서식 › 배경 제거 (Remove Background) with marks: the person paints "유지할 영역 표시" (keep) and
// "제거할 영역 표시" (remove) strokes on the picture and the rest is decided by colour. Pure pixel
// logic (RGBA in, RGBA out), so it is testable without a canvas.
//
// Method: the marked pixels are seeds of two competing regions, kept and removed. Both grow over
// neighbouring pixels in order of colour step (a bucket queue, so the cheapest step goes first); a
// pixel joins the region that reaches it first, as long as the largest colour step on the way is at
// most the tolerance. Pixels the removal region reaches become transparent; everything else stays.
// With no remove mark at all the picture's border is the removal seed (the usual "background touches
// the edge" case), so the first preview needs no work from the person.

import type { CutoutMarks } from './types';

export type MarkKind = 'keep' | 'remove';
export interface Mark { kind: MarkKind; /** Brush centres in picture pixels (a click is one point). */ points: [number, number][]; /** Brush radius in picture pixels. */ radius: number }

export const BG_TOLERANCE_MIN = 0, BG_TOLERANCE_MAX = 100, BG_TOLERANCE_DEFAULT = 30;
export const BG_MARK_LABEL: Record<MarkKind, string> = { keep: '유지할 영역 표시', remove: '제거할 영역 표시' };

/** Largest colour step (0..441) a tolerance of 0-100 % allows. */
export const toleranceToStep = (tolerance: number) => Math.round(Math.max(0, Math.min(100, tolerance)) * 1.2);

/** Pixels covered by the brush marks: 1 = keep, 2 = remove, 0 = unmarked (later marks win). */
export function paintMarks(w: number, h: number, marks: Mark[]): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const m of marks) {
    const v = m.kind === 'keep' ? 1 : 2, r = Math.max(0.5, m.radius), r2 = r * r;
    const stamp = (cx: number, cy: number) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) out[y * w + x] = v;
        }
      }
    };
    m.points.forEach((p, i) => {
      stamp(p[0], p[1]);
      // Fill the gap to the previous point so a fast drag leaves no holes.
      if (i) {
        const q = m.points[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / Math.max(1, r / 2));
        for (let k = 1; k < n; k++) stamp(q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n);
      }
    });
  }
  return out;
}

export interface BackgroundResult {
  /** 1 where the pixel is removed (made transparent). */
  removed: Uint8Array;
  /** The picture with the removed pixels transparent (and the cut edge softened). */
  rgba: Uint8ClampedArray;
  /** How many pixels were removed. */
  count: number;
}

/**
 * Remove the background of an RGBA picture. `tolerance` is 0-100 (higher removes more); `marks`
 * are the brush strokes (picture pixels). Pixels already transparent count as removed.
 */
export function removeBackgroundByMarks(rgba: Uint8ClampedArray, w: number, h: number, tolerance: number, marks: Mark[] = []): BackgroundResult {
  const n = w * h, limit = toleranceToStep(tolerance);
  const mark = paintMarks(w, h, marks);
  const label = new Uint8Array(n); // 0 unreached, 1 keep, 2 remove
  const cost = new Uint16Array(n);
  const hasRemove = mark.includes(2);
  const queue: number[][] = Array.from({ length: 443 }, () => []);
  const push = (i: number, c: number, l: number) => { if (!label[i]) { label[i] = l; cost[i] = c; queue[c].push(i); } };
  const transparent = (i: number) => rgba[i * 4 + 3] < 8;
  for (let i = 0; i < n; i++) {
    if (mark[i] === 1) push(i, 0, 1);
    else if (mark[i] === 2 || transparent(i)) push(i, 0, 2);
  }
  if (!hasRemove) {
    for (let x = 0; x < w; x++) { if (mark[x] !== 1) push(x, 0, 2); if (mark[(h - 1) * w + x] !== 1) push((h - 1) * w + x, 0, 2); }
    for (let y = 0; y < h; y++) { if (mark[y * w] !== 1) push(y * w, 0, 2); if (mark[y * w + w - 1] !== 1) push(y * w + w - 1, 0, 2); }
  }
  const step = (a: number, b: number) => {
    const dr = rgba[a * 4] - rgba[b * 4], dg = rgba[a * 4 + 1] - rgba[b * 4 + 1], db = rgba[a * 4 + 2] - rgba[b * 4 + 2];
    return Math.round(Math.sqrt(dr * dr + dg * dg + db * db));
  };
  // The queue holds entries labelled when pushed; a pixel is claimed by whichever region pops it first.
  const done = new Uint8Array(n);
  for (let c = 0; c <= 442; c++) {
    const bucket = queue[c];
    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k];
      if (done[i]) continue;
      done[i] = 1;
      const x = i % w, y = (i - x) / w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || label[j]) continue;
        const cc = Math.max(c, step(i, j));
        if (cc > limit) continue;
        label[j] = label[i]; cost[j] = cc; queue[cc].push(j);
      }
    }
  }
  const removed = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (label[i] === 2) { removed[i] = 1; count++; }
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < n; i++) {
    if (removed[i]) { out[i * 4 + 3] = 0; continue; }
    // Soften the cut: a kept pixel beside a removed one is a little see-through (a smoother edge).
    const x = i % w, y = (i - x) / w;
    const edge = (x > 0 && removed[i - 1]) || (x < w - 1 && removed[i + 1]) || (y > 0 && removed[i - w]) || (y < h - 1 && removed[i + w]);
    if (edge) out[i * 4 + 3] = Math.round(out[i * 4 + 3] * 0.75);
  }
  return { removed, rgba: out, count };
}

/** A brush stroke's radius in picture pixels for a brush size (1-100 % of the picture's short side, kept readable). */
export const brushRadius = (w: number, h: number, size: number) => Math.max(2, (Math.min(w, h) * Math.max(1, Math.min(100, size))) / 400);

/** Map a point on the displayed canvas (CSS pixels) to picture pixels. */
export const toPicturePoint = (cx: number, cy: number, shownW: number, shownH: number, w: number, h: number): [number, number] =>
  [Math.max(0, Math.min(w - 1, (cx / shownW) * w)), Math.max(0, Math.min(h - 1, (cy / shownH) * h))];

// ── Keeping the marks with the picture ────────────────────────────────────────────────────────
/** Strokes are thinned: a point closer than this (thousandths of the picture) to the last kept one is dropped. */
const THIN = 5;

/** The marks as the compact list stored with the picture (PictureAdjust.cutoutMarks), from marks in a `w` × `h` pixel picture. */
export function packMarks(marks: Mark[], w: number, h: number, tolerance: number): CutoutMarks {
  const short = Math.max(1, Math.min(w, h));
  const strokes = marks.filter((m) => m.points.length).map((m) => {
    const p: number[] = [];
    m.points.forEach(([x, y], i) => {
      const px = Math.round((Math.max(0, Math.min(w, x)) / w) * 1000), py = Math.round((Math.max(0, Math.min(h, y)) / h) * 1000);
      const last = i === m.points.length - 1;
      // Keep the first and last point; thin the points between.
      if (i === 0 || (last ? px !== p[p.length - 2] || py !== p[p.length - 1] : Math.hypot(px - p[p.length - 2], py - p[p.length - 1]) >= THIN)) p.push(px, py);
    });
    return { k: m.kind === 'keep' ? ('k' as const) : ('r' as const), r: Math.max(1, Math.round((m.radius / short) * 10000)), p };
  });
  return { tol: Math.round(Math.max(BG_TOLERANCE_MIN, Math.min(BG_TOLERANCE_MAX, tolerance))), strokes };
}

/** The marks and tolerance back, in the pixels of a `w` × `h` picture. Anything malformed is skipped. */
export function unpackMarks(saved: CutoutMarks | null | undefined, w: number, h: number): { marks: Mark[]; tolerance: number } {
  const short = Math.min(w, h);
  const marks: Mark[] = [];
  for (const s of Array.isArray(saved?.strokes) ? saved!.strokes : []) {
    if (!s || (s.k !== 'k' && s.k !== 'r') || !Array.isArray(s.p) || typeof s.r !== 'number' || !Number.isFinite(s.r)) continue;
    const points: [number, number][] = [];
    for (let i = 0; i + 1 < s.p.length; i += 2) {
      const x = s.p[i], y = s.p[i + 1];
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([Math.max(0, Math.min(w - 1, (x / 1000) * w)), Math.max(0, Math.min(h - 1, (y / 1000) * h))]);
    }
    if (points.length) marks.push({ kind: s.k === 'k' ? 'keep' : 'remove', points, radius: Math.max(0.5, (s.r / 10000) * short) });
  }
  const tol = typeof saved?.tol === 'number' && Number.isFinite(saved.tol) ? Math.max(BG_TOLERANCE_MIN, Math.min(BG_TOLERANCE_MAX, saved.tol)) : BG_TOLERANCE_DEFAULT;
  return { marks, tolerance: tol };
}
