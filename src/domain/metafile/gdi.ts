// The GDI device context shared by the WMF and EMF players: object table, selected pen / brush /
// font, window-viewport and world transforms, paths and clip groups. Drawing goes to an `Out`
// (SVG) in device units; the picture's frame is mapped to the SVG view box afterwards.
import { apply, compose, scaleOf, type Xf, type Bytes } from './bytes';
import { hex, num, Out, PathData, xmlText, type Color, type Fill, type Stroke } from './out';
import { cropRgba, pngDataUrl, type Dib } from './png';

export interface GdiPen { style: number; width: number; color: Color; cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; cosmetic: boolean }
export interface GdiBrush { style: number; color: Color; hatch: number; pattern?: { href: string; w: number; h: number } }
export interface GdiFont { family: string; height: number; weight: number; italic: boolean; underline: boolean; strike: boolean; charset: number; escapement: number }
export type GdiObject = { k: 'pen'; pen: GdiPen } | { k: 'brush'; brush: GdiBrush } | { k: 'font'; font: GdiFont } | { k: 'other' };

export const MAX_OBJECTS = 8192;
const MAX_STACK = 1024;
const MAX_TEXT = 32768;
export const MAX_POINTS = 1_000_000;

export const BS_SOLID = 0, BS_NULL = 1, BS_HATCHED = 2, BS_PATTERN = 3, BS_DIBPATTERN = 5, BS_DIBPATTERNPT = 6;
export const PS_NULL = 5;

export const colorref = (v: number): Color => ({ rgb: hex(v & 255, (v >>> 8) & 255, (v >>> 16) & 255), a: 1 });
const BLACK = colorref(0), WHITE = colorref(0xffffff);

interface DC {
  mapMode: number;
  winOrg: [number, number]; winExt: [number, number];
  vpOrg: [number, number]; vpExt: [number, number];
  world: Xf;
  pen: GdiPen; brush: GdiBrush; font: GdiFont;
  textColor: Color; bkColor: Color; bkMode: number; textAlign: number; polyFill: number; rop2: number; arcCcw: boolean;
  cur: [number, number];
  dcPen: Color; dcBrush: Color;
}

const defaultFont = (): GdiFont => ({ family: 'Arial', height: -16, weight: 400, italic: false, underline: false, strike: false, charset: 0, escapement: 0 });
const newDc = (): DC => ({
  mapMode: 1, winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1], world: [1, 0, 0, 1, 0, 0],
  pen: { style: 0, width: 1, color: BLACK, cap: 'round', join: 'round', cosmetic: true },
  brush: { style: BS_SOLID, color: WHITE, hatch: 0 },
  font: defaultFont(),
  textColor: BLACK, bkColor: WHITE, bkMode: 2, textAlign: 0, polyFill: 1, rop2: 13, arcCcw: true, cur: [0, 0],
  dcPen: BLACK, dcBrush: WHITE,
});

/** Windows 8-bit code pages by LOGFONT charset. */
const CHARSETS: Record<number, string> = { 0: 'windows-1252', 128: 'shift_jis', 129: 'euc-kr', 130: 'euc-kr', 134: 'gbk', 136: 'big5', 161: 'windows-1253', 162: 'windows-1254', 163: 'windows-1258', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250' };
export function decode8(u8: Uint8Array, charset: number): string {
  for (const label of [CHARSETS[charset] ?? 'windows-1252', 'windows-1252']) {
    try { return new TextDecoder(label).decode(u8); } catch { /* label unknown here */ }
  }
  return String.fromCharCode(...u8);
}

/** Appends an elliptical arc between parameters t0 and t1 (a rising parameter runs clockwise on screen) as cubic Béziers; `P` maps to device units. */
export function arcSegs(pd: PathData, P: (x: number, y: number) => [number, number], cx: number, cy: number, rx: number, ry: number, t0: number, t1: number, move: boolean) {
  const n = Math.max(1, Math.min(64, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 2) - 1e-9)));
  const dt = (t1 - t0) / n, k = (4 / 3) * Math.tan(dt / 4);
  const pt = (t: number): [number, number] => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  if (move) pd.m(...P(...pt(t0)));
  for (let i = 0; i < n; i++) {
    const a = t0 + i * dt, b = a + dt;
    const [ax, ay] = pt(a), [bx, by] = pt(b);
    pd.c(...P(ax - k * rx * Math.sin(a), ay + k * ry * Math.cos(a)), ...P(bx + k * rx * Math.sin(b), by - k * ry * Math.cos(b)), ...P(bx, by));
  }
}

