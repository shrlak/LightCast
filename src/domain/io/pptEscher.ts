// Escher / OfficeArt (MS-ODRAW) pieces of legacy .ppt drawings: the property tables of a shape
// (fill, line, rotation, text frame), the shape type → LightCast preset map and the flip / group flags.
import { colorRef, type Ctx, type Rec, type Scheme } from './pptRecords';
import type { DashStyle } from '../types';

/** Escher property id → value (the 32-bit number of the table; complex data is not kept). */
export type Props = Map<number, number>;

export const P = {
  rotation: 0x0004, cropTop: 0x0100, cropBottom: 0x0101, cropLeft: 0x0102, cropRight: 0x0103, pib: 0x0104,
  textLeft: 0x0081, textTop: 0x0082, textRight: 0x0083, textBottom: 0x0084, wrapText: 0x0085, anchorText: 0x0087, textFlags: 0x00bf,
  fillType: 0x0180, fillColor: 0x0181, fillOpacity: 0x0182, fillBack: 0x0183, fillBlip: 0x0186, fillAngle: 0x018d, fillFlags: 0x01bf,
  lineColor: 0x01c0, lineWidth: 0x01cb, lineDash: 0x01ce, lineStartArrow: 0x01d0, lineEndArrow: 0x01d1, lineFlags: 0x01ff,
};

/** SpAtom flags. */
export const SP = { group: 0x1, child: 0x2, patriarch: 0x4, deleted: 0x8, flipH: 0x40, flipV: 0x80, background: 0x400 };

/** Add the properties of an OPT / secondary / tertiary OPT record (earlier values are overwritten). */
export function readOpt(c: Ctx, r: Rec, into: Props) {
  for (let i = 0; i < r.inst && r.pos + (i + 1) * 6 <= r.end; i++) {
    const id = c.v.getUint16(r.pos + i * 6, true) & 0x3fff;
    into.set(id, c.v.getInt32(r.pos + i * 6 + 2, true));
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

/** Rotation in degrees clockwise (0-360). */
export function rotationOf(p: Props): number {
  const r = fixed(p.get(P.rotation));
  const d = ((r % 360) + 360) % 360;
  return Math.abs(d) < 0.005 || d > 359.995 ? 0 : Math.round(d * 100) / 100;
}
