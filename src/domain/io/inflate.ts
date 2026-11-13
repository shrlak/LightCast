// A small zlib / raw DEFLATE decoder (RFC 1950 / 1951, after zlib's "puff"): the compressed
// metafiles of a legacy .ppt need one and the readers here are synchronous. Never throws; the
// output is capped so a hostile stream cannot grow without bound.

interface Huff { count: Uint16Array; symbol: Uint16Array }

function build(lengths: ArrayLike<number>, n: number): Huff {
  const count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
  for (let s = 0; s < n; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixedTables: [Huff, Huff] | null = null;

/** Raw DEFLATE data from `start`; null when it is damaged or would pass `maxOut` bytes. */
export function inflateRaw(src: Uint8Array, start: number, maxOut: number): Uint8Array | null {
  try {
    let pos = start, bitBuf = 0, bitCnt = 0;
    let out = new Uint8Array(Math.min(Math.max(src.length * 4, 1024), maxOut));
    let n = 0;
    const bits = (need: number): number => {
      let v = bitBuf;
      while (bitCnt < need) {
        if (pos >= src.length) throw new Error('eof');
        v |= src[pos++] << bitCnt;
        bitCnt += 8;
      }
      bitBuf = v >>> need;
      bitCnt -= need;
      return v & ((1 << need) - 1);
    };
    const decode = (h: Huff): number => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= 15; len++) {
        code |= bits(1);
        const count = h.count[len];
        if (code - count < first) return h.symbol[index + (code - first)];
        index += count; first += count; first <<= 1; code <<= 1;
      }
      throw new Error('code');
    };
    const put = (b: number) => {
      if (n >= out.length) {
        if (n >= maxOut) throw new Error('size');
        const bigger = new Uint8Array(Math.min(out.length * 2, maxOut));
        bigger.set(out);
        out = bigger;
      }
      out[n++] = b;
    };
    for (let last = 0; !last;) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        if (pos + 4 > src.length) throw new Error('eof');
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + len > src.length) throw new Error('eof');
        for (let i = 0; i < len; i++) put(src[pos++]);
        continue;
      }
      if (type === 3) throw new Error('type');
      let lit: Huff, dist: Huff;
      if (type === 1) {
        if (!fixedTables) {
          const l = new Uint8Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8;
          for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7;
          for (let i = 280; i < 288; i++) l[i] = 8;
          fixedTables = [build(l, 288), build(new Uint8Array(30).fill(5), 30)];
        }
        [lit, dist] = fixedTables;
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new Error('counts');
        const lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[ORDER[i]] = bits(3);
        const lenCode = build(lengths.subarray(0, 19), 19);
        const all = new Uint8Array(320);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(lenCode);
          if (sym < 16) all[i++] = sym;
          else {
            let rep: number, val = 0;
            if (sym === 16) { if (!i) throw new Error('rep'); val = all[i - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) throw new Error('rep');
            while (rep--) all[i++] = val;
          }
        }
        lit = build(all.subarray(0, nlen), nlen);
        dist = build(all.subarray(nlen, nlen + ndist), ndist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) put(sym);
        else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) throw new Error('len');
          const len = LBASE[li] + bits(LEXT[li]);
          const ds = decode(dist);
          if (ds >= 30) throw new Error('dist');
          const d = DBASE[ds] + bits(DEXT[ds]);
          if (d > n) throw new Error('dist');
          for (let i = 0; i < len; i++) put(out[n - d]);
        }
      }
    }
    return out.slice(0, n);
  } catch {
    return null;
  }
}

/** A zlib stream (2-byte header, DEFLATE data, checksum). */
export function inflateZlib(src: Uint8Array, maxOut: number): Uint8Array | null {
  if (src.length < 3 || (src[0] & 0x0f) !== 8 || ((src[0] << 8) | src[1]) % 31 !== 0) return null;
  return inflateRaw(src, 2 + ((src[1] & 0x20) ? 4 : 0), maxOut);
}
