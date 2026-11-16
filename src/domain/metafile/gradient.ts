// EMF+ gradient brushes past their end colours: blend factors and preset colours of linear and path
// gradients, gamma correction (interpolation in linear light), and path gradients with their surround
// colours and focus scales. An elliptical path gradient with one surround colour becomes an SVG radial
// gradient; any other is drawn as a bitmap: the boundary is cut into triangles fanning out from the centre
// point and each pixel takes the colour interpolated across its triangle (GDI+'s own construction).
import type { Rgba } from './png';

export type C4 = [number, number, number, number]; // r, g, b, a (0..255)

/** Blend data: positions 0..1 with either factors (how much of the second colour) or colours. */
export interface Blend { pos: number[]; factors?: number[]; colors?: C4[] }

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const srgb = (v: number) => { const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };

/** `a` to `b` by `t`, in linear light when `gamma`. */
export function mix(a: C4, b: C4, t: number, gamma = false): C4 {
  t = Math.max(0, Math.min(1, t));
  if (!gamma) return [0, 1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as C4;
  return [srgb(lin(a[0]) + (lin(b[0]) - lin(a[0])) * t), srgb(lin(a[1]) + (lin(b[1]) - lin(a[1])) * t), srgb(lin(a[2]) + (lin(b[2]) - lin(a[2])) * t), Math.round(a[3] + (b[3] - a[3]) * t)];
}

/** Piecewise-linear value of a table at t. */
function interp(pos: number[], val: number[], t: number): number {
  if (!pos.length) return t;
  if (t <= pos[0]) return val[0];
  for (let i = 1; i < pos.length; i++) if (t <= pos[i]) { const f = pos[i] > pos[i - 1] ? (t - pos[i - 1]) / (pos[i] - pos[i - 1]) : 1; return val[i - 1] + (val[i] - val[i - 1]) * f; }
  return val[val.length - 1];
}

/** The colour at t (0 = first colour, 1 = second) with the blend applied. */
export function colorAt(c0: C4, c1: C4, t: number, blend: Blend | null, gamma: boolean): C4 {
  if (blend?.colors && blend.colors.length >= 2) {
    const p = blend.pos;
    if (t <= p[0]) return blend.colors[0];
    for (let i = 1; i < p.length; i++) if (t <= p[i]) return mix(blend.colors[i - 1], blend.colors[i], p[i] > p[i - 1] ? (t - p[i - 1]) / (p[i] - p[i - 1]) : 1, gamma);
    return blend.colors[blend.colors.length - 1];
  }
  const f = blend?.factors && blend.factors.length >= 2 ? interp(blend.pos, blend.factors, t) : t;
  return mix(c0, c1, f, gamma);
}

/**
 * SVG gradient stops (offset 0..1) for colours c0 -> c1 with a blend and gamma: the blend's own positions,
 * plus intermediate stops where the interpolation is not linear in sRGB (gamma correction).
 */
export function gradientStops(c0: C4, c1: C4, blend: Blend | null, gamma: boolean): [number, C4][] {
  const ts = new Set<number>([0, 1]);
  if (blend && blend.pos.length >= 2) for (const p of blend.pos.slice(0, 64)) ts.add(Math.max(0, Math.min(1, p)));
  let list = [...ts].sort((a, b) => a - b);
  if (gamma) { const fine: number[] = []; for (let i = 0; i + 1 < list.length; i++) for (let k = 0; k < 8; k++) fine.push(list[i] + ((list[i + 1] - list[i]) * k) / 8); fine.push(1); list = fine; }
  return list.map((t) => [t, colorAt(c0, c1, t, blend, gamma)]);
}

/** True when the closed polygon is an ellipse aligned with the axes (within 1.5 % of its radii); then its centre and radii. */
export function asEllipse(pts: [number, number][]): { cx: number; cy: number; rx: number; ry: number } | null {
  if (pts.length < 8) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  if (!(rx > 0 && ry > 0)) return null;
  for (const [x, y] of pts) if (Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) > 0.015) return null;
  return { cx, cy, rx, ry };
}

export interface PathGradient {
  center: C4; centerPt: [number, number];
  /** Boundary points (closed polygon) and the colour of each (the last surround colour repeats). */
  boundary: [number, number][]; surround: C4[];
  blend: Blend | null; focus: [number, number] | null; gamma: boolean; wrap: number;
}

/** Boundary-to-centre position 0..1 as the colour at that pixel: 0 is the boundary colour, 1 the centre colour. */
function pathColor(g: PathGradient, edge: C4, s: number): C4 {
  return colorAt(edge, g.center, s, g.blend, g.gamma);
}

const MAX_SIDE = 256;
const MAX_EDGES = 160;

/**
 * The path gradient drawn into a bitmap over the boundary's bounding box at `side` pixels on its longer
 * side; pixels outside the boundary stay transparent. Wrap modes 1..3 come back as a 2 x 2 tile with the
 * flipped copies, so the bitmap tiles like GDI+ does. Returns the bitmap and its box (brush units).
 */
