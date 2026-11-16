// A small software rasteriser for what the reader draws, used only by flood fills (EMF EXTFLOODFILL, WMF
// FLOODFILL / EXTFLOODFILL), which read back the pixels already painted. GDI paints whole pixels with no
// anti-aliasing and a flood fill compares exact colours, so this rasteriser does the same: a pixel is
// inside a shape when its centre is (non-zero or even-odd), hairlines are Bresenham lines, wider pens are
// segment quads with round joins. A canvas (with a DOM) would anti-alias every edge and let a border fill
// leak through the blended pixels, so it is not used.
//
// The drawing is recorded (paths with their paint and clip, bitmaps with their transform) while the file
// plays, only when the file holds a flood fill; at each flood the records since the last one are painted
// into a pixel buffer over the picture frame (at most MAX_PIXELS), the fill runs (4-connected scanline),
// and the filled pixels come back as rectangles that the caller draws with the current brush, at the
// flood's place in the drawing order. Text is not rasterised (it is not part of any filled area here).
import { apply, type Xf } from './bytes';
import type { Clip, ClipNode, Color } from './out';
import type { Rgba } from './png';

export const MAX_PIXELS = 4_000_000;
/** Pixels a file's flood fills may visit in all. */
const FLOOD_BUDGET = 64_000_000;
const MAX_FLOODS = 256;
const MAX_ITEMS = 200_000;
const MAX_EDGES = 2_000_000;

type RGBA = [number, number, number, number];
/** A pen as the rasteriser sees it: colour, width and dash lengths in device units, the cap of its ends. */
export interface Stroke { c: RGBA; width: number; dash?: number[]; cap?: 'butt' | 'round' | 'square' }
export type Paint =
  | { k: 'solid'; c: RGBA }
  | { k: 'hatch'; style: number; fg: RGBA; bg: RGBA | null }
  | { k: 'pattern'; img: Rgba | null; w: number; h: number; xf: Xf | null; avg: RGBA }
  | { k: 'linear'; x1: number; y1: number; x2: number; y2: number; stops: [number, RGBA][]; inv: Xf; pad: boolean };

type Item =
  | { k: 'path'; d: string; fill: Paint | null; stroke: Stroke | null; eo: boolean; blend?: string; clip: Clip }
  | { k: 'image'; m: Xf; img: Rgba; clip: Clip; blend?: string; invert?: boolean; opacity?: number };

export const rgbaOf = (c: Color): RGBA => { const v = parseInt(c.rgb.slice(1), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255, Math.round(Math.max(0, Math.min(1, c.a)) * 255)]; };

export function invertXf(m: Xf): Xf | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** The display list kept while a file with flood fills plays, and the pixel buffer it is painted into. */
export class Recorder {
  items: Item[] = [];
  paints = new Map<string, Paint>();
  warnings: string[] = [];
  private buf: Uint8ClampedArray | null = null;
  private W = 0; private H = 0; private vx = 0; private vy = 0; private k = 1;
  private done = 0;
  private floods = 0;
  private budget = FLOOD_BUDGET;
  private masks = new Map<ClipNode, Uint8Array>();

  path(d: string, fill: Paint | null, stroke: Stroke | null, eo: boolean, blend: string | undefined, clip: Clip) {
    if (this.items.length < MAX_ITEMS) this.items.push({ k: 'path', d, fill, stroke, eo, blend, clip });
  }
  image(m: Xf, img: Rgba, clip: Clip, o: { blend?: string; invert?: boolean; opacity?: number } = {}) {
    if (this.items.length < MAX_ITEMS) this.items.push({ k: 'image', m, img, clip, ...o });
  }

