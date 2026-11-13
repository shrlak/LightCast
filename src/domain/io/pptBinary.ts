// A reader for legacy binary PowerPoint (.ppt, PowerPoint 97-2003) files: the "PowerPoint Document"
// stream's record tree (MS-PPT), the persist directory that says where each slide currently lives
// (older edits are left in the file by incremental saves), the slides' text boxes and placeholders,
// speaker notes and the pictures of the "Pictures" stream. Text and pictures only — no themes,
// animations or vector art. Written for hostile input: it never throws, records are bounds-checked,
// recursion and the number of records, slides and pictures are capped, and what cannot be read is
// reported in `warnings` instead.
import { isCfb, readCfb } from './cfb';

export const PPT_MAX_RECORDS = 400_000;
export const PPT_MAX_DEPTH = 24;
export const PPT_MAX_SLIDES = 2000;
export const PPT_MAX_PICTURES = 2000;
const MAX_PICTURE_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_CHARS = 5_000_000;

export interface PptPicture { mime: 'image/jpeg' | 'image/png' | 'image/bmp' | 'image/tiff'; bytes: Uint8Array }
export interface PptShape {
  kind: 'text' | 'picture';
  /** Position and size in master units (1/576 inch); undefined when the shape inherits it from the layout. */
  x?: number; y?: number; w?: number; h?: number;
  text?: string;
  /** TextHeaderAtom type: 0 title, 1 body, 2 notes, 3 notice, 4 other, 5 center body, 6 center title, 7 half body, 8 quarter body. */
  textType?: number;
  /** OEPlaceholderAtom type (1 title, 2 body, 3 center title, 4 subtitle, ...); undefined for a plain text box. */
  placeholder?: number;
  /** Picture: 1-based index into `pictures` (0 when the picture could not be read). */
  picture?: number;
}
export interface PptSlide { shapes: PptShape[]; notes?: string }
export interface PptDocument {
  width: number;
  height: number;
  slides: PptSlide[];
  /** 1-based: pictures[i] is picture i + 1; null for a picture that cannot be shown (metafile, damaged). */
  pictures: (PptPicture | null)[];
  warnings: string[];
}

interface Rec { ver: number; inst: number; type: number; pos: number; end: number }
interface Ctx { b: Uint8Array; v: DataView; budget: number; warnings: Set<string> }

const T = {
  Document: 0x03e8, DocumentAtom: 0x03e9, Slide: 0x03ee, SlideAtom: 0x03ef, Notes: 0x03f0, SlideListWithText: 0x0ff0,
  SlidePersistAtom: 0x03f3, PPDrawing: 0x040c, DrawingGroup: 0x040b, UserEdit: 0x0ff5, PersistDirectory: 0x1772,
  TextHeader: 0x0f9f, TextChars: 0x0fa0, TextBytes: 0x0fa8, OEPlaceholder: 0x0bc3,
  Dgg: 0xf000, BStore: 0xf001, Dg: 0xf002, Spgr: 0xf003, Sp: 0xf004, SpAtom: 0xf00a, Opt: 0xf00b, ClientTextbox: 0xf00d, ClientAnchor: 0xf010, ClientData: 0xf011, ChildAnchor: 0xf00f, BSE: 0xf007,
};

/** The records between two offsets. `f` returns false to stop. Never reads outside [from, to). */
function each(c: Ctx, from: number, to: number, f: (r: Rec) => boolean | void) {
  let o = from;
  to = Math.min(to, c.b.length);
  while (o >= 0 && o + 8 <= to) {
    if (--c.budget < 0) { c.warnings.add('파일이 너무 복잡해 일부만 읽었습니다.'); return; }
    const verInst = c.v.getUint16(o, true);
    const type = c.v.getUint16(o + 2, true);
    const len = c.v.getUint32(o + 4, true);
    const pos = o + 8;
    const end = Math.min(pos + len, to);
    if (f({ ver: verInst & 0xf, inst: verInst >> 4, type, pos, end }) === false) return;
    if (pos + len > to) return;
    o = pos + len;
  }
}
const isContainer = (r: Rec) => r.ver === 0xf;

