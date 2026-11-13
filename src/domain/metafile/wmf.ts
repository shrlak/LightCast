// Windows Metafile (MS-WMF): a placeable (or plain) header, then 16-bit-word records. Records are
// played into a `Gdi`; those not understood are skipped.
import { Bytes } from './bytes';
import { BS_HATCHED, BS_SOLID, colorref, decode8, Gdi, MAX_POINTS, patternBrush } from './gdi';
import { decodeDib } from './png';

export interface Played {
  gdi: Gdi;
  /** The picture frame in device units: [x, y, w, h]; null when the file states none. */
  frame: [number, number, number, number] | null;
  /** Size in CSS px, when the file states one. */
  size: [number, number] | null;
}

const PLACEABLE = 0x9ac6cdd7;
export function isWmf(b: Bytes): boolean {
  if (b.u32(0) === PLACEABLE) return true;
  return (b.u16(0) === 1 || b.u16(0) === 2) && b.u16(2) === 9 && (b.u16(4) === 0x100 || b.u16(4) === 0x300);
}

const MAX_RECORDS = 2_000_000;

export function playWmf(b: Bytes): Played | null {
  if (!isWmf(b)) return null;
  const g = new Gdi();
  g.wmf = true;
  let pos = 0;
  let bbox: [number, number, number, number] | null = null;
  let inch = 0;
  if (b.u32(0) === PLACEABLE) {
    const l = b.i16(6), t = b.i16(8), r = b.i16(10), bt = b.i16(12);
    inch = b.u16(14);
    if (r !== l && bt !== t) bbox = [Math.min(l, r), Math.min(t, bt), Math.abs(r - l), Math.abs(bt - t)];
    pos = 22;
  }
  if (b.u16(pos + 2) !== 9) return null;
  pos += b.u16(pos + 2) * 2;
  if (bbox) { g.dc.winOrg = [bbox[0], bbox[1]]; g.dc.winExt = [bbox[2], bbox[3]]; }
  let n = 0;
  while (pos + 6 <= b.length && n++ < MAX_RECORDS && !g.out.full) {
    const words = b.u32(pos);
    const fn = b.u16(pos + 4);
    if (words < 3 || fn === 0) break;
    record(g, fn, b.slice(pos, Math.min(words * 2, b.length - pos)));
    pos += words * 2;
  }
  // View box: the window extent (what the records draw in), else the placeable bounding box.
  const ext = g.winSeen.ext;
  let frame: [number, number, number, number] | null = null;
  if (ext && ext[0] && ext[1]) frame = [0, 0, Math.abs(ext[0]), Math.abs(ext[1])];
  else if (bbox) frame = [0, 0, bbox[2], bbox[3]];
  const size: [number, number] | null = frame ? (inch > 0 && bbox ? [(bbox[2] / inch) * 96, (bbox[3] / inch) * 96] : [frame[2], frame[3]]) : null;
  return { gdi: g, frame, size };
}