export class Gdi {
  out = new Out();
  objects: (GdiObject | undefined)[] = [];
  dc = newDc();
  private stack: { dc: DC; clip: number }[] = [];
  /** Device pixels per millimetre (EMF header); a fixed map mode scales by it. */
  pxPerMm: [number, number] = [96 / 25.4, 96 / 25.4];
  /** WMF has no device: its coordinates stay logical and only the sign of the window extent counts. */
  wmf = false;
  private pathOpen = false;
  private pathD = '';
  private figure = false;
  private lastPath = '';
  /** Window org / ext as first set, for the WMF view box. */
  winSeen: { org?: [number, number]; ext?: [number, number] } = {};

  // ---- transforms ----

  private pageXf(): Xf {
    const { winOrg: [wx, wy], winExt: [ex, ey], vpOrg: [vx, vy], vpExt: [px, py] } = this.dc;
    let sx = 1, sy = 1;
    if (this.wmf) { sx = ex < 0 ? -1 : 1; sy = ey < 0 ? -1 : 1; return [sx, 0, 0, sy, -wx * sx, -wy * sy]; }
    const m = this.dc.mapMode;
    if (m >= 2 && m <= 6) {
      // LOMETRIC, HIMETRIC, LOENGLISH, HIENGLISH, TWIPS in millimetres per logical unit; y points up.
      const mm = [0, 0, 0.1, 0.01, 0.254, 0.0254, 25.4 / 1440][m];
      sx = this.pxPerMm[0] * mm; sy = -this.pxPerMm[1] * mm;
    } else if (m >= 7) {
      sx = ex ? px / ex : 1; sy = ey ? py / ey : 1;
    }
    return [sx, 0, 0, sy, vx - wx * sx, vy - wy * sy];
  }
  /** Logical → device. */
  xf(): Xf { return compose(this.pageXf(), this.dc.world); }

  setWindowExt(x: number, y: number) {
    this.winSeen.ext ??= [x, y];
    if (this.wmf || this.dc.mapMode >= 7) this.dc.winExt = [x, y];
  }
  setWindowOrg(x: number, y: number) { this.winSeen.org ??= [x, y]; this.dc.winOrg = [x, y]; }
  setViewportExt(x: number, y: number) { if (this.dc.mapMode >= 7) this.dc.vpExt = [x, y]; }
  setViewportOrg(x: number, y: number) { this.dc.vpOrg = [x, y]; }
  scaleWindowExt(a: number, b: number, c: number, d: number) { if (b && d) this.dc.winExt = [(this.dc.winExt[0] * a) / b, (this.dc.winExt[1] * c) / d]; }
  scaleViewportExt(a: number, b: number, c: number, d: number) { if (b && d) this.dc.vpExt = [(this.dc.vpExt[0] * a) / b, (this.dc.vpExt[1] * c) / d]; }
  setMapMode(m: number) { if (m >= 1 && m <= 8) this.dc.mapMode = m; }
  modifyWorld(x: Xf, mode: number) {
    if (mode === 1) this.dc.world = [1, 0, 0, 1, 0, 0];
    else if (mode === 2) this.dc.world = compose(x, this.dc.world);
    else if (mode === 3) this.dc.world = compose(this.dc.world, x);
    else if (mode === 4) this.dc.world = x;
  }

  // ---- state ----

