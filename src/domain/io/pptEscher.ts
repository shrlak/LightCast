// Escher / OfficeArt (MS-ODRAW) pieces of legacy .ppt drawings: the property tables of a shape
// (fill, line, rotation, text frame), the shape type → LightCast preset map and the flip / group flags.
import { colorRef, type Ctx, type Rec, type Scheme } from './pptRecords';
import type { DashStyle } from '../types';

/** Escher property id → value (the 32-bit number of the table; complex data is not kept). */
export type Props = Map<number, number>;

export const P = {
  rotation: 0x0004, geoLeft: 0x0140, geoTop: 0x0141, geoRight: 0x0142, geoBottom: 0x0143, pVertices: 0x0145, pSegmentInfo: 0x0146, shadowColor: 0x0201, shadowOpacity: 0x0204, shadowOffX: 0x0205, shadowOffY: 0x0206, shadowFlags: 0x023f, cropTop: 0x0100, cropBottom: 0x0101, cropLeft: 0x0102, cropRight: 0x0103, pib: 0x0104,
  textLeft: 0x0081, textTop: 0x0082, textRight: 0x0083, textBottom: 0x0084, wrapText: 0x0085, anchorText: 0x0087, textFlags: 0x00bf,
  fillType: 0x0180, fillColor: 0x0181, fillOpacity: 0x0182, fillBack: 0x0183, fillBlip: 0x0186, fillAngle: 0x018d, fillFlags: 0x01bf,
  lineColor: 0x01c0, lineWidth: 0x01cb, lineDash: 0x01ce, lineStartArrow: 0x01d0, lineEndArrow: 0x01d1, lineFlags: 0x01ff,
};

/** SpAtom flags. */
export const SP = { group: 0x1, child: 0x2, patriarch: 0x4, deleted: 0x8, flipH: 0x40, flipV: 0x80, background: 0x400 };

/** The complex (variable length) data of a property table, by property id; kept beside the Props map it was read with. */
const COMPLEX = new WeakMap<Props, Map<number, Uint8Array>>();
const ARRAYS = new Set([0x145, 0x146, 0x151, 0x152, 0x155, 0x156, 0x157, 0x197, 0x383]);
const MAX_COMPLEX = 4 * 1024 * 1024;
export const complexOf = (p: Props, id: number): Uint8Array | undefined => COMPLEX.get(p)?.get(id);

/** Add the properties of an OPT / secondary / tertiary OPT record (earlier values are overwritten). Complex data follows the table, in property order. */
export function readOpt(c: Ctx, r: Rec, into: Props) {
  const n = Math.min(r.inst, Math.floor((r.end - r.pos) / 6));
  let data = r.pos + n * 6;
  let store = COMPLEX.get(into);
  for (let i = 0; i < n; i++) {
    const raw = c.v.getUint16(r.pos + i * 6, true);
    const id = raw & 0x3fff;
    const val = c.v.getInt32(r.pos + i * 6 + 2, true);
    into.set(id, val);
    if (raw & 0x8000) {
      // Complex: the value is the byte length of its data.
      let len = Math.max(0, val);
      // An IMsoArray starts with a 6-byte header (count, allocated, element size); LibreOffice's length leaves the header out.
      if (ARRAYS.has(id) && len >= 0 && data + 6 <= r.end) {
        const cb = c.v.getUint16(data + 4, true), elem = cb === 0xfff0 ? 4 : cb;
        if (elem > 0 && c.v.getUint16(data, true) * elem === len) len += 6;
      }
      if (data + len <= r.end && len <= MAX_COMPLEX) {
        if (!store) COMPLEX.set(into, (store = new Map()));
        store.set(id, c.b.subarray(data, data + len));
      }
      data += len;
    } else store?.delete(id);
  }
}

/** A boolean-group property: its flag when the "use" bit (the flag shifted 16 up) is set, else undefined. */
const boolOf = (v: number | undefined, bit: number): boolean | undefined => (v !== undefined && (v & (bit << 16)) ? (v & bit) !== 0 : undefined);

