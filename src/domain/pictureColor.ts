// A picture's own colour, as PowerPoint draws it (Picture Format › Color / Corrections, read from a:blip): grayscale,
// brightness and contrast, saturation, recolour (duotone), black and white (bi-level), a colour made transparent or
// replaced, and inverted opacity. One pass over the pixels with the formulas DeckCraft measured on PowerPoint's own
// export (render/src/images.rs `apply_adjust`): Rec. 709 luminance on the stored values, contrast about mid-grey,
// brightness half before and half after the contrast stretch.
import { child, local, type MNode } from './io/markup';
import { colorOf, type DmlTheme } from './io/drawingml';

export interface PictureColor {
  grayscale?: boolean;
  /** -1..1 (a:lum@bright). */
  brightness?: number;
  /** -1..1 (a:lum@contrast). */
  contrast?: number;
  /** 0..4, 1 unchanged (a:hsl@sat, a:satMod). */
  saturation?: number;
  /** Recolour: the dark and the light colour (a:duotone). */
  duotone?: [string, string];
  /** Black and white at this luminance (0–1, a:biLevel@thresh). */
  bilevel?: number;
  /** Set Transparent Color (a:clrChange to a see-through colour). */
  clearColor?: string;
  /** a:clrChange to an opaque colour: pixels of `from` become `to`. */
  replace?: { from: string; to: string };
  /** a:alphaInv. */
  alphaInv?: boolean;
}

const hex = (h: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16) || 0) as [number, number, number];
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The colour changes of an a:blip, or undefined when it has none. */
export function pictureColorOf(blip: MNode | null | undefined, theme: DmlTheme): PictureColor | undefined {
  const out: PictureColor = {};
  for (const c of blip?.children ?? []) {
    const k = local(c);
    const num = (a: string) => Number(c.attrs[a] ?? 0) / 100000;
    if (k === 'grayscl') out.grayscale = true;
    else if (k === 'lum') { if (num('bright')) out.brightness = Math.max(-1, Math.min(1, num('bright'))); if (num('contrast')) out.contrast = Math.max(-1, Math.min(1, num('contrast'))); }
    else if (k === 'biLevel') out.bilevel = c.attrs.thresh !== undefined ? num('thresh') : 0.5;
    else if (k === 'alphaInv') out.alphaInv = true;
    else if (k === 'hsl' && c.attrs.sat !== undefined) out.saturation = Math.max(0, Math.min(4, 1 + num('sat')));
    else if (k === 'duotone') {
      const cols = c.children.map((x) => colorOf(x, theme)?.hex).filter((x): x is string => !!x);
      if (cols.length >= 2) out.duotone = [cols[0], cols[1]];
    } else if (k === 'clrChange') {
      const from = colorOf(child(c, 'clrFrom')?.children[0], theme), to = colorOf(child(c, 'clrTo')?.children[0], theme);
      if (from && to) { if (to.alpha < 0.5) out.clearColor = from.hex; else if (to.hex !== from.hex) out.replace = { from: from.hex, to: to.hex }; }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Applies `pc` to straight RGBA pixels in place. */
export function applyPictureColor(px: Uint8ClampedArray | Uint8Array, pc: PictureColor): void {
  const sat = pc.grayscale ? 0 : pc.saturation ?? 1;
  const b = Math.max(-1, Math.min(1, pc.brightness ?? 0)) * 255;
  const c = Math.max(-1, Math.min(1, pc.contrast ?? 0));
  const cf = c >= 0 ? 1 / (1 - c * 0.99) : 1 + c;
  const duo = pc.duotone ? [hex(pc.duotone[0]), hex(pc.duotone[1])] : null;
  const clear = pc.clearColor ? hex(pc.clearColor) : null;
  const from = pc.replace ? hex(pc.replace.from) : null, to = pc.replace ? hex(pc.replace.to) : null;
  const near = (i: number, k: [number, number, number]) => Math.abs(px[i] - k[0]) < 8 && Math.abs(px[i + 1] - k[1]) < 8 && Math.abs(px[i + 2] - k[2]) < 8;
  const tone = sat !== 1 || b !== 0 || c !== 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (clear && near(i, clear)) { px[i + 3] = 0; continue; }
    if (from && to && near(i, from)) { px[i] = to[0]; px[i + 1] = to[1]; px[i + 2] = to[2]; }
    let r = px[i], g = px[i + 1], bl = px[i + 2];
    if (tone) {
      const y = luma(r, g, bl);
      const adj = (v: number) => (y + (v - y) * sat - 127.5) * cf + 127.5 + (b * (1 + cf)) / 2;
      r = adj(r); g = adj(g); bl = adj(bl);
    }
    if (duo) {
      const t = Math.max(0, Math.min(1, luma(r, g, bl) / 255));
      r = duo[0][0] + (duo[1][0] - duo[0][0]) * t; g = duo[0][1] + (duo[1][1] - duo[0][1]) * t; bl = duo[0][2] + (duo[1][2] - duo[0][2]) * t;
    }
    if (pc.bilevel !== undefined) { const v = luma(r, g, bl) >= pc.bilevel * 255 ? 255 : 0; r = g = bl = v; }
    px[i] = r; px[i + 1] = g; px[i + 2] = bl;
    if (pc.alphaInv) px[i + 3] = 255 - px[i + 3];
  }
}

/** A stable key for caching a recoloured picture. */
export const pictureColorKey = (pc: PictureColor): string => JSON.stringify(pc, Object.keys(pc).sort());
