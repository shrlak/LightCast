// Synchronous PNG and JPEG decoders for the pixels the reader itself needs from an embedded image: a
// flood fill reads back what a PNG / JPEG pattern brush or bitmap painted (raster.ts), and the EMF+
// image effects are computed on the pixels (effects.ts). Pictures are otherwise passed to the SVG as
// they are, so the browser decodes what is shown.
//
// The metafile reader is synchronous (it runs in node for tests and in workers with no DOM), so the
// browser's own decoders (createImageBitmap, <img>), which are asynchronous, cannot be used here; these
// decoders work the same in node and in a browser.
//   PNG: every colour type and bit depth, palettes with tRNS, Adam7 interlacing (inflate.ts).
//   JPEG: baseline and extended sequential (SOF0 / SOF1) and progressive (SOF2) Huffman JPEG, 1, 3 or 4
//     components (greyscale, YCbCr, RGB / CMYK / YCCK by the Adobe marker), restart intervals. 2:1 and
//     2:2 chroma are upsampled with libjpeg's triangle filter, other ratios by replication; the inverse DCT
//     is a float one, so a pixel can differ from libjpeg's (browsers') output by a level or two.
//     Arithmetic-coded, 12-bit, lossless and hierarchical JPEG are not decoded (null).
// Bad data gives null, never an exception; the pixel count is limited by the file's decode budget.
import { inflateZlib } from '../io/inflate';
import { decodeBudget, MAX_PIXELS, type Rgba } from './png';

/** Decodes PNG or JPEG bytes (sniffed). Null when the format is another one or the data is damaged. */
export function decodeImage(u8: Uint8Array): Rgba | null {
  try {
    if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return decodePng(u8);
    if (u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8) return decodeJpeg(u8);
    return null;
  } catch {
    return null;
  }
}

const cache = new WeakMap<Uint8Array, Rgba | null>();
/** decodeImage, remembered per byte array (a brush or image object is often used many times). */
export function decodedImage(u8: Uint8Array): Rgba | null {
  if (cache.has(u8)) return cache.get(u8)!;
  const r = decodeImage(u8);
  cache.set(u8, r);
  return r;
}

function takeBudget(w: number, h: number): boolean {
  if (!(w > 0 && h > 0) || w > 65535 || h > 65535 || w * h > MAX_PIXELS || w * h > decodeBudget.px) return false;
  decodeBudget.px -= w * h;
  return true;
}

// ---- PNG ----

export function decodePng(u8: Uint8Array): Rgba | null {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 8;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let pal: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLen = 0;
  while (pos + 8 <= u8.length) {
    const len = v.getUint32(pos), t = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
    if (len > u8.length - pos - 12 + 4 && len > u8.length - pos - 8) break;
    const d = u8.subarray(pos + 8, Math.min(pos + 8 + len, u8.length));
    if (t === 'IHDR' && d.length >= 13) {
      w = v.getUint32(pos + 8); h = v.getUint32(pos + 12); depth = d[8]; type = d[9]; interlace = d[12];
    } else if (t === 'PLTE') pal = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') { idat.push(d); idatLen += d.length; }
    else if (t === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || (type !== 0 && type !== 3 && depth < 8) || (type === 3 && depth > 8)) return null;
  if (!takeBudget(w, h)) return null;
  const z = new Uint8Array(idatLen);
  let o = 0;
  for (const c of idat) { z.set(c, o); o += c.length; }
  const bpp = (channels * depth) / 8; // bytes per pixel, fractional below 8 bits
  const passes = interlace === 1
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let need = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw > 0 && ph > 0) need += ph * (1 + Math.ceil(pw * bpp));
  }
  const raw = inflateZlib(z, need + 1024);
  if (!raw || raw.length < need) return null;
  const px = new Uint8ClampedArray(w * h * 4);
  const fb = Math.max(1, Math.ceil(bpp));
  const tr = trns && type === 0 && trns.length >= 2 ? (trns[0] << 8) | trns[1] : -1;
  const trgb = trns && type === 2 && trns.length >= 6 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null;
  const max = (1 << depth) - 1;
  let p = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil(pw * bpp);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[p++];
      for (let i = 0; i < stride; i++) {
        const x = raw[p++], a = i >= fb ? cur[i - fb] : 0, b = prev[i], c = i >= fb ? prev[i - fb] : 0;
        let val: number;
        switch (f) {
          case 0: val = x; break;
          case 1: val = x + a; break;
          case 2: val = x + b; break;
          case 3: val = x + ((a + b) >> 1); break;
          case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); val = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: return null;
        }
        cur[i] = val & 255;
      }
      const sample = (i: number): number => {
        if (depth === 8) return cur[i];
        if (depth === 16) return cur[i * 2]; // the high byte
        const bit = i * depth, byte = cur[bit >> 3], shift = 8 - depth - (bit & 7);
        return (byte >> shift) & max;
      };
      const sample16 = (i: number) => (cur[i * 2] << 8) | cur[i * 2 + 1];
      for (let x = 0; x < pw; x++) {
        const X = x0 + x * dx, Y = y0 + y * dy, d = (Y * w + X) * 4;
        let r: number, g: number, bl: number, al = 255;
        if (type === 3) {
          const k = sample(x);
          r = pal && k * 3 + 2 < pal.length ? pal[k * 3] : 0; g = pal && k * 3 + 2 < pal.length ? pal[k * 3 + 1] : 0; bl = pal && k * 3 + 2 < pal.length ? pal[k * 3 + 2] : 0;
          if (trns && k < trns.length) al = trns[k];
        } else if (type === 0 || type === 4) {
          const s = sample(x * (type === 4 ? 2 : 1));
          r = g = bl = depth === 16 ? s : Math.round((s * 255) / max);
          if (type === 4) al = sample(x * 2 + 1);
          else if (tr >= 0 && (depth === 16 ? sample16(x) : s) === tr) al = 0;
        } else {
          const n = type === 6 ? 4 : 3;
          r = sample(x * n); g = sample(x * n + 1); bl = sample(x * n + 2);
          if (type === 6) al = sample(x * n + 3);
          else if (trgb && (depth === 16 ? sample16(x * 3) === trgb[0] && sample16(x * 3 + 1) === trgb[1] && sample16(x * 3 + 2) === trgb[2] : r === trgb[0] && g === trgb[1] && bl === trgb[2])) al = 0;
        }
        px[d] = r; px[d + 1] = g; px[d + 2] = bl; px[d + 3] = al;
      }
      [prev, cur] = [cur, prev];
    }
  }
  return { w, h, px };
}

