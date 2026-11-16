// EMF+ image effects (MS-EMFPLUS 2.2.3): an EmfPlusSerializableObject record carries one effect's
// parameter block under its GUID, and the next EmfPlusDrawImagePoints with the E flag draws its image
// through it.
//
// How each effect is computed
//   Every effect that works channel by channel (colour curve, levels, colour balance, brightness /
//   contrast, the lookup table) is a 256-entry table per channel (`effectLut`). On a decoded bitmap the
//   tables are applied to the pixels; on a PNG / JPEG image they become feComponentTransfer tables of 256
//   values, which give exactly the same levels (sRGB, no interpolation between the steps). Colour matrix
//   and tint are a 5 x 5 matrix (pixels, or feColorMatrix). Hue / saturation / lightness is a true HSL
//   conversion on the pixels (a decoded bitmap, or a PNG / JPEG of up to 4 M pixels decoded for it, see
//   decode.ts); feColorMatrix hueRotate / saturate stand in only past that. Blur and sharpen are a Gaussian
//   (sigma = radius / 3, the kernel cut at the radius) and an unsharp mask with it, on the pixels, or as
//   feGaussianBlur with the same sigma. Red-eye correction works on decoded pixels.
//
// What is exact and what is not
//   No reimplementation of these effects is published: Wine's gdiplus (dlls/gdiplus/image.c,
//   GdipBitmapApplyEffect) and Mono's libgdiplus are stubs, so the curves follow the Windows SDK
//   documentation of each parameter (gdipluseffects.h: CurveAdjustments, LevelsParams, ColorBalanceParams,
//   TintParams, BrightnessContrastParams, HueSaturationLightnessParams, BlurParams, SharpenParams), which
//   states ranges, directions and some exact mappings, but not the curves themselves.
//   Exact by the documentation: the colour matrix (the parameter block is the GDI+ ColorMatrix row by row,
//     MS-EMFPLUS 2.2.3.6, applied to the row vector [r g b a 1]), the lookup table, white saturation ("[0, t]
//     is mapped linearly to [0, 255]", above t is 255), black saturation ("[t, 255] to [0, 255]", below t is
//     0), which channel a colour curve changes, that highlight and shadow change only channel values above /
//     below half intensity, the tint hue's orientation (0 is blue, +60 cyan, +120 green, -60 magenta, -120
//     red), and the blur's expandEdge (the bitmap grows by the radius on every side).
//   Look-alikes (their parameters, ranges and directions as documented, the curve shape chosen here):
//     exposure (v * 2^(t / 100)), density (gamma 2^(-t / 128)), the contrast slope (1 / (1 - t / 100) up,
//     1 + t / 100 down, about mid grey), the highlight / shadow bend (u + t/100 u (1 - u) over the upper /
//     lower half), midtone and the levels midtone (gamma 2^(-t / 100)), the levels highlight / shadow
//     (a linear stretch of [shadow %, highlight %] to the full range), colour balance (an offset of t / 200
//     on its channel), brightness (an offset of b / 255 before the contrast), tint (a mix towards the tint
//     colour weighted by luminance), hue / saturation / lightness (HSL: hue turned by the level in degrees,
//     saturation scaled by 1 + s / 100, lightness moved towards white / black by l %), the blur's sigma
//     (radius / 3) and the sharpen amount (unsharp mask strength amount / 100).
//   MS-EMFPLUS notes (Appendix A, <10>) that Windows writes corrupt ColorCurve records, so a colour curve
//   with an adjustment or channel outside the enumerations is ignored.
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
    case 'colorCurve': {
      const adjust = b.u32(0), channel = b.u32(4);
      if (adjust > 7 || channel > 3) return null; // a corrupt record (MS-EMFPLUS Appendix A <10>)
      const lim = adjust <= 1 ? 255 : adjust >= 6 ? 255 : 100;
      return { k: 'colorCurve', adjust, channel, intensity: clamp(i(8), adjust >= 6 ? 0 : -lim, lim) };
    }
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

// ---- channel curves ----

