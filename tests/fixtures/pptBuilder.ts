// Builds small legacy .ppt (PowerPoint 97-2003) files for tests: a compound file (OLE2) holding the
// "PowerPoint Document", "Current User" and "Pictures" streams with the records the reader uses.
// Not a general writer — just enough structure to exercise the parser without a real file.

import { deflateSync } from 'node:zlib';

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

/** TextPFException fields the builder writes (masks and values in the order MS-PPT stores them). */
export interface FixturePF { bullet?: boolean; bulletChar?: number; bulletFont?: number; align?: number; lineSpacing?: number; leftMargin?: number; indent?: number }
/** TextCFException fields. `color` is the raw ColorIndexStruct: red, green, blue, index (0xFE literal, 0-7 scheme). */
export interface FixtureCF { bold?: boolean; italic?: boolean; underline?: boolean; font?: number; size?: number; color?: [number, number, number, number]; position?: number }

const pfBytes = (pf: FixturePF): number[] => {
  let masks = 0;
  const d: number[] = [];
  if (pf.bullet !== undefined) { masks |= 1; d.push(...u16(pf.bullet ? 1 : 0)); }
  if (pf.bulletChar !== undefined) { masks |= 0x80; d.push(...u16(pf.bulletChar)); }
  if (pf.bulletFont !== undefined) { masks |= 0x10; d.push(...u16(pf.bulletFont)); }
  if (pf.align !== undefined) { masks |= 0x800; d.push(...u16(pf.align)); }
  if (pf.lineSpacing !== undefined) { masks |= 0x1000; d.push(...u16(pf.lineSpacing)); }
  if (pf.leftMargin !== undefined) { masks |= 0x100; d.push(...u16(pf.leftMargin)); }
  if (pf.indent !== undefined) { masks |= 0x400; d.push(...u16(pf.indent)); }
  return [...u32(masks), ...d];
};
const cfBytes = (cf: FixtureCF): number[] => {
  let masks = 0;
  const d: number[] = [];
  let style = 0;
  if (cf.bold !== undefined) { masks |= 1; if (cf.bold) style |= 1; }
  if (cf.italic !== undefined) { masks |= 2; if (cf.italic) style |= 2; }
  if (cf.underline !== undefined) { masks |= 4; if (cf.underline) style |= 4; }
  if (masks) d.push(...u16(style));
  if (cf.font !== undefined) { masks |= 0x10000; d.push(...u16(cf.font)); }
  if (cf.size !== undefined) { masks |= 0x20000; d.push(...u16(cf.size)); }
  if (cf.color) { masks |= 0x40000; d.push(...cf.color); }
  if (cf.position !== undefined) { masks |= 0x80000; d.push(...u16(cf.position)); }
  return [...u32(masks), ...d];
};

export interface FixtureStyle {
  /** Paragraph runs: `count` characters each (the last may leave it out: the rest of the text plus the final mark). */
  pf?: (FixturePF & { count?: number; level?: number })[];
  cf?: (FixtureCF & { count?: number })[];
}

