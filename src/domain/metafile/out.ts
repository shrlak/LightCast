// The SVG a metafile is played into: an element list, defs (patterns, gradients, clips), the bounds
// of what was drawn, and the budgets that keep a hostile file from growing it without end.
import { type Xf } from './bytes';

/** Elements kept from one file; past this the picture is cut off where it stands. */
export const MAX_ITEMS = 200_000;
/** Characters of SVG kept from one file (about 96 MB). */
export const MAX_CHARS = 96 * 1024 * 1024;

export const num = (v: number): string => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
/** XML 1.0 forbids most control characters, even escaped. */
export const xmlText = (s: string) => esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));
export const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export type Color = { rgb: string; a: number };
export type Fill = { color: Color } | { ref: string } | null;
export interface Stroke { color: Color; width: number; dash?: number[]; cap?: 'butt' | 'round' | 'square'; join?: 'miter' | 'round' | 'bevel'; miter?: number }

/** Path data in device units, with the bounds of the points added. */
export class PathData {
  d = '';
  constructor(private out: Out) {}
  private pt(x: number, y: number) { this.out.grow(x, y); return `${num(x)} ${num(y)}`; }
  m(x: number, y: number) { this.d += `M${this.pt(x, y)}`; return this; }
  l(x: number, y: number) { this.d += `L${this.pt(x, y)}`; return this; }
  c(x1: number, y1: number, x2: number, y2: number, x: number, y: number) { this.d += `C${this.pt(x1, y1)} ${this.pt(x2, y2)} ${this.pt(x, y)}`; return this; }
  z() { this.d += 'Z'; return this; }
  get empty() { return this.d === ''; }
}

export class Out {
  private body: string[] = [];
  private defs: string[] = [];
  private chars = 0;
  items = 0;
  clipDepth = 0;
  private ids = 0;
  private hatches = new Map<string, string>();
  /** Bounds of everything drawn. */
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  /** While true nothing is drawn (EMF+ files play their own records, not the GDI fallback). */
  muted = false;

  get full() { return this.items >= MAX_ITEMS || this.chars >= MAX_CHARS; }
  grow(x: number, y: number) {
    if (this.muted || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }
  path() { return new PathData(this); }
  id(prefix: string) { return `${prefix}${++this.ids}`; }
  private push(s: string) { if (this.muted || this.full) return false; this.body.push(s); this.chars += s.length; this.items++; return true; }
  addDef(s: string) { if (this.chars + s.length < MAX_CHARS) { this.defs.push(s); this.chars += s.length; } }

  fillAttrs(f: Fill, evenOdd = false): string {
    if (!f) return ' fill="none"';
    const rule = evenOdd ? ' fill-rule="evenodd"' : '';
    if ('ref' in f) return ` fill="url(#${f.ref})"${rule}`;
    return ` fill="${f.color.rgb}"${f.color.a < 1 ? ` fill-opacity="${num(f.color.a)}"` : ''}${rule}`;
  }
  strokeAttrs(s: Stroke | null): string {
    if (!s) return '';
    let a = ` stroke="${s.color.rgb}" stroke-width="${num(Math.max(s.width, 0.0001))}"`;
    if (s.color.a < 1) a += ` stroke-opacity="${num(s.color.a)}"`;
    if (s.cap && s.cap !== 'butt') a += ` stroke-linecap="${s.cap}"`;
    if (s.join && s.join !== 'miter') a += ` stroke-linejoin="${s.join}"`;
    if (s.miter && s.miter !== 4) a += ` stroke-miterlimit="${num(s.miter)}"`;
    if (s.dash?.length) a += ` stroke-dasharray="${s.dash.map(num).join(' ')}"`;
    return a;
  }
  /** One filled and/or stroked path. */
  drawPath(p: PathData, fill: Fill, stroke: Stroke | null, evenOdd = false) {
    if (p.empty || (!fill && !stroke)) return;
    this.push(`<path d="${p.d}"${this.fillAttrs(fill, evenOdd)}${this.strokeAttrs(stroke)}/>`);
  }
  /** Raw element (text, image) drawn at once. */
  element(s: string) { this.push(s); }

  /** Opens a `<g clip-path>` over what is drawn next; close with `popClip`. */
  pushClip(p: PathData, evenOdd = false) {
    if (this.muted || this.full) return;
    const id = this.id('c');
    this.addDef(`<clipPath id="${id}"><path d="${p.empty ? 'M0 0' : p.d}"${evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    this.body.push(`<g clip-path="url(#${id})">`);
    this.clipDepth++;
  }
  popClip() { if (this.clipDepth > 0) { this.body.push('</g>'); this.clipDepth--; } }
  popClipsTo(depth: number) { while (this.clipDepth > depth) this.popClip(); }

  /** A hatch brush's pattern: `style` is the GDI HS_ constant. */
  hatch(style: number, fg: Color, bg: Color | null): string {
    const key = `${style}|${fg.rgb}|${fg.a}|${bg?.rgb ?? ''}`;
    let id = this.hatches.get(key);
    if (id) return id;
    id = this.id('h');
    const S = 8;
    const lines: string[] = [];
    if (style === 0 || style === 4 || style === 5) lines.push(`M0 ${S / 2}H${S}`);
    if (style === 1 || style === 4 || style === 5) lines.push(`M${S / 2} 0V${S}`);
    if (style === 2 || style === 5) lines.push(`M0 0L${S} ${S}`);
    if (style === 3 || style === 5) lines.push(`M0 ${S}L${S} 0`);
    const back = bg ? `<rect width="${S}" height="${S}" fill="${bg.rgb}"${bg.a < 1 ? ` fill-opacity="${num(bg.a)}"` : ''}/>` : '';
    this.addDef(`<pattern id="${id}" width="${S}" height="${S}" patternUnits="userSpaceOnUse">${back}<path d="${lines.join('')}" fill="none" stroke="${fg.rgb}" stroke-width="1"/></pattern>`);
    this.hatches.set(key, id);
    return id;
  }
  imagePattern(href: string, w: number, h: number): string {
    const id = this.id('p');
    this.addDef(`<pattern id="${id}" width="${num(w)}" height="${num(h)}" patternUnits="userSpaceOnUse"><image href="${href}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/></pattern>`);
    return id;
  }
  linearGradient(x1: number, y1: number, x2: number, y2: number, stops: [number, Color][], xf: Xf, pad: boolean): string {
    const id = this.id('g');
    const st = stops.map(([o, c]) => `<stop offset="${num(Math.max(0, Math.min(1, o)))}" stop-color="${c.rgb}"${c.a < 1 ? ` stop-opacity="${num(c.a)}"` : ''}/>`).join('');
    this.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" gradientTransform="matrix(${xf.map(num).join(' ')})" spreadMethod="${pad ? 'pad' : 'repeat'}">${st}</linearGradient>`);
    return id;
  }

  /** The finished SVG. `view` is `[x, y, w, h]` in device units; `width`/`height` are the size in CSS px. */
  svg(view: [number, number, number, number], width: number, height: number): string {
    this.popClipsTo(0);
    const [x, y, w, h] = view;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(width)}" height="${num(height)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}">`
      + (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') + this.body.join('') + '</svg>';
  }
}