/** One colour-curve adjustment as a function on 0..1 (CurveAdjustments order). */
export function curveFn(adjust: number, t: number): (v: number) => number {
  const bendUpper = (v: number) => { if (v <= 0.5) return v; const u = (v - 0.5) * 2; return 0.5 + (u + (t / 100) * u * (1 - u)) / 2; };
  const bendLower = (v: number) => { if (v >= 0.5) return v; const u = v * 2; return (u + (t / 100) * u * (1 - u)) / 2; };
  switch (adjust) {
    case 0: return (v) => v * 2 ** (t / 100); // exposure
    case 1: return (v) => v ** (2 ** (-t / 128)); // density: higher is lighter
    case 2: { const k = t >= 0 ? 1 / Math.max(1 - t / 100, 0.01) : 1 + t / 100; return (v) => (v - 0.5) * k + 0.5; } // contrast
    case 3: return bendUpper; // highlight: only values above half
    case 4: return bendLower; // shadow: only values below half
    case 5: return (v) => v ** (2 ** (-t / 100)); // midtone
    case 6: { const w = clamp(t, 0, 255); return (v) => (w <= 0 ? (v > 0 ? 1 : 0) : (v * 255) / w); } // white saturation: [0, t] -> [0, 255]
    case 7: { const b = clamp(t, 0, 255); return (v) => (b >= 255 ? (v >= 1 ? 1 : 0) : (v * 255 - b) / (255 - b)); } // black saturation: [t, 255] -> [0, 255]
    default: return (v) => v;
  }
}

const table = (fn: (v: number) => number): Uint8Array => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) t[i] = Math.round(clamp(fn(i / 255), 0, 1) * 255); return t; };
const IDENT = table((v) => v);

/** The per-channel table (R, G, B, A) of an effect that works channel by channel, or null for one that does not. */
export function effectLut(e: Effect): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] | null {
  switch (e.k) {
    case 'colorCurve': {
      const t = table(curveFn(e.adjust, e.intensity));
      return [e.channel === 0 || e.channel === 1 ? t : IDENT, e.channel === 0 || e.channel === 2 ? t : IDENT, e.channel === 0 || e.channel === 3 ? t : IDENT, IDENT];
    }
    case 'brightnessContrast': {
      const k = e.contrast >= 0 ? 1 / Math.max(1 - e.contrast / 100, 0.01) : 1 + e.contrast / 100;
      const t = table((v) => (v + e.brightness / 255 - 0.5) * k + 0.5);
      return [t, t, t, IDENT];
    }
    case 'colorBalance': return [table((v) => v + e.cr / 200), table((v) => v + e.mg / 200), table((v) => v + e.yb / 200), IDENT];
    case 'levels': {
      const hi = Math.max(e.highlight / 100, 0.01), lo = Math.min(e.shadow / 100, hi - 0.005), g = 2 ** (-e.midtone / 100);
      const t = table((v) => clamp((v - lo) / (hi - lo), 0, 1) ** g);
      return [t, t, t, IDENT];
    }
    case 'lut': return [Uint8Array.from(e.r), Uint8Array.from(e.g), Uint8Array.from(e.b), Uint8Array.from(e.a)];
    default: return null;
  }
}

/** The fully saturated colour of a standard hue in degrees (0 red, 120 green, 240 blue), 0..1. */
function hueColor(h: number): [number, number, number] {
  const x = ((((h % 360) + 360) % 360) / 60);
  const c = (n: number) => clamp(Math.abs(((x + n) % 6) - 3) - 1, 0, 1);
  return [c(0), c(4), c(2)];
}

/** The 5 x 5 matrix (GDI+ row-vector form, row by row) of an effect that is one: colour matrix, tint. */
function effectMatrix(e: Effect): number[] | null {
  if (e.k === 'matrix') return e.m;
  if (e.k !== 'tint' || !e.amount) return null;
  // TintParams.hue: 0 is blue and positive turns clockwise on the wheel (+60 cyan, +120 green), so the
  // standard hue is 240 - hue; a negative amount weakens the hue, i.e. tints towards its complement.
  const [tr, tg, tb] = hueColor(240 - e.hue + (e.amount < 0 ? 180 : 0));
  const t = Math.abs(e.amount) / 100;
  const L = [0.299, 0.587, 0.114];
  const tint = [tr, tg, tb];
  const m = new Array(25).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 5 + j] = (i === j ? 1 - t : 0) + t * tint[j] * L[i] * 1.5;
  m[3 * 5 + 3] = 1; m[24] = 1;
  return m;
}

// ---- pixels ----

/** Effects worth the pixels of a PNG / JPEG (no filter equivalent comes close enough). */
export const needsPixels = (e: Effect) => e.k === 'hsl' || e.k === 'redEye';

/**
 * The effect applied to decoded pixels. `dx, dy` is where the result's top-left lies in the source
 * image's pixel space (an expanding blur grows the bitmap by its radius on every side). Null when the
 * effect changes nothing or the image is too big for the work (MAX_WORK multiply-adds).
 */
