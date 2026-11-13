// A reader for the Compound File Binary format (OLE2 / "structured storage") that legacy Office
// files (.ppt, .doc, .xls) are stored in. Written for hostile input: it never throws, every chain
// is walked with a visited set and a length cap, and sizes are bounded. Reads streams by name.

export const CFB_MAX_FILE = 256 * 1024 * 1024;
export const CFB_MAX_STREAM = 128 * 1024 * 1024;
const MAX_DIR_ENTRIES = 20_000;
const MAX_SECTORS = 4_000_000;
const FREE = 0xffffffff, END = 0xfffffffe, FAT_SECT = 0xfffffffd, DIFAT_SECT = 0xfffffffc;
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export interface CfbEntry { name: string; type: number; start: number; size: number }
export interface Cfb {
  entries: CfbEntry[];
  /** The bytes of a stream by (case-insensitive) name, or null when absent / unreadable. */
  stream(name: string): Uint8Array | null;
}

export const isCfb = (b: Uint8Array) => b.length >= 512 && SIGNATURE.every((v, i) => b[i] === v);

/** Parse a compound file; null when it is not one or is too damaged to read at all. */
export function readCfb(bytes: Uint8Array): Cfb | null {
  try {
    return parse(bytes);
  } catch {
    return null;
  }
}

function parse(b: Uint8Array): Cfb | null {
  if (!isCfb(b) || b.length > CFB_MAX_FILE) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const shift = v.getUint16(0x1e, true);
  const miniShift = v.getUint16(0x20, true);
  if ((shift !== 9 && shift !== 12) || miniShift !== 6) return null;
  const sectorSize = 1 << shift;
  const miniSize = 1 << miniShift;
  const nSectors = Math.min(Math.floor((b.length - 512) / sectorSize) + 1, MAX_SECTORS);
  const offsetOf = (sector: number) => (sector + 1) * sectorSize;
  const valid = (sector: number) => sector < nSectors && offsetOf(sector) < b.length;
  const sectorBytes = (s: number) => b.subarray(offsetOf(s), Math.min(offsetOf(s) + sectorSize, b.length));

  // The FAT: sector numbers from the header's DIFAT, then the DIFAT chain.
  const fatSectors: number[] = [];
  const numFat = v.getUint32(0x2c, true);
  for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
    const s = v.getUint32(0x4c + i * 4, true);
    if (s !== FREE && valid(s)) fatSectors.push(s);
  }
  let difat = v.getUint32(0x44, true);
  const seenDifat = new Set<number>();
  for (let n = v.getUint32(0x48, true); n > 0 && difat !== END && difat !== FREE && valid(difat) && !seenDifat.has(difat) && seenDifat.size < 5000; n--) {
    seenDifat.add(difat);
    const dv = new DataView(b.buffer, b.byteOffset + offsetOf(difat), Math.min(sectorSize, b.length - offsetOf(difat)));
    const per = Math.floor(dv.byteLength / 4) - 1;
    for (let i = 0; i < per; i++) {
      const s = dv.getUint32(i * 4, true);
      if (s !== FREE && valid(s) && fatSectors.length < numFat + 109) fatSectors.push(s);
    }
    difat = dv.getUint32(per * 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const dv = new DataView(b.buffer, b.byteOffset + offsetOf(s), Math.min(sectorSize, b.length - offsetOf(s)));
    for (let i = 0; i + 4 <= dv.byteLength; i += 4) fat.push(dv.getUint32(i, true));
  }
  if (!fat.length) return null;

  /** The sectors of a chain, stopping at the end, a loop, an invalid sector or the cap. */
  const chain = (start: number, maxBytes = CFB_MAX_STREAM): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    const cap = Math.ceil(maxBytes / sectorSize) + 1;
    for (let s = start; s < nSectors && s !== END && s !== FREE && s !== FAT_SECT && s !== DIFAT_SECT && !seen.has(s) && out.length < cap; s = fat[s] ?? END) {
      if (!valid(s)) break;
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const secs = chain(start, Math.min(size, CFB_MAX_STREAM));
    const out = new Uint8Array(Math.min(secs.length * sectorSize, Math.min(size, CFB_MAX_STREAM)));
    let at = 0;
    for (const s of secs) {
      const part = sectorBytes(s);
      const n = Math.min(part.length, out.length - at);
      if (n <= 0) break;
      out.set(part.subarray(0, n), at);
      at += n;
    }
    return out.subarray(0, at);
  };

  // Directory.
  const dirStart = v.getUint32(0x30, true);
  const dirBytes = readChain(dirStart, MAX_DIR_ENTRIES * 128);
  const entries: CfbEntry[] = [];
  for (let o = 0; o + 128 <= dirBytes.length && entries.length < MAX_DIR_ENTRIES; o += 128) {
    const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset + o, 128);
    const nameLen = Math.min(dv.getUint16(0x40, true), 64);
    let name = '';
    for (let i = 0; i + 2 <= nameLen - 2; i += 2) name += String.fromCharCode(dv.getUint16(i, true));
    const type = dv.getUint8(0x42);
    // Version 3 files use the low 32 bits of the size only.
    const size = dv.getUint32(0x78, true) + (shift === 12 ? dv.getUint32(0x7c, true) * 2 ** 32 : 0);
    entries.push({ name, type, start: dv.getUint32(0x74, true), size });
  }
  const root = entries.find((e) => e.type === 5);
  if (!root) return null;

  // Mini stream: small streams live in 64-byte sectors inside the root entry's stream.
  const miniCutoff = v.getUint32(0x38, true) || 4096;
  let miniStream: Uint8Array | null = null;
  let miniFat: number[] | null = null;
  const loadMini = () => {
    if (miniFat) return;
    miniFat = [];
    const secs = chain(v.getUint32(0x3c, true), Math.min(v.getUint32(0x40, true), 100_000) * sectorSize);
    for (const s of secs) {
      const dv = new DataView(b.buffer, b.byteOffset + offsetOf(s), Math.min(sectorSize, b.length - offsetOf(s)));
      for (let i = 0; i + 4 <= dv.byteLength; i += 4) miniFat.push(dv.getUint32(i, true));
    }
    miniStream = readChain(root.start, root.size);
  };
  const readMini = (start: number, size: number): Uint8Array => {
    loadMini();
    const mf = miniFat!, ms = miniStream!;
    const cap = Math.min(size, CFB_MAX_STREAM);
    const out = new Uint8Array(Math.min(cap, ms.length));
    let at = 0;
    const seen = new Set<number>();
    for (let s = start; s !== END && s !== FREE && !seen.has(s) && at < out.length && s * miniSize < ms.length; s = mf[s] ?? END) {
      seen.add(s);
      const part = ms.subarray(s * miniSize, Math.min((s + 1) * miniSize, ms.length));
      const n = Math.min(part.length, out.length - at);
      out.set(part.subarray(0, n), at);
      at += n;
    }
    return out.subarray(0, at);
  };

  const cache = new Map<string, Uint8Array | null>();
  return {
    entries,
    stream(name: string) {
      const key = name.toLowerCase();
      if (cache.has(key)) return cache.get(key) ?? null;
      let result: Uint8Array | null = null;
      try {
        const e = entries.find((x) => x.type === 2 && x.name.toLowerCase() === key);
        if (e && e.size <= CFB_MAX_STREAM) result = e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size);
      } catch { result = null; }
      cache.set(key, result);
      return result;
    },
  };
}
