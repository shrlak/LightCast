// 그리기 › 잉크를 도형으로 변환 (Draw › Convert to Shape): recognise a hand-drawn stroke as a line,
// arrow, rectangle, ellipse, triangle or a straight-edged polygon. Pure geometry: canvas pixels in, a
// description of the shape out; editOps turns it into a slide object.
// (잉크를 텍스트로 / Ink to Text needs a handwriting model; LightCast has none and adds no heavy
// dependency for it, so that conversion is not offered.)

export type Pt = [number, number];

export type RecognizedInk =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'arrow'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number }
  | { kind: 'triangle'; x: number; y: number; w: number; h: number; flipV: boolean }
  /** A closed outline of straight edges (canvas pixels, the first point is not repeated). */
  | { kind: 'polygon'; points: Pt[] };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance of p from the segment a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker on an open run of points. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let max = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; at = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, at + 1), eps), right = simplify(pts.slice(at), eps);
  return [...left.slice(0, -1), ...right];
}

/** Drop jitter: points closer than `min` to the previous kept one. */
function dedupe(pts: Pt[], min: number): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) >= min) out.push(p);
  return out;
}

const pathLen = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

/** Interior angle (degrees) at b between a and c. */
function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1: Pt = [a[0] - b[0], a[1] - b[1]], v2: Pt = [c[0] - b[0], c[1] - b[1]];
  const l = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  if (!l) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / l))) * 180) / Math.PI;
}

/** Corners of a closed stroke: simplify the loop, then merge nearly straight or tiny corners. */
export function closedCorners(pts: Pt[], diag: number): Pt[] {
  // Start at the point farthest from the centroid (a corner or on the curve), split at the point opposite it.
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let start = 0, far = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d > far) { far = d; start = i; } });
  const loop = [...pts.slice(start), ...pts.slice(0, start)];
  let opp = 0, od = -1;
  loop.forEach((p, i) => { const d = dist(p, loop[0]); if (d > od) { od = d; opp = i; } });
  const eps = diag * 0.05;
  const a = simplify(loop.slice(0, opp + 1), eps), b = simplify([...loop.slice(opp), loop[0]], eps);
  let c = [...a.slice(0, -1), ...b.slice(0, -1)];
  for (let changed = true; changed && c.length > 3;) {
    changed = false;
    for (let i = 0; i < c.length; i++) {
      const prev = c[(i + c.length - 1) % c.length], cur = c[i], next = c[(i + 1) % c.length];
      if (angleAt(prev, cur, next) > 160 || dist(prev, cur) < diag * 0.08) { c = c.filter((_, j) => j !== i); changed = true; break; }
    }
  }
  return c;
}

/** Mean deviation of the points from the ellipse inscribed in their box (0 for a perfect one). */
function ellipseError(pts: Pt[], x: number, y: number, w: number, h: number): number {
  const cx = x + w / 2, cy = y + h / 2, a = w / 2, b = h / 2;
  if (a < 1 || b < 1) return 1;
  let sum = 0;
  for (const p of pts) sum += Math.abs(Math.hypot((p[0] - cx) / a, (p[1] - cy) / b) - 1);
  return sum / pts.length;
}

/** A shaft ending in a tip, then a back-swept head drawn in the same stroke. */
function asArrow(pts: Pt[], total: number): RecognizedInk | null {
  const s = simplify(dedupe(pts, 2), total * 0.04);
  if (s.length < 4) return null;
  // The tip is the vertex that ends the longest straight run from the start.
  let tipIdx = -1, best = 0;
  for (let i = 1; i < s.length - 1; i++) {
    const l = dist(s[0], s[i]);
    if (l > best && pathLen(s.slice(0, i + 1)) < l * 1.12) { best = l; tipIdx = i; }
  }
  if (tipIdx < 1) return null;
  const a = s[0], t = s[tipIdx], shaft = dist(a, t);
  const head = s.slice(tipIdx + 1);
  if (shaft < total * 0.45 || !head.length || pathLen([t, ...head]) > shaft * 1.3) return null;
  const ux = (t[0] - a[0]) / shaft, uy = (t[1] - a[1]) / shaft;
  let sides = 0, back = 0, left = false, right = false;
  for (const p of [t, ...head]) {
    const along = (p[0] - t[0]) * ux + (p[1] - t[1]) * uy;
    const side = -(p[0] - t[0]) * uy + (p[1] - t[1]) * ux;
    if (dist(p, t) > shaft * 0.5 || along > shaft * 0.05) return null;
    back = Math.max(back, -along);
    if (side > shaft * 0.06) left = true;
    if (-side > shaft * 0.06) right = true;
  }
  sides = (left ? 1 : 0) + (right ? 1 : 0);
  if (!sides || back < shaft * 0.08) return null;
  return { kind: 'arrow', x0: a[0], y0: a[1], x1: t[0], y1: t[1] };
}

