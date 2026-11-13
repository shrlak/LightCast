// Enhanced Metafile (MS-EMF): a header, then (type, size) records. Records are played into a `Gdi`;
// EMF+ comment records go to the EMF+ player. Records not understood are skipped.
import { type Xf, Bytes } from './bytes';
import { BS_HATCHED, BS_NULL, colorref, decode8, Gdi, MAX_POINTS, patternBrush, PS_NULL, type GdiBrush } from './gdi';
import { Plus } from './emfplus';
import { decodeDib } from './png';
import type { Played } from './wmf';

const SIGNATURE = 0x464d4520;
const EMF_PLUS = 0x2b464d45;
const MAX_RECORDS = 3_000_000;

export function isEmf(b: Bytes): boolean { return b.u32(0) === 1 && b.u32(40) === SIGNATURE; }

export interface EmfPlayed extends Played { plusUsed: boolean }

const pt = (r: Bytes, o: number): [number, number] => [r.i32(o), r.i32(o + 4)];
const rect = (r: Bytes, o: number): [number, number, number, number] => [r.i32(o), r.i32(o + 4), r.i32(o + 8), r.i32(o + 12)];
const xform = (r: Bytes, o: number): Xf => [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)];

/** Plays an EMF. With `preferPlus`, a file that holds EMF+ records is drawn from those (its GDI records are the fallback for old readers). */
export function playEmf(b: Bytes, preferPlus = true): EmfPlayed | null {
  if (!isEmf(b)) return null;
  const g = new Gdi();
  const hsize = b.u32(4);
  const [bl, bt, br, bb] = rect(b, 8);
  const [fl, ft, fr, fb] = rect(b, 24);
  const [dw, dh, mw, mh] = [b.i32(72), b.i32(76), b.i32(80), b.i32(84)];
  if (dw > 0 && dh > 0 && mw > 0 && mh > 0) g.pxPerMm = [dw / mw, dh / mh];
  let frame: [number, number, number, number] | null = null;
  let size: [number, number] | null = null;
  if (fr > fl && fb > ft) {
    const [kx, ky] = [g.pxPerMm[0] / 100, g.pxPerMm[1] / 100];
    frame = [fl * kx, ft * ky, (fr - fl) * kx, (fb - ft) * ky];
    size = [((fr - fl) / 100) * (96 / 25.4), ((fb - ft) / 100) * (96 / 25.4)];
  } else if (br > bl && bb > bt) {
    frame = [bl, bt, br - bl, bb - bt];
    size = [br - bl, bb - bt];
  }
  const plus = new Plus(g.out, frame ?? (br > bl && bb > bt ? [bl, bt, br - bl, bb - bt] : null));
  let gdiMute = false;
  let pos = Math.max(88, hsize);
  let n = 0;
  while (pos + 8 <= b.length && n++ < MAX_RECORDS && !g.out.full) {
    const type = b.u32(pos), len = b.u32(pos + 4);
    if (len < 8 || len % 4 !== 0 || pos + len > b.length) break;
    if (type === 14) break;
    const r = b.slice(pos, len);
    if (type === 70 && r.u32(12) === EMF_PLUS) {
      if (preferPlus) {
        g.out.muted = false;
        const getDc = plus.comment(r.tail(16));
        if (plus.active) gdiMute = !getDc;
      }
    } else {
      g.out.muted = gdiMute;
      record(g, type, r);
    }
    pos += len;
  }
  g.out.muted = false;
  return { gdi: g, frame, size, plusUsed: plus.active };
}