/** msosptXxx shape type → PowerPoint preset name (the names `SlideElement.shape` takes). Types not listed are freeforms or unknown. */
const PRESETS: Record<number, string> = {
  1: 'rect', 2: 'roundRect', 3: 'ellipse', 4: 'diamond', 5: 'triangle', 6: 'rtTriangle', 7: 'parallelogram', 8: 'trapezoid', 9: 'hexagon', 10: 'octagon',
  11: 'plus', 12: 'star5', 13: 'rightArrow', 14: 'rightArrow', 15: 'homePlate', 16: 'cube', 17: 'wedgeRoundRectCallout', 19: 'arc', 20: 'line', 21: 'plaque',
  22: 'can', 23: 'donut', 32: 'line', 33: 'line', 34: 'line', 35: 'line', 36: 'line', 37: 'line', 38: 'line', 39: 'line', 40: 'line',
  55: 'chevron', 56: 'pentagon', 58: 'star8', 59: 'star16', 60: 'star32', 61: 'wedgeRectCallout', 62: 'wedgeRoundRectCallout', 63: 'wedgeEllipseCallout',
  66: 'leftArrow', 67: 'downArrow', 68: 'upArrow', 69: 'leftRightArrow', 70: 'upDownArrow', 73: 'lightningBolt', 74: 'heart', 76: 'quadArrow',
  92: 'star24', 94: 'notchedRightArrow', 183: 'sun', 184: 'moon', 187: 'star4', 202: 'rect',
};
export const presetOf = (type: number): string | undefined => PRESETS[type];
export const isLineType = (type: number) => type === 20 || (type >= 32 && type <= 40);
/** Types that are a plain box: a text box or a rectangle. */
export const isBoxType = (type: number) => type === 1 || type === 202 || type === 0;

export interface FillSpec {
  /** Solid fill. */
  color?: string;
  /** Shaded fill: start and end colour, CSS-style angle (0 = left to right, 90 = top to bottom). */
  gradient?: { from: string; to: string; angle: number; radial?: boolean };
  /** Picture / texture fill: 1-based picture index. */
  picture?: number;
  /** Fill is the slide's background (fillType 9). */
  background?: boolean;
  /** 0-1 transparency. */
  transparency?: number;
}

const fixed = (v: number | undefined) => (v ?? 0) / 65536;

export function fillOf(p: Props, scheme: Scheme | undefined): FillSpec | undefined {
  const type = p.get(P.fillType);
  const colorV = p.get(P.fillColor);
  const filled = boolOf(p.get(P.fillFlags), 0x10) ?? (colorV !== undefined || type !== undefined);
  if (!filled) return undefined;
  const color = colorV !== undefined ? colorRef(colorV, scheme) : '#ffffff';
  const out: FillSpec = {};
  const op = p.get(P.fillOpacity);
  if (op !== undefined && op < 65536) out.transparency = Math.max(0, Math.min(1, 1 - op / 65536));
  if (type === 9) { out.background = true; return out; }
  if (type === 2 || type === 3) {
    const pic = p.get(P.fillBlip);
    if (pic && pic > 0) { out.picture = pic; return out; }
  }
  if (type !== undefined && type >= 4 && type <= 8) {
    const backV = p.get(P.fillBack);
    const to = backV !== undefined ? colorRef(backV, scheme) : '#ffffff';
    if (color && to) {
      const angle = ((-fixed(p.get(P.fillAngle)) % 360) + 360) % 360;
      out.gradient = { from: color, to, angle: Math.round(angle * 100) / 100, ...(type === 5 || type === 6 ? { radial: true } : {}) };
      return out;
    }
  }
  if (color) out.color = color;
  return out.color || out.picture ? out : undefined;
}

const DASH: Record<number, DashStyle> = { 1: 'sysDash', 2: 'sysDot', 3: 'sysDashDot', 4: 'sysDashDotDot', 5: 'dot', 6: 'dash', 7: 'lgDash', 8: 'dashDot', 9: 'lgDashDot', 10: 'lgDashDotDot' };

export interface LineSpec { color: string; /** EMU. */ width: number; dash?: DashStyle; arrowStart?: boolean; arrowEnd?: boolean }

export function lineOf(p: Props, scheme: Scheme | undefined, always: boolean): LineSpec | undefined {
  const colorV = p.get(P.lineColor);
  const on = boolOf(p.get(P.lineFlags), 0x8) ?? (always || colorV !== undefined);
  if (!on) return undefined;
  const color = colorV !== undefined ? colorRef(colorV, scheme) : '#000000';
  if (!color) return undefined;
  const w = p.get(P.lineWidth);
  const out: LineSpec = { color, width: w !== undefined && w >= 0 && w < 12700 * 200 ? w : 9525 };
  const dash = DASH[p.get(P.lineDash) ?? 0];
  if (dash) out.dash = dash;
  if ((p.get(P.lineStartArrow) ?? 0) > 0) out.arrowStart = true;
  if ((p.get(P.lineEndArrow) ?? 0) > 0) out.arrowEnd = true;
  return out;
}

