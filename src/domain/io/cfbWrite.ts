// A minimal writer for the Compound File Binary format (version 3, 512-byte sectors): enough to put a few
// streams into storages, which is what an encrypted Office file is. Streams under 4096 bytes go into the
// mini stream, larger ones into ordinary sectors; a DIFAT is written when the FAT needs more than 109 sectors.
// The directory tree of each storage is a balanced binary tree ordered the way the format requires.

export interface CfbNode {
  name: string;
  /** Stream bytes; absent for a storage. */
  data?: Uint8Array;
  /** Children of a storage. */
  children?: CfbNode[];
}

const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const FREE = 0xffffffff, END = 0xfffffffe, FAT_SECT = 0xfffffffd, DIFAT_SECT = 0xfffffffc;
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

interface Entry {
  name: string; type: 1 | 2 | 5; color: 0 | 1;
  left: number; right: number; child: number;
  data?: Uint8Array; start: number; size: number;
}

/** Directory order inside a storage: shorter names first, then by upper-cased UTF-16 code units. */
function compareNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  const x = a.toUpperCase(), y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Build the file for a root storage holding `children`. */
export function writeCfb(children: CfbNode[]): Uint8Array {
  // 1. Flatten into directory entries (root first), wiring each storage's children into a balanced tree.
  const entries: Entry[] = [{ name: 'Root Entry', type: 5, color: 1, left: FREE, right: FREE, child: FREE, start: END, size: 0 }];
  const addChildren = (parent: Entry, nodes: CfbNode[]) => {
    if (!nodes.length) return;
    const sorted = [...nodes].sort((a, b) => compareNames(a.name, b.name));
    for (const n of sorted) if (n.name.length > 31 || /[!:/\\]/.test(n.name.replace(/^\x06/, ''))) throw new Error(`Invalid compound file name: ${n.name}`);
    const made: Entry[] = sorted.map((n) => ({ name: n.name, type: n.children ? 1 : 2, color: 1, left: FREE, right: FREE, child: FREE, data: n.data, start: END, size: n.data?.length ?? 0 }));
    const ids = made.map((e) => { entries.push(e); return entries.length - 1; });
    const maxDepth = Math.floor(Math.log2(made.length));
    const perfect = Number.isInteger(Math.log2(made.length + 1));
    const build = (lo: number, hi: number, depth: number): number => {
      if (lo > hi) return FREE;
      const mid = (lo + hi) >> 1;
      const e = made[mid];
      if (!perfect && depth === maxDepth) e.color = 0; // red leaves keep the black height equal
      e.left = build(lo, mid - 1, depth + 1);
      e.right = build(mid + 1, hi, depth + 1);
      return ids[mid];
    };
    parent.child = build(0, made.length - 1, 0);
    sorted.forEach((n, i) => { if (n.children) addChildren(made[i], n.children); });
  };
  addChildren(entries[0], children);

  // 2. Mini stream, mini FAT and the sector plan.
  const ceilDiv = (a: number, b: number) => Math.ceil(a / b);
  const small = entries.filter((e) => e.type === 2 && e.size > 0 && e.size < CUTOFF);
  const big = entries.filter((e) => e.type === 2 && e.size >= CUTOFF);
  let miniCount = 0;
  const miniFat: number[] = [];
  for (const e of small) {
    const n = ceilDiv(e.size, MINI);
    e.start = miniCount;
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? END : miniCount + i + 1);
    miniCount += n;
  }
  const miniStream = new Uint8Array(miniCount * MINI);
  for (const e of small) miniStream.set(e.data!, e.start * MINI);
  entries[0].size = miniStream.length;

  const dirSectors = ceilDiv(entries.length, SECTOR / 128);
  const miniFatSectors = ceilDiv(miniFat.length, SECTOR / 4);
  const miniStreamSectors = ceilDiv(miniStream.length, SECTOR);
  let next = 0;
  const dirStart = next; next += dirSectors;
  const miniFatStart = miniFatSectors ? next : END; next += miniFatSectors;
  const miniStreamStart = miniStreamSectors ? next : END; next += miniStreamSectors;
  entries[0].start = miniStreamStart;
  for (const e of big) { e.start = next; next += ceilDiv(e.size, SECTOR); }
  const contentSectors = next;

  const perFat = SECTOR / 4;
  let fatCount = 0, difatCount = 0;
  for (let i = 0; i < 20; i++) {
    const f = ceilDiv(contentSectors + fatCount + difatCount, perFat);
    const d = f > 109 ? ceilDiv(f - 109, perFat - 1) : 0;
    if (f === fatCount && d === difatCount) break;
    fatCount = f; difatCount = d;
  }
  const total = contentSectors + fatCount + difatCount;
  const fatStart = contentSectors;
  const difatStart = contentSectors + fatCount;

  // 3. FAT.
  const fat = new Uint32Array(fatCount * perFat).fill(FREE);
  const chainRun = (start: number, count: number) => { for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? END : start + i + 1; };
  chainRun(dirStart, dirSectors);
  if (miniFatSectors) chainRun(miniFatStart, miniFatSectors);
  if (miniStreamSectors) chainRun(miniStreamStart, miniStreamSectors);
  for (const e of big) chainRun(e.start, ceilDiv(e.size, SECTOR));
  for (let i = 0; i < fatCount; i++) fat[fatStart + i] = FAT_SECT;
  for (let i = 0; i < difatCount; i++) fat[difatStart + i] = DIFAT_SECT;

  // 4. Assemble.
  const out = new Uint8Array(SECTOR + total * SECTOR);
  const v = new DataView(out.buffer);
  const at = (sector: number) => SECTOR + sector * SECTOR;
  out.set(SIGNATURE, 0);
  v.setUint16(0x18, 0x3e, true);
  v.setUint16(0x1a, 3, true);
  v.setUint16(0x1c, 0xfffe, true);
  v.setUint16(0x1e, 9, true);
  v.setUint16(0x20, 6, true);
  v.setUint32(0x2c, fatCount, true);
  v.setUint32(0x30, dirStart, true);
  v.setUint32(0x38, CUTOFF, true);
  v.setUint32(0x3c, miniFatStart, true);
  v.setUint32(0x40, miniFatSectors, true);
  v.setUint32(0x44, difatCount ? difatStart : END, true);
  v.setUint32(0x48, difatCount, true);
  for (let i = 0; i < 109; i++) v.setUint32(0x4c + i * 4, i < fatCount ? fatStart + i : FREE, true);
  // DIFAT sectors list the FAT sectors beyond the 109 in the header; the last slot links to the next one.
  for (let d = 0; d < difatCount; d++) {
    const base = at(difatStart + d);
    for (let i = 0; i < perFat - 1; i++) {
      const idx = 109 + d * (perFat - 1) + i;
      v.setUint32(base + i * 4, idx < fatCount ? fatStart + idx : FREE, true);
    }
    v.setUint32(base + (perFat - 1) * 4, d === difatCount - 1 ? END : difatStart + d + 1, true);
  }
  for (let i = 0; i < fat.length; i++) v.setUint32(at(fatStart) + i * 4, fat[i], true);
  for (let i = 0; i < miniFat.length; i++) v.setUint32(at(miniFatStart) + i * 4, miniFat[i], true);
  // Unused mini FAT slots stay free.
  for (let i = miniFat.length; i < miniFatSectors * perFat; i++) v.setUint32(at(miniFatStart) + i * 4, FREE, true);
  out.set(miniStream, at(miniStreamStart === END ? 0 : miniStreamStart));
  for (const e of big) out.set(e.data!, at(e.start));

  // Directory.
  const dir = at(dirStart);
  for (let i = 0; i < dirSectors * 4; i++) {
    const o = dir + i * 128;
    const e = entries[i];
    if (!e) { v.setUint32(o + 0x44, FREE, true); v.setUint32(o + 0x48, FREE, true); v.setUint32(o + 0x4c, FREE, true); continue; }
    for (let c = 0; c < e.name.length; c++) v.setUint16(o + c * 2, e.name.charCodeAt(c), true);
    v.setUint16(o + 0x40, (e.name.length + 1) * 2, true);
    v.setUint8(o + 0x42, e.type);
    v.setUint8(o + 0x43, e.color);
    v.setUint32(o + 0x44, e.left, true);
    v.setUint32(o + 0x48, e.right, true);
    v.setUint32(o + 0x4c, e.child, true);
    v.setUint32(o + 0x74, e.type === 1 ? 0 : e.size === 0 && e.type === 2 ? END : e.start, true);
    v.setUint32(o + 0x78, e.size, true);
  }
  return out;
}
