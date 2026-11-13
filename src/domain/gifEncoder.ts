// A small self-contained animated-GIF encoder (GIF89a): a shared 256-colour palette by median cut over all
// frames, LZW compression, a looping extension and one delay per frame. Used by File › Export › 애니메이션 GIF.

export interface GifFrame {
  /** RGBA pixels, width × height × 4 (as canvas getImageData gives). */
  data: Uint8ClampedArray | Uint8Array;
  /** Display time in hundredths of a second (GIF's unit). */
  delayCs: number;
}

export interface GifOptions {
  width: number;
  height: number;
  /** Times the animation repeats; 0 = forever (default). */
  loop?: number;
}

/** Median-cut palette (up to 256 RGB triples) over a sample of the pixels of all frames. */
export function buildPalette(frames: GifFrame[], maxColors = 256): number[][] {
  const counts = new Map<number, number>();
  for (const f of frames) {
    const d = f.data;
    const step = Math.max(1, Math.floor(d.length / 4 / 40000)) * 4;
    for (let i = 0; i < d.length; i += step) {
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  type Px = { c: number[]; n: number };
  const px: Px[] = [...counts].map(([k, n]) => ({ c: [(((k >> 10) & 31) << 3) | 4, (((k >> 5) & 31) << 3) | 4, ((k & 31) << 3) | 4], n }));
  if (!px.length) return [[0, 0, 0], [255, 255, 255]];
  const boxes: Px[][] = [px];
  const range = (b: Px[], ch: number) => { let lo = 255, hi = 0; for (const p of b) { lo = Math.min(lo, p.c[ch]); hi = Math.max(hi, p.c[ch]); } return hi - lo; };
  while (boxes.length < maxColors) {
    let bi = -1, best = 0, bch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) { const r = range(b, ch); if (r > best) { best = r; bi = i; bch = ch; } }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => x.c[bch] - y.c[bch]);
    const total = b.reduce((s, p) => s + p.n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i].n; cut = i + 1; if (acc >= total / 2) break; }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map((b) => {
    const t = b.reduce((s, p) => s + p.n, 0) || 1;
    return [0, 1, 2].map((ch) => Math.round(b.reduce((s, p) => s + p.c[ch] * p.n, 0) / t));
  });
}

/** Palette index of each pixel (nearest palette colour; cached per 5-bit colour). */
export function indexPixels(data: Uint8ClampedArray | Uint8Array, palette: number[][], cache: Map<number, number>): Uint8Array {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    let idx = cache.get(k);
    if (idx === undefined) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      let bd = Infinity;
      idx = 0;
      for (let p = 0; p < palette.length; p++) {
        const dr = palette[p][0] - r, dg = palette[p][1] - g, db = palette[p][2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; idx = p; }
      }
      cache.set(k, idx);
    }
    out[j] = idx;
  }
  return out;
}

/** GIF's variable-width LZW over palette indices. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const bytes: number[] = [];
  let cur = 0, bits = 0;
  const emit = (code: number, size: number) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { bytes.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  let size = minCodeSize + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  emit(clear, size);
  if (!indices.length) { emit(eoi, size); if (bits) bytes.push(cur & 255); return Uint8Array.from(bytes); }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << size) && size < 12) size++;
    } else {
      emit(clear, size);
      dict = new Map(); size = minCodeSize + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix, size);
  emit(eoi, size);
  if (bits) bytes.push(cur & 255);
  return Uint8Array.from(bytes);
}

/** Encode frames as an animated GIF. Every frame must be width × height RGBA. */
export function encodeGif(frames: GifFrame[], o: GifOptions): Uint8Array {
  if (!frames.length) throw new Error('GIF needs at least one frame');
  if (o.width < 1 || o.height < 1 || o.width > 65535 || o.height > 65535) throw new Error('bad GIF size');
  for (const f of frames) if (f.data.length !== o.width * o.height * 4) throw new Error('frame size does not match the GIF size');
  const palette = buildPalette(frames);
  let bitsPerColor = 1;
  while ((1 << bitsPerColor) < palette.length) bitsPerColor++;
  const tableSize = 1 << bitsPerColor;
  const out: number[] = [];
  const u16 = (n: number) => out.push(n & 255, (n >> 8) & 255);
  const str = (s: string) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  str('GIF89a');
  u16(o.width); u16(o.height);
  out.push(0x80 | ((bitsPerColor - 1) << 4) | (bitsPerColor - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) out.push(...(palette[i] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 11); str('NETSCAPE2.0'); out.push(3, 1); u16(o.loop ?? 0); out.push(0);
  const cache = new Map<number, number>();
  const minCode = Math.max(2, bitsPerColor);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0x00); u16(Math.max(0, Math.min(65535, Math.round(f.delayCs)))); out.push(0, 0);
    out.push(0x2c); u16(0); u16(0); u16(o.width); u16(o.height); out.push(0);
    out.push(minCode);
    const data = lzwEncode(indexPixels(f.data, palette, cache), minCode);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      out.push(n);
      for (let j = 0; j < n; j++) out.push(data[i + j]);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