export interface FixtureShape {
  text?: string; textType?: number; placeholder?: number; ascii?: boolean;
  /** Master units (1/576 inch): left, top, right, bottom (ClientAnchor). */
  anchor?: [number, number, number, number];
  /** A shape inside a group: its ChildAnchor in the group's child space. */
  childAnchor?: [number, number, number, number];
  /** 1-based picture index. */
  picture?: number;
  /** Escher shape type (msosptXxx): 1 rectangle, 3 ellipse, 20 line ... */
  spType?: number;
  /** Escher property table entries by property id (values as the 32-bit number). */
  opt?: Record<number, number>;
  /** Rotation in degrees (property 0x0004) and SpAtom flip flags. */
  rotation?: number;
  flipH?: boolean; flipV?: boolean;
  /** StyleTextPropAtom. */
  style?: FixtureStyle;
  /** A group shape: its own anchor (or childAnchor when nested), child space (Spgr) and members. */
  group?: { spgr: [number, number, number, number]; members: FixtureShape[] };
}
export interface FixtureBackground {
  /** Opaque Escher colour: 0xRRGGBB, or a scheme index with `scheme: true`. */
  color?: number;
  scheme?: boolean;
  /** 1-based picture index (picture fill). */
  picture?: number;
  /** Shaded fill: second colour (0xRRGGBB) and angle in degrees (Escher fillAngle). */
  to?: number; angle?: number;
}
export interface FixtureMaster {
  shapes: FixtureShape[];
  /** TextMasterStyleAtoms: per text type, the five levels. */
  styles?: { type: number; levels: { pf?: FixturePF; cf?: FixtureCF }[] }[];
  /** 8 scheme colours as 0xRRGGBB. */
  scheme?: number[];
  background?: FixtureBackground;
}
export interface FixtureSlide {
  shapes: FixtureShape[];
  notes?: string;
  /** Index into `masters` (default 0 when there are masters). */
  master?: number;
  /** SlideAtom flags (default 0x7: master objects, scheme and background followed). */
  flags?: number;
  scheme?: number[];
  background?: FixtureBackground;
  hidden?: boolean;
  transition?: { effect: number; speed?: number; onClick?: boolean; timeMs?: number };
}
export interface FixturePicture {
  type: 'jpeg' | 'png' | 'wmf' | 'emf';
  bytes: number[];
  /** Metafiles: store the data deflated (default) or plain. */
  compress?: boolean;
}
export interface FixtureOptions {
  slides: FixtureSlide[];
  pictures?: FixturePicture[];
  masters?: FixtureMaster[];
  /** FontCollection typefaces by font index. */
  fonts?: string[];
  /** Document-wide default Escher properties (the drawing group's OPT). */
  defaultProps?: Record<number, number>;
  /** Leave a stale copy of the first slide (older save) before the real ones. */
  staleSlide?: string;
  /** Omit the Current User stream (no persist directory). */
  noCurrentUser?: boolean;
  encrypted?: boolean;
}

const optRecord = (props: Record<number, number>) => {
  const ids = Object.keys(props).map(Number).sort((a, b) => a - b);
  return rec(3, ids.length, 0xf00b, ids.flatMap((id) => [...u16(id), ...u32(props[id] >>> 0)]));
};
/** An Escher colour property value: opaque RGB, or (scheme) a scheme colour index. */
export const escherColor = (rgb: number, scheme = false) => (scheme ? (0x08000000 | rgb) >>> 0 : (((rgb >> 16) & 0xff) | (rgb & 0xff00) | ((rgb & 0xff) << 16)) >>> 0);

const styleAtom = (text: string, st: FixtureStyle): Uint8Array => {
  const total = text.length + 1;
  const run = <R extends { count?: number }>(runs: R[]) => {
    let left = total;
    return runs.map((r, i) => { const count = r.count ?? (i === runs.length - 1 ? left : 0); left -= count; return { r, count }; });
  };
  const pf = run(st.pf ?? [{}]).flatMap(({ r, count }) => [...u32(count), ...u16((r as { level?: number }).level ?? 0), ...pfBytes(r)]);
  const cf = run(st.cf ?? [{}]).flatMap(({ r, count }) => [...u32(count), ...cfBytes(r)]);
  return rec(0, 0, 0x0fa1, [...pf, ...cf]);
};

