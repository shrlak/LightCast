// Shared plumbing of the legacy .ppt reader: the record header walk (MS-PPT 2.3.1), record type ids and
// the reading context. Every read is bounds-checked against the stream and the record budget.

export const PPT_MAX_RECORDS = 400_000;
export const PPT_MAX_DEPTH = 24;
export const PPT_MAX_SLIDES = 2000;
export const PPT_MAX_PICTURES = 2000;

export interface Rec { ver: number; inst: number; type: number; pos: number; end: number }
export interface Ctx { b: Uint8Array; v: DataView; budget: number; warnings: Set<string> }

export const T = {
  Document: 0x03e8, DocumentAtom: 0x03e9, Slide: 0x03ee, SlideAtom: 0x03ef, Notes: 0x03f0, MainMaster: 0x03f8, SlideListWithText: 0x0ff0,
  SlidePersistAtom: 0x03f3, PPDrawing: 0x040c, DrawingGroup: 0x040b, UserEdit: 0x0ff5, PersistDirectory: 0x1772,
  Environment: 0x03fa, SlideShowSlideInfo: 0x03f9, ColorSchemeAtom: 0x07f0, FontCollection: 0x07d5, FontEntityAtom: 0x0fb7,
  TextHeader: 0x0f9f, TextChars: 0x0fa0, TextBytes: 0x0fa8, StyleTextProp: 0x0fa1, TextMasterStyle: 0x0fa3, OEPlaceholder: 0x0bc3,
  Dgg: 0xf000, BStore: 0xf001, Dg: 0xf002, Spgr: 0xf003, Sp: 0xf004, SpgrAtom: 0xf009, SpAtom: 0xf00a, Opt: 0xf00b, ClientTextbox: 0xf00d, ClientAnchor: 0xf010, ClientData: 0xf011, ChildAnchor: 0xf00f, BSE: 0xf007,
  SecondaryOpt: 0xf121, TertiaryOpt: 0xf122,
};

/** The records between two offsets. `f` returns false to stop. Never reads outside [from, to). */
export function each(c: Ctx, from: number, to: number, f: (r: Rec) => boolean | void) {
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
export const isContainer = (r: Rec) => r.ver === 0xf;

const hex2 = (n: number) => (n & 0xff).toString(16).padStart(2, '0');
export const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** The 8 scheme colours of a ColorSchemeAtom: background, text & lines, shadows, title text, fills, accent, accent & hyperlink, accent & followed hyperlink. */
export type Scheme = string[];

/** ColorIndexStruct (red, green, blue, index) of a text run: index 0xFE is the literal colour, 0-7 a scheme colour. */
export function colorIndex(red: number, green: number, blue: number, index: number, scheme: Scheme | undefined): string | undefined {
  if (index === 0xfe) return rgbHex(red, green, blue);
  if (index < 8) return scheme?.[index];
  return undefined;
}

const SYSTEM_COLORS: Record<number, string> = { 0: '#c0c0c0', 1: '#000000', 2: '#000080', 3: '#808080', 4: '#c0c0c0', 5: '#ffffff', 6: '#000000', 7: '#000000', 8: '#000000', 9: '#000000', 15: '#c0c0c0', 16: '#808080' };

/** OfficeArtCOLORREF (an Escher colour property): literal RGB, a scheme index (flag 0x08) or a system colour (flag 0x10). */
export function colorRef(v: number, scheme: Scheme | undefined): string | undefined {
  const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff, flags = (v >>> 24) & 0xff;
  if (flags & 0x08) return scheme?.[r];
  if (flags & 0x10) return SYSTEM_COLORS[r];
  return rgbHex(r, g, b);
}
