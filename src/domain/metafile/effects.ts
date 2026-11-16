// EMF+ image effects (MS-EMFPLUS 2.2.3): an EmfPlusSerializableObject record carries one effect's
// parameter block under its GUID, and the next EmfPlusDrawImagePoints with the E flag draws its image
// through it. Each effect becomes SVG filter primitives on the image (feColorMatrix, feComponentTransfer,
// feGaussianBlur, feConvolveMatrix), so it works on PNG / JPEG images as well as on decoded bitmaps;
// red-eye correction, which changes only some pixels of given areas, is applied to the decoded pixels.
//
// The colour-curve, levels, colour-balance and tint formulas are GDI+ look-alikes: the specification
// gives the parameters and their direction, not the curves; matrix, lookup table, hue / saturation /
// lightness, brightness / contrast, blur and sharpen follow their usual definitions.
import type { Bytes } from './bytes';
import { num } from './out';
import type { Rgba } from './png';

export type Effect =
  | { k: 'blur'; radius: number; expand: boolean }
  | { k: 'brightnessContrast'; brightness: number; contrast: number }
  | { k: 'colorBalance'; cr: number; mg: number; yb: number }
  | { k: 'colorCurve'; adjust: number; channel: number; intensity: number }
  | { k: 'lut'; b: number[]; g: number[]; r: number[]; a: number[] }
  | { k: 'matrix'; m: number[] }
  | { k: 'hsl'; hue: number; sat: number; light: number }
  | { k: 'levels'; highlight: number; midtone: number; shadow: number }
  | { k: 'redEye'; areas: [number, number, number, number][] }
  | { k: 'sharpen'; radius: number; amount: number }
  | { k: 'tint'; hue: number; amount: number };

const GUIDS: Record<string, Effect['k']> = {
  '633c80a4-1843-482b-9ef2-be2834c5fdd4': 'blur',
  'd3a1dbe1-8ec4-4c17-9f4c-ea97ad1c343d': 'brightnessContrast',
  '537e597d-251e-48da-9664-29ca496b70f8': 'colorBalance',
  'dd6a0022-58e4-4a67-9d9b-d48eb881a53d': 'colorCurve',
  'a7ce72a9-0f7f-40d7-b3cc-d0c02d5c3212': 'lut',
  '718f2615-7933-40e3-a511-5f68fe14dd74': 'matrix',
  '8b2dd6c3-eb07-4d87-a5f0-7108e26a9c5f': 'hsl',
  '99c354ec-2a31-4f3a-8c34-17a803b33a25': 'levels',
  '74d29d05-69a4-4266-9549-3cc52836b632': 'redEye',
  '63cbf3ee-c526-402c-8f71-62c540bf5142': 'sharpen',
  '1077af00-2848-4441-9489-44ad4c2d7a2c': 'tint',
};

/** A GUID in its packet layout (MS-DTYP 2.3.4.2: Data1..3 little-endian, Data4 bytes) as the usual lower-case string. */
export function guidAt(r: Bytes, o: number): string {
  const h = (v: number, n: number) => v.toString(16).padStart(n, '0');
  const d4 = Array.from({ length: 8 }, (_, i) => h(r.u8At(o + 8 + i), 2));
  return `${h(r.u32(o), 8)}-${h(r.u16(o + 4), 4)}-${h(r.u16(o + 6), 4)}-${d4.slice(0, 2).join('')}-${d4.slice(2).join('')}`;
}
export const effectGuid = (k: Effect['k']) => Object.keys(GUIDS).find((g) => GUIDS[g] === k)!;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