const MAX_WORK = 400_000_000;
export function applyEffect(e: Effect, img: Rgba): { img: Rgba; dx: number; dy: number } | null {
  const { w, h } = img;
  const n = w * h;
  if (!(n > 0) || img.px.length < n * 4) return null;
  const lut = effectLut(e);
  if (lut) {
    const px = new Uint8ClampedArray(img.px);
    for (let i = 0; i < px.length; i += 4) { px[i] = lut[0][px[i]]; px[i + 1] = lut[1][px[i + 1]]; px[i + 2] = lut[2][px[i + 2]]; px[i + 3] = lut[3][px[i + 3]]; }
    return { img: { w, h, px }, dx: 0, dy: 0 };
  }
  const m = effectMatrix(e);
  if (m) {
    const px = new Uint8ClampedArray(n * 4), s = img.px;
    for (let i = 0; i < px.length; i += 4) {
      const v = [s[i] / 255, s[i + 1] / 255, s[i + 2] / 255, s[i + 3] / 255, 1];
      for (let j = 0; j < 4; j++) px[i + j] = Math.round(clamp(v[0] * m[j] + v[1] * m[5 + j] + v[2] * m[10 + j] + v[3] * m[15 + j] + m[20 + j], 0, 1) * 255);
    }
    return { img: { w, h, px }, dx: 0, dy: 0 };
  }
  switch (e.k) {
    case 'hsl': {
      if (!e.hue && !e.sat && !e.light) return null;
      const px = new Uint8ClampedArray(img.px);
      for (let i = 0; i < px.length; i += 4) {
        let [H, S, L] = rgbToHsl(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
        H = (H + e.hue + 360) % 360;
        S = clamp(S * (1 + e.sat / 100), 0, 1);
        L = e.light >= 0 ? L + (1 - L) * (e.light / 100) : L * (1 + e.light / 100);
        const [r, g, b] = hslToRgb(H, S, L);
        px[i] = Math.round(r * 255); px[i + 1] = Math.round(g * 255); px[i + 2] = Math.round(b * 255);
      }
      return { img: { w, h, px }, dx: 0, dy: 0 };
    }
    case 'blur': case 'sharpen': {
      if (!(e.radius > 0) || (e.k === 'sharpen' && !(e.amount > 0))) return null;
      const r = Math.ceil(e.radius);
      const grow = e.k === 'blur' && e.expand ? r : 0;
      if ((w + 2 * grow) * (h + 2 * grow) * (2 * r + 1) * 2 * 4 > MAX_WORK) return null;
      // Premultiplied, so transparent pixels do not darken their neighbours.
      const W = w + 2 * grow, H = h + 2 * grow;
      const src = new Float32Array(W * H * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, d = ((y + grow) * W + x + grow) * 4, a = img.px[o + 3] / 255;
        src[d] = img.px[o] * a; src[d + 1] = img.px[o + 1] * a; src[d + 2] = img.px[o + 2] * a; src[d + 3] = img.px[o + 3];
      }
      const blurred = gaussian(src, W, H, e.radius / 3, r, grow === 0);
      const px = new Uint8ClampedArray(W * H * 4);
      const k = e.k === 'sharpen' ? e.amount / 100 : 0;
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const a = e.k === 'sharpen' ? src[o + 3] : blurred[o + 3];
        px[o + 3] = Math.round(a);
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const v = e.k === 'sharpen' ? src[o + c] + k * (src[o + c] - blurred[o + c]) : blurred[o + c];
          px[o + c] = Math.round(v / (a / 255));
        }
      }
      return { img: { w: W, h: H, px }, dx: -grow, dy: -grow };
    }
    case 'redEye': {
      if (!e.areas.length) return null;
      const px = new Uint8ClampedArray(img.px);
      for (const [l, t, r, b] of e.areas) {
        for (let y = Math.max(0, Math.min(t, b)); y < Math.min(h, Math.max(t, b)); y++) for (let x = Math.max(0, Math.min(l, r)); x < Math.min(w, Math.max(l, r)); x++) {
          const o = (y * w + x) * 4;
          const R = px[o], G = px[o + 1], B = px[o + 2];
          if (R > 80 && R > 1.5 * Math.max(G, B)) px[o] = Math.round((G + B) / 2);
        }
      }
      return { img: { w, h, px }, dx: 0, dy: 0 };
    }
    default: return null;
  }
}