function decodeText(c: Ctx, r: Rec, wide: boolean): string {
  let s = '';
  if (wide) {
    for (let o = r.pos; o + 2 <= r.end && s.length < MAX_TEXT_CHARS; o += 2) s += String.fromCharCode(c.v.getUint16(o, true));
  } else {
    for (let o = r.pos; o < r.end && s.length < MAX_TEXT_CHARS; o++) s += String.fromCharCode(c.b[o]);
  }
  // \r ends a paragraph, \v is a line break inside one; other control characters (fields, tabs aside) are dropped.
  return s.replace(/[\r\v\u2028]/g, '\n').replace(/[\u0000-\u0008\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/\n+$/, '');
}

interface TextItem { type: number; text: string }

/** Text atoms from a ClientTextbox / SlideListWithText run: TextHeaderAtom starts an item, chars / bytes atoms fill it. */
function textItems(c: Ctx, from: number, to: number, stopAtPersist = false): TextItem[] {
  const out: TextItem[] = [];
  let cur: TextItem | null = null;
  each(c, from, to, (r) => {
    if (stopAtPersist && r.type === T.SlidePersistAtom) return false;
    if (r.type === T.TextHeader && r.end - r.pos >= 4) { cur = { type: c.v.getUint32(r.pos, true), text: '' }; out.push(cur); }
    else if (r.type === T.TextChars || r.type === T.TextBytes) {
      const text = decodeText(c, r, r.type === T.TextChars);
      if (cur && !cur.text) cur.text = text;
      else out.push((cur = { type: 4, text }));
    }
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

/** The picture of a blip record (JPEG, PNG, DIB, TIFF); null for metafiles and anything unreadable. */
function readBlip(c: Ctx, b: Uint8Array, v: DataView, at: number): PptPicture | null {
  if (at < 0 || at + 8 > b.length) return null;
  const inst = v.getUint16(at, true) >> 4;
  const type = v.getUint16(at + 2, true);
  const len = v.getUint32(at + 4, true);
  const pos = at + 8;
  const end = Math.min(pos + len, b.length);
  if (len > MAX_PICTURE_BYTES || end <= pos) return null;
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
    default: void c; return null; // EMF / WMF / PICT
  }
}

function readPictures(c: Ctx, doc: Rec | null, pictures: Uint8Array | null): (PptPicture | null)[] {
  const out: (PptPicture | null)[] = [];
  if (!doc) return out;
  const bse = (r: Rec) => {
    if (out.length >= PPT_MAX_PICTURES || r.end - r.pos < 36) return;
    const foDelay = c.v.getUint32(r.pos + 28, true);
    const nameLen = c.b[r.pos + 33];
    let pic: PptPicture | null = null;
    // A blip embedded after the header, else one in the Pictures stream.
    if (r.end - r.pos > 36 + nameLen + 8) pic = readBlip(c, c.b, c.v, r.pos + 36 + nameLen);
    if (!pic && pictures && foDelay !== 0xffffffff) pic = readBlip(c, pictures, new DataView(pictures.buffer, pictures.byteOffset, pictures.byteLength), foDelay);
    out.push(pic);
  };
  each(c, doc.pos, doc.end, (r) => {
    if (r.type !== T.DrawingGroup) return;
    each(c, r.pos, r.end, (dgg) => {
      if (dgg.type !== T.Dgg) return;
      each(c, dgg.pos, dgg.end, (store) => {
        if (store.type !== T.BStore) return;
        each(c, store.pos, store.end, (r2) => { if (r2.type === T.BSE) bse(r2); });
      });
    });
  });
  return out;
}

// ── Slides ─────────────────────────────────────────────────────────────────────────────────────

/** Shapes of a PPDrawing: text boxes, placeholders and pictures, in drawing order. */
function readShapes(c: Ctx, from: number, to: number, depth: number, out: PptShape[], pictureCount: number) {
  if (depth > PPT_MAX_DEPTH) { c.warnings.add('겹친 개체가 너무 깊어 일부를 건너뛰었습니다.'); return; }
  each(c, from, to, (r) => {
    if (r.type === T.Sp && isContainer(r)) {
      if (out.length < 5000) {
        const s = readShape(c, r, pictureCount);
        if (s) out.push(s);
      }
    } else if (isContainer(r)) readShapes(c, r.pos, r.end, depth + 1, out, pictureCount);
  });
}

function readShape(c: Ctx, sp: Rec, pictureCount: number): PptShape | null {
  let anchor: [number, number, number, number] | null = null;
  let child: [number, number, number, number] | null = null;
  let items: TextItem[] = [];
  let placeholder: number | undefined;
  let pib = 0;
  let background = false;
  each(c, sp.pos, sp.end, (r) => {
    const len = r.end - r.pos;
    if (r.type === T.SpAtom && len >= 8) background = (c.v.getUint32(r.pos + 4, true) & 0x400) !== 0; // fBackground
    else if (r.type === T.ClientAnchor) {
      if (len >= 16) anchor = [c.v.getInt32(r.pos + 4, true), c.v.getInt32(r.pos, true), c.v.getInt32(r.pos + 8, true), c.v.getInt32(r.pos + 12, true)]; // left, top, right, bottom
      else if (len >= 8) anchor = [c.v.getInt16(r.pos + 2, true), c.v.getInt16(r.pos, true), c.v.getInt16(r.pos + 4, true), c.v.getInt16(r.pos + 6, true)];
    } else if (r.type === T.ChildAnchor && len >= 16) {
      child = [c.v.getInt32(r.pos, true), c.v.getInt32(r.pos + 4, true), c.v.getInt32(r.pos + 8, true), c.v.getInt32(r.pos + 12, true)];
    } else if (r.type === T.ClientTextbox) items = textItems(c, r.pos, r.end);
    else if (r.type === T.ClientData) {
      each(c, r.pos, r.end, (d) => { if (d.type === T.OEPlaceholder && d.end - d.pos >= 5) placeholder = c.b[d.pos + 4]; });
    } else if (r.type === T.Opt) {
      for (let i = 0; i < r.inst && r.pos + (i + 1) * 6 <= r.end; i++) {
        const id = c.v.getUint16(r.pos + i * 6, true) & 0x3fff;
        if (id === 0x104) pib = c.v.getInt32(r.pos + i * 6 + 2, true);
      }
    }
  });
  if (background) return null;
  const rect = anchor ?? child;
  const geom = rect && rect[2] > rect[0] && rect[3] > rect[1] ? { x: rect[0], y: rect[1], w: rect[2] - rect[0], h: rect[3] - rect[1] } : {};
  const text = items.map((i) => i.text).filter(Boolean).join('\n');
  if (text.trim()) return { kind: 'text', ...geom, text, textType: items[0]?.type, placeholder };
  if (pib > 0) return { kind: 'picture', ...geom, picture: pib <= pictureCount ? pib : 0 };
  // An empty placeholder carries no text but marks where the layout's text would be: nothing to import.
  return null;
}

/** Slide container → its notes id and shapes. */
function readSlide(c: Ctx, at: number, pictureCount: number): { notesId: number; shapes: PptShape[] } | null {
  if (at < 0 || at + 8 > c.b.length) return null;
  let notesId = 0;
  const shapes: PptShape[] = [];
  let ok = false;
  each(c, at, at + 8 + c.v.getUint32(at + 4, true), (r) => {
    if (r.type !== T.Slide && r.type !== T.Notes) return false;
    ok = true;
    each(c, r.pos, r.end, (k) => {
      if (k.type === T.SlideAtom && k.end - k.pos >= 20) notesId = c.v.getUint32(k.pos + 16, true);
      else if (k.type === T.PPDrawing) readShapes(c, k.pos, k.end, 0, shapes, pictureCount);
    });
    return false;
  });
  return ok ? { notesId, shapes } : null;
}

interface Persist { persistId: number; slideId: number; items: TextItem[] }
/** SlideListWithText of one kind (0 slides, 2 notes): its SlidePersistAtoms with the text that follows each. */
function readList(c: Ctx, doc: Rec, kind: number): Persist[] {
  const out: Persist[] = [];
  each(c, doc.pos, doc.end, (r) => {
    if (r.type !== T.SlideListWithText || r.inst !== kind) return;
    each(c, r.pos, r.end, (p) => {
      if (p.type !== T.SlidePersistAtom || p.end - p.pos < 16 || out.length >= PPT_MAX_SLIDES) return;
      out.push({ persistId: c.v.getUint32(p.pos, true), slideId: c.v.getUint32(p.pos + 12, true), items: textItems(c, p.end, r.end, true) });
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

  const pictures = readPictures(c, document, cfb.stream('Pictures'));
  const slideList = readList(c, document, 0);
  const noteList = readList(c, document, 2);

  const slides: PptSlide[] = [];
  const noteTextOf = (notesId: number): string | undefined => {
    if (!notesId) return undefined;
    const entry = noteList.find((n) => n.slideId === notesId);
    if (!entry) return undefined;
    const at = dir?.map.get(entry.persistId);
    const parsed = at !== undefined ? readSlide(c, at, pictures.length) : null;
    const fromShapes = parsed?.shapes.filter((s) => s.kind === 'text' && s.textType === 2).map((s) => s.text).join('\n');
    const text = fromShapes || entry.items.filter((i) => i.type === 2).map((i) => i.text).join('\n');
    return text.trim() || undefined;
  };

  if (dir && slideList.length) {
    for (const entry of slideList.slice(0, PPT_MAX_SLIDES)) {
      const at = dir.map.get(entry.persistId);
      const parsed = at !== undefined ? readSlide(c, at, pictures.length) : null;
      let shapes = parsed?.shapes ?? [];
      // Text kept only in the slide list (outline text) when the slide's own boxes have none.
      if (!shapes.some((s) => s.kind === 'text') && entry.items.some((i) => i.text.trim())) {
        shapes = [...shapes, ...entry.items.filter((i) => i.text.trim()).map((i): PptShape => ({ kind: 'text', text: i.text, textType: i.type, placeholder: i.type === 0 || i.type === 6 ? 1 : 2 }))];
      }
      slides.push({ shapes, notes: parsed ? noteTextOf(parsed.notesId) : undefined });
    }
  } else {
    // No persist directory: every slide container in stream order, then notes by slide-list order.
    each(c, 0, stream.length, (r) => {
      if (r.type !== T.Slide || slides.length >= PPT_MAX_SLIDES) return;
      const parsed = readSlide(c, r.pos - 8, pictures.length);
      if (parsed) slides.push({ shapes: parsed.shapes });
    });
    if (!slides.length && slideList.length) for (const e of slideList) slides.push({ shapes: e.items.filter((i) => i.text.trim()).map((i): PptShape => ({ kind: 'text', text: i.text, textType: i.type, placeholder: i.type === 0 || i.type === 6 ? 1 : 2 })) });
  }
  if (!slides.length) c.warnings.add('슬라이드를 찾지 못했습니다.');
  if (pictures.some((p) => !p)) c.warnings.add('일부 그림(벡터 그림 등)은 가져오지 못했습니다.');
  return { width, height, slides, pictures, warnings: [...c.warnings] };
}
