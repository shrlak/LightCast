// Escher / OfficeArt (MS-ODRAW) pieces of legacy .ppt drawings: the property tables of a shape
// (fill, line, rotation, text frame), the shape type → LightCast preset map and the flip / group flags.
import { colorRef, type Ctx, type Rec, type Scheme } from './pptRecords';
import type { DashStyle } from '../types';
import { LO_PRESETS } from './pptLoPresets';
import { evaluateGeometry, geometryFingerprint, readGuides, type GeoInput } from './pptGeometry';

/** Escher property id → value (the 32-bit number of the table; complex data is not kept). */
export type Props = Map<number, number>;

export const P = {
  rotation: 0x0004, geoLeft: 0x0140, geoTop: 0x0141, geoRight: 0x0142, geoBottom: 0x0143, pVertices: 0x0145, pSegmentInfo: 0x0146, shadowColor: 0x0201, shadowOpacity: 0x0204, shadowOffX: 0x0205, shadowOffY: 0x0206, shadowFlags: 0x023f, cropTop: 0x0100, cropBottom: 0x0101, cropLeft: 0x0102, cropRight: 0x0103, pib: 0x0104,
  textLeft: 0x0081, textTop: 0x0082, textRight: 0x0083, textBottom: 0x0084, wrapText: 0x0085, anchorText: 0x0087, textFlags: 0x00bf,
  fillType: 0x0180, fillColor: 0x0181, fillOpacity: 0x0182, fillBack: 0x0183, fillBlip: 0x0186, fillAngle: 0x018b, fillFocus: 0x018c, fillShadeColors: 0x0197, fillFlags: 0x01bf,
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
  gradient?: { from: string; to: string; angle: number; radial?: boolean; /** Three or more stops (position 0-100). */ stops?: { pos: number; color: string }[] };
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
      // Escher's angle (16.16 degrees, read from real files: -270 is left to right, -180 is bottom to top) → LightCast's (0 left to right, 90 top to bottom).
      const angle = (((90 - fixed(p.get(P.fillAngle))) % 360) + 360) % 360;
      out.gradient = { from: color, to, angle: Math.round(angle * 100) / 100, ...(type === 5 || type === 6 ? { radial: true } : {}) };
      const stops = shadeStops(p, scheme);
      if (stops) out.gradient.stops = stops;
      return out;
    }
  }
  if (color) out.color = color;
  return out.color || out.picture ? out : undefined;
}

/** fillShadeColors: (colour, position in 16.16) pairs; null when there are fewer than three. */
function shadeStops(p: Props, scheme: Scheme | undefined): { pos: number; color: string }[] | null {
  const b = complexOf(p, P.fillShadeColors);
  if (!b || b.length < 6) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = Math.min(v.getUint16(0, true), Math.floor((b.length - 6) / 8), 32);
  const out: { pos: number; color: string }[] = [];
  for (let i = 0; i < n; i++) {
    const color = colorRef(v.getUint32(6 + i * 8, true), scheme);
    const pos = v.getInt32(6 + i * 8 + 4, true) / 65536;
    if (color && pos >= -0.001 && pos <= 1.001) out.push({ pos: Math.round(Math.max(0, Math.min(1, pos)) * 100), color });
  }
  return out.length >= 3 ? out.sort((a, c) => a.pos - c.pos) : null;
}

export interface ShadowSpec { color: string; /** 0-1. */ transparency: number; /** EMU. */ dx: number; dy: number }

/** The shape's drop shadow (fShadow of the shadow boolean group; offsets in EMU, default 25400). */
export function shadowOf(p: Props, scheme: Scheme | undefined): ShadowSpec | undefined {
  if (!boolOf(p.get(P.shadowFlags), 0x2)) return undefined;
  const colorV = p.get(P.shadowColor);
  const color = colorV !== undefined ? colorRef(colorV, scheme) : '#808080';
  if (!color) return undefined;
  const op = p.get(P.shadowOpacity);
  return { color, transparency: op === undefined ? 0 : Math.max(0, Math.min(1, 1 - op / 65536)), dx: p.get(P.shadowOffX) ?? 25400, dy: p.get(P.shadowOffY) ?? 25400 };
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

/**
 * Custom geometry of a freeform or a preset written as guide formulas (msosptNotPrimitive): pVertices + pSegmentInfo +
 * pGuides (MS-ODRAW 2.3.6) evaluated by pptGeometry.ts into an SVG path. `aspect` is the shape box's width / height.
 */
function geoInputOf(p: Props): GeoInput {
  const adjust: (number | undefined)[] = [];
  for (let k = 0; k < 8; k++) adjust.push(p.get(0x147 + k));
  const l = p.get(P.geoLeft), t = p.get(P.geoTop), r = p.get(P.geoRight), b = p.get(P.geoBottom);
  const rect = l !== undefined && t !== undefined && r !== undefined && b !== undefined && r > l && b > t ? { left: l, top: t, right: r, bottom: b } : undefined;
  return { vertices: complexOf(p, P.pVertices), segments: complexOf(p, P.pSegmentInfo), guides: complexOf(p, 0x156), adjust, rect };
}

/** The preset a producer wrote a formula shape from, recognised by its formulas (LibreOffice's presets); the adjust values are in `adjust`. */
export function recognisedPreset(p: Props): { shape: string; adjust: (number | undefined)[] } | undefined {
  const input = geoInputOf(p);
  if (input.rect || !input.guides) return undefined;
  const shape = LO_PRESETS[geometryFingerprint(input)];
  return shape ? { shape, adjust: input.adjust } : undefined;
}

export function customPathOf(p: Props, aspect?: number): CustomPath | null {
  const geo = evaluateGeometry(geoInputOf(p));
  if (!geo || !geo.path) return null;
  // Formulas without a stated space: the extent is only trusted when it fills a box of the shape's proportions.
  if (geo.guessedSpace && complexOf(p, 0x156) && aspect) {
    const ratio = geo.w / geo.h / aspect;
    if (ratio < 0.75 || ratio > 1.33) return null;
  }
  const out: CustomPath = { path: geo.path, w: geo.w, h: geo.h };
  if (geo.noFill) out.noFill = true;
  if (geo.noLine) out.noLine = true;
  return out;
}

/**
 * A custom shape whose guide formulas are not evaluated (LibreOffice writes its presets that way): a guess of the preset
 * from the kind of formulas it uses: sine and cosine mean an ellipse.
 */
export function guessPreset(p: Props): string | undefined {
  const ops = readGuides(complexOf(p, 0x156)).map((g) => g.op);
  return ops.filter((o) => o === 9).length === 1 && ops.filter((o) => o === 10).length === 1 && ops.length <= 40 ? 'ellipse' : undefined;
}

/** Rotation in degrees clockwise (0-360). */
export function rotationOf(p: Props): number {
  const r = fixed(p.get(P.rotation));
  const d = ((r % 360) + 360) % 360;
  return Math.abs(d) < 0.005 || d > 359.995 ? 0 : Math.round(d * 100) / 100;
}