  /**
   * Flood fill from the device point (x, y): `surface` false is FLOODFILLBORDER (fill everything up to the
   * colour `color`), true is FLOODFILLSURFACE (fill the area of exactly that colour). `view` is the
   * picture frame in device units and `unitsPerPx` the size of one pixel in device units. Returns the
   * filled area as path data in device units (rectangles), or null when nothing is filled.
   */
  flood(x: number, y: number, color: RGBA, surface: boolean, view: [number, number, number, number] | null, unitsPerPx: number, clip: Clip, page: RGBA | null = null): string | null {
    if (++this.floods > MAX_FLOODS) { this.warn('more flood fills than the limit; the rest are skipped'); return null; }
    if (!this.buf) {
      if (!view || !(view[2] > 0 && view[3] > 0)) { this.warn('a flood fill with no picture frame is skipped'); return null; }
      let k = 1 / Math.max(unitsPerPx, 1e-9);
      if (view[2] * k * view[3] * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (view[2] * view[3]));
      this.W = Math.max(1, Math.ceil(view[2] * k)); this.H = Math.max(1, Math.ceil(view[3] * k));
      this.vx = view[0]; this.vy = view[1]; this.k = k;
      this.buf = new Uint8ClampedArray(this.W * this.H * 4);
    }
    for (; this.done < this.items.length; this.done++) this.paint(this.items[this.done]);
    const { W, H } = this;
    const sx = Math.floor((x - this.vx) * this.k), sy = Math.floor((y - this.vy) * this.k);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
    const cm = this.clipMask(clip);
    const buf = this.buf;
    const target = (color[0] << 16) | (color[1] << 8) | color[2];
    // A pixel nothing was drawn on is unknown (-1: it matches no colour) unless the caller knows the page
    // (`page`, see Gdi.floodFill); a partly transparent one is seen over the page when it is known.
    const pg = page ? (page[0] << 16) | (page[1] << 8) | page[2] : -1;
    const colorAt = (i: number) => {
      const a = buf[i * 4 + 3];
      if (a === 0) return pg;
      if (a === 255 || !page) return (buf[i * 4] << 16) | (buf[i * 4 + 1] << 8) | buf[i * 4 + 2];
      const f = a / 255, mix = (q: number) => Math.round(buf[i * 4 + q] * f + page[q] * (1 - f));
      return (mix(0) << 16) | (mix(1) << 8) | mix(2);
    };
    const seen = new Uint8Array(W * H);
    const ok = (i: number) => !seen[i] && (!cm || cm[i]) && (surface ? colorAt(i) === target : colorAt(i) !== target);
    if (!ok(sy * W + sx)) return null;
    const runs: [number, number, number][] = []; // y, x0, x1 (exclusive)
    const stack: number[] = [sx, sy];
    while (stack.length) {
      const py = stack.pop()!, px = stack.pop()!;
      let i = py * W + px;
      if (!ok(i)) continue;
      let l = px, r = px;
      while (l > 0 && ok(i - (px - l) - 1)) l--;
      while (r + 1 < W && ok(py * W + r + 1)) r++;
      if ((this.budget -= r - l + 1) < 0) { this.warn('flood fills reached the pixel limit; the rest are skipped'); break; }
      for (let xx = l; xx <= r; xx++) seen[py * W + xx] = 1;
      runs.push([py, l, r + 1]);
      for (const ny of [py - 1, py + 1]) {
        if (ny < 0 || ny >= H) continue;
        let inRun = false;
        for (let xx = l; xx <= r; xx++) {
          i = ny * W + xx;
          const can = ok(i);
          if (can && !inRun) { stack.push(xx, ny); inRun = true; } else if (!can) inRun = false;
        }
      }
    }
    if (!runs.length) return null;
    // Rows sorted, runs that repeat on the next row merged into one rectangle.
    runs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const open = new Map<string, [number, number, number, number]>(); // key x0,x1 -> [x0, y0, x1, y1]
    const rects: [number, number, number, number][] = [];
    let row = -1;
    let rowKeys = new Set<string>();
    const closeMissing = () => { for (const [key, r] of open) if (!rowKeys.has(key)) { rects.push(r); open.delete(key); } };
    for (const [ry, x0, x1] of runs) {
      if (ry !== row) { if (row >= 0) { closeMissing(); if (ry !== row + 1) { for (const r of open.values()) rects.push(r); open.clear(); } } row = ry; rowKeys = new Set(); }
      const key = `${x0},${x1}`;
      rowKeys.add(key);
      const o = open.get(key);
      if (o && o[3] === ry) o[3] = ry + 1; else open.set(key, [x0, ry, x1, ry + 1]);
    }
    for (const r of open.values()) rects.push(r);
    const u = (v: number) => Math.round(v * 1000) / 1000;
    let d = '';
    for (const [x0, y0, x1, y1] of rects) {
      const X0 = u(this.vx + x0 / this.k), Y0 = u(this.vy + y0 / this.k), X1 = u(this.vx + x1 / this.k), Y1 = u(this.vy + y1 / this.k);
      d += `M${X0} ${Y0}H${X1}V${Y1}H${X0}Z`;
    }
    return d;
  }
  private warn(s: string) { if (!this.warnings.includes(s)) this.warnings.push(s); }

