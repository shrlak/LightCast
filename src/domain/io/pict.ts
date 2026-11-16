// A reader for Apple QuickDraw PICT version 2 pictures (as the Pictures stream of Mac-made .ppt files keeps them):
// the bitmap opcodes (BitsRect / BitsRgn / PackBitsRect / PackBitsRgn / DirectBitsRect / DirectBitsRgn: 1-8 bit indexed,
// 16 and 32 bit direct, PackBits-compressed rows), JPEG inside QuickTime-compressed opcodes (0x8200), and the simple vector
// opcodes painting and framing rectangles, ovals and lines in the foreground RGB colour. Drawn in picture order. Text, regions as shapes, patterns,
// polygons and arcs are skipped. Everything else is stepped over by the opcode length table. Version 1 pictures are not read.
// Never throws: a picture that cannot be read gives null. Pixel counts and the opcode count are capped.
import { encodePng, type Rgba } from '../metafile/png';

const MAX_PIXELS = 16_000_000;
const MAX_OPS = 200_000;

export type PictImage = { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array };

interface Rect { t: number; l: number; b: number; r: number }

/** One bitmap drawn from a bits opcode: pixels and where they go in the picture frame. */
interface Blit { img: Rgba; src: Rect; dst: Rect }
/** Rectangle, oval and line drawing; drawn with the bitmaps in picture order. */
interface Paint { kind: 'rect' | 'oval' | 'frameRect' | 'frameOval' | 'line'; r: Rect; color: [number, number, number]; pen: number }

class Reader {
  o: number;
  constructor(public b: Uint8Array, public v: DataView, start: number) { this.o = start; }
  need(n: number) { if (this.o + n > this.b.length) throw new RangeError('pict'); }
  u8() { this.need(1); return this.b[this.o++]; }
  u16() { this.need(2); const x = this.v.getUint16(this.o); this.o += 2; return x; }
  i16() { this.need(2); const x = this.v.getInt16(this.o); this.o += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.o); this.o += 4; return x; }
  skip(n: number) { this.need(n); this.o += n; }
  rect(): Rect { const t = this.i16(), l = this.i16(), b = this.i16(), r = this.i16(); return { t, l, b, r }; }
}

/** PackBits: a count byte n, then n+1 literal bytes (n < 128) or one byte repeated 257-n times (n > 128). Words for 16-bit pixels. */
function unpackBits(src: Uint8Array, out: Uint8Array, unit: 1 | 2): void {
  let i = 0, o = 0;
  while (i < src.length && o < out.length) {
    const n = src[i++];
    if (n < 128) {
      const len = (n + 1) * unit;
      for (let k = 0; k < len && i < src.length && o < out.length; k++) out[o++] = src[i++];
    } else if (n > 128) {
      const times = 257 - n;
      const val = src.subarray(i, i + unit);
      i += unit;
      for (let k = 0; k < times && o < out.length; k++) for (let u = 0; u < unit && o < out.length; u++) out[o++] = val[u] ?? 0;
    }
  }
}

