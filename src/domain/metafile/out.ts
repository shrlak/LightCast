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

/** "Everything": a rectangle far larger than any picture, for exclude-clip and complements. */
export const BIG = 'M-1e7 -1e7L1e7 -1e7L1e7 1e7L-1e7 1e7Z';

/** A clip region: a path, or paths combined. */
export type ClipNode =
  | { k: 'path'; d: string; eo: boolean; n: number }
  | { k: 'and' | 'or' | 'xor' | 'diff'; a: Clip; b: ClipNode; n: number };
export type Clip = ClipNode | null;
const MAX_CLIP_NODES = 128;
/** `cur` combined with the shape `s` (null `cur`: no clip, everything). A combine that would make the expression too big is ignored. */
export function combineClips(cur: Clip, s: ClipNode, mode: 'and' | 'or' | 'xor' | 'diff' | 'complement' | 'copy'): Clip {
  const size = (c: Clip) => (c ? c.n : 0);
  const make = (k: 'and' | 'or' | 'xor' | 'diff', a: Clip, b: ClipNode): Clip => (size(a) + b.n + 1 > MAX_CLIP_NODES ? cur : { k, a, b, n: size(a) + b.n + 1 });
  switch (mode) {
    case 'copy': return s;
    case 'and': return cur ? make('and', cur, s) : s;
    case 'or':
      if (cur && cur.k === 'path' && s.k === 'path' && !cur.eo && !s.eo) return { k: 'path', d: cur.d + s.d, eo: false, n: 1 }; // two plain paths: one path (non-zero winding unites them)
      return cur ? make('or', cur, s) : null; // everything or anything is everything
    case 'xor': return cur ? make('xor', cur, s) : make('diff', null, s);
    case 'diff': return make('diff', cur, s);
    default: return cur ? make('diff', s, cur) : { k: 'path', d: 'M0 0', eo: false, n: 1 }; // the shape minus the clip
  }
}

export type Color = { rgb: string; a: number };
export type Fill = { color: Color } | { ref: string } | null;
export interface Stroke { color: Color; width: number; dash?: number[]; cap?: 'butt' | 'round' | 'square'; join?: 'miter' | 'round' | 'bevel'; miter?: number }

/** Path data in device units, with the bounds of the points added. */
export class PathData {
  d = '';
  constructor(private out: Out) {}
  /** Extent of this path's points (a sliver thinner than a pixel is drawn without anti-aliasing). */
  lx = Infinity; ly = Infinity; hx = -Infinity; hy = -Infinity;
  private pt(x: number, y: number) {
    this.out.grow(x, y);
    if (x < this.lx) this.lx = x;
    if (x > this.hx) this.hx = x;
    if (y < this.ly) this.ly = y;
    if (y > this.hy) this.hy = y;
    return `${num(x)} ${num(y)}`;
  }
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
  private ids = 0;
  private hatches = new Map<string, string>();
  private invId = '';
  private clipState: Clip = null;
  /** The clip whose wrapper groups are open in the body (`wrapperOpen` of them). */
  private clipDrawn: Clip = null;
  private wrapperOpen = 0;
  private clipDefs = new Map<ClipNode, string>();
  private maskDefs = new Map<ClipNode, string>();
  private notDefs = new Map<ClipNode, string>();
  /** Bounds of everything drawn. */
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  /** While true nothing is drawn (EMF+ files play their own records, not the GDI fallback). */
  muted = false;
  /** Output units per CSS pixel (see Gdi.hair). */
  hair: () => number = () => 1;

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
  private push(s: string) { if (this.muted || this.full) return false; if (this.clipDrawn !== this.clipState) this.syncClip(); this.body.push(s); this.chars += s.length; this.items++; return true; }
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
  /** One filled and/or stroked path. `blend` is a CSS mix-blend-mode that stands in for a raster operation that reads the destination. */
  drawPath(p: PathData, fill: Fill, stroke: Stroke | null, evenOdd = false, blend?: string) {
    if (p.empty || (!fill && !stroke)) return;
    // GDI paints no partial pixels: gradients that a producer draws as hundreds of slivers narrower than a
    // pixel would blend with the page behind each of them and come out washed out when anti-aliased.
    const thin = fill && !stroke && Math.min(p.hx - p.lx, p.hy - p.ly) < this.hair();
    this.push(`<path d="${p.d}"${this.fillAttrs(fill, evenOdd)}${this.strokeAttrs(stroke)}${thin ? ' shape-rendering="crispEdges"' : ''}${blend ? ` style="mix-blend-mode:${blend}"` : ''}/>`);
  }
  /** Path data written without touching the bounds (for a huge "everything" rectangle). */
  rawPath(d: string) { const p = new PathData(this); p.d = d; return p; }
  /** An SVG filter that inverts colours (NOTSRCCOPY and friends); returns its id. */
  invertFilter(): string {
    if (!this.invId) {
      this.invId = this.id('f');
      this.addDef(`<filter id="${this.invId}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter>`);
    }
    return this.invId;
  }
  /** Raw element (text, image) drawn at once. */
  element(s: string) { this.push(s); }

  // ---- clip ----