  setObject(i: number, o: GdiObject) { if (i >= 0 && i < MAX_OBJECTS) this.objects[i] = o; }
  /** WMF: the lowest free slot. */
  addObject(o: GdiObject) {
    let i = this.objects.findIndex((v) => v === undefined);
    if (i < 0) i = this.objects.length;
    this.setObject(i, o);
  }
  deleteObject(i: number) { if (i >= 0 && i < this.objects.length) this.objects[i] = undefined; }
  select(i: number) {
    if (i >>> 31) { this.selectStock(i & 0x7fffffff); return; }
    const o = this.objects[i];
    if (!o) return;
    if (o.k === 'pen') this.dc.pen = o.pen;
    else if (o.k === 'brush') this.dc.brush = o.brush;
    else if (o.k === 'font') this.dc.font = o.font;
  }
  private selectStock(n: number) {
    const solid = (v: number): GdiBrush => ({ style: BS_SOLID, color: colorref(v), hatch: 0 });
    const pen = (style: number, c: Color): GdiPen => ({ style, width: 0, color: c, cap: 'round', join: 'round', cosmetic: true });
    const d = this.dc;
    switch (n) {
      case 0: d.brush = solid(0xffffff); break;
      case 1: d.brush = solid(0xc0c0c0); break;
      case 2: d.brush = solid(0x808080); break;
      case 3: d.brush = solid(0x404040); break;
      case 4: d.brush = solid(0); break;
      case 5: d.brush = { style: BS_NULL, color: BLACK, hatch: 0 }; break;
      case 6: d.pen = pen(0, WHITE); break;
      case 7: d.pen = pen(0, BLACK); break;
      case 8: d.pen = pen(PS_NULL, BLACK); break;
      case 18: d.brush = { style: BS_SOLID, color: d.dcBrush, hatch: 0 }; break;
      case 19: d.pen = pen(0, d.dcPen); break;
      case 10: case 11: case 12: case 13: case 14: case 16: case 17: d.font = defaultFont(); break;
    }
  }
  setDcPen(c: Color) { this.dc.dcPen = c; if (this.dc.pen.cosmetic && this.dc.pen.width === 0) this.dc.pen = { ...this.dc.pen, color: c }; }
  setDcBrush(c: Color) { this.dc.dcBrush = c; }
  save() { if (this.stack.length < MAX_STACK) this.stack.push({ dc: { ...this.dc }, clip: this.out.clipDepth }); }
  restore(n: number) {
    const idx = n < 0 ? this.stack.length + n : n - 1;
    if (idx < 0 || idx >= this.stack.length) return;
    const saved = this.stack[idx];
    this.stack.length = idx;
    const cur = this.dc.cur;
    this.dc = { ...saved.dc, cur };
    this.out.popClipsTo(saved.clip);
  }
  private clipBase() { return this.stack.length ? this.stack[this.stack.length - 1].clip : 0; }

  // ---- paint selection ----

  private fill(): Fill {
    const b = this.dc.brush;
    if (b.style === BS_NULL) return null;
    if (b.style === BS_HATCHED) return { ref: this.out.hatch(b.hatch, b.color, this.dc.bkMode === 2 ? this.dc.bkColor : null) };
    if (b.pattern && (b.style === BS_PATTERN || b.style === BS_DIBPATTERN || b.style === BS_DIBPATTERNPT)) return { ref: this.out.imagePattern(b.pattern.href, b.pattern.w, b.pattern.h) };
    return { color: b.color };
  }
  private stroke(): Stroke | null {
    const p = this.dc.pen;
    const style = p.style & 0xf;
    if (style === PS_NULL) return null;
    const s = scaleOf(this.xf());
    const width = p.cosmetic || p.width <= 0 ? 1 : Math.max(p.width * s, 0.25);
    const u = Math.max(width, 1);
    const dash = style === 1 ? [u * 6, u * 2] : style === 2 ? [u, u * 2] : style === 3 ? [u * 6, u * 2, u, u * 2] : style === 4 ? [u * 6, u * 2, u, u * 2, u, u * 2] : undefined;
    return { color: p.color, width, dash, cap: p.cosmetic ? 'butt' : p.cap, join: p.join };
  }

  // ---- geometry sinks ----

  private paint(pd: PathData, fill: boolean, stroke: boolean) {
    if (this.pathOpen) { this.pathD += pd.d; this.figure = false; return; }
    if (this.dc.rop2 === 11) return; // R2_NOP
    this.out.drawPath(pd, fill ? this.fill() : null, stroke ? this.stroke() : null, this.dc.polyFill === 1);
  }
  private P() { const m = this.xf(); return (x: number, y: number) => apply(m, x, y); }

