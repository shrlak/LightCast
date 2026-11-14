// A reader for legacy binary PowerPoint (.ppt, PowerPoint 97-2003) files: the "PowerPoint Document"
// stream's record tree (MS-PPT), the persist directory that says where each slide currently lives
// (older edits are left in the file by incremental saves), and what each slide holds:
//   text (StyleTextPropAtom runs: bold / italic / underline, size, colour, font, alignment, bullets and
//   indent levels, with the master's TextMasterStyle underneath), the FontCollection, the colour scheme
//   and slide background (solid, shaded, picture), Escher shapes (fill, line, rotation, flips, preset
//   autoshapes, group child coordinate spaces), master / title-master inheritance (placeholder position,
//   size, text frame and style, plus the master's own objects), pictures (JPEG, PNG, DIB, TIFF and the
//   compressed WMF / EMF), slide transitions, hidden slides and speaker notes.
// Not read: animations, tables as such (old tables are groups of rectangles and come through as those),
//   freeform / custom-geometry shapes, auto-numbered bullets (PowerPoint 2002 extension tags), OLE objects.
// Written for hostile input: it never throws, records are bounds-checked, recursion and the number of
// records, slides, shapes and pictures are capped, and what cannot be read is reported in `warnings`.
import { isCfb, readCfb } from './cfb';
import { inflateZlib } from './inflate';
import { each, isContainer, PPT_MAX_DEPTH, PPT_MAX_PICTURES, PPT_MAX_RECORDS, PPT_MAX_SLIDES, T, type Ctx, type Rec, type Scheme, rgbHex } from './pptRecords';
import { customPathOf, fillOf, guessPreset, shadowOf, type ShadowSpec, isBoxType, isLineType, lineOf, P, presetOf, readOpt, rotationOf, SP, type FillSpec, type LineSpec, type Props } from './pptEscher';
import { buildParas, readEnvironmentStyles, readFonts, readMasterStyle, readStyleRuns, type PptPara, type StyleRuns, type TextStyles } from './pptText';

export { PPT_MAX_DEPTH, PPT_MAX_PICTURES, PPT_MAX_RECORDS, PPT_MAX_SLIDES };
export type { PptPara, PptRun } from './pptText';

const MAX_PICTURE_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_CHARS = 5_000_000;
const MAX_SHAPES = 5000;

export interface PptPicture {
  /** The x-emf / x-wmf kinds are Windows metafiles (decompressed); the importer draws them as SVG / PNG. */
  mime: 'image/jpeg' | 'image/png' | 'image/bmp' | 'image/tiff' | 'image/x-emf' | 'image/x-wmf';
  bytes: Uint8Array;
}
export interface PptShape {
  kind: 'text' | 'picture' | 'shape';
  /** Position and size in master units (1/576 inch); undefined when the shape inherits it from the layout and the master has none. */
  x?: number; y?: number; w?: number; h?: number;
  /** Degrees clockwise. */
  rotation?: number;
  flipH?: boolean; flipV?: boolean;
  text?: string;
  /** The styled paragraphs of `text`, one per line (text style of the master underneath, then the paragraph's and run's own). */
  paras?: PptPara[];
  /** TextHeaderAtom type: 0 title, 1 body, 2 notes, 3 notice, 4 other, 5 center body, 6 center title, 7 half body, 8 quarter body. */
  textType?: number;
  /** OEPlaceholderAtom type (master ids 1 title, 2 body, 3 center title, 4 subtitle ...; slide ids 0x0d title, 0x0e body, 0x10 center title, 0x11 subtitle ...); undefined for a plain text box. */
  placeholder?: number;
  /** Picture: 1-based index into `pictures` (0 when the picture could not be read). */
  picture?: number;
  /** Picture crop as fractions cut from each side: left, top, right, bottom. */
  crop?: [number, number, number, number];
  /** The preset autoshape (PowerPoint's preset name) this shape is drawn as; absent for a plain text box. */
  shape?: string;
  fill?: FillSpec;
  line?: LineSpec;
  shadow?: ShadowSpec;
  /** Freeform / custom geometry: SVG path data in a `w`×`h` space that is stretched to the shape's box. */
  path?: { d: string; w: number; h: number };
  /** Text frame: margins left, top, right, bottom in EMU; vertical anchor; false = no word wrap. */
  margins?: [number, number, number, number];
  vAlign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  /** Members of one group share its number. */
  group?: number;
  /** Placed by the master (the master's own object, not a placeholder). */
  master?: boolean;
  /** The position came from the master's placeholder. */
  inherited?: boolean;
}
export type PptBackground =
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number; radial?: boolean }
  | { kind: 'picture'; picture: number };