function record(g: Gdi, type: number, r: Bytes): void {
  const d = g.dc;
  switch (type) {
    case 9: g.setWindowExt(r.i32(8), r.i32(12)); break;
    case 10: g.setWindowOrg(r.i32(8), r.i32(12)); break;
    case 11: g.setViewportExt(r.i32(8), r.i32(12)); break;
    case 12: g.setViewportOrg(r.i32(8), r.i32(12)); break;
    case 31: g.scaleViewportExt(r.i32(8), r.i32(12), r.i32(16), r.i32(20)); break;
    case 32: g.scaleWindowExt(r.i32(8), r.i32(12), r.i32(16), r.i32(20)); break;
    case 17: g.setMapMode(r.u32(8)); break;
    case 18: d.bkMode = r.u32(8); break;
    case 19: d.polyFill = r.u32(8); break;
    case 20: d.rop2 = r.u32(8); break;
    case 22: d.textAlign = r.u32(8); break;
    case 24: d.textColor = colorref(r.u32(8)); break;
    case 25: d.bkColor = colorref(r.u32(8)); break;
    case 57: d.arcCcw = r.u32(8) !== 2; break;
    case 122: g.setDcBrush(colorref(r.u32(8))); break;
    case 123: g.setDcPen(colorref(r.u32(8))); break;
    case 33: g.save(); break;
    case 34: g.restore(r.i32(8)); break;
    case 35: g.modifyWorld(xform(r, 8), 4); break;
    case 36: g.modifyWorld(xform(r, 8), r.u32(32)); break;
    case 37: g.select(r.u32(8)); break;
    case 40: g.deleteObject(r.u32(8)); break;
    case 38: // CREATEPEN: handle, style, width, colour
      g.setObject(r.u32(8), { k: 'pen', pen: { style: r.u32(12), width: r.i32(16), color: colorref(r.u32(24)), cap: 'round', join: 'round', cosmetic: r.i32(16) <= 1 } });
      break;
    case 95: { // EXTCREATEPEN: handle, offsets, LogPenEx (style, width, brush style, colour)
      const style = r.u32(28), width = r.u32(32), brush = r.u32(36);
      const cosmetic = (style & 0xf0000) === 0;
      const cap = style & 0xf00;
      const join = style & 0xf000;
      g.setObject(r.u32(8), { k: 'pen', pen: {
        style: brush === BS_NULL ? PS_NULL : style & 0xf, width, color: colorref(r.u32(40)), cosmetic,
        cap: cap === 0x100 ? 'square' : cap === 0x200 ? 'butt' : 'round', join: join === 0x1000 ? 'bevel' : join === 0x2000 ? 'miter' : 'round',
      } });
      break;
    }
    case 39: { // CREATEBRUSHINDIRECT
      const style = r.u32(12);
      g.setObject(r.u32(8), { k: 'brush', brush: { style: style > 6 ? 0 : style, color: colorref(r.u32(16)), hatch: style === BS_HATCHED ? r.u32(20) : 0 } });
      break;
    }
    case 93: case 94: { // CREATEMONOBRUSH, CREATEDIBPATTERNBRUSHPT: handle, usage, bmi off/size, bits off/size
      const dib = decodeDib(r.slice(r.u32(16), r.u32(20)), r.slice(r.u32(24), r.u32(28)));
      const brush: GdiBrush = patternBrush(dib) ?? { style: 0, color: colorref(0x808080), hatch: 0 };
      g.setObject(r.u32(8), { k: 'brush', brush });
      break;
    }
    case 82: { // EXTCREATEFONTINDIRECTW: handle, LOGFONT
      const family = r.utf16(40, 32).split('\0')[0].trim() || 'Arial';
      g.setObject(r.u32(8), { k: 'font', font: { family, height: r.i32(12), weight: Math.max(0, Math.min(1000, r.i32(28))), italic: r.u8At(32) !== 0, underline: r.u8At(33) !== 0, strike: r.u8At(34) !== 0, charset: r.u8At(35), escapement: r.i32(20) } });
      break;
    }
    case 30: { const [l, t, rr, bb] = rect(r, 8); g.intersectClipRect(l, t, rr, bb); break; }
    case 75: extSelectClip(g, r); break;
    case 67: g.clipPath(r.u32(8)); break;
    case 27: g.moveTo(...pt(r, 8)); break;
    case 54: g.lineTo(...pt(r, 8)); break;
    case 15: g.pixel(r.i32(8), r.i32(12), colorref(r.u32(16))); break;
    case 42: { const [l, t, rr, bb] = rect(r, 8); g.ellipse(l, t, rr, bb); break; }
    case 43: { const [l, t, rr, bb] = rect(r, 8); g.rect(l, t, rr, bb); break; }
    case 44: { const [l, t, rr, bb] = rect(r, 8); g.roundRect(l, t, rr, bb, r.i32(24), r.i32(28)); break; }
    case 45: case 46: case 47: {
      const [l, t, rr, bb] = rect(r, 8);
      const [sx, sy] = pt(r, 24), [ex, ey] = pt(r, 32);
      g.arc(l, t, rr, bb, sx, sy, ex, ey, type === 45 ? 0 : type === 46 ? 1 : 2);
      break;
    }
    case 3: case 86: g.poly(counted(r, type === 3), true); break;
    case 4: case 87: g.poly(counted(r, type === 4), false); break;
    case 6: case 89: g.polylineTo(counted(r, type === 6)); break;
    case 2: case 85: g.bezier(counted(r, type === 2), true); break;
    case 5: case 88: g.bezier(counted(r, type === 5), false); break;
    case 7: case 90: g.polyPoly(groups(r, type === 7), false); break;
    case 8: case 91: g.polyPoly(groups(r, type === 8), true); break;
    case 59: g.beginPath(); break;
    case 60: g.endPath(); break;
    case 61: g.closeFigure(); break;
    case 62: g.paintPath(true, false); break;
    case 63: g.paintPath(true, true); break;
    case 64: g.paintPath(false, true); break;
    case 83: case 84: extTextOut(g, r, type === 84); break;
    case 108: smallTextOut(g, r); break;
    case 76: case 77: { // BITBLT / STRETCHBLT: dest rect @24, rop @40, source x/y @44, bmi @84, bits @92, source size @100
      const dst: [number, number, number, number] = [r.i32(24), r.i32(28), r.i32(32), r.i32(36)];
      const rop = r.u32(40);
      if (r.u32(96) === 0 || r.u32(88) === 0) { rasterOp(g, rop, dst); break; }
      const src: [number, number, number, number] = [r.i32(44), r.i32(48), type === 77 ? r.i32(100) : dst[2], type === 77 ? r.i32(104) : dst[3]];
      blit(g, r, dst, src, 84, 92);
      break;
    }
    case 114: case 115: { // ALPHABLEND / TRANSPARENTBLT: like STRETCHBLT with the blend function (colour) at 40
      const dst: [number, number, number, number] = [r.i32(24), r.i32(28), r.i32(32), r.i32(36)];
      blit(g, r, dst, [r.i32(44), r.i32(48), r.i32(100), r.i32(104)], 84, 92);
      break;
    }
    case 81: { // STRETCHDIBITS: dest x/y @24, source x/y/w/h @32, bmi @48, bits @56, rop @68, dest w/h @72
      blit(g, r, [r.i32(24), r.i32(28), r.i32(72), r.i32(76)], [r.i32(32), r.i32(36), r.i32(40), r.i32(44)], 48, 56);
      break;
    }
    case 80: { // SETDIBITSTODEVICE: dest x/y @24, source x/y @32, size @40, bmi @48, bits @56, first scan line @68
      const w = r.i32(40), h = r.i32(44);
      blit(g, r, [r.i32(24), r.i32(28), w, h], [r.i32(32), r.i32(36) - r.u32(68), w, h], 48, 56);
      break;
    }
    default: break;
  }
}

