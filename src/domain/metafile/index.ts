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
//   EMF+: header, objects (brushes: solid, hatch, linear gradient, path gradient as its centre
//     colour; pens; paths; images: bitmap, PNG/JPEG/GIF, nested metafile; fonts; string formats),
//     Clear, Fill / Draw Rects, Polygon, Lines, Ellipse, Pie, Arc, Path, Beziers, curves, closed
//     curves, DrawImage, DrawImagePoints, DrawString, DrawDriverString (character codes), world and
//     page transforms, Save / Restore / containers, clip rectangle and path. In a file that holds
//     EMF+ records those are drawn and the GDI fallback is ignored, except where GetDC asks for it.
// Also drawn, approximately
//   Regions: EMF ExtCreateRegion / FillRgn / FrameRgn / PaintRgn / InvertRgn, WMF CreateRegion /
//     FillRegion / FrameRegion / PaintRegion / InvertRegion / SelectClipRegion, EMF+ region objects
//     (rect, infinite, empty, and / or / xor / exclude / complement; a path node as its bounding box)
//     with FillRegion and SetClipRegion. Clip combine modes AND, DIFF (exclude), COPY are exact; OR and
//     XOR rebuild the innermost clip, exact for one clip level. ExcludeClipRect is exact.
//   Raster operations that read the destination: DSTINVERT, PATINVERT, SRCINVERT, NOTSRCCOPY, SRCAND,
//     SRCPAINT, NOTSRCAND, MERGEPAINT, PATPAINT and the binary ROP2 modes (XOR, NOT, MASK, MERGE,
//     NOTCOPYPEN, BLACK, WHITE) become CSS `mix-blend-mode` (difference / multiply / screen) and an
//     invert filter. XOR is exact on black and white; elsewhere it is `difference`, a look-alike.
//     Blend modes show in browsers and when the SVG is drawn to a canvas for the PNG; other renderers
//     may ignore them.
//   Bitmaps: AlphaBlend constant alpha and per-pixel alpha, TransparentBlt colour key.
//   EMF+: texture brushes (tiled image, brush transform), relative-coordinate paths, BeginContainer
//     source -> destination rectangle mapping. Text widths come from canvas measureText with a DOM,
//     else built-in Helvetica / Times / fixed-pitch tables (metrics.ts).
//   Glyph-index text (ETO_GLYPH_INDEX, DrawDriverString without character codes): the indices cannot be
//     mapped to characters without the font, so a pale box is drawn per glyph as a placeholder.
// Not drawn: MaskBlt / PlgBlt, flood fills, EMF+ image attributes and effects (the attributes object
//   holds only a wrap mode and clamp colour), path nodes of EMF+ regions beyond their bounding box,
//   EMF+ complement clipping under an already open clip.
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
  return { svg: out.svg(view, w, h), width: w, height: h, format, items: out.items };
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