export interface CustomPath {
  /** SVG path data in a `w`×`h` space (the geometry rectangle, moved to the origin). */
  path: string;
  w: number;
  h: number;
  /** The path asks for no fill / no outline (msopathEscapeNoFill / NoLine). */
  noFill?: boolean;
  noLine?: boolean;
}

const MAX_PATH_POINTS = 20000;

/**
 * Custom geometry of a freeform (msosptNotPrimitive): pVertices + pSegmentInfo (MS-ODRAW 2.3.6) as an SVG path.
 * Vertices that are guide formulas and the arc escapes are not read: null.
 */
export function customPathOf(p: Props): CustomPath | null {
  const vb = complexOf(p, P.pVertices), sb = complexOf(p, P.pSegmentInfo);
  if (!vb || vb.length < 6) return null;
  const vv = new DataView(vb.buffer, vb.byteOffset, vb.byteLength);
  const n = vv.getUint16(0, true), size = vv.getUint16(4, true);
  const elem = size === 0xfff0 ? 4 : size;
  if (elem !== 4 && elem !== 8) return null;
  const count = Math.min(n, Math.floor((vb.length - 6) / elem), MAX_PATH_POINTS);
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * elem;
    pts.push(elem === 8 ? [vv.getInt32(o, true), vv.getInt32(o + 4, true)] : [vv.getInt16(o, true), vv.getInt16(o + 2, true)]);
  }
  let segs: number[] = [];
  if (sb && sb.length >= 6) {
    const sv = new DataView(sb.buffer, sb.byteOffset, sb.byteLength);
    const m = Math.min(sv.getUint16(0, true), Math.floor((sb.length - 6) / 2), MAX_PATH_POINTS);
    for (let i = 0; i < m; i++) segs.push(sv.getUint16(6 + i * 2, true));
  } else if (pts.length) segs = [0x4000, Math.max(0, pts.length - 1)];
  let left = p.get(P.geoLeft) ?? 0, top = p.get(P.geoTop) ?? 0;
  let right = p.get(P.geoRight) ?? 0, bottom = p.get(P.geoBottom) ?? 0;
  const hasGeo = right > left && bottom > top;
  if (!hasGeo) { left = 0; top = 0; right = 21600; bottom = 21600; }
  const f = (v: number) => String(Math.round(v * 100) / 100);
  // Coordinates with the formula flag (the high bit) are results of the shape's guides.
  const guides = guideValues(p, left, top, right, bottom);
  const coord = (v: number) => (v < 0 ? guides(v & (elem === 8 ? 0xffff : 0x7fff)) : v);
  const formulaUsed = pts.some(([x, y]) => x < 0 || y < 0);
  const rp = pts.map(([x, y]): [number, number] => [coord(x), coord(y)]);
  if (!hasGeo && rp.length) {
    // No geometry rectangle (LibreOffice, freeforms): the extent of the points is the space.
    left = Math.min(...rp.map((q) => q[0])); top = Math.min(...rp.map((q) => q[1]));
    right = Math.max(...rp.map((q) => q[0])); bottom = Math.max(...rp.map((q) => q[1]));
    if (right <= left) right = left + 1;
    if (bottom <= top) bottom = top + 1;
    // Guide formulas without a geometry rectangle (LibreOffice's presets) do not evaluate to a faithful outline: not drawn.
    if (formulaUsed) return null;
  }
  const gw = right - left, gh = bottom - top;
  const at = (i: number) => `${f(rp[i][0] - left)} ${f(rp[i][1] - top)}`;
  let d = '', i = 0;
  const out: CustomPath = { path: '', w: gw, h: gh };
  for (const s of segs) {
    const type = (s >> 13) & 7;
    const k = s & 0x1fff;
    if (type === 2) { if (i >= pts.length) return null; d += `M${at(i++)}`; }
    else if (type === 0) { const m = k || pts.length - i; if (i + m > pts.length) return null; for (let j = 0; j < m; j++) d += `L${at(i++)}`; }
    else if (type === 1) { if (i + 3 * k > pts.length) return null; for (let j = 0; j < k; j++, i += 3) d += `C${at(i)} ${at(i + 1)} ${at(i + 2)}`; }
    else if (type === 3) d += 'Z';
    else if (type === 4) break;
    else if (type === 5) {
      const code = (s >> 8) & 0x1f, m = (s & 0xff) || pts.length - i;
      if (code === 10) out.noFill = true;
      else if (code === 11) out.noLine = true;
      else if (code === 12 || code === 16 || code === 18) { if (i + m > pts.length) return null; for (let j = 0; j < m; j++) d += `L${at(i++)}`; }
      else return null; // arcs, auto curves and the like
    } else return null;
  }
  if (!d) return null;
  out.path = d;
  return out;
}