/** Parameters start at byte 6 of the record. */
function record(g: Gdi, fn: number, r: Bytes): void {
  const s = (i: number) => r.i16(6 + i * 2);
  const u = (i: number) => r.u16(6 + i * 2);
  const words = Math.floor((r.length - 6) / 2);
  const d = g.dc;
  switch (fn) {
    case 0x001e: g.save(); break;
    case 0x0127: g.restore(s(0)); break;
    case 0x0103: g.setMapMode(u(0)); break;
    case 0x0102: d.bkMode = u(0); break;
    case 0x0104: d.rop2 = u(0); break;
    case 0x0106: d.polyFill = u(0); break;
    case 0x012e: d.textAlign = u(0); break;
    case 0x0201: d.bkColor = colorref(r.u32(6)); break;
    case 0x0209: d.textColor = colorref(r.u32(6)); break;
    case 0x020b: g.setWindowOrg(s(1), s(0)); break;
    case 0x020c: g.setWindowExt(s(1), s(0)); break;
    case 0x020d: g.setViewportOrg(s(1), s(0)); break;
    case 0x020e: g.setViewportExt(s(1), s(0)); break;
    case 0x020f: g.setWindowOrg(d.winOrg[0] + s(1), d.winOrg[1] + s(0)); break;
    case 0x0211: g.setViewportOrg(d.vpOrg[0] + s(1), d.vpOrg[1] + s(0)); break;
    case 0x0410: g.scaleWindowExt(s(3), s(2), s(1), s(0)); break;
    case 0x0412: g.scaleViewportExt(s(3), s(2), s(1), s(0)); break;
    case 0x012d: g.select(u(0)); break;
    case 0x01f0: g.deleteObject(u(0)); break;
    case 0x02fa: // CreatePenIndirect: style, width (x, y), colour
      g.addObject({ k: 'pen', pen: { style: u(0), width: s(1), color: colorref(r.u32(12)), cap: 'round', join: 'round', cosmetic: s(1) <= 1 } });
      break;
    case 0x02fc: { // CreateBrushIndirect: style, colour, hatch
      const style = u(0);
      g.addObject({ k: 'brush', brush: { style: style === 3 ? BS_SOLID : style, color: colorref(r.u32(8)), hatch: style === BS_HATCHED ? u(3) : 0 } });
      break;
    }
    case 0x0142: { // DibCreatePatternBrush: style, colour usage, packed DIB
      const brush = patternBrush(decodeDib(r.tail(10), r.tail(10), true));
      g.addObject({ k: 'brush', brush: brush ?? { style: BS_SOLID, color: colorref(0x808080), hatch: 0 } });
      break;
    }
    case 0x01f9: g.addObject({ k: 'brush', brush: { style: BS_SOLID, color: colorref(0x808080), hatch: 0 } }); break;
    case 0x02fb: { // CreateFontIndirect: height, width, escapement, orientation, weight, flags, charset, ..., face name
      const charset = r.u8At(19);
      const raw: number[] = [];
      for (let i = 0; i < 32 && r.u8At(24 + i); i++) raw.push(r.u8At(24 + i));
      const family = decode8(new Uint8Array(raw), charset).trim() || 'Arial';
      g.addObject({ k: 'font', font: { family, height: s(0), weight: s(4), italic: r.u8At(16) !== 0, underline: r.u8At(17) !== 0, strike: r.u8At(18) !== 0, charset, escapement: s(2) } });
      break;
    }
    case 0x0214: g.moveTo(s(1), s(0)); break;
    case 0x0213: g.lineTo(s(1), s(0)); break;
    case 0x041b: g.rect(s(3), s(2), s(1), s(0)); break;
    case 0x0418: g.ellipse(s(3), s(2), s(1), s(0)); break;
    case 0x061c: g.roundRect(s(5), s(4), s(3), s(2), s(1), s(0)); break;
    case 0x0817: g.arc(s(7), s(6), s(5), s(4), s(3), s(2), s(1), s(0), 0); break;
    case 0x0830: g.arc(s(7), s(6), s(5), s(4), s(3), s(2), s(1), s(0), 1); break;
    case 0x081a: g.arc(s(7), s(6), s(5), s(4), s(3), s(2), s(1), s(0), 2); break;
    case 0x041f: g.pixel(s(3), s(2), colorref(r.u32(6))); break;
    case 0x0324: g.poly(points(r, 6 + 2, Math.min(u(0), words), MAX_POINTS), true); break;
    case 0x0325: g.poly(points(r, 6 + 2, Math.min(u(0), words), MAX_POINTS), false); break;
    case 0x0538: { // PolyPolygon: count of polygons, their point counts, the points
      const n = Math.min(u(0), words);
      const groups: [number, number][][] = [];
      let off = 6 + 2 + n * 2;
      for (let i = 0; i < n; i++) {
        const c = u(1 + i);
        groups.push(points(r, off, c, MAX_POINTS));
        off += c * 4;
        if (off > r.length) break;
      }
      g.polyPoly(groups, true);
      break;
    }
    case 0x0416: g.intersectClipRect(s(3), s(2), s(1), s(0)); break;
    case 0x0521: { // TextOut: length, string (word-aligned), y, x
      const n = Math.min(u(0), 32768), pad = n + (n & 1);
      const str = decode8(r.slice(8, n).u8, g.dc.font.charset);
      g.text(r.i16(8 + pad + 2), r.i16(8 + pad), str, null, null, false);
      break;
    }
    case 0x0a32: { // ExtTextOut: y, x, length, options, [rect], string, [dx]
      const n = Math.min(s(2), 32768), opts = u(3);
      let off = 14;
      let rect: [number, number, number, number] | null = null;
      if (opts & 6) { rect = [r.i16(14), r.i16(16), r.i16(18), r.i16(20)]; off = 22; }
      if (n <= 0) break;
      const str = decode8(r.slice(off, n).u8, g.dc.font.charset);
      const dxOff = off + n + (n & 1);
      const dx: number[] = [];
      for (let i = 0; i < n && r.has(dxOff + i * 2, 2); i++) dx.push(r.i16(dxOff + i * 2));
      g.text(s(1), s(0), str, dx.length === n ? dx : null, rect, (opts & 2) !== 0);
      break;
    }
    case 0x0f43: { // StretchDIBits: rop, usage, src h/w/y/x, dst h/w/y/x, DIB
      const dib = decodeDib(r.tail(28), r.tail(28), true);
      if (dib) g.bitmap(dib, [r.i16(18), r.i16(16), r.i16(14), r.i16(12)], [r.i16(26), r.i16(24), r.i16(22), r.i16(20)]);
      break;
    }
    case 0x0b41: { // DibStretchBlt: rop, src h/w/y/x, dst h/w/y/x, DIB
      const rop = r.u32(6);
      if (r.length <= 26) { rasterOp(g, rop, r.i16(24), r.i16(22), r.i16(20), r.i16(18)); break; }
      const dib = decodeDib(r.tail(26), r.tail(26), true);
      if (dib) g.bitmap(dib, [r.i16(16), r.i16(14), r.i16(12), r.i16(10)], [r.i16(24), r.i16(22), r.i16(20), r.i16(18)]);
      break;
    }
    case 0x0940: { // DibBitBlt: rop, ySrc, xSrc, height, width, yDst, xDst, DIB
      const rop = r.u32(6);
      if (r.length <= 24) { rasterOp(g, rop, r.i16(20), r.i16(18), r.i16(16), r.i16(14)); break; }
      const dib = decodeDib(r.tail(22), r.tail(22), true);
      const w = r.i16(16), h = r.i16(14);
      if (dib) g.bitmap(dib, [r.i16(12), r.i16(10), w, h], [r.i16(20), r.i16(18), w, h]);
      break;
    }
    case 0x0d33: { // SetDIBitsToDevice
      const dib = decodeDib(r.tail(24), r.tail(24), true);
      const w = r.i16(18), h = r.i16(16);
      if (dib) g.bitmap(dib, [r.i16(14), r.i16(12), w, h], [r.i16(22), r.i16(20), w, h]);
      break;
    }
    default: break;
  }
}

/** A raster operation with no source bitmap: PATCOPY fills with the brush, BLACKNESS / WHITENESS with a colour. */
function rasterOp(g: Gdi, rop: number, x: number, y: number, w: number, h: number) {
  if (rop === 0x00f00021) g.fillRect(x, y, w, h);
  else if (rop === 0x00000042) g.fillRect(x, y, w, h, colorref(0));
  else if (rop === 0x00ff0062) g.fillRect(x, y, w, h, colorref(0xffffff));
}

/** `n` points as (x, y) 16-bit pairs at `off`. */
function points(r: Bytes, off: number, n: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < Math.min(n, max) && r.has(off + i * 4, 4); i++) out.push([r.i16(off + i * 4), r.i16(off + i * 4 + 2)]);
  return out;
}