function rasterOp(g: Gdi, rop: number, [x, y, w, h]: [number, number, number, number]) {
  if (rop === 0x00f00021) g.fillRect(x, y, w, h);
  else if (rop === 0x00000042) g.fillRect(x, y, w, h, colorref(0));
  else if (rop === 0x00ff0062) g.fillRect(x, y, w, h, colorref(0xffffff));
}

/** The bitmap whose BITMAPINFO offset/size pair is at `bmi` and bits pair at `bits`, stretched into `dst`. */
function blit(g: Gdi, r: Bytes, dst: [number, number, number, number], src: [number, number, number, number], bmi: number, bits: number) {
  const bo = r.u32(bmi), bl = r.u32(bmi + 4), po = r.u32(bits), pl = r.u32(bits + 4);
  if (!pl || !bl) return;
  const dib = decodeDib(r.slice(bo, bl), r.slice(po, pl));
  if (dib) g.bitmap(dib, src, dst);
}

/** Point count at 24, then the points at 28: 32-bit, or 16-bit when `wide` is false. */
function counted(r: Bytes, wide: boolean): [number, number][] {
  return readPoints(r, 28, Math.min(r.u32(24), MAX_POINTS), wide);
}
function readPoints(r: Bytes, o: number, n: number, wide: boolean): [number, number][] {
  const out: [number, number][] = [];
  const step = wide ? 8 : 4;
  for (let i = 0; i < n && r.has(o + i * step, step); i++) out.push(wide ? [r.i32(o + i * step), r.i32(o + i * step + 4)] : [r.i16(o + i * step), r.i16(o + i * step + 2)]);
  return out;
}
/** Subpath count at 24, total points at 28, the counts at 32, then the points. */
function groups(r: Bytes, wide: boolean): [number, number][][] {
  const n = Math.min(r.u32(24), MAX_POINTS);
  const out: [number, number][][] = [];
  let o = 32 + n * 4;
  const step = wide ? 8 : 4;
  for (let i = 0; i < n && r.has(32 + i * 4, 4); i++) {
    const c = Math.min(r.u32(32 + i * 4), MAX_POINTS);
    if (!r.has(o, 0) || o > r.length) break;
    out.push(readPoints(r, o, c, wide));
    o += c * step;
  }
  return out;
}