  rect(l: number, t: number, r: number, b: number) {
    const P = this.P(), pd = this.out.path();
    pd.m(...P(l, t)).l(...P(r, t)).l(...P(r, b)).l(...P(l, b)).z();
    this.paint(pd, true, true);
  }
  ellipse(l: number, t: number, r: number, b: number) {
    const P = this.P(), pd = this.out.path();
    arcSegs(pd, P, (l + r) / 2, (t + b) / 2, Math.abs(r - l) / 2, Math.abs(b - t) / 2, 0, Math.PI * 2, true);
    pd.z();
    this.paint(pd, true, true);
  }
  roundRect(l: number, t: number, r: number, b: number, cw: number, ch: number) {
    const P = this.P(), pd = this.out.path();
    const [x0, x1] = [Math.min(l, r), Math.max(l, r)], [y0, y1] = [Math.min(t, b), Math.max(t, b)];
    const rx = Math.min(Math.abs(cw) / 2, (x1 - x0) / 2), ry = Math.min(Math.abs(ch) / 2, (y1 - y0) / 2);
    if (rx <= 0 || ry <= 0) return this.rect(l, t, r, b);
    const h = Math.PI / 2;
    pd.m(...P(x0 + rx, y0)).l(...P(x1 - rx, y0));
    arcSegs(pd, P, x1 - rx, y0 + ry, rx, ry, -h, 0, false);
    pd.l(...P(x1, y1 - ry));
    arcSegs(pd, P, x1 - rx, y1 - ry, rx, ry, 0, h, false);
    pd.l(...P(x0 + rx, y1));
    arcSegs(pd, P, x0 + rx, y1 - ry, rx, ry, h, Math.PI, false);
    pd.l(...P(x0, y0 + ry));
    arcSegs(pd, P, x0 + rx, y0 + ry, rx, ry, Math.PI, Math.PI * 1.5, false);
    pd.z();
    this.paint(pd, true, true);
  }
  /** kind 0 arc (stroke only), 1 chord, 2 pie. Start and end are points on the ray, in logical units. */
  arc(l: number, t: number, r: number, b: number, sx: number, sy: number, ex: number, ey: number, kind: 0 | 1 | 2) {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
    if (!rx || !ry) return;
    const ang = (x: number, y: number) => Math.atan2((y - cy) / ry, (x - cx) / rx);
    let t0 = ang(sx, sy), t1 = ang(ex, ey);
    // The default arc direction is counter-clockwise on screen, which is a falling parameter (y points down).
    if (this.dc.arcCcw) { if (t1 >= t0) t1 -= Math.PI * 2; } else if (t1 <= t0) t1 += Math.PI * 2;
    if (Math.abs(t1 - t0) < 1e-9) t1 = t0 + (this.dc.arcCcw ? -1 : 1) * Math.PI * 2;
    const P = this.P(), pd = this.out.path();
    if (kind === 2) pd.m(...P(cx, cy)).l(...P(cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)));
    arcSegs(pd, P, cx, cy, rx, ry, t0, t1, kind !== 2);
    if (kind) pd.z();
    this.paint(pd, kind !== 0, true);
  }
  poly(pts: [number, number][], close: boolean) {
    if (pts.length < 2) return;
    const P = this.P(), pd = this.out.path();
    pts.forEach(([x, y], i) => (i ? pd.l(...P(x, y)) : pd.m(...P(x, y))));
    if (close) pd.z();
    this.paint(pd, close, true);
  }
  polyPoly(groups: [number, number][][], close: boolean) {
    const P = this.P(), pd = this.out.path();
    for (const g of groups) {
      if (g.length < 2) continue;
      g.forEach(([x, y], i) => (i ? pd.l(...P(x, y)) : pd.m(...P(x, y))));
      if (close) pd.z();
    }
    this.paint(pd, close, true);
  }
  /** PolyBezier (own figure starting at the first point) or PolyBezierTo (continuing from the current point). */
  bezier(pts: [number, number][], from: boolean) {
    const P = this.P(), pd = this.out.path();
    let i = 0;
    if (from) { const s = pts[0]; if (!s) return; i = 1; pd.m(...P(...s)); }
    else if (this.pathOpen && this.figure) { /* continues the open figure */ }
    else pd.m(...P(...this.dc.cur));
    for (; i + 2 < pts.length; i += 3) pd.c(...P(...pts[i]), ...P(...pts[i + 1]), ...P(...pts[i + 2]));
    const last = pts[pts.length - 1];
    if (!from && last) this.dc.cur = last;
    if (this.pathOpen) { this.pathD += pd.d; this.figure = true; return; }
    this.paint(pd, false, true);
  }
  moveTo(x: number, y: number) { this.dc.cur = [x, y]; this.figure = false; }
  lineTo(x: number, y: number) {
    const P = this.P(), pd = this.out.path();
    if (!(this.pathOpen && this.figure)) pd.m(...P(...this.dc.cur));
    pd.l(...P(x, y));
    this.dc.cur = [x, y];
    if (this.pathOpen) { this.pathD += pd.d; this.figure = true; return; }
    this.paint(pd, false, true);
  }
  polylineTo(pts: [number, number][]) {
    for (const [x, y] of pts) this.lineTo(x, y);
  }
  pixel(x: number, y: number, c: Color) {
    const P = this.P(), pd = this.out.path();
    const [a, b] = P(x, y), [c2, d] = P(x + 1, y + 1);
    pd.m(a, b).l(c2, b).l(c2, d).l(a, d).z();
    this.out.drawPath(pd, { color: c }, null);
  }

  // ---- paths ----

  beginPath() { this.pathOpen = true; this.pathD = ''; this.figure = false; }
  endPath() { if (this.pathOpen) { this.pathOpen = false; this.lastPath = this.pathD; this.figure = false; } }
  closeFigure() { if (this.pathOpen && this.figure) { this.pathD += 'Z'; this.figure = false; } }
  private pathData(): PathData | null {
    if (!this.lastPath) return null;
    const pd = this.out.path();
    pd.d = this.lastPath;
    return pd;
  }
  /** FILLPATH, STROKEPATH, STROKEANDFILLPATH; the path is used up. */
  paintPath(fill: boolean, stroke: boolean) {
    const pd = this.pathData();
    if (!pd) return;
    this.out.drawPath(pd, fill ? this.fill() : null, stroke ? this.stroke() : null, this.dc.polyFill === 1);
    this.lastPath = '';
  }
  /** SELECTCLIPPATH: mode 1 AND, 5 COPY; others leave the clip as it is. */
  clipPath(mode: number) {
    const pd = this.pathData();
    this.lastPath = '';
    if (!pd || (mode !== 1 && mode !== 5)) return;
    if (mode === 5) this.out.popClipsTo(this.clipBase());
    this.out.pushClip(pd, this.dc.polyFill === 1);
  }
  intersectClipRect(l: number, t: number, r: number, b: number) {
    const P = this.P(), pd = this.out.path();
    pd.m(...P(l, t)).l(...P(r, t)).l(...P(r, b)).l(...P(l, b)).z();
    this.out.pushClip(pd);
  }
  /** Rectangles in logical units as the clip: mode 1 AND, 5 COPY (an empty list with COPY removes the clip). */
  clipRects(rects: [number, number, number, number][], mode: number) {
    if (mode === 5) this.out.popClipsTo(this.clipBase());
    if (!rects.length || (mode !== 1 && mode !== 5)) return;
    const P = this.P(), pd = this.out.path();
    for (const [l, t, r, b] of rects) pd.m(...P(l, t)).l(...P(r, t)).l(...P(r, b)).l(...P(l, b)).z();
    this.out.pushClip(pd);
  }
  resetClip() { this.out.popClipsTo(this.clipBase()); }

  // ---- text ----

  /** `dx` are advances in logical units. Alignment, colour and font come from the DC. */
  text(x: number, y: number, str: string, dx: number[] | null, bounds: [number, number, number, number] | null, opaque: boolean) {
    if (!str || this.out.muted || this.pathOpen) return;
    if (str.length > MAX_TEXT) str = str.slice(0, MAX_TEXT);
    const d = this.dc, f = d.font, align = d.textAlign;
    if (align & 1) [x, y] = d.cur;
    const m = this.xf();
    const s = scaleOf(m);
    const em = f.height < 0 ? -f.height : f.height > 0 ? f.height * 0.85 : 12;
    const size = Math.max(em * s, 0.5);
    const [px, py] = apply(m, x, y);
    const rot = (Math.atan2(d.world[1], d.world[0]) * 180) / Math.PI - f.escapement / 10;
    if (opaque && bounds && d.bkMode === 2) {
      const pd = this.out.path();
      const [l, t, r, b] = bounds;
      pd.m(...apply(m, l, t)).l(...apply(m, r, t)).l(...apply(m, r, b)).l(...apply(m, l, b)).z();
      this.out.drawPath(pd, { color: d.bkColor }, null);
    }
    const base = (align & 24) === 24 ? 0 : align & 8 ? -size * 0.2 : size * 0.8;
    const h = align & 6;
    let xs = '0', anchor = h === 6 ? 'middle' : h === 2 ? 'end' : 'start';
    let total = 0;
    if (dx && dx.length >= str.length) {
      const adv = [...str].map((_, i) => Math.abs(dx[i] * s));
      total = adv.reduce((a, v) => a + v, 0);
      let o = h === 6 ? -total / 2 : h === 2 ? -total : 0;
      const parts: string[] = [];
      for (const a of adv) { parts.push(num(o)); o += a; }
      xs = parts.join(' ');
      anchor = 'start';
    }
    this.out.grow(px, py - size);
    this.out.grow(px + (total || str.length * size * 0.5), py + size * 0.3);
    const fam = `'${f.family.replace(/['"\\<>&]/g, '')}', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', Arial, sans-serif`;
    const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    const c = d.textColor;
    this.out.element(
      `<text xml:space="preserve" transform="translate(${num(px)} ${num(py)})${rot ? ` rotate(${num(rot)})` : ''}" x="${xs}" y="${num(base)}" font-family="${xmlText(fam)}" font-size="${num(size)}"`
      + `${f.weight >= 600 ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''}`
      + `${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} fill="${c.rgb}">${xmlText(str)}</text>`,
    );
    if (align & 1 && total) d.cur = [x + total / (s || 1), y];
  }

  // ---- bitmaps ----

  /** Draws `dib` (source rectangle `src` = [x, y, w, h] in pixels) into `dst` = [x, y, w, h] logical units; a negative size mirrors. */
  bitmap(dib: Dib, src: [number, number, number, number], dst: [number, number, number, number]) {
    if (this.out.muted || this.pathOpen) return;
    let href = dib.encoded;
    let iw = dib.img.w, ih = dib.img.h;
    if (!href) {
      const [sx, sy, sw, sh] = src;
      const img = sw > 0 && sh > 0 ? cropRgba(dib.img, sx, sy, sw, sh) : dib.img;
      if (!img) return;
      iw = img.w; ih = img.h;
      href = pngDataUrl(img);
    }
    const [dx, dy, dw, dh] = dst;
    if (!dw || !dh || !iw || !ih) return;
    const m = compose(this.xf(), [dw / iw, 0, 0, dh / ih, dx, dy]);
    for (const [px, py] of [[0, 0], [iw, 0], [iw, ih], [0, ih]]) this.out.grow(...apply(m, px, py));
    this.out.element(`<image href="${href}" width="${iw}" height="${ih}" preserveAspectRatio="none" transform="matrix(${m.map(num).join(' ')})"/>`);
  }
  /** A rectangle filled with the current brush (PATCOPY) or a flat colour (BLACKNESS, WHITENESS). */
  fillRect(l: number, t: number, w: number, h: number, color?: Color) {
    const P = this.P(), pd = this.out.path();
    pd.m(...P(l, t)).l(...P(l + w, t)).l(...P(l + w, t + h)).l(...P(l, t + h)).z();
    this.out.drawPath(pd, color ? { color } : this.fill(), null);
  }
}

/** A brush pattern from a decoded bitmap. */
export function patternBrush(dib: Dib | null): GdiBrush | null {
  if (!dib || dib.encoded) return null;
  return { style: BS_DIBPATTERN, color: BLACK, hatch: 0, pattern: { href: pngDataUrl(dib.img), w: dib.img.w, h: dib.img.h } };
}

export type { Bytes };