  /**
   * The clip region as an expression over paths (null: no clip). Combining it (AND, OR, XOR, DIFF,
   * COPY, complement) only builds a new expression, so a saved clip is restored by setting it back;
   * the picture gets wrapper groups lazily, before the next element, as nested `clip-path` groups
   * for an intersection of paths and a `mask` for anything that is a union, difference or XOR.
   */
  get clip(): Clip { return this.clipState; }
  set clip(c: Clip) { this.clipState = c; }
  /** The clip with one more path: intersect (`and`), `or`, `xor`, `diff` (clip minus the path), `complement` (the path minus the clip) or `copy`. Over the size limit a combine is ignored. */
  combineClip(p: PathData, mode: 'and' | 'or' | 'xor' | 'diff' | 'complement' | 'copy', evenOdd = false) {
    const node: ClipNode = { k: 'path', d: p.empty ? 'M0 0' : p.d, eo: evenOdd, n: 1 };
    this.clipState = combineClips(this.clipState, node, mode);
  }
  /** The same with an "everything but" path: a path given as `BIG + d` is not needed; this is for callers that hold a path already. */
  private clipId(n: ClipNode & { k: 'path' }): string {
    let id = this.clipDefs.get(n);
    if (!id) {
      id = this.id('c');
      this.addDef(`<clipPath id="${id}"><path d="${n.d}"${n.eo ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
      this.clipDefs.set(n, id);
    }
    return id;
  }
  /** Conjuncts of an expression, outermost first. */
  private conjuncts(c: Clip, into: ClipNode[] = []): ClipNode[] {
    while (c) {
      if (c.k === 'and') { this.conjuncts(c.b, into); c = c.a; continue; }
      into.push(c); break;
    }
    return into;
  }
  private wrap(inner: string, leaf: ClipNode): string {
    return leaf.k === 'path' ? `<g clip-path="url(#${this.clipId(leaf)})">${inner}</g>` : `<g mask="url(#${this.maskId(leaf)})">${inner}</g>`;
  }
  private big(color: string) { return `<path d="${BIG}" fill="${color}"/>`; }
  /** `c` drawn as a shape filled with `color` (white to build a mask, black to cut one out). */
  private paintClip(c: Clip, color: string, depth = 0): string {
    if (depth > 64) return '';
    if (!c) return this.big(color);
    if (c.k === 'path') return `<path d="${c.d}" fill="${color}"${c.eo ? ' fill-rule="evenodd"' : ''}/>`;
    if (c.k === 'and') {
      const leaves = this.conjuncts(c).reverse();
      let inner = this.paintClip(leaves[0], color, depth + 1);
      for (let i = 1; i < leaves.length; i++) inner = this.wrap(inner, leaves[i]);
      return inner;
    }
    if (c.k === 'or') return this.paintClip(c.a, color, depth + 1) + this.paintClip(c.b, color, depth + 1);
    if (c.k === 'diff') return `<g mask="url(#${this.notId(c.b)})">${this.paintClip(c.a, color, depth + 1)}</g>`;
    // xor: (a - b) + (b - a)
    return `<g mask="url(#${this.notId(c.b)})">${this.paintClip(c.a, color, depth + 1)}</g><g mask="url(#${this.notId(c.a)})">${this.paintClip(c.b, color, depth + 1)}</g>`;
  }
  private maskBox = 'maskUnits="userSpaceOnUse" x="-10000000" y="-10000000" width="20000000" height="20000000"';
  private maskId(n: ClipNode): string {
    let id = this.maskDefs.get(n);
    if (!id) {
      id = this.id('m');
      this.addDef(`<mask id="${id}" ${this.maskBox}>${this.paintClip(n, '#fff')}</mask>`);
      this.maskDefs.set(n, id);
    }
    return id;
  }
  /** A mask that is white everywhere except where `n` is. */
  private notId(n: Clip): string {
    if (!n) return this.emptyMask();
    let id = this.notDefs.get(n);
    if (!id) {
      id = this.id('m');
      this.addDef(`<mask id="${id}" ${this.maskBox}>${this.big('#fff')}${this.paintClip(n, '#000')}</mask>`);
      this.notDefs.set(n, id);
    }
    return id;
  }
  private emptyId = '';
  private emptyMask(): string {
    if (!this.emptyId) { this.emptyId = this.id('m'); this.addDef(`<mask id="${this.emptyId}" ${this.maskBox}/>`); }
    return this.emptyId;
  }
  private closeWrappers() { while (this.wrapperOpen > 0) { this.body.push('</g>'); this.chars += 4; this.wrapperOpen--; } }
  private syncClip() {
    this.closeWrappers();
    this.clipDrawn = this.clipState;
    if (!this.clipState) return;
    for (const leaf of this.conjuncts(this.clipState).reverse()) {
      const open = leaf.k === 'path' ? `<g clip-path="url(#${this.clipId(leaf)})">` : `<g mask="url(#${this.maskId(leaf)})">`;
      this.body.push(open); this.chars += open.length; this.wrapperOpen++;
    }
  }

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
  imagePattern(href: string, w: number, h: number, xf?: Xf): string {
    const id = this.id('p');
    this.addDef(`<pattern id="${id}" width="${num(w)}" height="${num(h)}" patternUnits="userSpaceOnUse"${xf ? ` patternTransform="matrix(${xf.map(num).join(' ')})"` : ''}><image href="${href}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/></pattern>`);
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
    this.closeWrappers();
    const [x, y, w, h] = view;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(width)}" height="${num(height)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}">`
      + (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') + this.body.join('') + '</svg>';
  }
}
