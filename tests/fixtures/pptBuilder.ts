// Builds small legacy .ppt (PowerPoint 97-2003) files for tests: a compound file (OLE2) holding the
// "PowerPoint Document", "Current User" and "Pictures" streams with the records the reader uses.
// Not a general writer — just enough structure to exercise the parser without a real file.

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const cat = (...parts: (number[] | Uint8Array)[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

export const rec = (ver: number, inst: number, type: number, payload: number[] | Uint8Array = []): Uint8Array =>
  cat(u16((inst << 4) | ver), u16(type), u32(payload.length), payload);
const container = (type: number, inst: number, ...kids: Uint8Array[]) => rec(0xf, inst, type, cat(...kids));

const utf16 = (s: string) => Array.from(s).flatMap((ch) => u16(ch.charCodeAt(0)));
const textAtoms = (type: number, s: string, ascii = false) => [
  rec(0, type, 0x0f9f, u32(type)),
  ascii ? rec(0, 0, 0x0fa8, Array.from(s).map((c) => c.charCodeAt(0) & 0xff)) : rec(0, 0, 0x0fa0, utf16(s)),
];

export interface FixtureShape {
  text?: string; textType?: number; placeholder?: number; ascii?: boolean;
  /** Master units (1/576 inch): left, top, right, bottom. */
  anchor?: [number, number, number, number];
  /** 1-based picture index. */
  picture?: number;
}
export interface FixtureSlide { shapes: FixtureShape[]; notes?: string }
export interface FixtureOptions {
  slides: FixtureSlide[];
  pictures?: { type: 'jpeg' | 'png'; bytes: number[] }[];
  /** Leave a stale copy of the first slide (older save) before the real ones. */
  staleSlide?: string;
  /** Omit the Current User stream (no persist directory). */
  noCurrentUser?: boolean;
  encrypted?: boolean;
}

function shapeRecord(s: FixtureShape, id: number): Uint8Array {
  const kids: Uint8Array[] = [rec(2, 0, 0xf00a, [...u32(id), ...u32(0x0a00)])];
  if (s.picture) kids.push(rec(3, 1, 0xf00b, [...u16(0x4104), ...u32(s.picture)]));
  if (s.anchor) { const [l, t, r, b] = s.anchor; kids.push(rec(0, 0, 0xf010, [...u16(t), ...u16(l), ...u16(r), ...u16(b)])); }
  if (s.placeholder !== undefined) kids.push(container(0xf011, 0, rec(0, 0, 0x0bc3, [...u32(0), s.placeholder, 0, 0, 0])));
  if (s.text !== undefined) kids.push(container(0xf00d, 0, ...textAtoms(s.textType ?? 4, s.text, s.ascii)));
  return container(0xf004, 0, ...kids);
}
const drawing = (shapes: FixtureShape[]) =>
  rec(0, 0, 0x040c, container(0xf002, 0, container(0xf003, 0, rec(2, 0, 0xf00a, [...u32(1), ...u32(5)]), ...shapes.map((s, i) => shapeRecord(s, 1000 + i)))));

export function buildPpt(o: FixtureOptions): Uint8Array {
  const ps = o.pictures ?? [];
  // Pictures stream: one blip record each.
  const blips: number[][] = ps.map((p) => {
    const uid = Array.from({ length: 16 }, (_, i) => i + 1);
    const body = [...uid, 0xff, ...p.bytes];
    return Array.from(p.type === 'jpeg' ? rec(0, 0x46a, 0xf01d, body) : rec(0, 0x6e0, 0xf01e, body));
  });
  const offsets: number[] = [];
  let po = 0;
  for (const b of blips) { offsets.push(po); po += b.length; }
  const picturesStream = cat(...blips);

  const parts: { at: number; bytes: Uint8Array }[] = [];
  let at = 0;
  const put = (bytes: Uint8Array) => { parts.push({ at, bytes }); const p = at; at += bytes.length; return p; };
  const slideContainer = (shapes: FixtureShape[], notesId: number) =>
    container(0x03ee, 0, rec(2, 0, 0x03ef, [...u32(0), ...new Array(8).fill(0), ...u32(0x80000000), ...u32(notesId), ...u16(0), ...u16(0)]), drawing(shapes));
  if (o.staleSlide) put(slideContainer([{ text: o.staleSlide, textType: 0, placeholder: 1 }], 0));
  const slideAt = o.slides.map((s, i) => put(slideContainer(s.shapes, s.notes ? 300 + i : 0)));
  const noteAt = o.slides.map((s) => (s.notes ? put(container(0x03f0, 0, rec(2, 0, 0x03f1, new Array(8).fill(0)), drawing([{ text: s.notes, textType: 2, placeholder: 0x0c }]))) : -1));

  const persist = (id: number, slideId: number) => rec(0, 0, 0x03f3, [...u32(id), ...u32(0), ...u32(0), ...u32(slideId), ...u32(0)]);
  const slwt = (inst: number, entries: Uint8Array[]) => container(0x0ff0, inst, ...entries);
  const notesEntries = o.slides.flatMap((s, i) => (s.notes ? [persist(10 + i, 300 + i)] : []));
  const bse = ps.map((p, i) => rec(2, p.type === 'jpeg' ? 5 : 6, 0xf007, [p.type === 'jpeg' ? 5 : 6, p.type === 'jpeg' ? 5 : 6, ...new Array(16).fill(i + 1), ...u16(0xff), ...u32(blips[i].length), ...u32(1), ...u32(offsets[i]), 0, 0, 0, 0]));
  const doc = container(0x03e8, 0,
    rec(1, 0, 0x03e9, [...u32(5760), ...u32(4320), ...u32(0), ...u32(0), ...u32(0), ...u32(0), 0, 0, 0, 0]),
    ...(ps.length ? [rec(0xf, 0, 0x040b, container(0xf000, 0, container(0xf001, ps.length, ...bse)))] : []),
    slwt(0, o.slides.map((_, i) => persist(2 + i, 256 + i))),
    ...(notesEntries.length ? [slwt(2, notesEntries)] : []));
  const docAt = put(doc);

  // Persist directory: id 1 = document, 2.. = slides, 10.. = notes.
  const entries: [number, number][] = [[1, docAt], ...slideAt.map((a, i): [number, number] => [2 + i, a]), ...noteAt.flatMap((a, i): [number, number][] => (a >= 0 ? [[10 + i, a]] : []))];
  const dirBytes = entries.flatMap(([id, off]) => [...u32(id | (1 << 20)), ...u32(off)]);
  const dirAt = put(rec(0, 0, 0x1772, dirBytes));
  const editAt = put(rec(0, 0, 0x0ff5, [...u32(0), ...u16(0), 0, 3, ...u32(0), ...u32(dirAt), ...u32(1), ...u32(100), ...u16(1), ...u16(0)]));

  const docStream = new Uint8Array(at);
  for (const p of parts) docStream.set(p.bytes, p.at);
  const currentUser = rec(0, 0, 0x0ff6, [...u32(0x14), ...u32(o.encrypted ? 0xf3d1c4df : 0xe391c05f), ...u32(editAt), ...u16(8), ...u16(0), ...u16(3), ...u16(0)]);

  const streams: { name: string; data: Uint8Array }[] = [{ name: 'PowerPoint Document', data: docStream }];
  if (!o.noCurrentUser) streams.push({ name: 'Current User', data: currentUser });
  if (ps.length) streams.push({ name: 'Pictures', data: picturesStream });
  return buildCfb(streams);
}

/** A version 3 compound file: streams under 4096 bytes in the mini stream, the rest in regular sectors. */
export function buildCfb(streams: { name: string; data: Uint8Array }[]): Uint8Array {
  const S = 512;
  const small = streams.filter((s) => s.data.length < 4096);
  const big = streams.filter((s) => s.data.length >= 4096);
  // Mini stream and its FAT.
  const miniStart = new Map<string, number>();
  const miniFat: number[] = [];
  const miniChunks: Uint8Array[] = [];
  for (const s of small) {
    const n = Math.max(1, Math.ceil(s.data.length / 64));
    miniStart.set(s.name, miniFat.length);
    for (let i = 0; i < n; i++) { miniFat.push(i === n - 1 ? 0xfffffffe : miniFat.length + 1); const chunk = new Uint8Array(64); chunk.set(s.data.subarray(i * 64, i * 64 + 64)); miniChunks.push(chunk); }
  }
  const miniStream = cat(...miniChunks);
  const sectors = (n: number) => Math.ceil(n / S);
  const nDir = sectors((streams.length + 1) * 128);
  const nMiniFat = miniFat.length ? sectors(miniFat.length * 4) : 0;
  const nMini = sectors(miniStream.length);
  const nBig = big.map((s) => sectors(s.data.length));
  const content = nDir + nMiniFat + nMini + nBig.reduce((a, b) => a + b, 0);
  let nFat = 1;
  while (nFat * 128 < content + nFat) nFat++;
  const total = nFat + content;
  const fat = new Array<number>(nFat * 128).fill(0xffffffff);
  for (let i = 0; i < nFat; i++) fat[i] = 0xfffffffd;
  let next = nFat;
  const alloc = (n: number) => { const start = next; for (let i = 0; i < n; i++) { fat[next] = i === n - 1 ? 0xfffffffe : next + 1; next++; } return n ? start : 0xfffffffe; };
  const dirStart = alloc(nDir);
  const miniFatStart = alloc(nMiniFat);
  const miniDataStart = alloc(nMini);
  const bigStart = nBig.map((n) => alloc(n));

  const file = new Uint8Array(S + total * S);
  const dv = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  dv.setUint16(0x18, 0x3e, true); dv.setUint16(0x1a, 3, true); dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, 9, true); dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, nFat, true); dv.setUint32(0x30, dirStart, true); dv.setUint32(0x38, 4096, true);
  dv.setUint32(0x3c, nMiniFat ? miniFatStart : 0xfffffffe, true); dv.setUint32(0x40, nMiniFat, true);
  dv.setUint32(0x44, 0xfffffffe, true); dv.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i < nFat ? i : 0xffffffff, true);
  const sector = (n: number) => S + n * S;
  fat.forEach((v, i) => dv.setUint32(sector(0) + i * 4, v, true));
  miniFat.forEach((v, i) => dv.setUint32(sector(miniFatStart) + i * 4, v, true));
  if (miniStream.length) file.set(miniStream, sector(miniDataStart));
  big.forEach((s, i) => file.set(s.data, sector(bigStart[i])));
  // Directory: root, then every stream chained through the right sibling.
  const entry = (i: number, name: string, type: number, start: number, size: number, right: number, child: number) => {
    const o = sector(dirStart) + i * 128;
    for (let k = 0; k < name.length; k++) dv.setUint16(o + k * 2, name.charCodeAt(k), true);
    dv.setUint16(o + 0x40, (name.length + 1) * 2, true);
    file[o + 0x42] = type; file[o + 0x43] = 1;
    dv.setUint32(o + 0x44, 0xffffffff, true); dv.setUint32(o + 0x48, right, true); dv.setUint32(o + 0x4c, child, true);
    dv.setUint32(o + 0x74, start, true); dv.setUint32(o + 0x78, size, true);
  };
  entry(0, 'Root Entry', 5, nMini ? miniDataStart : 0xfffffffe, miniStream.length, 0xffffffff, streams.length ? 1 : 0xffffffff);
  streams.forEach((s, i) => {
    const isSmall = s.data.length < 4096;
    entry(i + 1, s.name, 2, isSmall ? miniStart.get(s.name)! : bigStart[big.indexOf(s)], s.data.length, i + 1 < streams.length ? i + 2 : 0xffffffff, 0xffffffff);
  });
  return file;
}