/** The guide formulas (pGuides) of a shape: index → value, with the adjust values (adjust1-8) and the geometry rectangle as inputs. */
function guideValues(p: Props, left: number, top: number, right: number, bottom: number): (i: number) => number {
  const gb = complexOf(p, 0x156);
  const list: { op: number; a: number; b: number; c: number; fa: boolean; fb: boolean; fc: boolean }[] = [];
  if (gb && gb.length >= 6) {
    const gv = new DataView(gb.buffer, gb.byteOffset, gb.byteLength);
    const m = Math.min(gv.getUint16(0, true), Math.floor((gb.length - 6) / 8), 512);
    for (let i = 0; i < m; i++) {
      const o = 6 + i * 8, w = gv.getUint16(o, true);
      list.push({ op: w & 0x1fff, fa: (w & 0x2000) === 0, fb: (w & 0x4000) === 0, fc: (w & 0x8000) === 0, a: gv.getInt16(o + 2, true), b: gv.getInt16(o + 4, true), c: gv.getInt16(o + 6, true) });
    }
  }
  const memo = new Map<number, number>();
  const active = new Set<number>();
  const param = (v: number, constant: boolean): number => {
    if (constant) return v;
    if (v & 0x400) return value(v & 0xff);
    if (v >= 0x147 && v <= 0x14e) return p.get(v) ?? 0;
    if (v === 0x140) return left;
    if (v === 0x141) return top;
    if (v === 0x142) return right;
    if (v === 0x143) return bottom;
    return 0;
  };
  const rad = (fixed16: number) => ((fixed16 / 65536) * Math.PI) / 180;
  const value = (i: number): number => {
    if (memo.has(i)) return memo.get(i)!;
    const g = list[i];
    if (!g || active.has(i)) return 0;
    active.add(i);
    const a = param(g.a, g.fa), b = param(g.b, g.fb), c = param(g.c, g.fc);
    let r = 0;
    switch (g.op) {
      case 0: r = a + b - c; break;
      case 1: r = c ? (a * b) / c : 0; break;
      case 2: r = (a + b) / 2; break;
      case 3: r = Math.abs(a); break;
      case 4: r = Math.min(a, b); break;
      case 5: r = Math.max(a, b); break;
      case 6: r = a > 0 ? b : c; break;
      case 7: r = Math.sqrt(a * a + b * b + c * c); break;
      case 8: r = (Math.atan2(b, a) * 180 / Math.PI) * 65536; break;
      case 9: r = a * Math.sin(rad(b)); break;
      case 10: r = a * Math.cos(rad(b)); break;
      case 11: r = a * Math.cos(Math.atan2(c, b)); break;
      case 12: r = a * Math.sin(Math.atan2(c, b)); break;
      case 13: r = Math.sqrt(Math.max(0, a)); break;
      case 14: r = a + b - c; break; // sum of angles (16.16 degrees): same arithmetic
      case 15: r = b ? c * Math.sqrt(Math.max(0, 1 - (a / b) ** 2)) : 0; break;
      case 16: r = a * Math.tan(rad(b)); break;
      case 0x17: case 0x1e: r = a; break; // val
      default: r = 0;
    }
    active.delete(i);
    if (!Number.isFinite(r)) r = 0;
    memo.set(i, r);
    return r;
  };
  return value;
}

/** Rotation in degrees clockwise (0-360). */
export function rotationOf(p: Props): number {
  const r = fixed(p.get(P.rotation));
  const d = ((r % 360) + 360) % 360;
  return Math.abs(d) < 0.005 || d > 359.995 ? 0 : Math.round(d * 100) / 100;
}
