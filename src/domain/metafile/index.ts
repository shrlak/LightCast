// Windows metafile pictures (.wmf, .emf, EMF+ inside .emf) → SVG, in TypeScript.
//
// Supported
//   WMF: placeable and plain headers; window / viewport origin and extent, SaveDC / RestoreDC; pens,
//     brushes (solid, hatched, DIB pattern), fonts; Rectangle, RoundRect, Ellipse, Arc, Pie, Chord,
//     Polygon, Polyline, PolyPolygon, LineTo / MoveTo, SetPixel; TextOut / ExtTextOut (8-bit code
//     pages incl. Korean, dx arrays, rotation); DIB bitmaps (StretchDIBits, DibStretchBlt, DibBitBlt,
//     SetDIBitsToDevice); IntersectClipRect; text / background colours and modes, polygon fill mode.
//   EMF: header frame and device size; map modes, window / viewport and world transforms; the object
//     table with stock objects; pens (incl. ext pens: dash, caps, joins), brushes (solid, hatched,
//     DIB pattern), fonts; shapes, polygons / polylines / Béziers (32 and 16 bit), arcs, path
//     brackets (fill / stroke / clip); ExtTextOutA / W, SmallTextOut; bitmaps (BitBlt, StretchBlt,
//     StretchDIBits, SetDIBitsToDevice, AlphaBlend, TransparentBlt); rectangle and path clips.
//   EMF+: header, objects (brushes: solid, hatch, linear gradient with blend factors / preset colours /
//     gamma correction / wrap, path gradient with surround colours, blend factors / preset colours, focus
//     scales, gamma and wrap (gradient.ts); pens; paths; images: bitmap, PNG/JPEG/GIF, nested metafile;
//     fonts; string formats), image effects (SerializableObject + DrawImagePoints E flag: blur, sharpen,
//     brightness / contrast, colour balance, colour curve, lookup table, colour matrix, hue / saturation /
//     lightness, levels, tint as SVG filters; red-eye on the decoded pixels, effects.ts),
//     Clear, Fill / Draw Rects, Polygon, Lines, Ellipse, Pie, Arc, Path, Beziers, curves, closed
//     curves, DrawImage, DrawImagePoints, DrawString, DrawDriverString (character codes), world and
//     page transforms, Save / Restore / containers, clip rectangle and path. In a file that holds
//     EMF+ records those are drawn and the GDI fallback is ignored, except where GetDC asks for it.
// Also drawn, approximately
//   Regions: EMF ExtCreateRegion / FillRgn / FrameRgn / PaintRgn / InvertRgn, WMF CreateRegion /
//     FillRegion / FrameRegion / PaintRegion / InvertRegion / SelectClipRegion, as rectangle lists.
//   Raster operations that read the destination: DSTINVERT, PATINVERT, SRCINVERT, NOTSRCCOPY, SRCAND,
//     SRCPAINT, NOTSRCAND, MERGEPAINT, PATPAINT and the binary ROP2 modes (XOR, NOT, MASK, MERGE,
//     NOTCOPYPEN, BLACK, WHITE) become CSS `mix-blend-mode` (difference / multiply / screen) and an
//     invert filter. XOR is exact on black and white; elsewhere it is `difference`, a look-alike.
//     Blend modes show in browsers and when the SVG is drawn to a canvas for the PNG; other renderers
//     may ignore them.
//   Bitmaps: AlphaBlend constant alpha and per-pixel alpha (also in 32-bit BI_BITFIELDS DIBs),
//     TransparentBlt colour key, MaskBlt (where the 1-bit mask is 1 the foreground operation of the ROP4,
//     where it is 0 its background operation: leave the destination, the source operations, BLACKNESS,
//     WHITENESS, PATCOPY, DSTINVERT, PATINVERT), PlgBlt (a parallelogram from three corners).
//   Flood fills (EMF EXTFLOODFILL, WMF FLOODFILL / EXTFLOODFILL; border and surface modes): a file that
//     holds one records what it draws and a software rasteriser (raster.ts) paints it, without
//     anti-aliasing, like GDI, over the frame (at most 4 M pixels); the 4-connected scanline fill's pixels
//     are drawn with the current brush as rectangles at the flood's place in the drawing order. Text is
//     not rasterised, dashes are drawn solid, and the page under the picture counts as white.
//   Text widths come from the font's own advance widths (hmtx) when its file is known (imported or
//     brought by a deck, fonts.ts), else canvas measureText with a DOM, else built-in Helvetica / Times /
//     fixed-pitch tables (metrics.ts). In double-byte code pages (Korean, Japanese, Chinese) the advance
//     array has one entry per byte and is folded to one per character.
//   Glyph-index text (ETO_GLYPH_INDEX, DrawDriverString without character codes): mapped back to
//     characters through the font's cmap (formats 4 and 12) when its file is known; otherwise, and for a
//     glyph the cmap does not name, a pale box per glyph.
//   EMF+ path gradients: an elliptical boundary with one surround colour is a radial gradient (with the
//     tile wrap modes it is padded); any other is a bitmap of the boundary cut into triangles from the
//     centre (at most 256 px a side). Focus scales that differ in x and y are blended by direction. The
//     colour-curve, levels, balance and tint effect curves are look-alikes (the specification gives only
//     their parameters).
// Exact clips: the clip is kept as an expression over paths (AND, OR, XOR, DIFF, COPY; EMF+ also
//   complement) and drawn as nested `clip-path` groups for intersections and as a `mask` for the
//   rest, so a union, XOR or complement is exact however many clips are already open, and RestoreDC /
//   Restore bring a saved clip back. EMF+ region trees (rectangles, infinite, empty and path nodes
//   with and / or / xor / exclude / complement) are drawn and clipped exactly, path nodes included.
//   EMF+ image attributes: a source rectangle that reaches past the image shows the wrap mode (tile,
//   mirrored in x / y / both) or the clamp colour. EMF+ texture brushes, relative-coordinate paths
//   and BeginContainer source -> destination mapping are read as the specifications lay them out.
// WMF output stays in logical units: a hairline pen (and the dash and sliver rules) is one pixel,
//   which is the frame width over the size in pixels, not one logical unit.
// Not drawn
//   EMF+ ImageAttributes colour matrices, gamma, thresholds and remap tables: the EMF+ attributes object
//     (MS-EMFPLUS 2.2.1.5) stores only the wrap mode and clamp colour, so a file cannot carry them.
//   Red-eye correction of a PNG / JPEG image (it works on decoded bitmaps only); a WMF ExtTextOut with
//     ETO_GLYPH_INDEX is read as characters.
//   EMF+ region and clip changes beyond 128 nested combines, or a region tree of over 400 nodes, are
//     ignored rather than approximated.
import { Bytes } from './bytes';
import { isEmf, playEmf } from './emf';
import { setNestedRenderer } from './emfplus';
import { base64, decodeBudget } from './png';
import { isWmf, playWmf, type Played } from './wmf';

