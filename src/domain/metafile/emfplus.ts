// EMF+ (MS-EMFPLUS): GDI+ records carried in EMR_COMMENT records of an EMF. When a file holds them
// they are drawn instead of its GDI fallback ("dual" files carry both); the GetDC record hands
// control back to the GDI records for a stretch.
import { apply, compose, scaleOf, type Xf, Bytes } from './bytes';
import { arcSegs } from './gdi';
import { BIG, combineClips, hex, num, Out, xmlText, type Clip, type ClipNode, type Color, type Fill, type PathData, type Stroke } from './out';
import { cropRgba, encodedImageUrl, pngDataUrl, type Rgba } from './png';
import { applyEffect, effectFilter, needsPixels, parseEffect, type Effect } from './effects';
import { decodedImage } from './decode';
import { textWidth } from './metrics';
import { glyphAdvancesEm, glyphsToText } from './fonts';
import { baselineOrigins, charAdvances, textCoverage } from './textraster';
import { asEllipse, gradientStops, pathGradientImage, radialStops, type Blend, type C4, type PathGradient } from './gradient';

/** Renders a nested metafile image to an SVG data URL (set by index.ts, which owns the whole reader). */
export let nestedRenderer: ((u8: Uint8Array) => { href: string; w: number; h: number } | null) | null = null;
export const setNestedRenderer = (f: typeof nestedRenderer) => { nestedRenderer = f; };

const MAX_OBJECTS = 64;
const MAX_STACK = 64;
const MAX_POINTS = 100_000;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const MAX_CHARS = 32768;

const argb = (v: number): Color => ({ rgb: hex((v >>> 16) & 255, (v >>> 8) & 255, v & 255), a: (v >>> 24) / 255 });
const c4 = (v: number): C4 => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255, v >>> 24];
const colorOf4 = (c: C4): Color => ({ rgb: hex(c[0], c[1], c[2]), a: c[3] / 255 });

type Op = { t: 'M' | 'L'; x: number; y: number } | { t: 'C'; p: [number, number, number, number, number, number] } | { t: 'Z' };

type BrushObj =
  | { k: 'solid'; c: Color }
  | { k: 'hatch'; style: number; fg: Color; bg: Color }
  | { k: 'linear'; rect: [number, number, number, number]; c0: C4; c1: C4; blend: Blend | null; gamma: boolean; xf: Xf; wrap: number }
  | { k: 'pathGradient'; g: PathGradient; ops: Op[]; xf: Xf }
  | { k: 'texture'; img: ImageObj; xf: Xf };
interface PenObj { width: number; unit: number; brush: BrushObj; dash: number; cap: number; join: number; miter: number; dashes?: number[] }
interface ImageObj { href: string; w: number; h: number; px?: Rgba; /** PNG / JPEG bytes of a compressed image, decoded where the pixels are needed (decode.ts). */ bytes?: Uint8Array }
interface FontObj { em: number; unit: number; style: number; family: string }
interface FormatObj { align: number; lineAlign: number }
type R4 = [number, number, number, number];
/** A region: rectangles and paths (world units) combined by the EMF+ operators, kept as a tree so it can be drawn and clipped exactly. */
type RegionNode = { t: 'rect'; r: R4 } | { t: 'path'; ops: Op[] } | { t: 'inf' } | { t: 'empty' } | { t: 'op'; m: number; a: RegionNode; b: RegionNode };
interface ImageAttrs { wrap: number; clamp: Color; clampObject: boolean }
type PlusObj = { k: 'region'; v: RegionNode } | { k: 'attrs'; v: ImageAttrs } | { k: 'brush'; v: BrushObj } | { k: 'pen'; v: PenObj } | { k: 'path'; v: Op[] } | { k: 'image'; v: ImageObj } | { k: 'font'; v: FontObj } | { k: 'format'; v: FormatObj };

let nesting = 0;

