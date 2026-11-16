// The area a piece of text covers, as path data in device units, for the flood-fill rasteriser
// (raster.ts): a flood fill has to stop at (or run over) the pixels text painted, as GDI's does.
//   - With the font file known (fonts.ts), each glyph's own outline (TrueType glyf or CFF) is placed at
//     the glyph's position, size and rotation; the raster fills it with the non-zero rule, a pixel being
//     inside when its centre is, like GDI's non-anti-aliased text (hinting, which moves outlines to the
//     pixel grid, is not applied, so a stem edge can be a pixel off).
//   - A font file without outlines this reader understands (CFF2, bitmap-only), and text whose font file
//     is not known, falls back to a filled box per visible character: the advance width (from hmtx, or
//     from the built-in tables of metrics.ts) by the cap height (OS/2 sCapHeight, else 0.7 em) standing
//     on the baseline. A flood stops at the box, so text is never painted over, but the counters inside
//     letters ('o', 'e') stay unfilled.
// Underline and strikeout are added as bars at the font's own position and thickness (post / OS/2),
// else at 0.1 em below / 0.26 em above the baseline, 0.05 em thick.
import { metafileFont, type MetafileFont } from './fonts';
import { textWidth } from './metrics';
import { num } from './out';

export interface TextRun {
  family: string; bold: boolean; italic: boolean;
  /** The em size in device units. */
  size: number;
  /** Characters (code points) or glyph indices (ETO_GLYPH_INDEX, DrawDriverString without CmapLookup). */
  chars?: string[];
  glyphs?: number[];
  /** Where each character's / glyph's baseline origin is, in device units. */
  origins: [number, number][];
  /** Advance of each one in device units (for the fallback boxes and the decoration bars). */
  advances: number[];
  /** Text direction in radians (0: along +x on screen; positive turns clockwise on screen, as SVG's rotate). */
  angle: number;
  underline?: boolean; strike?: boolean;
}

const MAX_GLYPHS = 32768;

/**
 * Lays out a run along one baseline: `x, y` is the start of the baseline (device units), `adv` the
 * advances, `angle` the direction. A convenience for the GDI and EMF+ text records.
 */
export function baselineOrigins(x: number, y: number, adv: number[], angle: number): [number, number][] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out: [number, number][] = [];
  let o = 0;
  for (const a of adv) { out.push([x + c * o, y + s * o]); o += a; }
  return out;
}

/** Advances in device units of characters with a font of `size` (the font's hmtx when known, else the built-in tables). */
export function charAdvances(chars: string[], family: string, size: number, bold: boolean, italic: boolean): number[] {
  const f = metafileFont(family, bold, italic);
  return chars.map((ch) => (f ? (f.advance(f.glyphOf(ch.codePointAt(0) ?? 0)) / f.unitsPerEm) * size : textWidth(ch, family, size, bold, italic)));
}

/** Path data (device units) of the area the run covers; '' when nothing is visible. */
export function textCoverage(run: TextRun): string {
  const f = metafileFont(run.family, run.bold, run.italic);
  const n = Math.min(run.origins.length, MAX_GLYPHS);
  const c = Math.cos(run.angle), s = Math.sin(run.angle);
  // Local (x along the text, y down) to device.
  const D = (ox: number, oy: number, lx: number, ly: number) => `${num(ox + c * lx - s * ly)} ${num(oy + s * lx + c * ly)}`;
  let d = '';
  for (let i = 0; i < n; i++) {
    const [ox, oy] = run.origins[i];
    const g = glyphOf(f, run, i);
    if (g === null) continue; // a space or a control character
    const out = f && g >= 0 ? f.outline(g) : null;
    if (out && out.length) { d += place(out, f!, run.size, ox, oy, D); continue; }
    if (out && !out.length) continue; // a glyph with no contours (a space)
    // Fallback: a box of the advance by the cap height.
    const a = run.advances[i] ?? run.size * 0.55;
    const cap = f ? (f.capHeight / f.unitsPerEm) * run.size : run.size * 0.7;
    const l = a * 0.06, r = a * 0.94;
    if (r > l) d += `M${D(ox, oy, l, 0)}L${D(ox, oy, r, 0)}L${D(ox, oy, r, -cap)}L${D(ox, oy, l, -cap)}Z`;
  }
  if ((run.underline || run.strike) && n) {
    const [ox, oy] = run.origins[0];
    const total = run.advances.slice(0, n).reduce((t, v) => t + v, 0);
    const k = run.size / (f?.unitsPerEm ?? 1000);
    const bar = ([pos, th]: [number, number]) => { const t = Math.max(th * k, 1e-3); d += `M${D(ox, oy, 0, -pos * k - t / 2)}L${D(ox, oy, total, -pos * k - t / 2)}L${D(ox, oy, total, -pos * k + t / 2)}L${D(ox, oy, 0, -pos * k + t / 2)}Z`; };
    if (run.underline) bar(f ? f.underline : [-100, 50]);
    if (run.strike) bar(f ? f.strike : [260, 50]);
  }
  return d;
}

/** The glyph for item i: an index (-1 when the font is unknown but something visible is there), or null for nothing visible. */
function glyphOf(f: MetafileFont | null, run: TextRun, i: number): number | null {
  if (run.glyphs) return run.glyphs[i] ?? null;
  const ch = run.chars?.[i] ?? '';
  const cp = ch.codePointAt(0) ?? 0;
  if (cp <= 32 || cp === 0xa0 || cp === 0x3000 || (cp >= 0x2000 && cp <= 0x200b)) return null;
  return f ? f.glyphOf(cp) : -1;
}

function place(o: (string | number)[], f: MetafileFont, size: number, ox: number, oy: number, D: (ox: number, oy: number, lx: number, ly: number) => string): string {
  const k = size / f.unitsPerEm;
  let d = '', i = 0, cx = 0, cy = 0;
  const P = (x: number, y: number) => D(ox, oy, x * k, -y * k);
  while (i < o.length) {
    const t = o[i++];
    if (t === 'M' || t === 'L') { cx = o[i++] as number; cy = o[i++] as number; d += t + P(cx, cy); }
    else if (t === 'Q') { // as a cubic
      const qx = o[i++] as number, qy = o[i++] as number, x = o[i++] as number, y = o[i++] as number;
      d += 'C' + P(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)) + ' ' + P(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)) + ' ' + P(x, y);
      cx = x; cy = y;
    } else if (t === 'C') {
      const a = o.slice(i, i + 6) as number[]; i += 6;
      d += 'C' + P(a[0], a[1]) + ' ' + P(a[2], a[3]) + ' ' + P(a[4], a[5]);
      cx = a[4]; cy = a[5];
    } else if (t === 'Z') d += 'Z';
    else break;
  }
  return d;
}