  // ---- painting ----

  private toPx(x: number, y: number): [number, number] { return [(x - this.vx) * this.k, (y - this.vy) * this.k]; }

  private paint(it: Item) {
    const cm = this.clipMask(it.clip);
    if (it.k === 'image') { this.paintImage(it, cm); return; }
    const polys = this.polys(it.d);
    if (it.fill) {
      const cov = this.cover(polys, it.eo);
      this.compose(cov, cm, it.fill, it.blend);
    }
    if (it.stroke && it.stroke.c[3] > 0) {
      const cov = this.strokeCover(polys, it.stroke);
      this.compose(cov, cm, { k: 'solid', c: it.stroke.c }, it.blend);
    }
  }

  /** Path data (M, L, H, V, C, Z, absolute) as polygons in pixel units; each polygon carries whether it was closed. */
  private polys(d: string): { pts: number[]; closed: boolean }[] {
    const out: { pts: number[]; closed: boolean }[] = [];
    const tok = d.match(/[MLHVCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
    let cur: number[] | null = null, cx = 0, cy = 0, sx = 0, sy = 0, cmd = 'M', i = 0, edges = 0;
    const n = () => +tok[i++] || 0;
    const push = (x: number, y: number) => { const [px, py] = this.toPx(x, y); cur!.push(px, py); cx = x; cy = y; edges++; };
    while (i < tok.length && edges < MAX_EDGES) {
      const t = tok[i];
      if (/^[MLHVCZ]$/i.test(t)) { cmd = t.toUpperCase(); i++; if (cmd === 'Z') { if (cur) { out.push({ pts: cur, closed: true }); cx = sx; cy = sy; cur = null; } continue; } }
      if (cmd === 'M') { if (cur) out.push({ pts: cur, closed: false }); cur = []; const x = n(), y = n(); sx = x; sy = y; push(x, y); cmd = 'L'; continue; }
      if (!cur) { cur = []; push(cx, cy); }
      if (cmd === 'L') push(n(), n());
      else if (cmd === 'H') push(n(), cy);
      else if (cmd === 'V') push(cx, n());
      else if (cmd === 'C') {
        const x0 = cx, y0 = cy, x1 = n(), y1 = n(), x2 = n(), y2 = n(), x3 = n(), y3 = n();
        const len = (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)) * this.k;
        const steps = Math.max(2, Math.min(64, Math.ceil(len / 4)));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, a = 1 - t;
          push(a * a * a * x0 + 3 * a * a * t * x1 + 3 * a * t * t * x2 + t * t * t * x3, a * a * a * y0 + 3 * a * a * t * y1 + 3 * a * t * t * y2 + t * t * t * y3);
        }
      } else i++;
    }
    if (cur) out.push({ pts: cur, closed: false });
    return out;
  }