/** EmfPlusSerializableObject data (after the record header): GUID, buffer size, parameter block. */
export function parseEffect(r: Bytes): Effect | null {
  const kind = GUIDS[guidAt(r, 0)];
  const size = r.u32(16);
  const b = r.slice(20, size);
  const i = (o: number) => b.i32(o), f = (o: number) => b.f32(o);
  switch (kind) {
    case 'blur': return { k: 'blur', radius: clamp(f(0), 0, 255), expand: b.u32(4) !== 0 };
    case 'brightnessContrast': return { k: 'brightnessContrast', brightness: clamp(i(0), -255, 255), contrast: clamp(i(4), -100, 100) };
    case 'colorBalance': return { k: 'colorBalance', cr: clamp(i(0), -100, 100), mg: clamp(i(4), -100, 100), yb: clamp(i(8), -100, 100) };
    case 'colorCurve': return { k: 'colorCurve', adjust: b.u32(0), channel: b.u32(4), intensity: clamp(i(8), -255, 255) };
    case 'lut': {
      if (b.length < 1024) return null;
      const t = (o: number) => Array.from({ length: 256 }, (_, k) => b.u8At(o + k));
      return { k: 'lut', b: t(0), g: t(256), r: t(512), a: t(768) };
    }
    case 'matrix': {
      if (b.length < 100) return null;
      return { k: 'matrix', m: Array.from({ length: 25 }, (_, k) => clamp(f(k * 4), -1e4, 1e4)) };
    }
    case 'hsl': return { k: 'hsl', hue: clamp(i(0), -180, 180), sat: clamp(i(4), -100, 100), light: clamp(i(8), -100, 100) };
    case 'levels': return { k: 'levels', highlight: clamp(i(0), 0, 100), midtone: clamp(i(4), -100, 100), shadow: clamp(i(8), 0, 100) };
    case 'redEye': {
      const n = Math.min(Math.max(0, i(0)), 1024);
      const areas: [number, number, number, number][] = [];
      for (let k = 0; k < n && b.has(4 + k * 16, 16); k++) areas.push([i(4 + k * 16), i(8 + k * 16), i(12 + k * 16), i(16 + k * 16)]);
      return { k: 'redEye', areas };
    }
    case 'sharpen': return { k: 'sharpen', radius: clamp(f(0), 0, 255), amount: clamp(f(4), 0, 100) };
    case 'tint': return { k: 'tint', hue: clamp(i(0), -180, 180), amount: clamp(i(4), -100, 100) };
    default: return null;
  }
}

const transfer = (fn: (v: number) => number, ch: [boolean, boolean, boolean] = [true, true, true]) => {
  const table = Array.from({ length: 33 }, (_, k) => num(clamp(fn(k / 32), 0, 1))).join(' ');
  const f = (c: string, on: boolean) => (on ? `<feFunc${c} type="table" tableValues="${table}"/>` : '');
  return `<feComponentTransfer>${f('R', ch[0])}${f('G', ch[1])}${f('B', ch[2])}</feComponentTransfer>`;
};
const linear = (slope: [number, number, number], icpt: [number, number, number]) =>
  `<feComponentTransfer>${['R', 'G', 'B'].map((c, k) => `<feFunc${c} type="linear" slope="${num(slope[k])}" intercept="${num(icpt[k])}"/>`).join('')}</feComponentTransfer>`;
const matrix = (rows: number[]) => `<feColorMatrix type="matrix" values="${rows.map(num).join(' ')}"/>`;

/** The fully saturated colour of a hue in degrees, 0..1. */
function hueColor(h: number): [number, number, number] {
  const x = ((((h % 360) + 360) % 360) / 60);
  const c = (n: number) => clamp(Math.abs(((x + n) % 6) - 3) - 1, 0, 1);
  return [c(0), c(4), c(2)];
}

/** One colour-curve adjustment as a function on 0..1. */
function curve(adjust: number, t: number): (v: number) => number {
  switch (adjust) {
    case 0: return (v) => v * 2 ** (t / 100); // exposure
    case 1: return (v) => v ** (2 ** (-t / 128)); // density: lower is darker
    case 2: { const k = t >= 0 ? 1 / Math.max(1 - t / 100, 0.01) : 1 + t / 100; return (v) => (v - 0.5) * k + 0.5; } // contrast
    case 3: return (v) => v + (t / 100) * v * v * (1 - v) * 2; // highlight
    case 4: return (v) => v + (t / 100) * v * (1 - v) * (1 - v) * 2; // shadow
    case 5: return (v) => v ** (2 ** (-t / 100)); // midtone
    case 6: { const w = Math.max(clamp(t, 0, 255), 1) / 255; return (v) => v / w; } // white saturation: the white point
    case 7: { const b = clamp(t, 0, 254) / 255; return (v) => (v - b) / (1 - b); } // black saturation: the black point
    default: return (v) => v;
  }
}