// ---- JPEG ----

interface Huff { lookup: Map<number, number>; maxLen: number }
interface Comp { id: number; h: number; v: number; tq: number; bpl: number; bpc: number; blocks: Int16Array; dc: Huff | null; ac: Huff | null; pred: number }

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

function buildHuff(counts: Uint8Array, symbols: Uint8Array): Huff {
  // Canonical codes, keyed by (length << 16) | code.
  const lookup = new Map<number, number>();
  let code = 0, k = 0, maxLen = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) { if (k < symbols.length) lookup.set((len << 16) | code, symbols[k++]); code++; maxLen = len; }
    code <<= 1;
  }
  return { lookup, maxLen };
}

let COS: Float64Array | null = null;
function idct(inp: Int32Array, out: Uint8ClampedArray, outOff: number, stride: number, tmp: Float64Array) {
  if (!COS) {
    COS = new Float64Array(64);
    for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2;
  }
  const C = COS;
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { // rows: tmp[y][u] = sum over v of C[y][v] in[v][u]
    let s = 0;
    for (let vv = 0; vv < 8; vv++) s += C[y * 8 + vv] * inp[vv * 8 + u];
    tmp[y * 8 + u] = s;
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let s = 0;
    for (let u = 0; u < 8; u++) s += C[x * 8 + u] * tmp[y * 8 + u];
    out[outOff + y * stride + x] = Math.round(s + 128);
  }
}