/** A separable Gaussian (sigma, kernel cut at `r`) over premultiplied RGBA floats; `clampEdges` repeats the edge pixels, else outside is transparent. */
function gaussian(src: Float32Array, W: number, H: number, sigma: number, r: number, clampEdges: boolean): Float32Array {
  const ker = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { ker[i + r] = Math.exp(-(i * i) / (2 * Math.max(sigma, 1e-3) ** 2)); sum += ker[i + r]; }
  for (let i = 0; i < ker.length; i++) ker[i] /= sum;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horiz: boolean) => {
    const len = horiz ? W : H, lines = horiz ? H : W;
    for (let l = 0; l < lines; l++) for (let p = 0; p < len; p++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let k = -r; k <= r; k++) {
        let q = p + k;
        if (q < 0 || q >= len) { if (!clampEdges) continue; q = q < 0 ? 0 : len - 1; }
        const o = (horiz ? l * W + q : q * W + l) * 4, f = ker[k + r];
        a0 += from[o] * f; a1 += from[o + 1] * f; a2 += from[o + 2] * f; a3 += from[o + 3] * f;
      }
      const d = (horiz ? l * W + p : p * W + l) * 4;
      to[d] = a0; to[d + 1] = a1; to[d + 2] = a2; to[d + 3] = a3;
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, L];
  const S = L > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const H = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [H, S, L];
}
function hslToRgb(H: number, S: number, L: number): [number, number, number] {
  if (!S) return [L, L, L];
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(H / 360 + 1 / 3), f(H / 360), f(H / 360 - 1 / 3)];
}

// ---- SVG filters (for images whose pixels are not decoded) ----

const lutPrim = (t: [Uint8Array, Uint8Array, Uint8Array, Uint8Array]) => {
  const f = (c: string, a: Uint8Array) => (a === IDENT ? '' : `<feFunc${c} type="table" tableValues="${Array.from(a, (v) => num(v / 255)).join(' ')}"/>`);
  return `<feComponentTransfer>${f('R', t[0])}${f('G', t[1])}${f('B', t[2])}${f('A', t[3])}</feComponentTransfer>`;
};
const matrixPrim = (m: number[]) => {
  // GDI+ multiplies the row vector [r g b a 1] by the matrix; SVG writes one row per output channel.
  const rows: number[] = [];
  for (let j = 0; j < 4; j++) rows.push(m[j], m[5 + j], m[10 + j], m[15 + j], m[20 + j]);
  return `<feColorMatrix type="matrix" values="${rows.map(num).join(' ')}"/>`;
};

/**
 * The SVG filter for an effect on an image of w x h pixels drawn at (0, 0) in its own pixel units: the
 * primitives and the filter region (null when it changes nothing visible as a filter).
 */
export function effectFilter(e: Effect, w = 0, h = 0): { prim: string; region: string } | null {
  const whole = 'filterUnits="objectBoundingBox" x="0" y="0" width="1" height="1"';
  const lut = effectLut(e);
  if (lut) return { prim: lutPrim(lut), region: whole };
  const m = effectMatrix(e);
  if (m) return { prim: matrixPrim(m), region: whole };
  switch (e.k) {
    case 'blur': {
      if (!(e.radius > 0)) return null;
      const g = e.expand ? Math.ceil(e.radius) : 0;
      const region = e.expand && w > 0 && h > 0 ? `filterUnits="userSpaceOnUse" x="${-g}" y="${-g}" width="${w + 2 * g}" height="${h + 2 * g}"` : whole;
      return { prim: `<feGaussianBlur stdDeviation="${num(e.radius / 3)}" edgeMode="${e.expand ? 'none' : 'duplicate'}"/>`, region };
    }
    case 'sharpen': {
      if (!(e.amount > 0 && e.radius > 0)) return null;
      const k = e.amount / 100;
      return { prim: `<feGaussianBlur in="SourceGraphic" stdDeviation="${num(e.radius / 3)}" edgeMode="duplicate" result="b"/><feComposite in="SourceGraphic" in2="b" operator="arithmetic" k1="0" k2="${num(1 + k)}" k3="${num(-k)}" k4="0"/>`, region: whole };
    }
    case 'hsl': {
      let s = '';
      if (e.hue) s += `<feColorMatrix type="hueRotate" values="${num(e.hue)}"/>`;
      if (e.sat) s += `<feColorMatrix type="saturate" values="${num(1 + e.sat / 100)}"/>`;
      if (e.light) {
        const l = e.light / 100;
        s += `<feComponentTransfer>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="${num(l > 0 ? 1 - l : 1 + l)}" intercept="${num(l > 0 ? l : 0)}"/>`).join('')}</feComponentTransfer>`;
      }
      return s ? { prim: s, region: whole } : null;
    }
    default: return null;
  }
}