/** The SVG filter primitives for an effect (null when it changes nothing visible as a filter). */
export function effectFilter(e: Effect): string | null {
  switch (e.k) {
    case 'blur': return e.radius > 0 ? `<feGaussianBlur stdDeviation="${num(e.radius / 3)}" edgeMode="${e.expand ? 'none' : 'duplicate'}"/>` : null;
    case 'brightnessContrast': {
      const k = e.contrast >= 0 ? 1 / Math.max(1 - e.contrast / 100, 0.01) : 1 + e.contrast / 100;
      const c = 0.5 * (1 - k) + (e.brightness / 255) * k;
      return linear([k, k, k], [c, c, c]);
    }
    case 'colorBalance': return linear([1, 1, 1], [e.cr / 200, e.mg / 200, e.yb / 200]);
    case 'colorCurve': {
      const ch: [boolean, boolean, boolean] = e.channel === 1 ? [true, false, false] : e.channel === 2 ? [false, true, false] : e.channel === 3 ? [false, false, true] : [true, true, true];
      return transfer(curve(e.adjust, e.intensity), ch);
    }
    case 'lut': {
      const t = (a: number[]) => a.map((v) => num(v / 255)).join(' ');
      return `<feComponentTransfer><feFuncR type="table" tableValues="${t(e.r)}"/><feFuncG type="table" tableValues="${t(e.g)}"/><feFuncB type="table" tableValues="${t(e.b)}"/><feFuncA type="table" tableValues="${t(e.a)}"/></feComponentTransfer>`;
    }
    case 'matrix': {
      // GDI+ multiplies the row vector [r g b a 1] by the 5 x 5 matrix; SVG writes one row per output channel.
      const M = (i: number, j: number) => e.m[i * 5 + j];
      const rows: number[] = [];
      for (let j = 0; j < 4; j++) rows.push(M(0, j), M(1, j), M(2, j), M(3, j), M(4, j));
      return matrix(rows);
    }
    case 'hsl': {
      let s = '';
      if (e.hue) s += `<feColorMatrix type="hueRotate" values="${num(e.hue)}"/>`;
      if (e.sat) s += `<feColorMatrix type="saturate" values="${num(1 + e.sat / 100)}"/>`;
      if (e.light) { const l = e.light / 100; s += l > 0 ? linear([1 - l, 1 - l, 1 - l], [l, l, l]) : linear([1 + l, 1 + l, 1 + l], [0, 0, 0]); }
      return s || null;
    }
    case 'levels': {
      const hi = Math.max(e.highlight / 100, 0.01), lo = Math.min(e.shadow / 100, hi - 0.005), g = 2 ** (-e.midtone / 100);
      return transfer((v) => clamp((v - lo) / (hi - lo), 0, 1) ** g);
    }
    case 'sharpen': {
      if (!(e.amount > 0)) return null;
      const a = (e.amount / 100) * Math.min(Math.max(e.radius, 1), 4) / 2;
      return `<feConvolveMatrix order="3" kernelMatrix="0 ${num(-a)} 0 ${num(-a)} ${num(1 + 4 * a)} ${num(-a)} 0 ${num(-a)} 0" edgeMode="duplicate" preserveAlpha="true"/>`;
    }
    case 'tint': {
      if (!e.amount) return null;
      const [tr, tg, tb] = hueColor(e.amount >= 0 ? e.hue : e.hue + 180);
      const t = Math.abs(e.amount) / 100;
      const L = [0.299, 0.587, 0.114];
      const row = (c: number, k: number) => [0, 1, 2].map((q) => (q === k ? 1 - t : 0) + t * c * L[q] * 1.5);
      return matrix([...row(tr, 0), 0, 0, ...row(tg, 1), 0, 0, ...row(tb, 2), 0, 0, 0, 0, 0, 1, 0]);
    }
    case 'redEye': return null;
  }
}

/** Effects that need the pixels (red-eye correction): the corrected bitmap, or null when there is nothing to do. */
export function effectPixels(e: Effect, img: Rgba): Rgba | null {
  if (e.k !== 'redEye' || !e.areas.length) return null;
  const px = new Uint8ClampedArray(img.px);
  for (const [l, t, r, b] of e.areas) {
    for (let y = Math.max(0, Math.min(t, b)); y < Math.min(img.h, Math.max(t, b)); y++) for (let x = Math.max(0, Math.min(l, r)); x < Math.min(img.w, Math.max(l, r)); x++) {
      const o = (y * img.w + x) * 4;
      const R = px[o], G = px[o + 1], B = px[o + 2];
      if (R > 80 && R > 1.5 * Math.max(G, B)) px[o] = Math.round((G + B) / 2);
    }
  }
  return { w: img.w, h: img.h, px };
}
