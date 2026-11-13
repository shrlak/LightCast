// A tiny PNG encoder (stored deflate blocks, no compression) and a DIB (BITMAPINFO + bits) decoder.
import { Bytes } from './bytes';

/** Most pixels one bitmap may hold; bigger ones are refused. */
export const MAX_PIXELS = 40_000_000;
/** Bitmaps with more pixels than this are averaged down before they are written into the SVG. */
const KEEP_PIXELS = 3_000_000;

/** Pixels still allowed to be decoded from one file (index.ts sets it per file). */
export const decodeBudget = { px: 0 };

export interface Rgba { w: number; h: number; px: Uint8ClampedArray }

let crcTable: Uint32Array | null = null;
function crc32(p: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Averages a bitmap down by an integer factor until it has at most `limit` pixels. */
export function shrink(img: Rgba, limit = KEEP_PIXELS): Rgba {
  if (img.w * img.h <= limit) return img;
  const k = Math.ceil(Math.sqrt((img.w * img.h) / limit));
  const w = Math.max(1, Math.floor(img.w / k)), h = Math.max(1, Math.floor(img.h / k));
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = [0, 0, 0, 0];
    let n = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const o = ((y * k + j) * img.w + x * k + i) * 4;
      if (o + 3 >= img.px.length) continue;
      for (let c = 0; c < 4; c++) s[c] += img.px[o + c];
      n++;
    }
    for (let c = 0; c < 4; c++) px[(y * w + x) * 4 + c] = n ? s[c] / n : 0;
  }
  return { w, h, px };
}

/** The PNG file for a bitmap (RGB when it is opaque, else RGBA). */
export function encodePng(img0: Rgba): Uint8Array {
  const { w, h, px } = shrink(img0);
  let opaque = true;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { opaque = false; break; }
  const bpp = opaque ? 3 : 4;
  const stride = w * bpp + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    let o = y * stride + 1;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      raw[o++] = px[s]; raw[o++] = px[s + 1]; raw[o++] = px[s + 2];
      if (!opaque) raw[o++] = px[s + 3];
    }
  }
  // zlib stream of stored blocks.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let zo = 2, a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535, n = Math.min(65535, raw.length - start);
    z[zo++] = i === blocks - 1 ? 1 : 0;
    z[zo++] = n & 0xff; z[zo++] = n >> 8; z[zo++] = ~n & 0xff; z[zo++] = (~n >> 8) & 0xff;
    z.set(raw.subarray(start, start + n), zo);
    zo += n;
  }
  new DataView(z.buffer).setUint32(zo, ((b << 16) | a) >>> 0);
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w); iv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function base64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export const pngDataUrl = (img: Rgba) => `data:image/png;base64,${base64(encodePng(img))}`;

/** A data URL for already-encoded PNG / JPEG / GIF / BMP bytes (sniffed), or null. */
export function encodedImageUrl(u8: Uint8Array): string | null {
  const m = (a: number[]) => a.every((v, i) => u8[i] === v);
  const type = m([0x89, 0x50, 0x4e, 0x47]) ? 'png' : m([0xff, 0xd8, 0xff]) ? 'jpeg' : m([0x47, 0x49, 0x46]) ? 'gif' : m([0x42, 0x4d]) ? 'bmp' : null;
  return type ? `data:image/${type};base64,${base64(u8)}` : null;
}

export interface Dib {
  img: Rgba;
  /** Compressed PNG / JPEG carried in the DIB (BI_PNG, BI_JPEG), to be drawn as it is. */
  encoded?: string;
}

/**
 * Decodes a DIB: `info` is the BITMAPINFO (header and palette), `bits` the pixels. Handles 1, 4, 8,
 * 16, 24 and 32 bits per pixel (BI_RGB, BI_BITFIELDS) and RLE4 / RLE8; BI_JPEG and BI_PNG are
 * passed through. With `packed`, the bits follow the header and palette inside `info`.
 */