/** The pixels of a bits opcode (the reader stands after the opcode). Region variants carry a mask region, which is skipped. */
function readBits(rd: Reader, op: number): Blit | null {
  const direct = op === 0x9a || op === 0x9b;
  if (direct) rd.skip(4); // baseAddr
  let rowBytes = rd.u16();
  const isPixMap = direct || (rowBytes & 0x8000) !== 0;
  rowBytes &= 0x3fff;
  const bounds = rd.rect();
  let pixelSize = 1, packType = 0, cmpCount = 1;
  let palette: [number, number, number][] = [[255, 255, 255], [0, 0, 0]];
  if (isPixMap) {
    rd.skip(2); // pmVersion
    packType = rd.u16();
    rd.skip(4 + 8); // packSize, hRes, vRes
    rd.skip(2); // pixelType
    pixelSize = rd.u16();
    cmpCount = rd.u16();
    rd.skip(2 + 4 + 4 + 4); // cmpSize, planeBytes, pmTable, pmReserved
    if (!direct) {
      rd.skip(4); // ctSeed
      const flags = rd.u16();
      const n = rd.u16() + 1;
      if (n > 256) return null;
      palette = new Array(256).fill(null).map(() => [0, 0, 0] as [number, number, number]);
      for (let i = 0; i < n; i++) {
        const value = rd.u16(), r = rd.u16() >> 8, g = rd.u16() >> 8, b = rd.u16() >> 8;
        // Device colour tables (flag 0x8000) are in order; others say each entry's index.
        palette[flags & 0x8000 ? i : value & 0xff] = [r, g, b];
      }
    }
  }
  const src = rd.rect(), dst = rd.rect();
  rd.skip(2); // transfer mode
  if (op === 0x91 || op === 0x99 || op === 0x9b) { const size = rd.u16(); rd.skip(Math.max(0, size - 2)); }
  const w = bounds.r - bounds.l, h = bounds.b - bounds.t;
  if (w <= 0 || h <= 0 || w * h > MAX_PIXELS || ![1, 2, 4, 8, 16, 32].includes(pixelSize)) return null;
  const px = new Uint8ClampedArray(w * h * 4);
  // Bytes per unpacked row: 32-bit rows with packType 4 are stored as planes, packType 2 drops the pad byte.
  const planar = pixelSize === 32 && packType !== 1 && packType !== 2 && rowBytes >= 8;
  const unpackedRow = pixelSize === 32 && planar ? w * cmpCount : pixelSize === 32 && packType === 2 ? w * 3 : rowBytes;
  const row = new Uint8Array(Math.max(unpackedRow, rowBytes));
  for (let y = 0; y < h; y++) {
    if (rowBytes < 8 || packType === 1 || (pixelSize === 32 && packType === 2)) {
      const n = pixelSize === 32 && packType === 2 ? w * 3 : rowBytes;
      rd.need(n);
      row.set(rd.b.subarray(rd.o, rd.o + n));
      rd.o += n;
    } else {
      const count = rowBytes > 250 ? rd.u16() : rd.u8();
      rd.need(count);
      row.fill(0);
      unpackBits(rd.b.subarray(rd.o, rd.o + count), row.subarray(0, unpackedRow), pixelSize === 16 ? 2 : 1);
      rd.o += count;
    }
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      if (pixelSize <= 8) {
        const per = 8 / pixelSize;
        const byte = row[Math.floor(x / per)] ?? 0;
        const idx = (byte >> ((per - 1 - (x % per)) * pixelSize)) & ((1 << pixelSize) - 1);
        [r, g, b] = isPixMap ? palette[idx] ?? [0, 0, 0] : idx ? [0, 0, 0] : [255, 255, 255];
      } else if (pixelSize === 16) {
        const v = (row[x * 2] << 8) | row[x * 2 + 1];
        r = ((v >> 10) & 31) * 255 / 31; g = ((v >> 5) & 31) * 255 / 31; b = (v & 31) * 255 / 31;
      } else if (planar) {
        const off = cmpCount === 4 ? w : 0;
        r = row[off + x]; g = row[off + w + x]; b = row[off + 2 * w + x];
      } else if (packType === 2) {
        r = row[x * 3]; g = row[x * 3 + 1]; b = row[x * 3 + 2];
      } else {
        r = row[x * 4 + 1]; g = row[x * 4 + 2]; b = row[x * 4 + 3];
      }
      const o = (y * w + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  // The source rectangle is in the bitmap's bounds space.
  return { img: { w, h, px }, src: { t: src.t - bounds.t, l: src.l - bounds.l, b: src.b - bounds.t, r: src.r - bounds.l }, dst };
}

/** The bytes of a JPEG inside QuickTime image data (from its SOI marker to its last EOI marker). */
function jpegIn(data: Uint8Array): Uint8Array | null {
  let s = -1;
  for (let i = 0; i + 2 < data.length; i++) if (data[i] === 0xff && data[i + 1] === 0xd8 && data[i + 2] === 0xff) { s = i; break; }
  if (s < 0) return null;
  for (let e = data.length - 2; e > s; e--) if (data[e] === 0xff && data[e + 1] === 0xd9) return data.slice(s, e + 2);
  return null;
}

/** Data length of opcodes with a fixed or self-described size (v2); -1 for those read elsewhere or unknown. */
function skipOp(rd: Reader, op: number): boolean {
  const fixed: Record<number, number> = { 0x02: 8, 0x03: 2, 0x04: 1, 0x05: 2, 0x06: 4, 0x07: 4, 0x08: 2, 0x09: 8, 0x0a: 8, 0x0b: 4, 0x0c: 4, 0x0d: 2, 0x0e: 4, 0x0f: 4, 0x10: 8, 0x11: 1, 0x15: 2, 0x16: 2, 0x1a: 6, 0x1b: 6, 0x1d: 6, 0x1f: 6, 0x20: 8, 0x21: 4, 0x22: 6, 0x23: 2, 0xa0: 2 };
  if (op in fixed) { rd.skip(fixed[op]); return true; }
  if (op === 0x00 || (op >= 0x17 && op <= 0x19) || op === 0x1c || op === 0x1e) return true;
  if (op === 0x01 || (op >= 0x80 && op <= 0x87) || (op >= 0x70 && op <= 0x77)) { const n = rd.u16(); rd.skip(Math.max(0, n - 2)); return true; }
  if ((op >= 0x24 && op <= 0x27) || (op >= 0x2c && op <= 0x2f) || (op >= 0x92 && op <= 0x97) || (op >= 0x9c && op <= 0x9f) || (op >= 0xa2 && op <= 0xaf)) { rd.skip(rd.u16()); return true; }
  if (op === 0x28) { rd.skip(4); rd.skip(rd.u8()); return true; }
  if (op === 0x29 || op === 0x2a) { rd.skip(1); rd.skip(rd.u8()); return true; }
  if (op === 0x2b) { rd.skip(2); rd.skip(rd.u8()); return true; }
  if ((op >= 0x30 && op <= 0x37) || (op >= 0x40 && op <= 0x47) || (op >= 0x50 && op <= 0x57)) { rd.skip(8); return true; }
  if ((op >= 0x38 && op <= 0x3f) || (op >= 0x48 && op <= 0x4f) || (op >= 0x58 && op <= 0x5f) || (op >= 0x78 && op <= 0x7f) || (op >= 0x88 && op <= 0x8f) || (op >= 0xb0 && op <= 0xcf) || (op >= 0x8000 && op <= 0x80ff)) return true;
  if (op >= 0x60 && op <= 0x67) { rd.skip(12); return true; }
  if (op >= 0x68 && op <= 0x6f) { rd.skip(4); return true; }
  if (op === 0xa1) { rd.skip(2); rd.skip(rd.u16()); return true; }
  if ((op >= 0xd0 && op <= 0xfe) || op >= 0x8100) { rd.skip(rd.u32()); return true; }
  if (op >= 0x100 && op <= 0x7fff) { rd.skip((op >> 8) * 2); return true; }
  return false;
}

/** Where a PICT starts: right at the picture size word, or after the 512-byte header of a PICT file. */
function startOf(b: Uint8Array): number | null {
  const isV2At = (o: number) => o + 14 <= b.length && b[o + 10] === 0x00 && b[o + 11] === 0x11 && b[o + 12] === 0x02 && b[o + 13] === 0xff;
  if (isV2At(0)) return 0;
  if (isV2At(512)) return 512;
  return null;
}

/** A PICT v2 picture as a PNG (or the JPEG it wraps); null when it holds nothing this reader can draw. */
export function pictToImage(bytes: Uint8Array): PictImage | null {
  try {
    return decode(bytes);
  } catch {
    return null;
  }
}

function decode(bytes: Uint8Array): PictImage | null {
  const start = startOf(bytes);
  if (start === null) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rd = new Reader(bytes, v, start + 2);
  const frame = rd.rect();
  const fw = frame.r - frame.l, fh = frame.b - frame.t;
  if (fw <= 0 || fh <= 0) return null;
  rd.skip(4); // version opcode 0x0011 and 0x02FF
  const blits: Blit[] = [];
  /** Everything drawn, in picture order. */
  const items: (Blit | Paint)[] = [];
  const jpegs: Uint8Array[] = [];
  let fg: [number, number, number] = [0, 0, 0];
  let pen = 1;
  let pos = { x: 0, y: 0 };
  let last: Rect | null = null;
  for (let n = 0; n < MAX_OPS; n++) {
    if (rd.o & 1) rd.o++;
    if (rd.o + 2 > bytes.length) break;
    const op = rd.u16();
    if (op === 0xff) break;
    if (op === 0x0c00) { rd.skip(24); continue; }
    if (op === 0x1a) { fg = [rd.u16() >> 8, rd.u16() >> 8, rd.u16() >> 8]; continue; }
    if (op === 0x07) { const ph = rd.i16(), pw = rd.i16(); pen = Math.max(1, Math.min(ph, pw)); continue; }
    if (op === 0x90 || op === 0x91 || (op >= 0x98 && op <= 0x9b)) {
      const blit = readBits(rd, op);
      if (!blit) return jpegs.length ? { mime: 'image/jpeg', bytes: jpegs[0] } : null;
      blits.push(blit); items.push(blit);
      continue;
    }
    if (op === 0x8200) {
      const len = rd.u32();
      rd.need(len);
      const jpg = jpegIn(bytes.subarray(rd.o, rd.o + len));
      if (jpg) jpegs.push(jpg);
      rd.o += len;
      continue;
    }
    if (op === 0x30 || op === 0x31 || op === 0x34 || op === 0x50 || op === 0x51 || op === 0x54) {
      const r = rd.rect();
      last = r;
      const kind: Paint['kind'] = op >= 0x50 ? (op === 0x50 ? 'frameOval' : 'oval') : op === 0x30 ? 'frameRect' : 'rect';
      if (op === 0x34 || op === 0x54) { /* fill with a pattern: drawn in the foreground colour */ }
      items.push({ kind, r, color: fg, pen });
      continue;
    }
    if ((op === 0x38 || op === 0x39 || op === 0x58 || op === 0x59) && last) {
      items.push({ kind: op === 0x38 ? 'frameRect' : op === 0x39 ? 'rect' : op === 0x58 ? 'frameOval' : 'oval', r: last, color: fg, pen });
      continue;
    }
    if (op === 0x20) { const y0 = rd.i16(), x0 = rd.i16(), y1 = rd.i16(), x1 = rd.i16(); items.push({ kind: 'line', r: { t: y0, l: x0, b: y1, r: x1 }, color: fg, pen }); pos = { x: x1, y: y1 }; continue; }
    if (op === 0x21) { const y1 = rd.i16(), x1 = rd.i16(); items.push({ kind: 'line', r: { t: pos.y, l: pos.x, b: y1, r: x1 }, color: fg, pen }); pos = { x: x1, y: y1 }; continue; }
    if (op === 0x22) { const y0 = rd.i16(), x0 = rd.i16(); const dx = (rd.u8() << 24) >> 24, dy = (rd.u8() << 24) >> 24; items.push({ kind: 'line', r: { t: y0, l: x0, b: y0 + dy, r: x0 + dx }, color: fg, pen }); pos = { x: x0 + dx, y: y0 + dy }; continue; }
    if (op === 0x23) { const dx = (rd.u8() << 24) >> 24, dy = (rd.u8() << 24) >> 24; items.push({ kind: 'line', r: { t: pos.y, l: pos.x, b: pos.y + dy, r: pos.x + dx }, color: fg, pen }); pos = { x: pos.x + dx, y: pos.y + dy }; continue; }
    if (!skipOp(rd, op)) break;
  }
  // Only a wrapped JPEG: keep it as it is.
  if (jpegs.length && !items.length) return { mime: 'image/jpeg', bytes: jpegs[0] };
  if (!items.length) return null;
  // Draw at the bitmaps' own resolution (frame units are 1/72 inch; a 300 dpi scan is drawn at 300 dpi).
  let scale = 1;
  for (const bl of blits) {
    const dw = bl.dst.r - bl.dst.l, dh = bl.dst.b - bl.dst.t;
    if (dw > 0 && dh > 0) scale = Math.max(scale, (bl.src.r - bl.src.l) / dw, (bl.src.b - bl.src.t) / dh);
  }
  scale = Math.min(scale, 8, Math.sqrt(MAX_PIXELS / (fw * fh)));
  const W = Math.max(1, Math.round(fw * scale)), H = Math.max(1, Math.round(fh * scale));
  if (W * H > MAX_PIXELS) return null;
  const out = new Uint8ClampedArray(W * H * 4).fill(255);
  const X = (x: number) => (x - frame.l) * scale, Y = (y: number) => (y - frame.t) * scale;
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
  };
  function drawBlit(bl: Blit) {
    const dl = X(bl.dst.l), dt = Y(bl.dst.t), dw = X(bl.dst.r) - dl, dh = Y(bl.dst.b) - dt;
    const sw = bl.src.r - bl.src.l, sh = bl.src.b - bl.src.t;
    if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
    for (let y = Math.max(0, Math.floor(dt)); y < Math.min(H, Math.ceil(dt + dh)); y++) {
      const sy = Math.min(bl.img.h - 1, Math.max(0, bl.src.t + Math.floor(((y + 0.5 - dt) / dh) * sh)));
      for (let x = Math.max(0, Math.floor(dl)); x < Math.min(W, Math.ceil(dl + dw)); x++) {
        const sx = Math.min(bl.img.w - 1, Math.max(0, bl.src.l + Math.floor(((x + 0.5 - dl) / dw) * sw)));
        const si = (sy * bl.img.w + sx) * 4, o = (y * W + x) * 4;
        out[o] = bl.img.px[si]; out[o + 1] = bl.img.px[si + 1]; out[o + 2] = bl.img.px[si + 2]; out[o + 3] = 255;
      }
    }
  }
  for (const it of items) {
    if ('img' in it) { drawBlit(it); continue; }
    const p = it;
    const l = Math.round(X(p.r.l)), t = Math.round(Y(p.r.t)), r = Math.round(X(p.r.r)), b = Math.round(Y(p.r.b));
    const pw = Math.max(1, Math.round(p.pen * scale));
    if (p.kind === 'line') {
      const steps = Math.max(Math.abs(r - l), Math.abs(b - t), 1);
      for (let i = 0; i <= steps; i++) for (let a = 0; a < pw; a++) for (let c = 0; c < pw; c++) put(Math.round(l + ((r - l) * i) / steps) + a, Math.round(t + ((b - t) * i) / steps) + c, p.color);
      continue;
    }
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
    for (let y = Math.max(0, t); y < Math.min(H, b); y++) for (let x = Math.max(0, l); x < Math.min(W, r); x++) {
      const oval = p.kind === 'oval' || p.kind === 'frameOval';
      const inside = !oval || ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
      if (!inside) continue;
      if (p.kind === 'rect' || p.kind === 'oval') { put(x, y, p.color); continue; }
      const edge = oval ? ((x + 0.5 - cx) / Math.max(1, rx - pw)) ** 2 + ((y + 0.5 - cy) / Math.max(1, ry - pw)) ** 2 > 1 : x < l + pw || x >= r - pw || y < t + pw || y >= b - pw;
      if (edge) put(x, y, p.color);
    }
  }
  return { mime: 'image/png', bytes: encodePng({ w: W, h: H, px: out }) };
}
