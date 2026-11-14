// Byte builders for hand-made WMF / EMF / EMF+ test files (shared by the metafile tests).
export class B {
  a: number[] = [];
  u8(...v: number[]) { this.a.push(...v.map((x) => x & 255)); return this; }
  u16(...v: number[]) { for (const x of v) this.u8(x, x >> 8); return this; }
  u32(...v: number[]) { for (const x of v) this.u8(x, x >> 8, x >> 16, x >>> 24); return this; }
  f32(...v: number[]) { for (const x of v) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); this.u8(...new Uint8Array(d.buffer)); } return this; }
  utf16(s: string) { for (const c of s) this.u16(c.charCodeAt(0)); return this; }
  pad4() { while (this.a.length % 4) this.a.push(0); return this; }
  get bytes() { return Uint8Array.from(this.a); }
  get length() { return this.a.length; }
}
export const RED = 0x0000ff, BLUE = 0xff0000; // COLORREF is 0x00BBGGRR

// WMF: a record is size (words), function, parameters (16-bit words).
export const wmfRec = (fn: number, ...words: number[]) => new B().u32(3 + words.length).u16(fn).u16(...words.map((w) => w & 0xffff)).a;
export function wmf(...records: number[][]): Uint8Array {
  const body = records.flat();
  const total = 9 + 3 + body.length / 2; // header words + EOF record + records
  const b = new B();
  b.u32(0x9ac6cdd7).u16(0).u16(0, 0, 200, 100).u16(100).u32(0).u16(0); // placeable header: 200 x 100 units at 100 per inch
  b.u16(1, 9, 0x300).u32(total).u16(2).u32(10).u16(0); // METAHEADER
  b.u8(...body);
  b.u32(3).u16(0); // EOF
  return b.bytes;
}
export const WMF_SAMPLE = wmf(
  wmfRec(0x020c, 100, 200), // SetWindowExt (y, x)
  wmfRec(0x020b, 0, 0), // SetWindowOrg
  wmfRec(0x02fc, 0, RED & 0xffff, RED >>> 16, 0), // CreateBrushIndirect: solid red
  wmfRec(0x012d, 0), // SelectObject 0
  wmfRec(0x041b, 60, 110, 10, 10), // Rectangle bottom, right, top, left
  wmfRec(0x0324, 3, 20, 20, 90, 20, 55, 80), // Polygon, 3 points
);

// EMF: header (88 bytes), records, EOF.
export const emfRec = (type: number, build: (b: B) => void) => { const b = new B(); b.u32(type, 0); build(b); b.pad4(); const a = b.a; a.splice(4, 4, ...new B().u32(a.length).a); return a; };
export function emf(records: number[][]): Uint8Array {
  const h = new B();
  // 250 x 250 mm on 1000 x 1000 device pixels: 4 px per mm; the frame is 50 x 25 mm.
  h.u32(1, 88).u32(0, 0, 200, 100).u32(0, 0, 5000, 2500).u32(0x464d4520, 0x10000, 0, 0).u16(1, 0).u32(0, 0, 0).u32(1000, 1000, 250, 250);
  const body = records.flat();
  const eof = emfRec(14, (b) => b.u32(0, 16, 20));
  const all = [...h.a, ...body, ...eof];
  const out = new Uint8Array(all);
  new DataView(out.buffer).setUint32(48, out.length, true);
  return out;
}
export const emfBrush = (slot: number, color: number) => emfRec(39, (b) => b.u32(slot, 0, color, 0));
export const emfSelect = (slot: number) => emfRec(37, (b) => b.u32(slot));
export const emfRect = (l: number, t: number, r: number, b2: number) => emfRec(43, (b) => b.u32(l, t, r, b2));
export const emfFont = (slot: number, face: string, height: number) => emfRec(82, (b) => {
  b.u32(slot, height, 0, 0, 0, 400).u8(0, 0, 0, 0, 0, 0, 0, 0); // italic.. pitch
  const name = new B().utf16(face);
  while (name.length < 64) name.u8(0);
  b.u8(...name.a);
});
export function emfTextW(x: number, y: number, text: string) {
  return emfRec(84, (b) => {
    b.u32(0, 0, 189, 94, 1, 0, 0); // bounds, graphics mode, scales
    b.u32(x, y, text.length, 76, 0, 0, 0, 0, 0, 0); // EmrText: ref, chars, string offset, options, rect(4), dx offset
    b.utf16(text);
  });
}

// EMF+ records ride in EMR_COMMENT.
export const plusRec = (type: number, flags: number, build: (b: B) => void) => { const d = new B(); build(d); d.pad4(); return new B().u16(type, flags).u32(12 + d.length, d.length).u8(...d.a).a; };
export const comment = (...recs: number[][]) => { const body = recs.flat(); return emfRec(70, (b) => b.u32(4 + body.length, 0x2b464d45).u8(...body)); };
export const plusHeader = (dual: boolean) => plusRec(0x4001, dual ? 1 : 0, (b) => b.u32(0xdbc01002, 1, 96, 96));
export const argb = (a: number, r: number, g: number, bl: number) => ((a << 24) | (r << 16) | (g << 8) | bl) >>> 0;
export const plusFillRects = (color: number, x: number, y: number, w: number, h: number) => plusRec(0x400a, 0x8000, (b) => b.u32(color, 1).f32(x, y, w, h));