export function decodeJpeg(u8: Uint8Array): Rgba | null {
  const qt: Int32Array[] = [];
  const dcT: (Huff | null)[] = [null, null, null, null], acT: (Huff | null)[] = [null, null, null, null];
  let comps: Comp[] = [];
  let w = 0, h = 0, progressive = false, restart = 0, adobe = -1, mcusX = 0, mcusY = 0, hmax = 1, vmax = 1;
  let pos = 2, guard = 0;
  let frame = false;
  while (pos + 4 <= u8.length && guard++ < 10000) {
    if (u8[pos] !== 0xff) { pos++; continue; }
    const m = u8[pos + 1];
    if (m === 0xff) { pos++; continue; }
    if (m === 0xd9) break;
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { pos += 2; continue; }
    const len = (u8[pos + 2] << 8) | u8[pos + 3];
    if (len < 2 || pos + 2 + len > u8.length) return null;
    const s = pos + 4, e = pos + 2 + len;
    if (m === 0xdb) {
      for (let p = s; p < e;) {
        const pq = u8[p] >> 4, tq = u8[p] & 15; p++;
        const t = new Int32Array(64);
        for (let i = 0; i < 64; i++) { t[ZIGZAG[i]] = pq ? (u8[p] << 8) | u8[p + 1] : u8[p]; p += pq ? 2 : 1; }
        if (tq < 4) qt[tq] = t;
      }
    } else if (m === 0xc4) {
      for (let p = s; p + 17 <= e;) {
        const tc = u8[p] >> 4, th = u8[p] & 15;
        const counts = u8.subarray(p + 1, p + 17);
        let n = 0;
        for (let i = 0; i < 16; i++) n += counts[i];
        if (p + 17 + n > e) return null;
        const t = buildHuff(counts, u8.subarray(p + 17, p + 17 + n));
        if (th < 4) (tc === 0 ? dcT : acT)[th] = t;
        p += 17 + n;
      }
    } else if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (frame) return null;
      frame = true;
      progressive = m === 0xc2;
      if (u8[s] !== 8) return null; // 12-bit samples: not decoded
      h = (u8[s + 1] << 8) | u8[s + 2]; w = (u8[s + 3] << 8) | u8[s + 4];
      const n = u8[s + 5];
      if (!n || n > 4 || !takeBudget(w, h)) return null;
      for (let i = 0; i < n; i++) {
        const o = s + 6 + i * 3;
        const hh = u8[o + 1] >> 4, vv = u8[o + 1] & 15;
        if (!hh || !vv || hh > 4 || vv > 4) return null;
        comps.push({ id: u8[o], h: hh, v: vv, tq: u8[o + 2] & 3, bpl: 0, bpc: 0, blocks: new Int16Array(0), dc: null, ac: null, pred: 0 });
      }
      hmax = Math.max(...comps.map((c) => c.h)); vmax = Math.max(...comps.map((c) => c.v));
      mcusX = Math.ceil(w / (8 * hmax)); mcusY = Math.ceil(h / (8 * vmax));
      let total = 0;
      for (const c of comps) { c.bpl = mcusX * c.h; c.bpc = mcusY * c.v; total += c.bpl * c.bpc * 64; }
      if (total > 4 * MAX_PIXELS) return null;
      for (const c of comps) c.blocks = new Int16Array(c.bpl * c.bpc * 64);
    } else if ((m >= 0xc3 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return null; // lossless, hierarchical, arithmetic
    } else if (m === 0xdd) restart = (u8[s] << 8) | u8[s + 1];
    else if (m === 0xee && len >= 12 && String.fromCharCode(...u8.subarray(s, s + 5)) === 'Adobe') adobe = u8[s + 11];
    else if (m === 0xda) {
      if (!frame) return null;
      const n = u8[s];
      const scomps: Comp[] = [];
      for (let i = 0; i < n; i++) {
        const c = comps.find((k) => k.id === u8[s + 1 + i * 2]);
        if (!c) return null;
        c.dc = dcT[u8[s + 2 + i * 2] >> 4]; c.ac = acT[u8[s + 2 + i * 2] & 15];
        scomps.push(c);
      }
      const q = s + 1 + n * 2;
      const ss = u8[q], se = u8[q + 1], ah = u8[q + 2] >> 4, al = u8[q + 2] & 15;
      const end = scan(u8, e, scomps, progressive, ss, se, ah, al, restart, mcusX, mcusY, w, h, hmax, vmax);
      if (end < 0) return null;
      pos = end;
      continue;
    }
    pos = e;
  }
  if (!frame || !comps.length) return null;
  // Dequantise, inverse DCT, then colour.
  const planes: { data: Uint8ClampedArray; stride: number; c: Comp }[] = [];
  const blk = new Int32Array(64), tmp = new Float64Array(64);
  for (const c of comps) {
    const q = qt[c.tq];
    if (!q) return null;
    const stride = c.bpl * 8;
    const data = new Uint8ClampedArray(stride * c.bpc * 8);
    for (let by = 0; by < c.bpc; by++) for (let bx = 0; bx < c.bpl; bx++) {
      const o = (by * c.bpl + bx) * 64;
      for (let i = 0; i < 64; i++) blk[i] = c.blocks[o + i] * q[i];
      idct(blk, data, by * 8 * stride + bx * 8, stride, tmp);
    }
    planes.push({ data, stride, c });
  }
  const px = new Uint8ClampedArray(w * h * 4);
  const n = comps.length;
  const transform = adobe >= 0 ? adobe !== 0 : n === 3 ? !(comps[0].id === 0x52 && comps[1].id === 0x47 && comps[2].id === 0x42) : false;
  const full = planes.map((p) => upsample(p.data, p.stride, Math.ceil((w * p.c.h) / hmax), Math.ceil((h * p.c.v) / vmax), hmax / p.c.h, vmax / p.c.v, w, h));
  const at = (k: number, x: number, y: number) => full[k][y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = (y * w + x) * 4;
    let r: number, g: number, b: number;
    if (n === 1 || n === 2) { r = g = b = at(0, x, y); }
    else {
      const Y = at(0, x, y), cb = at(1, x, y), cr = at(2, x, y);
      if (transform) { r = Y + 1.402 * (cr - 128); g = Y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128); b = Y + 1.772 * (cb - 128); }
      else { r = Y; g = cb; b = cr; }
      if (n === 4) {
        // Adobe CMYK is stored inverted (and YCCK is YCbCr of the inverted C, M, Y).
        const k = at(3, x, y);
        const inv = adobe >= 0;
        const C = inv ? r : 255 - r, M = inv ? g : 255 - g, Ye = inv ? b : 255 - b, K = inv ? k : 255 - k;
        r = (C * K) / 255; g = (M * K) / 255; b = (Ye * K) / 255;
      }
    }
    px[d] = r; px[d + 1] = g; px[d + 2] = b; px[d + 3] = 255;
  }
  return { w, h, px };
}