  /** Pixels whose centres are inside the polygons (all treated as closed). */
  private cover(polys: { pts: number[] }[], eo: boolean, into?: Uint8Array): Uint8Array {
    const { W, H } = this;
    const cov = into ?? new Uint8Array(W * H);
    const edges: number[] = []; // x0, y0, x1, y1, dir (y0 < y1)
    for (const { pts } of polys) {
      const m = pts.length / 2;
      for (let j = 0; j < m; j++) {
        const ax = pts[j * 2], ay = pts[j * 2 + 1], bx = pts[((j + 1) % m) * 2], by = pts[((j + 1) % m) * 2 + 1];
        if (ay === by || !Number.isFinite(ax + ay + bx + by)) continue;
        if (ay < by) edges.push(ax, ay, bx, by, 1); else edges.push(bx, by, ax, ay, -1);
      }
    }
    const ne = edges.length / 5;
    if (!ne) return cov;
    const order = Array.from({ length: ne }, (_, j) => j).sort((a, b) => edges[a * 5 + 1] - edges[b * 5 + 1]);
    let next = 0;
    let active: number[] = [];
    const xs: [number, number][] = [];
    let y0 = Math.max(0, Math.floor(edges[order[0] * 5 + 1] - 0.5));
    for (let y = y0; y < H; y++) {
      const yc = y + 0.5;
      while (next < ne && edges[order[next] * 5 + 1] <= yc) active.push(order[next++]);
      active = active.filter((e) => edges[e * 5 + 3] > yc);
      if (!active.length) { if (next >= ne) break; y0 = Math.floor(edges[order[next] * 5 + 1] - 0.5); if (y0 > y) y = y0 - 1; continue; }
      xs.length = 0;
      for (const e of active) {
        const o = e * 5, ax = edges[o], ay = edges[o + 1], bx = edges[o + 2], by = edges[o + 3];
        if (ay > yc) continue;
        xs.push([ax + ((yc - ay) / (by - ay)) * (bx - ax), edges[o + 4]]);
      }
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let j = 0; j < xs.length; j++) {
        wind = eo ? wind ^ 1 : wind + xs[j][1];
        if (j + 1 < xs.length && wind !== 0) {
          const l = Math.max(0, Math.ceil(xs[j][0] - 0.5)), r = Math.min(W - 1, Math.ceil(xs[j + 1][0] - 0.5) - 1);
          for (let x = l; x <= r; x++) cov[y * W + x] = 1;
        }
      }
    }
    return cov;
  }

  /**
   * The pixels a pen covers. A hairline (at most 1.5 px) is GDI's cosmetic line: Bresenham from pixel to
   * pixel, the last pixel of an open figure left out, a dash pattern stepping one unit per pixel along the
   * figure (it starts afresh with each figure). A wider pen is segment quads with round joins and the
   * figure's caps; a dash pattern is measured along the figure in pixels and each dash is stroked as its
   * own open piece with the caps.
   */
  private strokeCover(polys: { pts: number[]; closed: boolean }[], st: Stroke): Uint8Array {
    const { W, H } = this;
    const width = st.width * this.k;
    const cov = new Uint8Array(W * H);
    const set = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < W && y < H) cov[y * W + x] = 1; };
    const dash = st.dash?.length ? dashPattern(st.dash.map((v) => v * this.k), width <= 1.5) : null;
    for (const { pts, closed } of polys) {
      const m = pts.length / 2;
      if (m === 1) { set(Math.floor(pts[0]), Math.floor(pts[1])); continue; }
      const segs = closed ? m : m - 1;
      if (width <= 1.5) {
        const pos = { i: 0, left: dash ? dash[0] : 0, on: true };
        for (let j = 0; j < segs; j++) {
          const ax = pts[j * 2], ay = pts[j * 2 + 1], bx = pts[((j + 1) % m) * 2], by = pts[((j + 1) % m) * 2 + 1];
          let x0 = Math.floor(ax), y0 = Math.floor(ay);
          const x1 = Math.floor(bx), y1 = Math.floor(by);
          const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), stx = x0 < x1 ? 1 : -1, sty = y0 < y1 ? 1 : -1;
          let err = dx + dy, guard = 0;
          for (;;) {
            if (x0 === x1 && y0 === y1) break; // the end pixel belongs to the next segment (or is left out)
            if (!dash || pos.on) set(x0, y0);
            if (dash) step(dash, pos, 1);
            if (guard++ > 4 * (W + H)) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += stx; }
            if (e2 <= dx) { err += dx; y0 += sty; }
          }
        }
        continue;
      }
      if (!dash) { this.widePiece(pts, closed, width, st.cap ?? 'round', cov); continue; }
      // Dashes along the figure.
      const pos = { i: 0, left: dash[0], on: true };
      let piece: number[] = [];
      const flush = () => { if (piece.length >= 4) this.widePiece(piece, false, width, st.cap ?? 'butt', cov); piece = []; };
      for (let j = 0; j < segs; j++) {
        const ax = pts[j * 2], ay = pts[j * 2 + 1], bx = pts[((j + 1) % m) * 2], by = pts[((j + 1) % m) * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay);
        let t = 0, guard = 0;
        while (t < len && guard++ < 100_000) {
          const run = Math.min(pos.left, len - t);
          const p0 = [ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len], p1 = [ax + ((bx - ax) * (t + run)) / len, ay + ((by - ay) * (t + run)) / len];
          if (pos.on) { if (!piece.length) piece.push(p0[0], p0[1]); piece.push(p1[0], p1[1]); }
          t += run;
          if (run >= pos.left) { if (pos.on) flush(); step(dash, pos, run); } else pos.left -= run;
        }
      }
      flush();
    }
    return cov;
  }

  /** A wide pen along one figure: segment quads, round joins, and the caps at the ends of an open figure. */
  private widePiece(pts: number[], closed: boolean, width: number, cap: 'butt' | 'round' | 'square', cov: Uint8Array) {
    const m = pts.length / 2;
    const segs = closed ? m : m - 1;
    const r = width / 2, steps = Math.max(8, Math.min(32, Math.ceil(r)));
    const disc = (cx: number, cy: number) => {
      const d: number[] = [];
      for (let s = 0; s < steps; s++) { const t = (s / steps) * Math.PI * 2; d.push(cx + r * Math.cos(t), cy + r * Math.sin(t)); }
      this.cover([{ pts: d }], false, cov);
    };
    for (let j = 0; j < segs; j++) {
      let ax = pts[j * 2], ay = pts[j * 2 + 1], bx = pts[((j + 1) % m) * 2], by = pts[((j + 1) % m) * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 0) {
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        if (!closed && cap === 'square') { if (j === 0) { ax -= ux * r; ay -= uy * r; } if (j === segs - 1) { bx += ux * r; by += uy * r; } }
        const nx = -uy * r, ny = ux * r;
        this.cover([{ pts: [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny] }], false, cov);
      }
      const last = j === segs - 1;
      if (closed || !last || cap === 'round') disc(pts[((j + 1) % m) * 2], pts[((j + 1) % m) * 2 + 1]); // a join (or the round end cap)
      if (!closed && j === 0 && cap === 'round') disc(pts[0], pts[1]);
    }
  }

  private clipMask(c: Clip): Uint8Array | null {
    if (!c) return null;
    const cached = this.masks.get(c);
    if (cached) return cached;
    const m = this.evalClip(c, 0);
    if (this.masks.size > 32) this.masks.clear();
    this.masks.set(c, m);
    return m;
  }
  private evalClip(c: ClipNode, depth: number): Uint8Array {
    const N = this.W * this.H;
    if (depth > 64) return new Uint8Array(N).fill(1);
    if (c.k === 'path') return this.cover(this.polys(c.d), c.eo);
    const a = c.a ? this.evalClip(c.a, depth + 1) : new Uint8Array(N).fill(1);
    const b = this.evalClip(c.b, depth + 1);
    for (let i = 0; i < N; i++) a[i] = c.k === 'and' ? a[i] & b[i] : c.k === 'or' ? a[i] | b[i] : c.k === 'xor' ? a[i] ^ b[i] : a[i] & (b[i] ^ 1);
    return a;
  }

  /** The paint's colour at the centre of pixel (x, y), or null where it is transparent. */
  private colorAt(p: Paint, x: number, y: number): RGBA | null {
    const dx = this.vx + (x + 0.5) / this.k, dy = this.vy + (y + 0.5) / this.k;
    switch (p.k) {
      case 'solid': return p.c;
      case 'hatch': {
        const u = ((dx % 8) + 8) % 8, v = ((dy % 8) + 8) % 8, s = p.style, w = Math.max(0.5, 0.5 / this.k);
        const on = ((s === 0 || s === 4 || s === 5) && Math.abs(v - 4) < w) || ((s === 1 || s === 4 || s === 5) && Math.abs(u - 4) < w)
          || ((s === 2 || s === 5) && Math.abs(u - v) < w * 1.4) || ((s === 3 || s === 5) && Math.abs(u + v - 8) < w * 1.4);
        return on ? p.fg : p.bg;
      }
      case 'pattern': {
        if (!p.img) return p.avg;
        let [ux, uy] = [dx, dy];
        if (p.xf) { const inv = invertXf(p.xf); if (inv) [ux, uy] = apply(inv, dx, dy); }
        const ix = Math.floor((((ux % p.w) + p.w) % p.w) * (p.img.w / p.w)), iy = Math.floor((((uy % p.h) + p.h) % p.h) * (p.img.h / p.h));
        const o = (Math.min(iy, p.img.h - 1) * p.img.w + Math.min(ix, p.img.w - 1)) * 4;
        return [p.img.px[o], p.img.px[o + 1], p.img.px[o + 2], p.img.px[o + 3]];
      }
      case 'linear': {
        const [ux, uy] = apply(p.inv, dx, dy);
        const gx = p.x2 - p.x1, gy = p.y2 - p.y1, L = gx * gx + gy * gy;
        let t = L ? ((ux - p.x1) * gx + (uy - p.y1) * gy) / L : 0;
        t = p.pad ? Math.max(0, Math.min(1, t)) : t - Math.floor(t);
        return stopColor(p.stops, t);
      }
    }
  }

  private compose(cov: Uint8Array, clip: Uint8Array | null, paint: Paint, blend?: string) {
    const { W, H } = this;
    const buf = this.buf!;
    const solid = paint.k === 'solid' ? paint.c : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cov[i] || (clip && !clip[i])) continue;
      const c = solid ?? this.colorAt(paint, x, y);
      if (c && c[3] > 0) put(buf, i, c, blend);
    }
  }

  private paintImage(it: Item & { k: 'image' }, clip: Uint8Array | null) {
    const { W, H } = this;
    const m: Xf = [it.m[0] * this.k, it.m[1] * this.k, it.m[2] * this.k, it.m[3] * this.k, (it.m[4] - this.vx) * this.k, (it.m[5] - this.vy) * this.k];
    const inv = invertXf(m);
    if (!inv) return;
    const { w, h, px } = it.img;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [a, b] of [[0, 0], [w, 0], [w, h], [0, h]]) { const [X, Y] = apply(m, a, b); x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y); }
    const buf = this.buf!;
    const op = it.opacity ?? 1;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
      const i = y * W + x;
      if (clip && !clip[i]) continue;
      const [u, v] = apply(inv, x + 0.5, y + 0.5);
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const o = (Math.floor(v) * w + Math.floor(u)) * 4;
      let c: RGBA = [px[o], px[o + 1], px[o + 2], Math.round(px[o + 3] * op)];
      if (it.invert) c = [255 - c[0], 255 - c[1], 255 - c[2], c[3]];
      if (c[3] > 0) put(buf, i, c, it.blend);
    }
  }
}