export interface PptTransition {
  /** SlideShowSlideInfoAtom effect type (0 cut, 1 random, 2 blinds, 3 checker, 4 cover, 5 dissolve, 6 fade, 7 uncover, 8 random bars, 9 strips, 10 wipe, 11 box ...). */
  effect: number;
  /** 0 slow, 1 medium, 2 fast. */
  speed: number;
  /** effectDirection (what it means depends on the effect: 0 left, 1 up, 2 right, 3 down for wipes and pushes). */
  direction?: number;
  /** Advance on a mouse click. */
  onClick: boolean;
  /** Automatic advance after this many milliseconds (0 = none). */
  afterMs: number;
}
export interface PptSlide {
  shapes: PptShape[];
  notes?: string;
  background?: PptBackground;
  hidden?: boolean;
  transition?: PptTransition;
}
export interface PptDocument {
  width: number;
  height: number;
  slides: PptSlide[];
  /** 1-based: pictures[i] is picture i + 1; null for a picture that cannot be shown (damaged, PICT). */
  pictures: (PptPicture | null)[];
  warnings: string[];
}

// ── Text atoms ─────────────────────────────────────────────────────────────────────────────────

function decodeRaw(c: Ctx, r: Rec, wide: boolean): string {
  let s = '';
  if (wide) {
    for (let o = r.pos; o + 2 <= r.end && s.length < MAX_TEXT_CHARS; o += 2) s += String.fromCharCode(c.v.getUint16(o, true));
  } else {
    for (let o = r.pos; o < r.end && s.length < MAX_TEXT_CHARS; o++) s += String.fromCharCode(c.b[o]);
  }
  return s;
}
// \r ends a paragraph, \v is a line break inside one; other control characters (fields, tabs aside) are dropped.
const plain = (raw: string) => raw.replace(/[\r\v\u2028]/g, '\n').replace(/[\u0000-\u0008\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/\n+$/, '');

interface TextItem { type: number; raw: string; style: StyleRuns | null }
const itemText = (i: TextItem) => plain(i.raw);

/** Text atoms from a ClientTextbox / SlideListWithText run: TextHeaderAtom starts an item, chars / bytes atoms fill it, a StyleTextPropAtom styles it. */
function textItems(c: Ctx, from: number, to: number, stopAtPersist = false): TextItem[] {
  const out: TextItem[] = [];
  let cur: TextItem | null = null;
  each(c, from, to, (r) => {
    if (stopAtPersist && r.type === T.SlidePersistAtom) return false;
    if (r.type === T.TextHeader && r.end - r.pos >= 4) { cur = { type: c.v.getUint32(r.pos, true), raw: '', style: null }; out.push(cur); }
    else if (r.type === T.TextChars || r.type === T.TextBytes) {
      const raw = decodeRaw(c, r, r.type === T.TextChars);
      if (cur && !cur.raw) cur.raw = raw;
      else out.push((cur = { type: 4, raw, style: null }));
    } else if (r.type === T.StyleTextProp && cur && !cur.style) cur.style = readStyleRuns(c, r, cur.raw.length);
  });
  return out;
}

// ── Pictures ────────────────────────────────────────────────────────────────────────────────────

function dibToBmp(d: Uint8Array): Uint8Array | null {
  if (d.length < 40) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const hdr = v.getUint32(0, true);
  if (hdr < 12 || hdr > 124 || hdr > d.length) return null;
  const bits = hdr >= 16 ? v.getUint16(14, true) : 0;
  const used = hdr >= 36 ? v.getUint32(32, true) : 0;
  const palette = bits && bits <= 8 ? (used || 1 << bits) * 4 : 0;
  const offset = 14 + hdr + Math.min(palette, 1024 * 4) + (hdr === 40 && hdr + 12 <= d.length && v.getUint32(16, true) === 3 ? 12 : 0);
  const out = new Uint8Array(14 + d.length);
  out.set([0x42, 0x4d]);
  new DataView(out.buffer).setUint32(2, out.length, true);
  new DataView(out.buffer).setUint32(10, offset, true);
  out.set(d, 14);
  return out;
}

/** The picture of a blip record (JPEG, PNG, DIB, TIFF, compressed or plain EMF / WMF); null for PICT and anything unreadable. */
function readBlip(b: Uint8Array, v: DataView, at: number): PptPicture | null {
  if (at < 0 || at + 8 > b.length) return null;
  const inst = v.getUint16(at, true) >> 4;
  const type = v.getUint16(at + 2, true);
  const len = v.getUint32(at + 4, true);
  const pos = at + 8;
  const end = Math.min(pos + len, b.length);
  if (len > MAX_PICTURE_BYTES || end <= pos) return null;
  if (type === 0xf01a || type === 0xf01b) {
    // Metafile blip: UID(s), then 34 bytes (size, bounds, extent, compressed size, compression, filter), then the data.
    const two = (type === 0xf01a && inst === 0x3d5) || (type === 0xf01b && inst === 0x217);
    const hdr = pos + (two ? 32 : 16);
    if (hdr + 34 >= end) return null;
    const size = v.getUint32(hdr, true), saved = v.getUint32(hdr + 28, true), compression = b[hdr + 32];
    const raw = b.subarray(hdr + 34, Math.min(hdr + 34 + saved, end));
    const mime = type === 0xf01a ? 'image/x-emf' : 'image/x-wmf';
    if (compression === 0xfe) return raw.length ? { mime, bytes: raw } : null;
    if (compression !== 0) return null;
    const data = inflateZlib(raw, Math.min(Math.max(size, 1024), MAX_PICTURE_BYTES));
    return data && data.length ? { mime, bytes: data } : null;
  }
  // One 16-byte UID, or two when the instance is the "with secondary UID" variant.
  const two = (type === 0xf01d && inst === 0x46b) || (type === 0xf01d && inst === 0x6e3) || (type === 0xf01e && inst === 0x6e1) || (type === 0xf01f && inst === 0x7a9) || (type === 0xf029 && inst === 0x6e5) || (type === 0xf02a && inst === 0x6e3);
  const start = pos + (two ? 32 : 16) + 1;
  if (start >= end) return null;
  const data = b.subarray(start, end);
  switch (type) {
    case 0xf01d: case 0xf02a: return data[0] === 0xff && data[1] === 0xd8 ? { mime: 'image/jpeg', bytes: data } : null;
    case 0xf01e: return data[0] === 0x89 && data[1] === 0x50 ? { mime: 'image/png', bytes: data } : null;
    case 0xf01f: { const bmp = dibToBmp(data); return bmp ? { mime: 'image/bmp', bytes: bmp } : null; }
    case 0xf029: return { mime: 'image/tiff', bytes: data };
    default: return null; // PICT
  }
}

function readPictures(c: Ctx, doc: Rec | null, pictures: Uint8Array | null): { list: (PptPicture | null)[]; defaults: Props } {
  const out: (PptPicture | null)[] = [];
  const defaults: Props = new Map();
  if (!doc) return { list: out, defaults };
  const bse = (r: Rec) => {
    if (out.length >= PPT_MAX_PICTURES || r.end - r.pos < 36) return;
    const foDelay = c.v.getUint32(r.pos + 28, true);
    const nameLen = c.b[r.pos + 33];
    let pic: PptPicture | null = null;
    // A blip embedded after the header, else one in the Pictures stream.
    if (r.end - r.pos > 36 + nameLen + 8) pic = readBlip(c.b, c.v, r.pos + 36 + nameLen);
    if (!pic && pictures && foDelay !== 0xffffffff) pic = readBlip(pictures, new DataView(pictures.buffer, pictures.byteOffset, pictures.byteLength), foDelay);
    out.push(pic);
  };
  each(c, doc.pos, doc.end, (r) => {
    if (r.type !== T.DrawingGroup) return;
    each(c, r.pos, r.end, (dgg) => {
      if (dgg.type !== T.Dgg) return;
      each(c, dgg.pos, dgg.end, (store) => {
        if (store.type === T.BStore) each(c, store.pos, store.end, (r2) => { if (r2.type === T.BSE) bse(r2); });
        else if (store.type === T.Opt) readOpt(c, store, defaults); // default shape properties of the whole file
      });
    });
  });
  return { list: out, defaults };
}

// ── Shapes ─────────────────────────────────────────────────────────────────────────────────────

interface Placed { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }
type Mapper = (p: Placed) => Placed;
interface Rect { l: number; t: number; r: number; b: number }
const norm = (d: number) => { const r = ((d % 360) + 360) % 360; return Math.round(r * 100) / 100; };

/** The child coordinate space of a group (its Spgr rectangle) laid onto where the group is (`g`, already in slide space). */
function groupMapper(g: Placed, s: Rect | undefined): Mapper {
  const sw = s ? s.r - s.l : 0, sh = s ? s.b - s.t : 0;
  const sx = sw > 0 ? g.w / sw : 1, sy = sh > 0 ? g.h / sh : 1;
  const sl = s && sw > 0 ? s.l : g.x, st = s && sh > 0 ? s.t : g.y;
  const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2;
  const th = (g.rot * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
  return (p) => {
    let cx = g.x + (p.x + p.w / 2 - sl) * sx, cy = g.y + (p.y + p.h / 2 - st) * sy;
    let flipH = p.flipH, flipV = p.flipV, rot = p.rot;
    if (g.flipH) { cx = 2 * gcx - cx; flipH = !flipH; rot = -rot; }
    if (g.flipV) { cy = 2 * gcy - cy; flipV = !flipV; rot = -rot; }
    if (g.rot) { const dx = cx - gcx, dy = cy - gcy; cx = gcx + dx * cos - dy * sin; cy = gcy + dx * sin + dy * cos; }
    const w = p.w * sx, h = p.h * sy;
    return { x: cx - w / 2, y: cy - h / 2, w, h, rot: norm(rot + g.rot), flipH, flipV };
  };
}

interface RawShape {
  props: Props;
  flags: number;
  spType: number;
  /** Position in slide space (master units) once the group mappings are applied. */
  placed?: Placed;
  /** The group's child space rectangle (group shapes only). */
  spgr?: Rect;
  items: TextItem[];
  placeholder?: number;
  group?: number;
}

interface Parsed {
  masterId: number;
  notesId: number;
  /** SlideAtom flags: 0x1 show the master's objects, 0x2 follow the master's colour scheme, 0x4 follow the master's background. */
  flags: number;
  hasAtom: boolean;
  scheme?: Scheme;
  shapes: RawShape[];
  background?: RawShape;
  styles: TextStyles;
  info?: PptTransition & { hidden: boolean };
}

interface DrawState { shapes: RawShape[]; background?: RawShape; defaults: Props; groups: number }

const rectOf = (l: number, t: number, r: number, b: number): Rect => ({ l: Math.min(l, r), t: Math.min(t, b), r: Math.max(l, r), b: Math.max(t, b) });

function readRawShape(c: Ctx, sp: Rec, map: Mapper, st: DrawState, group: number | undefined): RawShape {
  const props: Props = new Map(st.defaults);
  const raw: RawShape = { props, flags: 0, spType: 0, items: [], group };
  let abs: Rect | undefined, child: Rect | undefined;
  each(c, sp.pos, sp.end, (r) => {
    const len = r.end - r.pos;
    if (r.type === T.SpAtom && len >= 8) { raw.spType = r.inst; raw.flags = c.v.getUint32(r.pos + 4, true); }
    else if (r.type === T.SpgrAtom && len >= 16) raw.spgr = rectOf(c.v.getInt32(r.pos, true), c.v.getInt32(r.pos + 4, true), c.v.getInt32(r.pos + 8, true), c.v.getInt32(r.pos + 12, true));
    else if (r.type === T.ClientAnchor) {
      if (len >= 16) abs = rectOf(c.v.getInt32(r.pos + 4, true), c.v.getInt32(r.pos, true), c.v.getInt32(r.pos + 8, true), c.v.getInt32(r.pos + 12, true)); // left, top, right, bottom
      else if (len >= 8) abs = rectOf(c.v.getInt16(r.pos + 2, true), c.v.getInt16(r.pos, true), c.v.getInt16(r.pos + 4, true), c.v.getInt16(r.pos + 6, true));
    } else if (r.type === T.ChildAnchor && len >= 16) child = rectOf(c.v.getInt32(r.pos, true), c.v.getInt32(r.pos + 4, true), c.v.getInt32(r.pos + 8, true), c.v.getInt32(r.pos + 12, true));
    else if (r.type === T.ClientTextbox) raw.items = textItems(c, r.pos, r.end);
    else if (r.type === T.ClientData) {
      each(c, r.pos, r.end, (d) => { if (d.type === T.OEPlaceholder && d.end - d.pos >= 5) raw.placeholder = c.b[d.pos + 4]; });
    } else if (r.type === T.Opt || r.type === T.SecondaryOpt || r.type === T.TertiaryOpt) readOpt(c, r, props);
  });
  const rect = abs ?? child;
  if (rect && (rect.r > rect.l || rect.b > rect.t)) {
    const p: Placed = { x: rect.l, y: rect.t, w: rect.r - rect.l, h: rect.b - rect.t, rot: rotationOf(props), flipH: (raw.flags & SP.flipH) !== 0, flipV: (raw.flags & SP.flipV) !== 0 };
    raw.placed = abs ? p : map(p);
  }
  return raw;
}

function walkDrawing(c: Ctx, from: number, to: number, depth: number, map: Mapper, st: DrawState, group: number | undefined) {
  if (depth > PPT_MAX_DEPTH) { c.warnings.add('겹친 개체가 너무 깊어 일부를 건너뛰었습니다.'); return; }
  each(c, from, to, (r) => {
    if (st.shapes.length >= MAX_SHAPES) return false;
    if (r.type === T.Spgr && isContainer(r)) readGroup(c, r, depth + 1, map, st, group);
    else if (r.type === T.Sp && isContainer(r)) addShape(c, r, map, st, group);
    else if (isContainer(r)) walkDrawing(c, r.pos, r.end, depth + 1, map, st, group);
  });
}

function addShape(c: Ctx, sp: Rec, map: Mapper, st: DrawState, group: number | undefined) {
  const raw = readRawShape(c, sp, map, st, group);
  if (raw.flags & SP.deleted) return;
  if (raw.flags & SP.background) { st.background ??= raw; return; }
  st.shapes.push(raw);
}

/** A group container: its first shape is the group itself (anchor, child space, rotation), the rest are its members. */
function readGroup(c: Ctx, g: Rec, depth: number, map: Mapper, st: DrawState, group: number | undefined) {
  if (depth > PPT_MAX_DEPTH) { c.warnings.add('겹친 개체가 너무 깊어 일부를 건너뛰었습니다.'); return; }
  let inner = map;
  let gid = group;
  let first = true;
  each(c, g.pos, g.end, (r) => {
    if (st.shapes.length >= MAX_SHAPES) return false;
    if (first) {
      first = false;
      if (r.type === T.Sp && isContainer(r)) {
        const head = readRawShape(c, r, map, st, group);
        if (!(head.flags & SP.patriarch)) {
          if (head.placed) inner = groupMapper(head.placed, head.spgr);
          gid = group ?? ++st.groups;
        }
        return;
      }
    }
    if (r.type === T.Spgr && isContainer(r)) readGroup(c, r, depth + 1, inner, st, gid);
    else if (r.type === T.Sp && isContainer(r)) addShape(c, r, inner, st, gid);
    else if (isContainer(r)) walkDrawing(c, r.pos, r.end, depth + 1, inner, st, gid);
  });
}

// ── Slides and masters ─────────────────────────────────────────────────────────────────────────

const SLIDE_TYPES = new Set<number>([T.Slide, T.Notes, T.MainMaster]);

function readSchemeAtom(c: Ctx, r: Rec): Scheme | undefined {
  if (r.end - r.pos < 32) return undefined;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) out.push(rgbHex(c.b[r.pos + i * 4], c.b[r.pos + i * 4 + 1], c.b[r.pos + i * 4 + 2]));
  return out;
}

/** Slide, notes or master container at a stream offset. */
function readContainer(c: Ctx, at: number, defaults: Props): Parsed | null {
  if (at < 0 || at + 8 > c.b.length) return null;
  const parsed: Parsed = { masterId: 0, notesId: 0, flags: 0x7, hasAtom: false, shapes: [], styles: new Map() };
  const st: DrawState = { shapes: parsed.shapes, defaults, groups: 0 };
  let ok = false;
  let anyScheme: Scheme | undefined;
  each(c, at, at + 8 + c.v.getUint32(at + 4, true), (r) => {
    if (!SLIDE_TYPES.has(r.type)) return false;
    ok = true;
    each(c, r.pos, r.end, (k) => {
      if (k.type === T.SlideAtom && k.end - k.pos >= 20) {
        parsed.hasAtom = true;
        parsed.masterId = c.v.getUint32(k.pos + 12, true);
        parsed.notesId = c.v.getUint32(k.pos + 16, true);
        if (k.end - k.pos >= 22) parsed.flags = c.v.getUint16(k.pos + 20, true);
      } else if (k.type === T.PPDrawing) walkDrawing(c, k.pos, k.end, 0, (p) => p, st, undefined);
      else if (k.type === T.ColorSchemeAtom) {
        const s = readSchemeAtom(c, k);
        if (k.inst === 6 && s) parsed.scheme = s; // the slide's own scheme
        anyScheme ??= s;
      } else if (k.type === T.TextMasterStyle) {
        const ms = readMasterStyle(c, k);
        if (ms && !parsed.styles.has(ms.type)) parsed.styles.set(ms.type, ms.levels);
      }
      else if (k.type === T.SlideShowSlideInfo && k.end - k.pos >= 12) {
        const flags = c.v.getUint16(k.pos + 10, true);
        parsed.info = { effect: c.b[k.pos + 9], direction: c.b[k.pos + 8], speed: k.end - k.pos >= 13 ? c.b[k.pos + 12] : 1, onClick: (flags & 0x1) !== 0, afterMs: (flags & 0x400) !== 0 ? Math.max(0, c.v.getInt32(k.pos, true)) : 0, hidden: (flags & 0x4) !== 0 };
      }
    });
    return false;
  });
  parsed.scheme ??= anyScheme;
  parsed.background = st.background;
  return ok ? parsed : null;
}

interface Persist { persistId: number; slideId: number; items: TextItem[] }
/** SlideListWithText of one kind (0 slides, 1 masters, 2 notes): its SlidePersistAtoms with the text that follows each. */
function readList(c: Ctx, doc: Rec, kind: number): Persist[] {
  const out: Persist[] = [];
  each(c, doc.pos, doc.end, (r) => {
    if (r.type !== T.SlideListWithText || r.inst !== kind) return;
    each(c, r.pos, r.end, (p) => {
      if (p.type !== T.SlidePersistAtom || p.end - p.pos < 16 || out.length >= PPT_MAX_SLIDES) return;
      out.push({ persistId: c.v.getUint32(p.pos, true), slideId: c.v.getUint32(p.pos + 12, true), items: kind === 0 ? textItems(c, p.end, r.end, true) : [] });
    });
  });
  return out;
}

/** persistId → stream offset, newest edit first, from the Current User stream's edit chain. */
function persistDirectory(c: Ctx, currentUser: Uint8Array | null): { map: Map<number, number>; docId: number } | 'encrypted' | null {
  if (!currentUser || currentUser.length < 20) return null;
  const token = new DataView(currentUser.buffer, currentUser.byteOffset, currentUser.byteLength).getUint32(12, true);
  if (token === 0xf3d1c4df) return 'encrypted';
  let edit = new DataView(currentUser.buffer, currentUser.byteOffset, currentUser.byteLength).getUint32(16, true);
  const map = new Map<number, number>();
  let docId = 0;
  const seen = new Set<number>();
  for (let n = 0; n < 4096 && edit + 8 + 20 <= c.b.length && !seen.has(edit); n++) {
    seen.add(edit);
    if (c.v.getUint16(edit + 2, true) !== T.UserEdit) break;
    const pos = edit + 8;
    const last = c.v.getUint32(pos + 8, true);
    const dir = c.v.getUint32(pos + 12, true);
    if (!docId) docId = c.v.getUint32(pos + 16, true);
    if (dir + 8 <= c.b.length && c.v.getUint16(dir + 2, true) === T.PersistDirectory) {
      const end = Math.min(dir + 8 + c.v.getUint32(dir + 4, true), c.b.length);
      for (let o = dir + 8; o + 4 <= end && map.size < 2_000_000;) {
        const h = c.v.getUint32(o, true);
        const first = h & 0xfffff, count = h >>> 20;
        o += 4;
        for (let i = 0; i < count && o + 4 <= end; i++, o += 4) if (!map.has(first + i)) map.set(first + i, c.v.getUint32(o, true));
      }
    }
    if (!last || last === edit) break;
    edit = last;
  }
  return map.size ? { map, docId } : null;
}

// ── Raw shapes → PptShapes ─────────────────────────────────────────────────────────────────────

/** A slide placeholder type → the master placeholder types whose position and style it takes, best first. */
const MASTER_OF: Record<number, number[]> = {
  0x0d: [1], 0x10: [3, 1], 0x11: [4, 2], 0x0e: [2], 0x0f: [2], 0x12: [1], 0x13: [2], 0x14: [2], 0x15: [2], 0x16: [2], 0x17: [2], 0x18: [2], 0x19: [2], 0x1a: [2], 0x1b: [2],
  3: [3, 1], 4: [4, 2],
};

interface Env {
  scheme?: Scheme;
  styles?: TextStyles;
  fallback?: TextStyles;
  fonts: string[];
  /** The master's shapes, for placeholder inheritance. */
  master?: RawShape[];
  pictureCount: number;
}

function masterPlaceholder(env: Env, ph: number): RawShape | undefined {
  for (const t of MASTER_OF[ph] ?? [ph]) {
    const m = env.master?.find((s) => s.placeholder === t);
    if (m) return m;
  }
  return undefined;
}

const MARGIN = [91440, 45720, 91440, 45720];

function finishShape(raw: RawShape, env: Env, c: Ctx): PptShape | null {
  const mp = raw.placeholder !== undefined ? masterPlaceholder(env, raw.placeholder) : undefined;
  const props: Props = mp ? new Map([...mp.props, ...raw.props]) : raw.props;
  const placed = raw.placed ?? mp?.placed;
  const spType = raw.spType || (mp?.spType ?? 0);
  const preset = presetOf(spType);
  const geom: Partial<PptShape> = placed ? { x: placed.x, y: placed.y, w: placed.w, h: placed.h } : {};
  if (placed?.rot) geom.rotation = placed.rot;
  if (raw.placed?.flipH) geom.flipH = true;
  if (raw.placed?.flipV) geom.flipV = true;
  if (!raw.placed && placed) geom.inherited = true;
  const base: Partial<PptShape> = { ...geom, ...(raw.placeholder !== undefined ? { placeholder: raw.placeholder } : {}), ...(raw.group ? { group: raw.group } : {}) };

  const textEnv = { styles: env.styles, fallback: env.fallback, fonts: env.fonts, scheme: env.scheme };
  const paras: PptPara[] = [];
  for (const i of raw.items) if (itemText(i).trim()) paras.push(...buildParas(i.raw, i.style, i.type, textEnv));
  const text = paras.map((p) => p.text).join('\n');
  const textType = raw.items[0]?.type;
  const custom = !preset && raw.placeholder === undefined ? customPathOf(raw.props, placed && placed.h > 0 ? placed.w / placed.h : undefined) : null;
  let fill = fillOf(props, env.scheme);
  let line = lineOf(props, env.scheme, isLineType(spType));
  if (custom?.noFill) fill = undefined;
  if (custom?.noLine) line = undefined;
  const shadow = fill || line || (props.get(P.pib) ?? 0) > 0 ? shadowOf(props, env.scheme) : undefined;
  if (shadow) base.shadow = shadow;
  const pib = props.get(P.pib) ?? 0;
  const frame: Partial<PptShape> = {};
  const m = [P.textLeft, P.textTop, P.textRight, P.textBottom].map((id, k) => props.get(id) ?? MARGIN[k]);
  if (m.some((v, k) => v !== MARGIN[k])) frame.margins = m as [number, number, number, number];
  const anchor = props.get(P.anchorText);
  if (anchor !== undefined) frame.vAlign = anchor === 1 || anchor === 4 || anchor === 7 ? 'middle' : anchor === 2 || anchor === 5 || anchor === 8 ? 'bottom' : 'top';
  if (props.get(P.wrapText) === 2) frame.wrap = false;

  if (text.trim()) {
    const out: PptShape = { kind: 'text', ...base, text, paras, textType, ...frame };
    if (fill) out.fill = fill;
    if (line) out.line = line;
    if (preset && !isBoxType(spType) && !isLineType(spType) && raw.placeholder === undefined) out.shape = preset;
    else if (custom) out.path = { d: custom.path, w: custom.w, h: custom.h };
    else if (!preset && raw.placeholder === undefined && (fill || line)) { const g = guessPreset(raw.props); if (g) out.shape = g; }
    return out;
  }
  if (pib > 0 && !isLineType(spType)) {
    const out: PptShape = { kind: 'picture', ...base, picture: pib <= env.pictureCount ? pib : 0 };
    const crop = [P.cropLeft, P.cropTop, P.cropRight, P.cropBottom].map((id) => Math.max(0, Math.min(0.95, (props.get(id) ?? 0) / 65536)));
    if (crop.some((v) => v > 0.001)) out.crop = crop as [number, number, number, number];
    if (line) out.line = line;
    return out;
  }
  // An empty placeholder carries no text but marks where the layout's text would be (kept for the master lookup, dropped later).
  if (raw.placeholder !== undefined) return { kind: 'text', ...base, text: '', ...frame };
  if (custom && (fill || line)) return { kind: 'shape', ...base, path: { d: custom.path, w: custom.w, h: custom.h }, ...(fill ? { fill } : {}), ...(line ? { line } : {}) };
  if (!preset) {
    if (!fill && !line) return null;
    c.warnings.add('일부 도형(자유형 등)은 사각형으로 바꿔 가져왔습니다.');
    return { kind: 'shape', ...base, shape: guessPreset(raw.props) ?? 'rect', ...(fill ? { fill } : {}), ...(line ? { line } : {}) };
  }
  if (isLineType(spType)) return line ? { kind: 'shape', ...base, shape: 'line', line } : null;
  if (!fill && !line) return null;
  return { kind: 'shape', ...base, shape: preset, ...(fill ? { fill } : {}), ...(line ? { line } : {}) };
}

function backgroundOf(parsed: Parsed, master: Parsed | undefined, scheme: Scheme | undefined, pictureCount: number): PptBackground | undefined {
  const spec = (p: Parsed | undefined): FillSpec | undefined => (p?.background ? fillOf(p.background.props, scheme) : undefined);
  const own = spec(parsed);
  const inherited = spec(master);
  // A slide that follows the master's background (flag 0x4) takes the master's even when it carries a stale one of its own.
  const follow = parsed.hasAtom && (parsed.flags & 0x4) !== 0;
  const pick = follow ? inherited ?? own : own ?? inherited;
  const bg = pick && !pick.background ? pick : undefined;
  if (bg?.picture) return bg.picture <= pictureCount ? { kind: 'picture', picture: bg.picture } : undefined;
  if (bg?.gradient) return { kind: 'gradient', ...bg.gradient };
  if (bg?.color) return { kind: 'color', color: bg.color };
  return scheme?.[0] ? { kind: 'color', color: scheme[0] } : undefined;
}

const empty = (warnings: string[]): PptDocument => ({ width: 5760, height: 4320, slides: [], pictures: [], warnings });

/** Read a .ppt file. Never throws: an unreadable file gives no slides and a Korean warning. */
export function parsePpt(bytes: Uint8Array): PptDocument {
  try {
    return parse(bytes);
  } catch {
    return empty(['PPT 파일을 읽는 중 문제가 생겼습니다.']);
  }
}

function parse(bytes: Uint8Array): PptDocument {
  if (!isCfb(bytes)) return empty(['PowerPoint 97-2003 형식(.ppt) 파일이 아닙니다.']);
  const cfb = readCfb(bytes);
  const stream = cfb?.stream('PowerPoint Document');
  if (!cfb || !stream || stream.length < 8) return empty(['PowerPoint 문서 스트림을 찾지 못했습니다.']);
  const c: Ctx = { b: stream, v: new DataView(stream.buffer, stream.byteOffset, stream.byteLength), budget: PPT_MAX_RECORDS, warnings: new Set() };

  const dir = persistDirectory(c, cfb.stream('Current User'));
  if (dir === 'encrypted') return empty(['암호로 보호된 PPT 파일은 가져올 수 없습니다. PowerPoint에서 암호를 해제하고 저장해 주세요.']);

  // The document container: through the persist directory, else the first one in the stream.
  let doc: Rec | null = null;
  const docAt = dir ? dir.map.get(dir.docId) : undefined;
  if (docAt !== undefined && docAt + 8 <= stream.length && c.v.getUint16(docAt + 2, true) === T.Document) {
    doc = { ver: 0xf, inst: 0, type: T.Document, pos: docAt + 8, end: Math.min(docAt + 8 + c.v.getUint32(docAt + 4, true), stream.length) };
  } else {
    each(c, 0, stream.length, (r) => { if (r.type === T.Document) { doc = r; return false; } });
    if (dir) c.warnings.add('편집 기록을 읽지 못해 파일에 남은 순서대로 읽었습니다.');
  }
  if (!doc) return empty(['PowerPoint 문서 정보를 찾지 못했습니다.', ...c.warnings]);
  const document: Rec = doc;

  let width = 5760, height = 4320;
  each(c, document.pos, document.end, (r) => {
    if (r.type === T.DocumentAtom && r.end - r.pos >= 8) {
      const w = c.v.getInt32(r.pos, true), h = c.v.getInt32(r.pos + 4, true);
      if (w >= 576 && h >= 576 && w <= 576 * 400 && h <= 576 * 400) { width = w; height = h; }
    }
    return r.type === T.DocumentAtom ? false : undefined;
  });

  const { list: pictures, defaults } = readPictures(c, document, cfb.stream('Pictures'));
  const fonts = readFonts(c, document);
  const fallback = readEnvironmentStyles(c, document);
  const slideList = readList(c, document, 0);
  const masterList = readList(c, document, 1);
  const noteList = readList(c, document, 2);

  // Masters (main and title) by their id, read once.
  const masters = new Map<number, Parsed | null>();
  const masterOf = (id: number): Parsed | undefined => {
    if (!id || !dir) return undefined;
    if (!masters.has(id)) {
      const entry = masterList.find((m) => m.slideId === id);
      const at = entry ? dir.map.get(entry.persistId) : undefined;
      masters.set(id, at !== undefined ? readContainer(c, at, defaults) : null);
    }
    return masters.get(id) ?? undefined;
  };

  const slides: PptSlide[] = [];
  const noteTextOf = (notesId: number): string | undefined => {
    if (!notesId) return undefined;
    const entry = noteList.find((n) => n.slideId === notesId);
    if (!entry) return undefined;
    const at = dir?.map.get(entry.persistId);
    const parsed = at !== undefined ? readContainer(c, at, defaults) : null;
    const fromShapes = parsed?.shapes.flatMap((s) => s.items.filter((i) => i.type === 2).map(itemText)).filter(Boolean).join('\n');
    const text = fromShapes || entry.items.filter((i) => i.type === 2).map(itemText).join('\n');
    return text.trim() || undefined;
  };

  const toSlide = (parsed: Parsed | null, entryItems: TextItem[]): PptSlide => {
    const master = parsed ? masterOf(parsed.masterId) : undefined;
    const followScheme = parsed && parsed.hasAtom && (parsed.flags & 0x2) !== 0;
    const scheme = followScheme ? master?.scheme ?? parsed?.scheme : parsed?.scheme ?? master?.scheme;
    const styles = master?.styles.size ? master.styles : [...masters.values()].find((m) => m?.styles.size)?.styles;
    const env: Env = { scheme, styles, fallback, fonts, master: master?.shapes, pictureCount: pictures.length };
    const shapes: PptShape[] = [];
    // The master's own objects (logos, bands, plain text) sit under the slide's, unless the slide hides them.
    if (master && (!parsed?.hasAtom || (parsed.flags & 0x1) !== 0)) {
      for (const raw of master.shapes) {
        if (raw.placeholder !== undefined) continue;
        const s = finishShape(raw, { ...env, master: undefined, styles: master.styles.size ? master.styles : styles }, c);
        if (s && !(s.kind === 'text' && !s.text)) shapes.push({ ...s, master: true });
      }
    }
    for (const raw of parsed?.shapes ?? []) {
      const s = finishShape(raw, env, c);
      if (s && !(s.kind === 'text' && !s.text?.trim() && !s.fill && !s.line)) shapes.push(s);
    }
    // Text kept only in the slide list (outline text) when the slide's own boxes have none.
    if (!shapes.some((s) => s.kind === 'text' && s.text) && entryItems.some((i) => itemText(i).trim())) {
      for (const i of entryItems) {
        if (!itemText(i).trim()) continue;
        const paras = buildParas(i.raw, i.style, i.type, { styles, fallback, fonts, scheme });
        shapes.push({ kind: 'text', text: paras.map((p) => p.text).join('\n'), paras, textType: i.type, placeholder: i.type === 0 || i.type === 6 ? 1 : 2 });
      }
    }
    const slide: PptSlide = { shapes };
    if (parsed) {
      const background = backgroundOf(parsed, master, scheme, pictures.length);
      if (background) slide.background = background;
      if (parsed.info?.hidden) slide.hidden = true;
      if (parsed.info && (parsed.info.effect > 0 || parsed.info.afterMs > 0 || !parsed.info.onClick)) {
        const { effect, direction, speed, onClick, afterMs } = parsed.info;
        slide.transition = { effect, direction, speed, onClick, afterMs };
      }
    }
    return slide;
  };

  if (dir && slideList.length) {
    for (const entry of slideList.slice(0, PPT_MAX_SLIDES)) {
      const at = dir.map.get(entry.persistId);
      const parsed = at !== undefined ? readContainer(c, at, defaults) : null;
      const slide = toSlide(parsed, entry.items);
      const notes = parsed ? noteTextOf(parsed.notesId) : undefined;
      if (notes) slide.notes = notes;
      slides.push(slide);
    }
  } else {
    // No persist directory: every slide container in stream order (no masters, no notes).
    each(c, 0, stream.length, (r) => {
      if (r.type !== T.Slide || slides.length >= PPT_MAX_SLIDES) return;
      const parsed = readContainer(c, r.pos - 8, defaults);
      if (parsed) slides.push(toSlide(parsed, []));
    });
    if (!slides.length && slideList.length) for (const e of slideList) slides.push(toSlide(null, e.items));
  }
  if (!slides.length) c.warnings.add('슬라이드를 찾지 못했습니다.');
  if (pictures.some((p) => !p)) c.warnings.add('일부 그림(벡터 그림 등)은 가져오지 못했습니다.');
  return { width, height, slides, pictures, warnings: [...c.warnings] };
}