function shapeRecord(s: FixtureShape, id: number): Uint8Array {
  if (s.group) {
    const [gl, gt, gr, gb] = s.anchor ?? [0, 0, 0, 0];
    const head = container(0xf004, 0,
      rec(1, 0, 0xf009, s.group.spgr.flatMap((n) => u32(n))),
      rec(2, 0, 0xf00a, [...u32(id), ...u32(0x201 | (s.flipH ? 0x40 : 0) | (s.flipV ? 0x80 : 0))]),
      ...(s.rotation ? [optRecord({ 0x4: Math.round(s.rotation * 65536) })] : []),
      s.childAnchor
        ? rec(0, 0, 0xf00f, s.childAnchor.flatMap((n) => u32(n)))
        : rec(0, 0, 0xf010, [...u16(gt), ...u16(gl), ...u16(gr), ...u16(gb)]));
    return container(0xf003, 0, head, ...s.group.members.map((m, i) => shapeRecord(m, id + 1 + i)));
  }
  const flags = 0x0a00 | (s.flipH ? 0x40 : 0) | (s.flipV ? 0x80 : 0) | (s.childAnchor ? 0x2 : 0);
  const kids: Uint8Array[] = [rec(2, s.spType ?? 0, 0xf00a, [...u32(id), ...u32(flags)])];
  const props: Record<number, number> = { ...(s.opt ?? {}) };
  if (s.picture) props[0x104] = s.picture;
  if (s.rotation) props[0x4] = Math.round(s.rotation * 65536);
  if (Object.keys(props).length) kids.push(optRecord(props));
  if (s.anchor) { const [l, t, r, b] = s.anchor; kids.push(rec(0, 0, 0xf010, [...u16(t), ...u16(l), ...u16(r), ...u16(b)])); }
  if (s.childAnchor) kids.push(rec(0, 0, 0xf00f, s.childAnchor.flatMap((n) => u32(n))));
  if (s.placeholder !== undefined) kids.push(container(0xf011, 0, rec(0, 0, 0x0bc3, [...u32(0), s.placeholder, 0, 0, 0])));
  if (s.text !== undefined) kids.push(container(0xf00d, 0, ...textAtoms(s.textType ?? 4, s.text, s.ascii), ...(s.style ? [styleAtom(s.text, s.style)] : [])));
  return container(0xf004, 0, ...kids);
}
const backgroundShape = (bg: FixtureBackground): Uint8Array => {
  const props: Record<number, number> = {};
  if (bg.picture) { props[0x180] = 3; props[0x186] = bg.picture; }
  else if (bg.to !== undefined) { props[0x180] = 4; props[0x181] = escherColor(bg.color ?? 0xffffff); props[0x183] = escherColor(bg.to); props[0x18d] = Math.round((bg.angle ?? 0) * 65536); }
  else { props[0x180] = 0; props[0x181] = escherColor(bg.color ?? 0xffffff, bg.scheme); }
  props[0x1bf] = 0x00110011; // fFilled, used
  return container(0xf004, 0, rec(2, 0, 0xf00a, [...u32(2), ...u32(0xc00)]), optRecord(props));
};
const drawing = (shapes: FixtureShape[], bg?: FixtureBackground) =>
  rec(0, 0, 0x040c, container(0xf002, 0, container(0xf003, 0, rec(2, 0, 0xf00a, [...u32(1), ...u32(5)]), ...shapes.map((s, i) => shapeRecord(s, 1000 + i * 10))), ...(bg ? [backgroundShape(bg)] : [])));

const schemeAtom = (colors: number[]) => rec(0, 6, 0x07f0, colors.flatMap((c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 0]));
const masterStyleAtom = (t: { type: number; levels: { pf?: FixturePF; cf?: FixtureCF }[] }) =>
  rec(0, t.type, 0x0fa3, [...u16(t.levels.length), ...t.levels.flatMap((l) => [...(t.type >= 5 ? u16(0) : []), ...pfBytes(l.pf ?? {}), ...cfBytes(l.cf ?? {})])]);