/** EXTSELECTCLIPRGN: byte count @8, mode @12, RGNDATA @16 (32-byte header, then rectangles). */
function extSelectClip(g: Gdi, r: Bytes) {
  const cb = r.u32(8), mode = r.u32(12);
  if (cb === 0) { if (mode === 5) g.resetClip(); return; }
  const count = Math.min(r.u32(16 + 8), 4096);
  const rects: [number, number, number, number][] = [];
  for (let i = 0; i < count && r.has(16 + 32 + i * 16, 16) && 32 + i * 16 + 16 <= cb; i++) rects.push(rect(r, 16 + 32 + i * 16));
  g.clipRects(rects, mode);
}

const ETO_OPAQUE = 2, ETO_NO_RECT = 0x100, ETO_SMALL_CHARS = 0x200, ETO_GLYPH_INDEX = 0x10, ETO_PDY = 0x2000;

/** EXTTEXTOUTA / W: EmrText at 36: reference @36, chars @44, string offset @48, options @52, rect @56, dx offset @72. */
function extTextOut(g: Gdi, r: Bytes, wide: boolean) {
  const [x, y] = pt(r, 36);
  const n = Math.min(r.u32(44), 32768), off = r.u32(48), opts = r.u32(52);
  if (!n || opts & ETO_GLYPH_INDEX) return;
  const noRect = (opts & ETO_NO_RECT) !== 0;
  const bounds = noRect ? null : rect(r, 56);
  const dxOff = r.u32(noRect ? 56 : 72);
  const str = wide ? r.utf16(off, n) : decode8(r.slice(off, n).u8, g.dc.font.charset);
  const step = opts & ETO_PDY ? 8 : 4;
  const dx: number[] = [];
  if (dxOff) for (let i = 0; i < str.length && r.has(dxOff + i * step, 4); i++) dx.push(r.i32(dxOff + i * step));
  g.text(x, y, str, dx.length === str.length && str.length === n ? dx : null, bounds, (opts & ETO_OPAQUE) !== 0);
}

/** SMALLTEXTOUT: x, y @8, chars @16, options @20, then bounds (unless ETO_NO_RECT) and the characters. */
function smallTextOut(g: Gdi, r: Bytes) {
  const x = r.i32(8), y = r.i32(12), n = Math.min(r.u32(16), 32768), opts = r.u32(20);
  if (!n || opts & ETO_GLYPH_INDEX) return;
  const noRect = (opts & ETO_NO_RECT) !== 0;
  const off = noRect ? 36 : 52;
  const str = opts & ETO_SMALL_CHARS ? decode8(r.slice(off, n).u8, g.dc.font.charset) : r.utf16(off, n);
  g.text(x, y, str, null, noRect ? null : rect(r, 36), (opts & ETO_OPAQUE) !== 0);
}