/** A dash array (pixels) as whole steps for a hairline (at least one pixel each), doubled when its length is odd, as GDI and SVG repeat it. */
function dashPattern(d: number[], hairline: boolean): number[] {
  let p = d.map((v) => (hairline ? Math.max(1, Math.round(v)) : Math.max(v, 1e-3)));
  if (p.length % 2) p = p.concat(p);
  return p.reduce((a, v) => a + v, 0) > 0 ? p.slice(0, 64) : [1, 0];
}
/** Advances a dash position by `n` pixels. */
function step(p: number[], pos: { i: number; left: number; on: boolean }, n: number) {
  let guard = 0;
  while (n > 0 && guard++ < 10_000) {
    if (pos.left > n) { pos.left -= n; return; }
    n -= pos.left;
    pos.i = (pos.i + 1) % p.length; pos.left = p[pos.i]; pos.on = pos.i % 2 === 0;
  }
}

function stopColor(stops: [number, RGBA][], t: number): RGBA {
  if (!stops.length) return [0, 0, 0, 0];
  if (t <= stops[0][0]) return stops[0][1];
  for (let j = 1; j < stops.length; j++) {
    if (t <= stops[j][0]) {
      const [p0, c0] = stops[j - 1], [p1, c1] = stops[j];
      const f = p1 > p0 ? (t - p0) / (p1 - p0) : 1;
      return [0, 1, 2, 3].map((q) => Math.round(c0[q] + (c1[q] - c0[q]) * f)) as RGBA;
    }
  }
  return stops[stops.length - 1][1];
}

/** Source-over (with the blend mode) of `c` onto pixel `i`. */
function put(buf: Uint8ClampedArray, i: number, c: RGBA, blend?: string) {
  const o = i * 4;
  const da = buf[o + 3] / 255, sa = c[3] / 255;
  for (let q = 0; q < 3; q++) {
    const s = c[q], d = buf[o + q];
    const b = !blend || da === 0 ? s : blend === 'difference' ? Math.abs(s - d) : blend === 'multiply' ? (s * d) / 255 : blend === 'screen' ? s + d - (s * d) / 255 : s;
    buf[o + q] = Math.round(da === 0 ? s : sa * ((1 - da) * s + da * b) + (1 - sa) * d);
  }
  buf[o + 3] = Math.round((sa + da * (1 - sa)) * 255);
}