export function buildPpt(o: FixtureOptions): Uint8Array {
  const ps = o.pictures ?? [];
  const masters = o.masters ?? [];
  const typeOf = (p: FixturePicture): [number, number, number] => ({ jpeg: [0xf01d, 0x46a, 5], png: [0xf01e, 0x6e0, 6], wmf: [0xf01b, 0x216, 3], emf: [0xf01a, 0x3d4, 2] } as Record<string, [number, number, number]>)[p.type];
  // Pictures stream: one blip record each.
  const blips: number[][] = ps.map((p) => {
    const uid = Array.from({ length: 16 }, (_, i) => i + 1);
    const [type, inst] = typeOf(p);
    if (p.type === 'wmf' || p.type === 'emf') {
      const plain = Uint8Array.from(p.bytes);
      const compress = p.compress !== false;
      const data = compress ? deflateSync(plain) : plain;
      return Array.from(rec(0, inst, type, [...uid, ...u32(plain.length), ...new Array(16).fill(0), ...u32(0), ...u32(0), ...u32(data.length), compress ? 0 : 0xfe, 0xfe, ...data]));
    }
    return Array.from(rec(0, inst, type, [...uid, 0xff, ...p.bytes]));
  });
  const offsets: number[] = [];
  let po = 0;
  for (const b of blips) { offsets.push(po); po += b.length; }
  const picturesStream = cat(...blips);

  const parts: { at: number; bytes: Uint8Array }[] = [];
  let at = 0;
  const put = (bytes: Uint8Array) => { parts.push({ at, bytes }); const p = at; at += bytes.length; return p; };
  const masterId = (i: number) => 0x80000000 + i;
  const slideContainer = (s: FixtureSlide, notesId: number) => {
    const mi = masters.length ? s.master ?? 0 : -1;
    const tr = s.transition;
    const info = s.hidden || tr
      ? [rec(1, 0, 0x03f9, [...u32(tr?.timeMs ?? 0), ...u32(0), 0, tr?.effect ?? 0, ...u16(((tr?.onClick ?? true) ? 1 : 0) | (s.hidden ? 4 : 0)), tr?.speed ?? 1, 0, 0, 0])]
      : [];
    return container(0x03ee, 0,
      rec(2, 0, 0x03ef, [...u32(0), ...new Array(8).fill(0), ...u32(mi >= 0 ? masterId(mi) : 0x80000000), ...u32(notesId), ...u16(s.flags ?? 0x7), ...u16(0)]),
      ...(s.scheme ? [schemeAtom(s.scheme)] : []),
      ...info,
      drawing(s.shapes, s.background));
  };
  if (o.staleSlide) put(slideContainer({ shapes: [{ text: o.staleSlide, textType: 0, placeholder: 1 }] }, 0));
  const slideAt = o.slides.map((s, i) => put(slideContainer(s, s.notes ? 300 + i : 0)));
  const noteAt = o.slides.map((s) => (s.notes ? put(container(0x03f0, 0, rec(2, 0, 0x03f1, new Array(8).fill(0)), drawing([{ text: s.notes, textType: 2, placeholder: 0x0c }]))) : -1));
  const masterAt = masters.map((m) => put(container(0x03f8, 0,
    rec(2, 0, 0x03ef, [...u32(0), ...new Array(8).fill(0), ...u32(0), ...u32(0), ...u16(0), ...u16(0)]),
    ...(m.scheme ? [schemeAtom(m.scheme)] : []),
    drawing(m.shapes, m.background),
    ...(m.styles ?? []).map(masterStyleAtom))));

  const persist = (id: number, slideId: number) => rec(0, 0, 0x03f3, [...u32(id), ...u32(0), ...u32(0), ...u32(slideId), ...u32(0)]);
  const slwt = (inst: number, entries: Uint8Array[]) => container(0x0ff0, inst, ...entries);
  const notesEntries = o.slides.flatMap((s, i) => (s.notes ? [persist(10 + i, 300 + i)] : []));
  const bse = ps.map((p, i) => { const bt = typeOf(p)[2]; return rec(2, bt, 0xf007, [bt, bt, ...new Array(16).fill(i + 1), ...u16(0xff), ...u32(blips[i].length), ...u32(1), ...u32(offsets[i]), 0, 0, 0, 0]); });
  const fontAtom = (name: string, i: number) => rec(0, i, 0x0fb7, [...utf16(name), ...new Array(68).fill(0)].slice(0, 68));
  const doc = container(0x03e8, 0,
    rec(1, 0, 0x03e9, [...u32(5760), ...u32(4320), ...u32(0), ...u32(0), ...u32(0), ...u32(0), 0, 0, 0, 0]),
    ...(ps.length || o.defaultProps ? [rec(0xf, 0, 0x040b, container(0xf000, 0, ...(ps.length ? [container(0xf001, ps.length, ...bse)] : []), ...(o.defaultProps ? [optRecord(o.defaultProps)] : [])))] : []),
    ...(o.fonts?.length ? [container(0x03fa, 0, container(0x07d5, 0, ...o.fonts.map(fontAtom)))] : []),
    ...(masters.length ? [slwt(1, masters.map((_, i) => persist(100 + i, masterId(i))))] : []),
    slwt(0, o.slides.map((_, i) => persist(2 + i, 256 + i))),
    ...(notesEntries.length ? [slwt(2, notesEntries)] : []));
  const docAt = put(doc);

  // Persist directory: id 1 = document, 2.. = slides, 10.. = notes, 100.. = masters.
  const entries: [number, number][] = [[1, docAt], ...slideAt.map((a, i): [number, number] => [2 + i, a]), ...noteAt.flatMap((a, i): [number, number][] => (a >= 0 ? [[10 + i, a]] : [])), ...masterAt.map((a, i): [number, number] => [100 + i, a])];
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