export function decodeDib(info: Bytes, bits: Bytes, packed = false): Dib | null {
  const hs = info.u32(0);
  if (hs < 12 || !info.has(0, hs)) return null;
  let w: number, h: number, bpp: number, comp = 0, used = 0;
  if (hs === 12) { w = info.u16(4); h = info.u16(6); bpp = info.u16(10); }
  else { w = info.i32(4); h = info.i32(8); bpp = info.u16(14); comp = info.u32(16); used = info.u32(32); }
  const topDown = h < 0;
  h = Math.abs(h);
  if (w <= 0 || h <= 0 || w > 65535 || h > 65535 || w * h > MAX_PIXELS || w * h > decodeBudget.px) return null;
  decodeBudget.px -= w * h;
  const entry = hs === 12 ? 3 : 4;
  const isMask = comp === 3 || comp === 6;
  const maskBytes = hs === 40 && isMask ? 12 : 0;
  const palN = bpp <= 8 ? Math.min(256, used || 1 << bpp) : 0;
  const pixelBytes = packed ? info.tail(hs + maskBytes + palN * entry) : bits;
  if (comp === 4 || comp === 5) {
    const url = encodedImageUrl(pixelBytes.u8);
    return url ? { img: { w, h, px: new Uint8ClampedArray(4) }, encoded: url } : null;
  }
  const masks = [0xff0000, 0xff00, 0xff];
  if (isMask) for (let i = 0; i < 3; i++) masks[i] = hs >= 52 ? info.u32(40 + i * 4) : info.u32(hs + i * 4);
  else if (bpp === 16) { masks[0] = 0x7c00; masks[1] = 0x3e0; masks[2] = 0x1f; }
  const palOff = hs + maskBytes;
  const pal: number[][] = [];
  for (let i = 0; i < palN; i++) pal.push([info.u8At(palOff + i * entry + 2), info.u8At(palOff + i * entry + 1), info.u8At(palOff + i * entry)]);
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const o = ((topDown ? y : h - 1 - y) * w + x) * 4;
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
  };
  if (comp === 1 || comp === 2) {
    // RLE8 / RLE4: run and escape codes.
    let x = 0, y = 0, p = 0;
    const n = pixelBytes.length;
    const idx = (i: number, xx: number, yy: number) => { const c = pal[i] ?? [0, 0, 0]; put(xx, yy, c[0], c[1], c[2]); };
    while (p + 1 < n && y < h) {
      const a = pixelBytes.u8At(p), b = pixelBytes.u8At(p + 1);
      p += 2;
      if (a > 0) {
        for (let i = 0; i < a; i++) idx(comp === 1 ? b : (i & 1 ? b & 15 : b >> 4), x++, y);
      } else if (b === 0) { x = 0; y++; }
      else if (b === 1) break;
      else if (b === 2) { x += pixelBytes.u8At(p); y += pixelBytes.u8At(p + 1); p += 2; }
      else {
        const bytes = comp === 1 ? b : Math.ceil(b / 2);
        for (let i = 0; i < b; i++) {
          const v = pixelBytes.u8At(p + (comp === 1 ? i : i >> 1));
          idx(comp === 1 ? v : (i & 1 ? v & 15 : v >> 4), x++, y);
        }
        p += bytes + (bytes & 1);
      }
    }
    return { img: { w, h, px } };
  }
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null;
  const stride = Math.floor((w * bpp + 31) / 32) * 4;
  let anyAlpha = false;
  const shiftOf = (m: number) => { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return [s, m] as const; };
  const [rs, rm] = shiftOf(masks[0]), [gs, gm] = shiftOf(masks[1]), [bs, bm] = shiftOf(masks[2]);
  const scale = (v: number, m: number) => (m ? Math.round((v * 255) / m) : 0);
  for (let y = 0; y < h; y++) {
    const ro = y * stride;
    if (ro >= pixelBytes.length) break;
    for (let x = 0; x < w; x++) {
      if (bpp === 24) { const o = ro + x * 3; put(x, y, pixelBytes.u8At(o + 2), pixelBytes.u8At(o + 1), pixelBytes.u8At(o)); }
      else if (bpp === 32) {
        const o = ro + x * 4;
        if (isMask) {
          const v = pixelBytes.u32(o);
          put(x, y, scale((v & masks[0]) >>> rs, rm), scale((v & masks[1]) >>> gs, gm), scale((v & masks[2]) >>> bs, bm));
        } else {
          const a = pixelBytes.u8At(o + 3);
          if (a) anyAlpha = true;
          put(x, y, pixelBytes.u8At(o + 2), pixelBytes.u8At(o + 1), pixelBytes.u8At(o), a);
        }
      } else if (bpp === 16) {
        const v = pixelBytes.u16(ro + x * 2);
        put(x, y, scale((v & masks[0]) >>> rs, rm), scale((v & masks[1]) >>> gs, gm), scale((v & masks[2]) >>> bs, bm));
      } else {
        const per = 8 / bpp;
        const v = pixelBytes.u8At(ro + Math.floor(x / per));
        const c = pal[(v >> (8 - bpp - (x % per) * bpp)) & ((1 << bpp) - 1)] ?? [0, 0, 0];
        put(x, y, c[0], c[1], c[2]);
      }
    }
  }
  // A 32-bit BI_RGB bitmap whose fourth byte is all zero carries no alpha: it is opaque.
  if (bpp === 32 && !isMask && !anyAlpha) for (let i = 3; i < px.length; i += 4) px[i] = 255;
  return { img: { w, h, px } };
}

/** Pixels `[x, y, w, h]` of an image (clamped to it), as a new image. */
export function cropRgba(img: Rgba, x: number, y: number, w: number, h: number): Rgba | null {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.w, Math.ceil(x + w)), y1 = Math.min(img.h, Math.ceil(y + h));
  if (!(x1 > x0 && y1 > y0)) return null;
  if (x0 === 0 && y0 === 0 && x1 === img.w && y1 === img.h) return img;
  const out = new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4);
  for (let j = y0; j < y1; j++) out.set(img.px.subarray((j * img.w + x0) * 4, (j * img.w + x1) * 4), (j - y0) * (x1 - x0) * 4);
  return { w: x1 - x0, h: y1 - y0, px: out };
}