export class Plus {
  /** An EMF+ header was seen: its records are the picture. */
  active = false;
  private dpi = 96;
  private world: Xf = [1, 0, 0, 1, 0, 0];
  private unit = 2;
  private scale = 1;
  private objects: (PlusObj | undefined)[] = new Array(MAX_OBJECTS).fill(undefined);
  private objectBytes = 0;
  /** Container mapping (BeginContainer's source to destination rectangles), applied after the world transform. */
  private base: Xf = [1, 0, 0, 1, 0, 0];
  private stack: { id: number; world: Xf; base: Xf; unit: number; scale: number; clip: Clip; floor: Clip }[] = [];
  /** The clip a container starts from: ResetClip and a replacing clip fall back to it, since a container's clip adds to its parent's. */
  private floor: Clip = null;
  private partial: { id: number; kind: number; total: number; data: number[] } | null = null;
  /** The image effect of the last EmfPlusSerializableObject, for the next DrawImagePoints with the E flag. */
  private effect: Effect | null = null;
  /** An image drawn with image attributes, waiting to see the bitmap of its GDI fallback (see offerFallback). */
  private fallback: { at: number; img: Rgba; src: [number, number, number, number]; m: Xf; offers: Rgba[] } | null = null;
  /** True while an image waits for its GDI fallback (emf.ts then hands the fallback's bitmaps to offerFallback). */
  get wantsFallback() { return !!this.fallback; }
  /** A bitmap from the GDI records that follow the EMF+ record (the dual file's fallback for it). */
  offerFallback(img: Rgba) { if (this.fallback && this.fallback.offers.length < 2) this.fallback.offers.push(img); }
  /**
   * After the fallback records: when they held exactly one bitmap and it shows the image recoloured, it is
   * drawn in the image's place. An EmfPlusImageAttributes object keeps only the wrap mode and clamp colour
   * (MS-EMFPLUS 2.2.1.5), so a colour matrix, gamma, threshold, colour key or remap table set on the GDI+
   * ImageAttributes is not in the EMF+ records; the GDI fallback of a dual file is GDI+'s own rendering of
   * the call, which has them applied. "Recoloured" is judged on a 32 x 32 grid of samples: the bitmaps
   * differ there by more than 16 levels in at least 30 % of the samples (a resampled but unchanged copy
   * does not), so a fallback at another resolution is used too.
   */
  settleFallback() {
    const f = this.fallback;
    this.fallback = null;
    if (!f || f.offers.length !== 1 || f.at < 0) return;
    const g = f.offers[0];
    const [sx, sy, sw, sh] = f.src;
    if (!(sw > 0 && sh > 0) || !g.w || !g.h) return;
    let differ = 0, n = 0;
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
      const u = (i + 0.5) / 32, v = (j + 0.5) / 32;
      const ax = Math.floor(sx + u * sw), ay = Math.floor(sy + v * sh), bx = Math.floor(u * g.w), by = Math.floor(v * g.h);
      if (ax < 0 || ay < 0 || ax >= f.img.w || ay >= f.img.h) continue;
      const a = (ay * f.img.w + ax) * 4, b = (by * g.w + bx) * 4;
      n++;
      if ([0, 1, 2, 3].some((c) => Math.abs(f.img.px[a + c] - g.px[b + c]) > 16)) differ++;
    }
    if (!n || differ < n * 0.3) return;
    const m = compose(f.m, [sw / g.w, 0, 0, sh / g.h, sx, sy]);
    this.out.replaceElement(f.at, `<g transform="matrix(${m.map(num).join(' ')})"><image href="${pngDataUrl(g)}" width="${g.w}" height="${g.h}" preserveAspectRatio="none"/></g>`);
  }

  constructor(private out: Out, private frame: [number, number, number, number] | null) {}

  /** Plays the records of one EMR_COMMENT (after the "EMF+" identifier). True when a GetDC record asked for the GDI records that follow. */
  comment(data: Bytes): boolean {
    let getDc = false;
    let pos = 0;
    let guard = 0;
    while (pos + 12 <= data.length && guard++ < 1_000_000 && !this.out.full) {
      const type = data.u16(pos), flags = data.u16(pos + 2), size = data.u32(pos + 4), dsize = data.u32(pos + 8);
      if (size < 12 || dsize > size - 12 || pos + 12 + dsize > data.length) break;
      if (type === 0x4004) getDc = true;
      try { this.record(type, flags, data.slice(pos + 12, dsize)); } catch { /* a record that cannot be played is skipped */ }
      pos += size;
    }
    return getDc;
  }

  // ---- state ----

  private unitFactor(unit: number): number {
    switch (unit) {
      case 3: return this.dpi / 72;
      case 4: return this.dpi;
      case 5: return this.dpi / 300;
      case 6: return this.dpi / 25.4;
      default: return 1;
    }
  }
  private xf(): Xf { const k = this.unitFactor(this.unit) * this.scale; return compose([k, 0, 0, k, 0, 0], compose(this.base, this.world)); }

  private record(type: number, flags: number, r: Bytes): void {
    if (type === 0x4001) {
      this.active = true;
      const d = r.u32(8);
      if (d > 0 && d < 100_000) this.dpi = d;
      return;
    }
    if (!this.active) return;
    const id = flags & 0xff;
    const compressed = (flags & 0x4000) !== 0;
    switch (type) {
      case 0x4008: this.object(flags, r); break;
      case 0x4009: this.clear(r.u32(0)); break;
      case 0x400a: { // FillRects: brush, count, rects
        const fill = this.fillOf(flags, r.u32(0));
        for (const rc of rects(r, 8, r.u32(4), compressed)) this.shape(rectOps(rc), fill, null);
        break;
      }
      case 0x400b: { // DrawRects: count, rects; pen in flags
        const pen = this.stroke(id);
        for (const rc of rects(r, 4, r.u32(0), compressed)) this.shape(rectOps(rc), null, pen);
        break;
      }
      case 0x400c: this.shape(polyOps(points(r, 8, r.u32(4), compressed), true), this.fillOf(flags, r.u32(0)), null); break;
      case 0x400d: this.shape(polyOps(points(r, 4, r.u32(0), compressed), (flags & 0x2000) !== 0), null, this.stroke(id)); break;
      case 0x400e: this.shape(ellipseOps(rects(r, 4, 1, compressed)[0]), this.fillOf(flags, r.u32(0)), null); break;
      case 0x400f: this.shape(ellipseOps(rects(r, 0, 1, compressed)[0]), null, this.stroke(id)); break;
      case 0x4010: this.shape(pieOps(rects(r, 12, 1, compressed)[0], r.f32(4), r.f32(8), true), this.fillOf(flags, r.u32(0)), null); break;
      case 0x4011: this.shape(pieOps(rects(r, 8, 1, compressed)[0], r.f32(0), r.f32(4), true), null, this.stroke(id)); break;
      case 0x4012: this.shape(pieOps(rects(r, 8, 1, compressed)[0], r.f32(0), r.f32(4), false), null, this.stroke(id)); break;
      case 0x4014: { const p = this.path(id); if (p) this.shape(p, this.fillOf(flags, r.u32(0)), null); break; }
      case 0x4015: { const p = this.path(id); if (p) this.shape(p, null, this.stroke(r.u32(0))); break; }
      case 0x4016: this.shape(curveOps(points(r, 12, r.u32(8), compressed), r.f32(4), true), this.fillOf(flags, r.u32(0)), null); break;
      case 0x4017: this.shape(curveOps(points(r, 8, r.u32(4), compressed), r.f32(0), true), null, this.stroke(id)); break;
      case 0x4018: this.shape(curveOps(points(r, 16, r.u32(12), compressed), r.f32(0), false), null, this.stroke(id)); break;
      case 0x4019: { // DrawBeziers
        const pts = points(r, 4, r.u32(0), compressed);
        const ops: Op[] = pts.length ? [{ t: 'M', x: pts[0][0], y: pts[0][1] }] : [];
        for (let i = 1; i + 2 < pts.length; i += 3) ops.push({ t: 'C', p: [...pts[i], ...pts[i + 1], ...pts[i + 2]] });
        this.shape(ops, null, this.stroke(id));
        break;
      }
      case 0x401a: this.drawImage(id, r, compressed); break;
      case 0x401b: this.drawImagePoints(id, r, compressed, flags); break;
      case 0x4038: this.effect = parseEffect(r); break; // SerializableObject: an image effect
      case 0x401c: this.drawString(flags, r); break;
      case 0x4036: this.drawDriverString(flags, r); break;
      case 0x4025: case 0x4028: case 0x4027: // Save, BeginContainerNoParams, BeginContainer
        if (this.stack.length < MAX_STACK) {
          this.stack.push({ id: r.u32(type === 0x4027 ? 32 : 0), world: this.world, base: this.base, unit: this.unit, scale: this.scale, clip: this.out.clip, floor: this.floor });
          if (type !== 0x4025) this.floor = this.out.clip;
          if (type === 0x4027) {
            // The source rectangle (in the unit named by the flags) is mapped onto the destination rectangle (in the current units); the container starts with an identity world transform.
            const [dx, dy, dw, dh, sx, sy, sw, sh] = [r.f32(0), r.f32(4), r.f32(8), r.f32(12), r.f32(16), r.f32(20), r.f32(24), r.f32(28)];
            if (sw && sh && dw && dh) {
              const kx = dw / sw, ky = dh / sh;
              this.base = compose(compose(this.base, this.world), [kx, 0, 0, ky, dx - sx * kx, dy - sy * ky]);
              this.world = [1, 0, 0, 1, 0, 0];
            }
          }
        }
        break;
      case 0x4026: case 0x4029: { // Restore, EndContainer
        const want = r.u32(0);
        const i = this.stack.map((s) => s.id).lastIndexOf(want);
        if (i < 0) break;
        const s = this.stack[i];
        this.stack.length = i;
        this.world = s.world; this.base = s.base; this.unit = s.unit; this.scale = s.scale;
        this.out.clip = s.clip; this.floor = s.floor;
        break;
      }
      case 0x402a: this.world = xform(r, 0); break;
      case 0x402b: this.world = [1, 0, 0, 1, 0, 0]; break;
      case 0x402c: this.mult(xform(r, 0), flags); break;
      case 0x402d: this.mult([1, 0, 0, 1, r.f32(0), r.f32(4)], flags); break;
      case 0x402e: this.mult([r.f32(0), 0, 0, r.f32(4), 0, 0], flags); break;
      case 0x402f: { const a = (r.f32(0) * Math.PI) / 180; this.mult([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0], flags); break; }
      case 0x4030: this.unit = flags & 0xff; this.scale = r.f32(0) > 0 ? r.f32(0) : 1; break;
      case 0x4031: this.out.clip = this.floor; break;
      case 0x4032: this.clip(rectOps(rects(r, 0, 1, compressed)[0]), (flags >> 8) & 0xf); break;
      case 0x4033: { const p = this.path(id); if (p) this.clip(p, (flags >> 8) & 0xf); break; }
      case 0x4034: { const o = this.objects[id]; if (o?.k === 'region') this.clipRegion(o.v, (flags >> 8) & 0xf); break; } // SetClipRegion
      case 0x4013: { // FillRegion: brush (or colour), region in the flags
        const o = this.objects[id];
        if (o?.k === 'region') this.fillRegion(o.v, this.fillOf(flags, r.u32(0)));
        break;
      }
      default: break; // rendering hints, regions, effects, terminal-server records: not drawn
    }
  }

  private mult(m: Xf, flags: number) { this.world = flags & 0x2000 ? compose(m, this.world) : compose(this.world, m); }

  /** CombineMode: 0 replace, 1 intersect, 2 union, 3 xor, 4 exclude (clip minus shape), 5 complement (shape minus clip). All exact, however many clips are nested. */
  private clip(ops: Op[], mode: number, empty = false) {
    if (mode > 5) return;
    const pd = empty ? this.out.rawPath('M0 0') : this.toPath(ops, this.xf());
    const m = (['copy', 'and', 'or', 'xor', 'diff', 'complement'] as const)[mode];
    if (m === 'copy') { // replaces the clip, inside the container's own (parent) clip
      const keep = this.floor;
      this.out.clip = keep;
      this.out.combineClip(pd, keep ? 'and' : 'copy', true);
    } else this.out.combineClip(pd, m, true);
  }

  /** A region as a clip expression in device space (paths transformed by `m`). Null when the tree is too big to draw. */
  private regionClip(n: RegionNode, m: Xf, budget = { left: 400 }): ClipNode | null {
    if (budget.left-- <= 0) return null;
    const path = (ops: Op[]): ClipNode => { const pd = this.toPath(ops, m); return { k: 'path', d: pd.empty ? 'M0 0' : pd.d, eo: false, n: 1 }; };
    switch (n.t) {
      case 'rect': return path(rectOps(n.r));
      case 'path': return path(n.ops);
      case 'empty': return { k: 'path', d: 'M0 0', eo: false, n: 1 };
      case 'inf': return { k: 'path', d: BIG, eo: false, n: 1 };
      default: {
        const a = this.regionClip(n.a, m, budget), b = this.regionClip(n.b, m, budget);
        if (!a || !b) return null;
        const size = a.n + b.n + 1;
        switch (n.m) {
          case 1: return { k: 'and', a, b, n: size };
          case 2: return { k: 'or', a, b, n: size };
          case 3: return { k: 'xor', a, b, n: size };
          case 4: return { k: 'diff', a, b, n: size };
          default: return { k: 'diff', a: b, b: a, n: size }; // complement: b minus a
        }
      }
    }
  }
  private clipRegion(region: RegionNode, mode: number) {
    if (mode > 5) return;
    const node = this.regionClip(region, this.xf());
    if (!node) return;
    const m = (['copy', 'and', 'or', 'xor', 'diff', 'complement'] as const)[mode];
    if (m === 'copy') this.out.clip = this.floor;
    this.out.clip = combineClips(this.out.clip, node, m === 'copy' ? (this.floor ? 'and' : 'copy') : m);
  }
  /** FillRegion: the brush painted over the region's bounds, clipped to the region. */
  private fillRegion(region: RegionNode, brush: BrushObj | null) {
    const node = this.regionClip(region, this.xf());
    const box = regionBounds(region, this.frame);
    if (!node || !box || !brush) return;
    const keep = this.out.clip;
    this.out.clip = combineClips(keep, node, 'and');
    this.shape(rectOps(box), brush, null);
    this.out.clip = keep;
  }

  private clear(c: number) {
    if (!this.frame) return;
    const [x, y, w, h] = this.frame;
    const pd = this.out.path();
    pd.m(x, y).l(x + w, y).l(x + w, y + h).l(x, y + h).z();
    this.out.drawPath(pd, { color: argb(c) }, null);
  }

  // ---- objects ----

  private object(flags: number, r: Bytes) {
    const id = flags & 0xff, kind = (flags >> 8) & 0x7f;
    if (flags & 0x8000) {
      const total = Math.min(r.u32(0), MAX_OBJECT_BYTES);
      let p = this.partial;
      if (!p || p.id !== id || p.kind !== kind || p.total !== total) p = this.partial = { id, kind, total, data: [] };
      const chunk = r.tail(4).u8;
      for (let i = 0; i < chunk.length && p.data.length < p.total; i++) p.data.push(chunk[i]);
      if (p.data.length >= p.total) { this.partial = null; this.store(id, parseObject(kind, new Bytes(Uint8Array.from(p.data)))); }
      return;
    }
    const p = this.partial;
    if (p && p.id === id && p.kind === kind) {
      this.partial = null;
      const chunk = r.u8;
      for (let i = 0; i < chunk.length && p.data.length < p.total; i++) p.data.push(chunk[i]);
      this.store(id, parseObject(kind, new Bytes(Uint8Array.from(p.data))));
      return;
    }
    this.store(id, parseObject(kind, r));
  }
  private store(id: number, o: PlusObj | null) {
    if (id >= MAX_OBJECTS) return;
    const cost = (x: PlusObj | undefined) => (!x ? 0 : x.k === 'image' ? x.v.href.length : x.k === 'path' ? x.v.length * 48 : 256);
    this.objectBytes -= cost(this.objects[id]);
    this.objects[id] = undefined;
    if (o && this.objectBytes + cost(o) <= MAX_OBJECT_BYTES) { this.objects[id] = o; this.objectBytes += cost(o); }
  }
  private path(id: number): Op[] | null { const o = this.objects[id]; return o?.k === 'path' ? o.v : null; }

  // ---- paint ----

  /** A brush by object id, or (flag S, 0x8000) an inline ARGB colour. */
  private fillOf(flags: number, id: number): BrushObj | null {
    if (flags & 0x8000) return { k: 'solid', c: argb(id) };
    const o = this.objects[id];
    return o?.k === 'brush' ? o.v : null;
  }
  private fillFor(b: BrushObj | null, m: Xf): Fill {
    if (!b) return null;
    if (b.k === 'solid') return { color: b.c };
    if (b.k === 'hatch') return { ref: this.out.hatch(b.style, b.fg, b.bg) };
    if (b.k === 'texture') return { ref: this.out.imagePattern(b.img.href, b.img.w, b.img.h, compose(m, b.xf), b.img.px, b.img.bytes) };
    if (b.k === 'pathGradient') return this.pathFill(b, m);
    const [x, y, w] = b.rect;
    const stops = gradientStops(b.c0, b.c1, b.blend, b.gamma).map(([o, c]) => [o, colorOf4(c)] as [number, Color]);
    // Tile repeats, a flip in x reflects (the gradient runs along x of its rectangle), clamp pads.
    return { ref: this.out.linearGradient(x, y, x + w, y, stops, compose(m, b.xf), b.wrap === 1 || b.wrap === 3 ? 'reflect' : b.wrap === 4 ? 'pad' : 'repeat') };
  }
  /**
   * A path gradient: a radial gradient when its boundary is an ellipse with one surround colour, else a
   * bitmap of the triangulated boundary (gradient.ts) as an image pattern over the boundary's box. With the
   * clamp wrap mode nothing is painted outside the boundary (shape() clips to it); the tile modes repeat
   * the box, flipped for the flip modes.
   */
  private pathFill(b: BrushObj & { k: 'pathGradient' }, m: Xf): Fill {
    const g = b.g;
    const xf = compose(m, b.xf);
    const ell = asEllipse(g.boundary);
    const one = g.surround.every((c) => c.join() === g.surround[0].join());
    if (ell && one) { // the tile modes would repeat the box around the ellipse: drawn padded instead
      const st = radialStops(g).map(([o, c]) => [o, colorOf4(c)] as [number, Color]);
      const unit = compose(xf, [ell.rx, 0, 0, ell.ry, ell.cx, ell.cy]);
      return { ref: this.out.radialGradient(st, unit, (g.centerPt[0] - ell.cx) / ell.rx, (g.centerPt[1] - ell.cy) / ell.ry) };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of g.boundary) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const side = Math.max(x1 - x0, y1 - y0) * scaleOf(xf);
    const r = pathGradientImage(g, Math.min(256, Math.max(16, side)));
    if (!r) return { color: colorOf4(g.center) };
    const [bx, by, bw, bh] = r.box;
    const fxTile = g.wrap === 1 || g.wrap === 3, fyTile = g.wrap === 2 || g.wrap === 3;
    return { ref: this.out.imagePattern(pngDataUrl(r.img), bw * (fxTile ? 2 : 1), bh * (fyTile ? 2 : 1), compose(xf, [1, 0, 0, 1, bx, by]), r.img) };
  }
  private stroke(id: number): PenObj | null { const o = this.objects[id]; return o?.k === 'pen' ? o.v : null; }
  private strokeFor(p: PenObj | null, m: Xf): Stroke | null {
    if (!p) return null;
    const b = p.brush;
    const color = this.colorOf(b);
    const width = p.unit <= 1 ? p.width * scaleOf(m) : p.width * this.unitFactor(p.unit);
    const w = Math.max(width, 1);
    const unit = Math.max(width, 1);
    const dash = p.dashes?.length ? p.dashes.map((d) => d * unit) : p.dash === 1 ? [3 * unit, unit] : p.dash === 2 ? [unit, unit] : p.dash === 3 ? [3 * unit, unit, unit, unit] : p.dash === 4 ? [3 * unit, unit, unit, unit, unit, unit] : undefined;
    return { color, width: w, dash, cap: p.cap === 1 ? 'square' : p.cap === 2 ? 'round' : 'butt', join: p.join === 1 ? 'bevel' : p.join === 2 ? 'round' : 'miter', miter: p.miter };
  }
  private toPath(ops: Op[], m: Xf): PathData {
    const pd = this.out.path();
    for (const o of ops) {
      if (o.t === 'M') pd.m(...apply(m, o.x, o.y));
      else if (o.t === 'L') pd.l(...apply(m, o.x, o.y));
      else if (o.t === 'C') pd.c(...apply(m, o.p[0], o.p[1]), ...apply(m, o.p[2], o.p[3]), ...apply(m, o.p[4], o.p[5]));
      else pd.z();
    }
    return pd;
  }
  private shape(ops: Op[], fill: BrushObj | null, pen: PenObj | null) {
    if (!ops.length || (!fill && !pen)) return;
    const m = this.xf();
    if (fill?.k === 'pathGradient' && (fill.g.wrap === 4 || fill.g.wrap > 4)) {
      // Clamp: the path gradient paints only inside its boundary.
      const keep = this.out.clip;
      const bp = this.toPath(fill.ops, compose(m, fill.xf));
      this.out.clip = combineClips(keep, { k: 'path', d: bp.empty ? 'M0 0' : bp.d, eo: false, n: 1 }, 'and');
      this.out.drawPath(this.toPath(ops, m), this.fillFor(fill, m), null, true);
      this.out.clip = keep;
      if (pen) this.out.drawPath(this.toPath(ops, m), null, this.strokeFor(pen, m), true);
      return;
    }
    this.out.drawPath(this.toPath(ops, m), this.fillFor(fill, m), this.strokeFor(pen, m), true);
  }

  // ---- images ----

  private image(id: number): ImageObj | null { const o = this.objects[id]; return o?.k === 'image' ? o.v : null; }
  private attrs(id: number): ImageAttrs | null { const o = this.objects[id]; return o?.k === 'attrs' ? o.v : null; }
  /**
   * Draws the source rectangle `src` of `img` under `m`. Where the rectangle reaches past the image,
   * the image attributes say what shows there: wrap modes 0..3 repeat the image (3 = flipped
   * alternately in x and / or y), mode 4 (clamp) fills it with the clamp colour; with no attributes
   * it stays transparent.
   */
  private place(img: ImageObj, src0: [number, number, number, number], m: Xf, attrs: ImageAttrs | null = null, effect: Effect | null = null) {
    let src = src0;
    let filt = '';
    if (effect) {
      // On the pixels when they are at hand (a bitmap object, or a PNG / JPEG decoded for an effect a
      // filter cannot match); else as SVG filter primitives on the image (effects.ts).
      const raw = img.px ?? (needsPixels(effect) && img.bytes ? smallDecoded(img.bytes) : null);
      const res = raw ? applyEffect(effect, raw) : null;
      if (raw && res) {
        const kx = img.w / raw.w, ky = img.h / raw.h;
        img = { href: pngDataUrl(res.img), w: res.img.w * kx, h: res.img.h * ky, px: res.img };
        if (res.dx || res.dy) { // an expanding blur: the bitmap grew by its radius on every side, and so does what is shown
          m = compose(m, [1, 0, 0, 1, res.dx * kx, res.dy * ky]);
          src = [src[0], src[1], src[2] - 2 * res.dx * kx, src[3] - 2 * res.dy * ky];
        }
      } else if (!raw) {
        const f = effectFilter(effect, img.w, img.h);
        if (f) {
          const id = this.out.id('f');
          this.out.addDef(`<filter id="${id}" color-interpolation-filters="sRGB" ${f.region}>${f.prim}</filter>`);
          filt = ` filter="url(#${id})"`;
        }
      }
    }
    const [sx, sy, sw, sh] = src;
    if (this.out.recording) this.recordImage(img, src, m, effect && filt ? effect : null);
    const whole = sx <= 0 && sy <= 0 && sx + sw >= img.w && sy + sh >= img.h;
    const inside = sx >= 0 && sy >= 0 && sx + sw <= img.w && sy + sh <= img.h;
    for (const [px, py] of [[sx, sy], [sx + sw, sy], [sx + sw, sy + sh], [sx, sy + sh]]) this.out.grow(...apply(m, px, py));
    const one = (x: number, y: number, fx: boolean, fy: boolean) =>
      `<image href="${img.href}" ${fx || fy ? `transform="matrix(${fx ? -1 : 1} 0 0 ${fy ? -1 : 1} ${num(fx ? x + img.w : x)} ${num(fy ? y + img.h : y)})" ` : `x="${num(x)}" y="${num(y)}" `}width="${num(img.w)}" height="${num(img.h)}" preserveAspectRatio="none"${filt}/>`;
    const waitFallback = (at: number) => {
      const px = attrs && !effect ? img.px ?? (img.bytes ? smallDecoded(img.bytes) : null) : null;
      // Two such images in one EMF+ comment share one stretch of fallback records: neither can be matched.
      if (px && px.w === Math.round(img.w) && px.h === Math.round(img.h)) this.fallback = this.fallback ? { ...this.fallback, at: -1 } : { at, img: px, src, m, offers: [] };
    };
    if (!(sw > 0 && sh > 0) || (whole && inside) || (!attrs && whole)) {
      waitFallback(this.out.element(`<g transform="matrix(${m.map(num).join(' ')})">${one(0, 0, false, false)}</g>`));
      return;
    }
    let content = '';
    if (!inside && attrs && attrs.wrap <= 3 && img.w > 0 && img.h > 0) {
      const i0 = Math.floor(sx / img.w), i1 = Math.ceil((sx + sw) / img.w), j0 = Math.floor(sy / img.h), j1 = Math.ceil((sy + sh) / img.h);
      if ((i1 - i0) * (j1 - j0) <= 400) {
        for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
          content += one(i * img.w, j * img.h, (attrs.wrap === 1 || attrs.wrap === 3) && (i & 1) !== 0, (attrs.wrap === 2 || attrs.wrap === 3) && (j & 1) !== 0);
        }
      } else content = one(0, 0, false, false);
    } else {
      if (!inside && attrs && attrs.wrap === 4 && attrs.clamp.a > 0) content += `<rect x="${num(sx)}" y="${num(sy)}" width="${num(sw)}" height="${num(sh)}" fill="${attrs.clamp.rgb}"${attrs.clamp.a < 1 ? ` fill-opacity="${num(attrs.clamp.a)}"` : ''}/>`;
      content += one(0, 0, false, false);
    }
    waitFallback(this.out.element(`<g transform="matrix(${m.map(num).join(' ')})"><svg x="${num(sx)}" y="${num(sy)}" width="${num(sw)}" height="${num(sh)}" viewBox="${num(sx)} ${num(sy)} ${num(sw)} ${num(sh)}" preserveAspectRatio="none" overflow="hidden">${content}</svg></g>`));
  }
  /** An image just placed, for the flood-fill rasteriser: its pixels (decoded if need be, through the effect a filter applied) within the source rectangle. */
  private recordImage(img: ImageObj, src: [number, number, number, number], m: Xf, effect: Effect | null) {
    let px = img.px ?? (img.bytes ? decodedImage(img.bytes) : null);
    if (!px) return;
    if (effect) { const r = applyEffect(effect, px); if (r) { m = compose(m, [1, 0, 0, 1, (r.dx * img.w) / px.w, (r.dy * img.h) / px.h]); px = r.img; } }
    const kx = img.w / px.w, ky = img.h / px.h;
    const [sx, sy, sw, sh] = src;
    const x0 = Math.max(0, Math.floor(sx / kx)), y0 = Math.max(0, Math.floor(sy / ky)), x1 = Math.min(px.w, Math.ceil((sx + sw) / kx)), y1 = Math.min(px.h, Math.ceil((sy + sh) / ky));
    if (x1 <= x0 || y1 <= y0) return;
    const part = x0 > 0 || y0 > 0 || x1 < px.w || y1 < px.h ? cropRgba(px, x0, y0, x1 - x0, y1 - y0) : px;
    if (part) this.out.recordImage(compose(m, [kx, 0, 0, ky, x0 * kx, y0 * ky]), part);
  }
  /** DrawImage: attributes id, source unit, source rectangle (floats), destination rectangle. */
  private drawImage(id: number, r: Bytes, compressed: boolean) {
    const img = this.image(id);
    if (!img) return;
    const src: [number, number, number, number] = [r.f32(8), r.f32(12), r.f32(16), r.f32(20)];
    const dst = rects(r, 24, 1, compressed)[0];
    if (!dst || !src[2] || !src[3]) return;
    const kx = dst[2] / src[2], ky = dst[3] / src[3];
    this.place(img, src, compose(this.xf(), [kx, 0, 0, ky, dst[0] - src[0] * kx, dst[1] - src[1] * ky]), this.attrs(r.u32(0)));
  }
  /** DrawImagePoints: three corner points (top-left, top-right, bottom-left) give the parallelogram. */
  private drawImagePoints(id: number, r: Bytes, compressed: boolean, flags = 0) {
    const img = this.image(id);
    if (!img) return;
    const src: [number, number, number, number] = [r.f32(8), r.f32(12), r.f32(16), r.f32(20)];
    const p = flags & 0x0800 ? relPoints(r, 28, Math.min(r.u32(24), 3)) : points(r, 28, Math.min(r.u32(24), 3), compressed);
    // E flag: the image is drawn through the effect of the last SerializableObject record.
    const effect = flags & 0x2000 ? this.effect : null;
    if (p.length < 3 || !src[2] || !src[3]) return;
    const [ul, ur, ll] = p;
    const a = (ur[0] - ul[0]) / src[2], b = (ur[1] - ul[1]) / src[2], c = (ll[0] - ul[0]) / src[3], d = (ll[1] - ul[1]) / src[3];
    this.place(img, src, compose(this.xf(), [a, b, c, d, ul[0] - a * src[0] - c * src[1], ul[1] - b * src[0] - d * src[1]]), this.attrs(r.u32(0)), effect);
  }

  // ---- text ----

  private textStyle(font: FontObj, m: Xf) {
    const size = Math.max((font.unit <= 1 ? font.em * scaleOf(m) : font.em * this.unitFactor(font.unit)), 0.5);
    const attrs = `font-family="${xmlText(`'${font.family.replace(/['"\\<>&]/g, '')}', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', Arial, sans-serif`)}" font-size="${num(size)}"${font.style & 1 ? ' font-weight="bold"' : ''}${font.style & 2 ? ' font-style="italic"' : ''}${font.style & 4 ? ' text-decoration="underline"' : font.style & 8 ? ' text-decoration="line-through"' : ''}`;
    return { size, attrs };
  }
  private colorOf(b: BrushObj | null): Color { return !b ? { rgb: '#000000', a: 1 } : b.k === 'solid' ? b.c : b.k === 'hatch' ? b.fg : b.k === 'texture' ? { rgb: '#808080', a: 1 } : b.k === 'pathGradient' ? colorOf4(b.g.center) : colorOf4(b.c0); }

  /** DrawString: brush, format, length, layout rectangle, UTF-16 text; the font object is in the flags. */
  private drawString(flags: number, r: Bytes) {
    const o = this.objects[flags & 0xff];
    if (o?.k !== 'font') return;
    const n = Math.min(r.u32(8), MAX_CHARS);
    const str = r.utf16(28, n);
    if (!str) return;
    const f = this.objects[r.u32(4)];
    const fmt = f?.k === 'format' ? f.v : { align: 0, lineAlign: 0 };
    const [x, y, w, h] = [r.f32(12), r.f32(16), r.f32(20), r.f32(24)];
    const m = this.xf();
    const { size, attrs } = this.textStyle(o.v, m);
    const c = this.colorOf(this.fillOf(flags, r.u32(0)));
    const lines = str.split(/\r\n|\r|\n/);
    const em = size / (scaleOf(m) || 1);
    const lineH = em * 1.2;
    const total = lines.length * lineH;
    const top = fmt.lineAlign === 1 ? y + (h - total) / 2 : fmt.lineAlign === 2 ? y + h - total : y;
    const ax = fmt.align === 1 ? x + w / 2 : fmt.align === 2 ? x + w : x;
    const anchor = fmt.align === 1 ? 'middle' : fmt.align === 2 ? 'end' : 'start';
    const rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    lines.forEach((line, i) => {
      if (!line) return;
      const [px, py] = apply(m, ax, top + i * lineH + em * 0.9);
      const lw = textWidth(line, o.v.family, size, (o.v.style & 1) !== 0, (o.v.style & 2) !== 0);
      const lx = anchor === 'middle' ? -lw / 2 : anchor === 'end' ? -lw : 0;
      this.out.grow(px + lx, py - size); this.out.grow(px + lx + lw, py + size * 0.3);
      this.out.element(`<text xml:space="preserve" transform="translate(${num(px)} ${num(py)})${rot ? ` rotate(${num(rot)})` : ''}" ${attrs}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} fill="${c.rgb}"${c.a < 1 ? ` fill-opacity="${num(c.a)}"` : ''}>${xmlText(line)}</text>`);
      if (this.out.recording) {
        const bold = (o.v.style & 1) !== 0, italic = (o.v.style & 2) !== 0;
        const chars = [...line], adv = charAdvances(chars, o.v.family, size, bold, italic);
        const sum = adv.reduce((t, v) => t + v, 0), a = (rot * Math.PI) / 180;
        const off = anchor === 'middle' ? -sum / 2 : anchor === 'end' ? -sum : 0;
        this.out.recordText(textCoverage({ family: o.v.family, bold, italic, size, chars, origins: baselineOrigins(px + Math.cos(a) * off, py + Math.sin(a) * off, adv, a), advances: adv, angle: a, underline: (o.v.style & 4) !== 0, strike: (o.v.style & 8) !== 0 }), c);
      }
    });
  }

  /**
   * DrawDriverString: brush, options, matrix flag, glyph count, glyph codes, positions. Character codes
   * are drawn as text; glyph indices (no CmapLookup option) are mapped back to characters through the
   * font's cmap when its file is known (fonts.ts), else each glyph is a pale box where it would stand.
   */
  private drawDriverString(flags: number, r: Bytes) {
    const o = this.objects[flags & 0xff];
    if (o?.k !== 'font') return;
    const opts = r.u32(4), n = Math.min(r.u32(12), MAX_CHARS);
    if (!n) return;
    const bold = (o.v.style & 1) !== 0, italic = (o.v.style & 2) !== 0;
    const codes: number[] = [];
    for (let i = 0; i < n && r.has(16 + i * 2, 2); i++) codes.push(r.u16(16 + i * 2));
    const glyphs = !(opts & 1);
    const chars = glyphs ? glyphsToText(o.v.family, codes, bold, italic) : codes.map((c) => String.fromCharCode(c));
    const realized = (opts & 4) !== 0;
    const pos = 16 + Math.ceil((n * 2) / 4) * 4;
    const m = this.xf();
    const { size, attrs } = this.textStyle(o.v, m);
    const c = this.colorOf(this.fillOf(flags, r.u32(0)));
    const xs: number[] = [], ys: number[] = [];
    const count = realized ? 1 : n;
    for (let i = 0; i < count && r.has(pos + i * 8, 8); i++) { const [px, py] = apply(m, r.f32(pos + i * 8), r.f32(pos + i * 8 + 4)); xs.push(px); ys.push(py); }
    if (!xs.length) return;
    // Realized advance: only the first position is given; the rest follow the font's own advances (or a typical width).
    const adv = glyphs ? glyphAdvancesEm(o.v.family, codes, bold, italic) : null;
    const dir: [number, number] = [m[0] / (scaleOf(m) || 1), m[1] / (scaleOf(m) || 1)];
    const at = (i: number): [number, number] => {
      if (!realized) return [xs[Math.min(i, xs.length - 1)], ys[Math.min(i, ys.length - 1)]];
      let off = 0;
      for (let k = 0; k < i; k++) off += adv ? adv[k] * size : !glyphs && chars ? textWidth(chars[k] ?? '', o.v.family, size, bold, italic) : size * 0.55;
      return [xs[0] + dir[0] * off, ys[0] + dir[1] * off];
    };
    const tx: number[] = [], ty: number[] = [];
    let str = '';
    const pd = this.out.path();
    const w = size * 0.55;
    for (let i = 0; i < codes.length; i++) {
      const [x, y] = at(i);
      const ch = chars?.[i] ?? '';
      if (ch && ch.codePointAt(0)! >= 32) { str += ch; for (let k = 0; k < ch.length; k++) { tx.push(x); ty.push(y); } }
      else if (glyphs) pd.m(x + w * 0.1, y - size * 0.75).l(x + w * 0.9, y - size * 0.75).l(x + w * 0.9, y).l(x + w * 0.1, y).z();
      this.out.grow(x, y - size); this.out.grow(x + size, y + size * 0.3);
    }
    if (!pd.empty) this.out.drawPath(pd, { color: { rgb: c.rgb, a: Math.min(c.a, 0.3) } }, null);
    if (this.out.recording) {
      const origins = codes.map((_, i) => at(i));
      const advances = codes.map((_, i) => (adv ? adv[i] * size : chars?.[i] ? textWidth(chars[i], o.v.family, size, bold, italic) : size * 0.55));
      const angle = Math.atan2(dir[1], dir[0]);
      const run = glyphs ? { glyphs: codes } : { chars: chars ?? [] };
      this.out.recordText(textCoverage({ family: o.v.family, bold, italic, size, ...run, origins, advances, angle, underline: (o.v.style & 4) !== 0, strike: (o.v.style & 8) !== 0 }), c);
    }
    if (str) this.out.element(`<text xml:space="preserve" x="${tx.map(num).join(' ')}" y="${ty.map(num).join(' ')}" ${attrs} fill="${c.rgb}"${c.a < 1 ? ` fill-opacity="${num(c.a)}"` : ''}>${xmlText(str)}</text>`);
  }
}

/** A PNG / JPEG decoded for an effect, if it has at most 4 M pixels (decode.ts). */
function smallDecoded(u8: Uint8Array): Rgba | null {
  const r = decodedImage(u8);
  return r && r.w * r.h <= 4_000_000 ? r : null;
}

// ---- geometry ----

type P2 = [number, number];
const rectOps = (r?: [number, number, number, number]): Op[] => (!r ? [] : [{ t: 'M', x: r[0], y: r[1] }, { t: 'L', x: r[0] + r[2], y: r[1] }, { t: 'L', x: r[0] + r[2], y: r[1] + r[3] }, { t: 'L', x: r[0], y: r[1] + r[3] }, { t: 'Z' }]);
function polyOps(pts: P2[], close: boolean): Op[] {
  const ops: Op[] = pts.map(([x, y], i) => ({ t: i ? 'L' : 'M', x, y }));
  if (close && ops.length) ops.push({ t: 'Z' });
  return ops;
}
/** Elliptical pieces as cubic Béziers in world units (an identity mapper through the shared arc routine). */
function arcOps(r: [number, number, number, number] | undefined, t0: number, t1: number, move: boolean): Op[] {
  if (!r) return [];
  const ops: Op[] = [];
  // Reuse arcSegs through a recording stand-in for PathData.
  const rec = {
    m: (x: number, y: number) => { ops.push({ t: 'M', x, y }); return rec; },
    c: (a: number, b: number, c: number, d: number, e: number, f: number) => { ops.push({ t: 'C', p: [a, b, c, d, e, f] }); return rec; },
  };
  arcSegs(rec as unknown as PathData, (x, y) => [x, y], r[0] + r[2] / 2, r[1] + r[3] / 2, Math.abs(r[2]) / 2, Math.abs(r[3]) / 2, t0, t1, move);
  return ops;
}
const ellipseOps = (r?: [number, number, number, number]): Op[] => [...arcOps(r, 0, Math.PI * 2, true), ...(r ? [{ t: 'Z' } as Op] : [])];
function pieOps(r: [number, number, number, number] | undefined, start: number, sweep: number, pie: boolean): Op[] {
  if (!r || !sweep) return [];
  const sw = Math.max(-360, Math.min(360, sweep));
  const t0 = (start * Math.PI) / 180, t1 = t0 + (sw * Math.PI) / 180;
  const ops: Op[] = [];
  if (pie) {
    ops.push({ t: 'M', x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 }, { t: 'L', x: r[0] + r[2] / 2 + (Math.abs(r[2]) / 2) * Math.cos(t0), y: r[1] + r[3] / 2 + (Math.abs(r[3]) / 2) * Math.sin(t0) });
    ops.push(...arcOps(r, t0, t1, false), { t: 'Z' });
  } else ops.push(...arcOps(r, t0, t1, true));
  return ops;
}
/** A cardinal spline through the points as cubic Béziers. */
function curveOps(pts: P2[], tension: number, closed: boolean): Op[] {
  const n = pts.length;
  if (n < 2) return [];
  const t = Number.isFinite(tension) ? tension : 0.5;
  const at = (i: number): P2 => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const ops: Op[] = [{ t: 'M', x: pts[0][0], y: pts[0][1] }];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    ops.push({ t: 'C', p: [p1[0] + (t * (p2[0] - p0[0])) / 3, p1[1] + (t * (p2[1] - p0[1])) / 3, p2[0] - (t * (p3[0] - p1[0])) / 3, p2[1] - (t * (p3[1] - p1[1])) / 3, p2[0], p2[1]] });
  }
  if (closed) ops.push({ t: 'Z' });
  return ops;
}

const xform = (r: Bytes, o: number): Xf => [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)];

/** `n` points at `o`: 16-bit integers when compressed, else floats. */
function points(r: Bytes, o: number, n: number, compressed: boolean): P2[] {
  const out: P2[] = [];
  const step = compressed ? 4 : 8;
  for (let i = 0; i < Math.min(n, MAX_POINTS) && r.has(o + i * step, step); i++) out.push(compressed ? [r.i16(o + i * step), r.i16(o + i * step + 2)] : [r.f32(o + i * step), r.f32(o + i * step + 4)]);
  return out;
}
/** `n` EmfPlusPointR points at `o`: 7-bit or 15-bit signed integers, each relative to the one before. */
function relPoints(r: Bytes, o: number, n: number): P2[] {
  const out: P2[] = [];
  let x = 0, y = 0;
  const int = (): number => {
    const b0 = r.u8At(o++);
    if (!(b0 & 0x80)) return b0 & 0x40 ? (b0 & 0x7f) - 0x80 : b0 & 0x7f;
    const v = ((b0 & 0x7f) << 8) | r.u8At(o++);
    return v & 0x4000 ? v - 0x8000 : v;
  };
  for (let i = 0; i < n && o < r.length; i++) { x += int(); y += int(); out.push([x, y]); }
  return out;
}
/** `n` rectangles (x, y, w, h) at `o`. */
function rects(r: Bytes, o: number, n: number, compressed: boolean): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const step = compressed ? 8 : 16;
  for (let i = 0; i < Math.min(n, MAX_POINTS) && r.has(o + i * step, step); i++) {
    const b = o + i * step;
    out.push(compressed ? [r.i16(b), r.i16(b + 2), r.i16(b + 4), r.i16(b + 6)] : [r.f32(b), r.f32(b + 4), r.f32(b + 8), r.f32(b + 12)]);
  }
  return out;
}

// ---- object parsing ----

function parseObject(kind: number, r: Bytes): PlusObj | null {
  switch (kind) {
    case 1: { const v = parseBrush(r); return v ? { k: 'brush', v } : null; }
    case 2: { const v = parsePen(r); return v ? { k: 'pen', v } : null; }
    case 3: { const v = parsePath(r); return v ? { k: 'path', v } : null; }
    case 4: { const v = parseRegion(r); return v ? { k: 'region', v } : null; }
    case 5: { const v = parseImage(r); return v ? { k: 'image', v } : null; }
    case 6: {
      const n = Math.min(r.u32(20), 256);
      const em = r.f32(4);
      if (!(em > 0)) return null;
      return { k: 'font', v: { em, unit: r.u32(8), style: r.u32(12), family: r.utf16(24, n).trim() || 'Arial' } };
    }
    case 7: return { k: 'format', v: { align: r.u32(12), lineAlign: r.u32(16) } };
    case 8: return { k: 'attrs', v: { wrap: r.u32(8), clamp: argb(r.u32(12)), clampObject: r.u32(16) !== 0 } }; // image attributes: version, reserved, wrap mode, clamp colour, object clamp
    default: return null;
  }
}

/** A brush: version, type, then solid ARGB, hatch (style, fore, back), a path gradient (centre colour) or a linear gradient. */
function parseBrush(r: Bytes): BrushObj | null {
  const type = r.u32(4);
  if (type === 0) return { k: 'solid', c: argb(r.u32(8)) };
  if (type === 1) return { k: 'hatch', style: r.u32(8), fg: argb(r.u32(12)), bg: argb(r.u32(16)) };
  if (type === 3) return parsePathGradient(r);
  if (type === 4) {
    const bf = r.u32(8), wrap = r.u32(12);
    const rect: [number, number, number, number] = [r.f32(16), r.f32(20), r.f32(24), r.f32(28)];
    const c0 = c4(r.u32(32)), c1 = c4(r.u32(36));
    let o = 48;
    let xf: Xf = [1, 0, 0, 1, 0, 0];
    if (bf & 0x2) { xf = [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)]; o += 24; }
    const blend = readBlend(r, o, bf);
    return { k: 'linear', rect, c0, c1, blend: blend.v, gamma: (bf & 0x80) !== 0, xf, wrap };
  }
  if (type === 2) { // texture brush: flags, wrap mode, optional transform, then the image object
    const bf = r.u32(8);
    let o = 16;
    let xf: Xf = [1, 0, 0, 1, 0, 0];
    if (bf & 0x2) { xf = [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)]; o += 24; }
    const img = parseImage(r.tail(o));
    return img ? { k: 'texture', img, xf } : null;
  }
  return null;
}

/**
 * Blend data after a gradient's transform: preset colours (flag 0x4: count, positions, ARGB colours) or
 * horizontal blend factors (0x8: count, positions, factors); vertical factors (0x10) are read past.
 */
function readBlend(r: Bytes, o: number, bf: number): { v: Blend | null; end: number } {
  let v: Blend | null = null;
  const take = (kind: 'colors' | 'factors') => {
    const n = Math.min(r.u32(o), 256);
    const pos = Array.from({ length: n }, (_, i) => r.f32(o + 4 + i * 4));
    const vals = Array.from({ length: n }, (_, i) => (kind === 'colors' ? r.u32(o + 4 + n * 4 + i * 4) : r.f32(o + 4 + n * 4 + i * 4)));
    o += 4 + n * 8;
    if (n < 2) return null;
    return kind === 'colors' ? { pos, colors: vals.map(c4) } : { pos, factors: vals };
  };
  if (bf & 0x4) v = take('colors');
  else {
    if (bf & 0x8) v = take('factors');
    if (bf & 0x10) { const h = take('factors'); v ??= h; }
  }
  return { v, end: o };
}

/**
 * A path gradient brush: flags, wrap, centre colour, centre point, surround colours, the boundary (a path
 * with flag 0x1, else points), then the optional transform (0x2), preset colours (0x4) or blend factors
 * (0x8), focus scales (0x40); 0x80 is gamma correction.
 */
function parsePathGradient(r: Bytes): BrushObj | null {
  const bf = r.u32(8), wrap = r.u32(12);
  const center = c4(r.u32(16)), centerPt: [number, number] = [r.f32(20), r.f32(24)];
  const ns = Math.min(r.u32(28), 4096);
  const surround = Array.from({ length: Math.max(ns, 1) }, (_, i) => (ns ? c4(r.u32(32 + i * 4)) : center));
  let o = 32 + ns * 4;
  let ops: Op[] = [];
  if (bf & 0x1) {
    const size = r.u32(o);
    ops = parsePath(r.slice(o + 4, size)) ?? [];
    o += 4 + size;
  } else {
    const n = Math.min(r.u32(o), MAX_POINTS);
    ops = polyOps(points(r, o + 4, n, false), true);
    o += 4 + n * 8;
  }
  const boundary = flatten(ops);
  if (boundary.length < 3) return { k: 'solid', c: colorOf4(center) };
  let xf: Xf = [1, 0, 0, 1, 0, 0];
  if (bf & 0x2) { xf = [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)]; o += 24; }
  const blend = readBlend(r, o, bf);
  o = blend.end;
  let focus: [number, number] | null = null;
  if (bf & 0x40 && r.u32(o) === 2) focus = [r.f32(o + 4), r.f32(o + 8)];
  // GDI+ hands one colour per boundary point; with fewer, the last one repeats.
  const g: PathGradient = { center, centerPt, boundary, surround, blend: blend.v, focus, gamma: (bf & 0x80) !== 0, wrap };
  return { k: 'pathGradient', g, ops, xf };
}

/** Path ops as one closed polygon (Béziers flattened; later figures appended). */
function flatten(ops: Op[]): [number, number][] {
  const pts: [number, number][] = [];
  let cx = 0, cy = 0;
  for (const o of ops) {
    if (pts.length > 4096) break;
    if (o.t === 'M' || o.t === 'L') { pts.push([o.x, o.y]); cx = o.x; cy = o.y; }
    else if (o.t === 'C') {
      const [x1, y1, x2, y2, x3, y3] = o.p;
      for (let s = 1; s <= 12; s++) { const t = s / 12, a = 1 - t; pts.push([a * a * a * cx + 3 * a * a * t * x1 + 3 * a * t * t * x2 + t * t * t * x3, a * a * a * cy + 3 * a * a * t * y1 + 3 * a * t * t * y2 + t * t * t * y3]); }
      cx = x3; cy = y3;
    }
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}

/**
 * A region object: version, node count, then the node tree in pre-order. A combine node (types 1..5)
 * is followed by its left and right children. Leaf types: 0x10000000 rectangle (4 floats), 0x10000001
 * path (size, then an EmfPlusPath), 0x10000002 empty, 0x10000003 infinite.
 */
function parseRegion(r: Bytes): RegionNode | null {
  let o = 8, guard = 0;
  const node = (depth: number): RegionNode | null => {
    if (guard++ > 4096 || depth > 64 || !r.has(o, 4)) return null;
    const type = r.u32(o); o += 4;
    if (type === 0x10000000) { const v: R4 = [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12)]; o += 16; return v[2] > 0 && v[3] > 0 ? { t: 'rect', r: v } : { t: 'empty' }; }
    if (type === 0x10000002) return { t: 'empty' };
    if (type === 0x10000003) return { t: 'inf' };
    if (type === 0x10000001) {
      const size = r.u32(o); o += 4;
      const ops = parsePath(r.slice(o, size));
      o += size;
      return ops && ops.length ? { t: 'path', ops } : { t: 'empty' };
    }
    if (type >= 1 && type <= 5) {
      const a = node(depth + 1), b = a && node(depth + 1);
      return a && b ? { t: 'op', m: type, a, b } : null;
    }
    return null;
  };
  return node(0);
}

/** The box a region fills (world units); an infinite region fills the picture frame. */
function regionBounds(n: RegionNode, frame: [number, number, number, number] | null): R4 | null {
  const box = (x0: number, y0: number, x1: number, y1: number): R4 | null => (x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null);
  const union = (a: R4 | null, b: R4 | null): R4 | null => (!a ? b : !b ? a : box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0] + a[2], b[0] + b[2]), Math.max(a[1] + a[3], b[1] + b[3])));
  switch (n.t) {
    case 'rect': return n.r;
    case 'empty': return null;
    case 'inf': return frame ? [...frame] as R4 : [-1e5, -1e5, 2e5, 2e5];
    case 'path': {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of n.ops) {
        const pts = p.t === 'C' ? [[p.p[0], p.p[1]], [p.p[2], p.p[3]], [p.p[4], p.p[5]]] : p.t === 'Z' ? [] : [[p.x, p.y]];
        for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      return box(x0, y0, x1, y1);
    }
    default: {
      const a = regionBounds(n.a, frame), b = regionBounds(n.b, frame);
      return n.m === 4 ? a : n.m === 5 ? b : n.m === 1 ? union(a, b) : union(a, b);
    }
  }
}

/** A pen: version, type, flags, unit, width, then the optional parts the flags name, then its brush. */
function parsePen(r: Bytes): PenObj | null {
  const fl = r.u32(8), unit = r.u32(12), width = r.f32(16);
  let o = 20;
  const pen: PenObj = { width, unit, brush: { k: 'solid', c: { rgb: '#000000', a: 1 } }, dash: 0, cap: 0, join: 0, miter: 10 };
  if (fl & 0x1) o += 24;
  if (fl & 0x2) { pen.cap = r.u32(o); o += 4; }
  if (fl & 0x4) o += 4;
  if (fl & 0x8) { pen.join = r.u32(o); o += 4; }
  if (fl & 0x10) { pen.miter = r.f32(o) || 10; o += 4; }
  if (fl & 0x20) { pen.dash = r.u32(o); o += 4; }
  if (fl & 0x40) o += 4;
  if (fl & 0x80) o += 4;
  if (fl & 0x100) {
    const n = Math.min(r.u32(o), 64);
    if (pen.dash === 5) pen.dashes = Array.from({ length: n }, (_, i) => Math.max(r.f32(o + 4 + i * 4), 0.1));
    o += 4 + n * 4;
  }
  if (fl & 0x200) o += 4;
  if (fl & 0x400) o += 4 + Math.min(r.u32(o), 64) * 4;
  if (fl & 0x800) o += 4 + r.u32(o);
  if (fl & 0x1000) o += 4 + r.u32(o);
  const b = parseBrush(r.tail(o));
  if (b) pen.brush = b;
  return pen;
}

/** A path: version, point count, flags (0x4000 compressed 16-bit points), the points, one type byte per point. */
function parsePath(r: Bytes): Op[] | null {
  const n = r.u32(4), fl = r.u32(8);
  if (n > MAX_POINTS) return null;
  const compressed = (fl & 0x4000) !== 0;
  let pts: P2[], tOff: number;
  if (fl & 0x800) {
    // Relative coordinates: each value is a 1-byte (7-bit) or 2-byte (15-bit, big-endian) signed integer, added to the previous point.
    pts = [];
    let o = 12, x = 0, y = 0;
    const int = (): number => {
      const b0 = r.u8At(o++);
      if (!(b0 & 0x80)) return b0 & 0x40 ? (b0 & 0x7f) - 0x80 : b0 & 0x7f;
      const v = ((b0 & 0x7f) << 8) | r.u8At(o++);
      return v & 0x4000 ? v - 0x8000 : v;
    };
    for (let i = 0; i < n && o < r.length; i++) { x += int(); y += int(); pts.push([x, y]); }
    tOff = o;
  } else {
    pts = points(r, 12, n, compressed);
    tOff = 12 + n * (compressed ? 4 : 8);
  }
  const ops: Op[] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = r.u8At(tOff + i);
    const kind = t & 0xf;
    const close = (t & 0x80) !== 0;
    if (kind === 0) ops.push({ t: 'M', x: pts[i][0], y: pts[i][1] });
    else if (kind === 3 && i + 2 < pts.length) {
      ops.push({ t: 'C', p: [...pts[i], ...pts[i + 1], ...pts[i + 2]] });
      i += 2;
      if (r.u8At(tOff + i) & 0x80) ops.push({ t: 'Z' });
      continue;
    } else ops.push({ t: 'L', x: pts[i][0], y: pts[i][1] });
    if (close) ops.push({ t: 'Z' });
  }
  return ops;
}

/** An image: version, type (1 bitmap, 2 metafile). */
function parseImage(r: Bytes): ImageObj | null {
  const type = r.u32(4);
  if (type === 1) {
    const w = r.i32(8), h = r.i32(12), stride = r.i32(16), fmt = r.u32(20), compressed = r.u32(24) === 1;
    if (compressed) {
      const u8 = r.tail(28).u8;
      const href = encodedImageUrl(u8);
      return href ? { href, w: w || 1, h: h || 1, bytes: u8 } : null;
    }
    if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || w * h > 40_000_000) return null;
    const bpp = (fmt >>> 8) & 0xff;
    const px = new Uint8ClampedArray(w * h * 4);
    const s = Math.abs(stride);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = 28 + y * s + x * (bpp >> 3), d = (y * w + x) * 4;
      if (bpp === 32) {
        const a = fmt === 0x26200a || fmt === 0xe200b ? r.u8At(o + 3) : 255;
        const k = fmt === 0xe200b && a ? 255 / a : 1; // premultiplied
        px[d] = r.u8At(o + 2) * k; px[d + 1] = r.u8At(o + 1) * k; px[d + 2] = r.u8At(o) * k; px[d + 3] = a;
      } else if (bpp === 24) { px[d] = r.u8At(o + 2); px[d + 1] = r.u8At(o + 1); px[d + 2] = r.u8At(o); px[d + 3] = 255; }
      else return null;
    }
    return { href: pngDataUrl({ w, h, px }), w, h, px: { w, h, px } };
  }
  if (type === 2 && nestedRenderer && nesting < 2) {
    const size = r.u32(12);
    nesting++;
    try {
      const res = nestedRenderer(r.slice(16, size).u8);
      return res ? { href: res.href, w: res.w, h: res.h } : null;
    } finally { nesting--; }
  }
  return null;
}