/**
 * A component plane (cw x ch samples, `stride` apart) at full size. Twice-wide (h2v1) and twice-wide-and-
 * high (h2v2) chroma use libjpeg's "fancy" triangle filter (3/4 of the nearer sample, 1/4 of the farther,
 * with its rounding biases), so they match what libjpeg / browsers produce; other ratios are replicated.
 */
function upsample(src: Uint8ClampedArray, stride: number, cw: number, ch: number, fx: number, fy: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  const S = (x: number, y: number) => src[Math.min(y, ch - 1) * stride + Math.min(x, cw - 1)];
  if (fx === 2 && (fy === 1 || fy === 2)) {
    const row = new Int32Array(cw);
    for (let y = 0; y < h; y++) {
      if (fy === 2) {
        const iy = y >> 1, far = y & 1 ? Math.min(iy + 1, ch - 1) : Math.max(iy - 1, 0);
        for (let x = 0; x < cw; x++) row[x] = 3 * S(x, iy) + S(x, far);
      } else for (let x = 0; x < cw; x++) row[x] = S(x, y);
      const o = y * w;
      for (let x = 0; x < cw; x++) {
        const L = row[Math.max(x - 1, 0)], C = row[x], R = row[Math.min(x + 1, cw - 1)];
        let a: number, b: number;
        if (fy === 2) { a = x === 0 ? (C * 4 + 8) >> 4 : (3 * C + L + 8) >> 4; b = x === cw - 1 ? (C * 4 + 7) >> 4 : (3 * C + R + 7) >> 4; }
        else { a = x === 0 ? C : (3 * C + L + 1) >> 2; b = x === cw - 1 ? C : (3 * C + R + 2) >> 2; }
        if (2 * x < w) out[o + 2 * x] = a;
        if (2 * x + 1 < w) out[o + 2 * x + 1] = b;
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = S(Math.floor(x / fx), Math.floor(y / fy));
  return out;
}

/** Decodes one scan's entropy-coded data from `pos`; returns the position after it (a marker), or -1. */
function scan(u8: Uint8Array, pos: number, comps: Comp[], progressive: boolean, ss: number, se: number, ah: number, al: number,
  restart: number, mcusX: number, mcusY: number, w: number, h: number, hmax: number, vmax: number): number {
  let bitBuf = 0, bitCnt = 0, marker = false;
  const bit = (): number => {
    if (bitCnt === 0) {
      if (marker || pos >= u8.length) { marker = true; return 0; }
      let b = u8[pos];
      if (b === 0xff) {
        const nx = u8[pos + 1];
        if (nx === 0) pos += 2;
        else { marker = true; return 0; }
      } else pos++;
      bitBuf = b; bitCnt = 8;
      b = 0;
    }
    bitCnt--;
    return (bitBuf >> bitCnt) & 1;
  };
  const bits = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bit(); return v; };
  const recv = (n: number) => { if (!n) return 0; const v = bits(n); return v < 1 << (n - 1) ? v - (1 << n) + 1 : v; };
  const decode = (t: Huff | null): number => {
    if (!t) return -1;
    let code = 0;
    for (let len = 1; len <= t.maxLen; len++) {
      code = (code << 1) | bit();
      const s = t.lookup.get((len << 16) | code);
      if (s !== undefined) return s;
    }
    return -1;
  };
  let eobrun = 0;
  const blockBase = (c: Comp, row: number, col: number) => (row * c.bpl + col) * 64;
  const decodeBlock = (c: Comp, o: number): boolean => {
    const B = c.blocks;
    if (!progressive) {
      const t = decode(c.dc);
      if (t < 0) return false;
      c.pred += recv(t);
      B[o] = c.pred;
      for (let k = 1; k < 64;) {
        const rs = decode(c.ac);
        if (rs < 0) return false;
        const r = rs >> 4, s = rs & 15;
        if (!s) { if (r !== 15) break; k += 16; continue; }
        k += r;
        if (k > 63) return false;
        B[o + ZIGZAG[k]] = recv(s);
        k++;
      }
      return true;
    }
    if (ss === 0) { // DC
      if (ah === 0) { const t = decode(c.dc); if (t < 0) return false; c.pred += recv(t); B[o] = c.pred << al; }
      else if (bit()) B[o] |= 1 << al;
      return true;
    }
    if (ah === 0) { // AC first
      if (eobrun > 0) { eobrun--; return true; }
      for (let k = ss; k <= se;) {
        const rs = decode(c.ac);
        if (rs < 0) return false;
        const r = rs >> 4, s = rs & 15;
        if (!s) {
          if (r < 15) { eobrun = (1 << r) - 1; if (r) eobrun += bits(r); break; }
          k += 16; continue;
        }
        k += r;
        if (k > 63) return false;
        B[o + ZIGZAG[k]] = recv(s) * (1 << al);
        k++;
      }
      return true;
    }
    // AC refinement
    const p1 = 1 << al, m1 = -1 << al;
    let k = ss;
    if (eobrun <= 0) {
      for (; k <= se;) {
        const rs = decode(c.ac);
        if (rs < 0) return false;
        let r = rs >> 4;
        const s = rs & 15;
        let val = 0;
        if (s) { val = bit() ? p1 : m1; }
        else if (r !== 15) { eobrun = 1 << r; if (r) eobrun += bits(r); break; }
        while (k <= se) {
          const z = o + ZIGZAG[k];
          if (B[z] !== 0) { if (bit() && (B[z] & p1) === 0) B[z] += B[z] >= 0 ? p1 : m1; }
          else { if (r === 0) { if (val) B[z] = val; k++; break; } r--; }
          k++;
        }
      }
    }
    if (eobrun > 0) {
      for (; k <= se; k++) { const z = o + ZIGZAG[k]; if (B[z] !== 0 && bit() && (B[z] & p1) === 0) B[z] += B[z] >= 0 ? p1 : m1; }
      eobrun--;
    }
    return true;
  };
  const single = comps.length === 1;
  const total = single
    ? Math.ceil(Math.ceil((w * comps[0].h) / hmax) / 8) * Math.ceil(Math.ceil((h * comps[0].v) / vmax) / 8)
    : mcusX * mcusY;
  const perRow = single ? Math.ceil(Math.ceil((w * comps[0].h) / hmax) / 8) : mcusX;
  let n = 0;
  while (n < total) {
    for (const c of comps) c.pred = 0;
    eobrun = 0;
    const stop = restart ? Math.min(total, n + restart) : total;
    for (; n < stop; n++) {
      const row = Math.floor(n / perRow), col = n % perRow;
      if (single) { if (!decodeBlock(comps[0], blockBase(comps[0], row, col))) return -1; }
      else for (const c of comps) for (let v = 0; v < c.v; v++) for (let hh = 0; hh < c.h; hh++) {
        if (!decodeBlock(c, blockBase(c, row * c.v + v, col * c.h + hh))) return -1;
      }
    }
    if (n < total) {
      // Find the restart marker and go on after it.
      bitCnt = 0; marker = false;
      while (pos + 1 < u8.length && !(u8[pos] === 0xff && u8[pos + 1] >= 0xd0 && u8[pos + 1] <= 0xd7)) {
        if (u8[pos] === 0xff && u8[pos + 1] !== 0 && u8[pos + 1] !== 0xff) return pos; // another marker: the scan ends early
        pos++;
      }
      pos += 2;
      if (pos >= u8.length) return pos;
    }
  }
  // Skip to the next marker.
  while (pos + 1 < u8.length && !(u8[pos] === 0xff && u8[pos + 1] !== 0 && !(u8[pos + 1] >= 0xd0 && u8[pos + 1] <= 0xd7))) pos++;
  return pos;
}