/** Recognise a stroke (canvas pixels); null when it is none of the shapes (it stays ink). */
export function recognizeStroke(raw: Pt[]): RecognizedInk | null {
  const pts = dedupe(raw, 1);
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const diag = Math.hypot(w, h);
  if (diag < 24) return null;
  const total = pathLen(pts);
  const first = pts[0], last = pts[pts.length - 1];
  const gap = dist(first, last);

  if (gap > Math.max(diag * 0.22, total * 0.12)) {
    const dev = Math.max(...pts.map((p) => segDist(p, first, last)));
    if (dev <= gap * 0.07 && total <= gap * 1.2) return { kind: 'line', x0: first[0], y0: first[1], x1: last[0], y1: last[1] };
    return asArrow(pts, total);
  }

  // Closed stroke: a smooth round loop is an ellipse, otherwise count the straight edges.
  const eErr = ellipseError(pts, x, y, w, h);
  const corners = closedCorners(pts, diag);
  const asEllipse: RecognizedInk = { kind: 'ellipse', x, y, w, h };
  if (corners.length < 3 || corners.length > 8) return eErr < 0.12 && w > 4 && h > 4 ? asEllipse : null;
  // How far the stroke strays from the straight edges between the corners (worst and average).
  const devs = pts.map((p) => Math.min(...corners.map((c, i) => segDist(p, c, corners[(i + 1) % corners.length]))));
  const edgeDev = Math.max(...devs), meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
  // A round loop hugs a circle, not its corner polygon (a hexagon drawn by hand hugs its edges).
  if (eErr < 0.07 && meanDev > diag * 0.015) return asEllipse;
  if (edgeDev > diag * 0.09) return eErr < 0.1 ? asEllipse : null;

  if (corners.length === 4) {
    const ok = corners.every((c, i) => Math.abs(angleAt(corners[(i + 3) % 4], c, corners[(i + 1) % 4]) - 90) < 22);
    const edges = corners.map((c, i) => Math.atan2(corners[(i + 1) % 4][1] - c[1], corners[(i + 1) % 4][0] - c[0]));
    // Tilted by less than about 12 degrees counts as upright.
    const upright = edges.every((a) => { const m = ((Math.abs(a) * 180) / Math.PI) % 90; return m < 12 || m > 78; });
    if (ok && upright) return { kind: 'rect', x, y, w, h };
  }
  if (corners.length === 3) {
    const sorted = corners.map((c) => c[1]).sort((p, q) => p - q);
    const apex = corners.reduce((m, c) => (c[1] < m[1] ? c : m)), low = corners.reduce((m, c) => (c[1] > m[1] ? c : m));
    const baseMid = corners.filter((c) => c !== apex).reduce((s, c) => s + c[0], 0) / 2;
    if (sorted[2] - sorted[1] < h * 0.18 && Math.abs(apex[0] - baseMid) < w * 0.2) return { kind: 'triangle', x, y, w, h, flipV: false };
    const topMid = corners.filter((c) => c !== low).reduce((s, c) => s + c[0], 0) / 2;
    if (sorted[1] - sorted[0] < h * 0.18 && Math.abs(low[0] - topMid) < w * 0.2) return { kind: 'triangle', x, y, w, h, flipV: true };
  }
  return { kind: 'polygon', points: corners };
}