export function pathGradientImage(g: PathGradient, side: number): { img: Rgba; box: [number, number, number, number] } | null {
  let b = g.boundary;
  if (b.length < 3) return null;
  if (b.length > MAX_EDGES) { const k = b.length / MAX_EDGES; b = Array.from({ length: MAX_EDGES }, (_, i) => b[Math.floor(i * k)]); }
  const cols = (i: number) => g.surround[Math.min(Math.floor(i * (g.boundary.length / b.length)), g.surround.length - 1)] ?? g.center;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of b) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const bw = x1 - x0, bh = y1 - y0;
  if (!(bw > 0 && bh > 0) || !Number.isFinite(bw + bh)) return null;
  const n = Math.max(2, Math.min(MAX_SIDE, Math.round(side)));
  const W = bw >= bh ? n : Math.max(2, Math.round((n * bw) / bh)), H = bw >= bh ? Math.max(2, Math.round((n * bh) / bw)) : n;
  const [cx, cy] = g.centerPt;
  const fx = g.focus ? Math.max(0, Math.min(1, g.focus[0])) : 0, fy = g.focus ? Math.max(0, Math.min(1, g.focus[1])) : 0;
  // Fan triangles (centre, b[i], b[i+1]) with their barycentric set-up.
  const tri = b.map((p, i) => {
    const q = b[(i + 1) % b.length];
    const d = (q[1] - cy) * (p[0] - cx) + (cx - q[0]) * (p[1] - cy);
    return { p, q, d, i, j: (i + 1) % b.length };
  }).filter((t) => Math.abs(t.d) > 1e-12);
  const px = new Uint8ClampedArray(W * H * 4);
  let last = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = x0 + ((x + 0.5) / W) * bw, Y = y0 + ((y + 0.5) / H) * bh;
    let hit = -1, wp = 0, wq = 0;
    for (let k = 0; k < tri.length; k++) {
      const t = tri[(last + k) % tri.length];
      const a = ((t.q[1] - cy) * (X - cx) + (cx - t.q[0]) * (Y - cy)) / t.d;
      const c = ((cy - t.p[1]) * (X - cx) + (t.p[0] - cx) * (Y - cy)) / t.d;
      if (a >= -1e-9 && c >= -1e-9 && a + c <= 1 + 1e-9) { hit = (last + k) % tri.length; wp = a; wq = c; break; }
    }
    if (hit < 0) continue;
    last = hit;
    const t = tri[hit];
    const u = wp + wq; // 0 at the centre, 1 on the boundary
    const edge = mix(cols(t.i), cols(t.j), wp + wq > 0 ? wq / (wp + wq) : 0, g.gamma);
    // Focus scales: the boundary shrunk by (fx, fy) about the centre is all centre colour.
    let f = 0;
    if (fx || fy) { const dx = Math.abs(X - cx), dy = Math.abs(Y - cy); f = dx + dy > 0 ? (fx * dx + fy * dy) / (dx + dy) : (fx + fy) / 2; }
    const s = f >= 1 ? 1 : u <= f ? 1 : 1 - (u - f) / (1 - f);
    const c = pathColor(g, edge, s);
    px.set(c, (y * W + x) * 4);
  }
  let img: Rgba = { w: W, h: H, px };
  if (g.wrap >= 1 && g.wrap <= 3) img = flipTile(img, g.wrap !== 2, g.wrap !== 1);
  return { img, box: [x0, y0, bw, bh] };
}

/** A 2 x 2 (or 2 x 1, 1 x 2) tile of `img` with the copies mirrored in x and / or y. */
function flipTile(img: Rgba, fx: boolean, fy: boolean): Rgba {
  const W = img.w * (fx ? 2 : 1), H = img.h * (fy ? 2 : 1);
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x < img.w ? x : 2 * img.w - 1 - x, sy = y < img.h ? y : 2 * img.h - 1 - y;
    const o = (sy * img.w + sx) * 4;
    px.set(img.px.subarray(o, o + 4), (y * W + x) * 4);
  }
  return { w: W, h: H, px };
}

/** Radial-gradient stops (offset 0 at the centre, 1 on the boundary) for an elliptical path gradient. */
export function radialStops(g: PathGradient): [number, C4][] {
  const edge = g.surround[0] ?? g.center;
  const f = g.focus ? Math.max(0, Math.min(1, (g.focus[0] + g.focus[1]) / 2)) : 0;
  // gradientStops runs from the boundary (0) to the centre (1); a radial offset runs the other way.
  const st = gradientStops(edge, g.center, g.blend, g.gamma).map(([t, c]) => [f + (1 - f) * (1 - t), c] as [number, C4]).sort((a, b) => a[0] - b[0]);
  if (f > 0) st.unshift([0, st[0][1]]);
  return st;
}