export interface MetafileSvg {
  svg: string;
  /** Size in CSS pixels (96 dpi). */
  width: number;
  height: number;
  format: 'wmf' | 'emf' | 'emf+';
  /** Elements drawn; 0 means nothing the reader understands was in the file. */
  items: number;
  /** Notes about parts that could not be drawn (e.g. a flood fill past the limits). */
  warnings?: string[];
}

/** Files bigger than this are not read. */
export const MAX_BYTES = 256 * 1024 * 1024;

const toBytes = (input: ArrayBuffer | ArrayBufferView): Bytes =>
  new Bytes(input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength));

/** True when the bytes start like a WMF (placeable or plain) or an EMF. */
export function isMetafile(input: ArrayBuffer | ArrayBufferView): boolean {
  try { const b = toBytes(input); return isEmf(b) || isWmf(b); } catch { return false; }
}

function finish(p: Played, format: MetafileSvg['format']): MetafileSvg | null {
  const out = p.gdi.out;
  let view = p.frame;
  if (!view || !(view[2] > 0 && view[3] > 0)) {
    if (!Number.isFinite(out.minX) || !(out.maxX > out.minX || out.maxY > out.minY)) return null;
    view = [out.minX, out.minY, Math.max(out.maxX - out.minX, 1), Math.max(out.maxY - out.minY, 1)];
  }
  let [w, h] = p.size && p.size[0] > 0 && p.size[1] > 0 ? p.size : [view[2], view[3]];
  const k = Math.min(1, 20000 / Math.max(w, h, 1));
  w = Math.max(1, w * k); h = Math.max(1, h * k);
  return { svg: out.svg(view, w, h), width: w, height: h, format, items: out.items, ...(out.warnings.length ? { warnings: [...out.warnings] } : {}) };
}

/** Reads a WMF / EMF / EMF+ and draws it as an SVG picture. Never throws: null when it is not a metafile or has no extent. */
let depth = 0;
export function metafileToSvg(input: ArrayBuffer | ArrayBufferView): MetafileSvg | null {
  if (depth === 0) decodeBudget.px = 120_000_000;
  depth++;
  try {
    const b = toBytes(input);
    if (b.length < 18 || b.length > MAX_BYTES) return null;
    if (isEmf(b)) {
      let p = playEmf(b, true);
      if (p && p.plusUsed && p.gdi.out.items === 0) p = playEmf(b, false); // EMF+ drew nothing: use the GDI records
      return p ? finish(p, p.plusUsed ? 'emf+' : 'emf') : null;
    }
    if (isWmf(b)) {
      const p = playWmf(b);
      return p ? finish(p, 'wmf') : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    depth--;
  }
}

setNestedRenderer((u8) => {
  const r = metafileToSvg(u8);
  return r ? { href: `data:image/svg+xml;base64,${base64(new TextEncoder().encode(r.svg))}`, w: r.width, h: r.height } : null;
});
