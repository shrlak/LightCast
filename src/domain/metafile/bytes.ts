// Bounds-checked little-endian reads. Past the end every getter returns 0, so a truncated file
// yields wrong numbers (which the callers range-check) instead of an exception.

export class Bytes {
  readonly view: DataView;
  constructor(readonly u8: Uint8Array) {
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  get length() { return this.u8.length; }
  has(off: number, n: number) { return Number.isInteger(off) && off >= 0 && n >= 0 && off + n <= this.u8.length; }
  u8At(o: number) { return this.has(o, 1) ? this.u8[o] : 0; }
  u16(o: number) { return this.has(o, 2) ? this.view.getUint16(o, true) : 0; }
  i16(o: number) { return this.has(o, 2) ? this.view.getInt16(o, true) : 0; }
  u32(o: number) { return this.has(o, 4) ? this.view.getUint32(o, true) : 0; }
  i32(o: number) { return this.has(o, 4) ? this.view.getInt32(o, true) : 0; }
  f32(o: number) { const v = this.has(o, 4) ? this.view.getFloat32(o, true) : 0; return Number.isFinite(v) ? v : 0; }
  /** A view of `n` bytes at `o` (clamped to what exists). */
  slice(o: number, n: number): Bytes {
    const s = Math.max(0, Math.min(Number.isFinite(o) ? o : 0, this.u8.length));
    const e = Math.max(s, Math.min(s + Math.max(0, Number.isFinite(n) ? n : 0), this.u8.length));
    return new Bytes(this.u8.subarray(s, e));
  }
  tail(o: number): Bytes { return this.slice(o, this.u8.length - o); }
  /** UTF-16LE text of `n` units at `o`. */
  utf16(o: number, n: number): string {
    let s = '';
    for (let i = 0; i < n && this.has(o + i * 2, 2); i++) s += String.fromCharCode(this.u16(o + i * 2));
    return s;
  }
}

/** [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Xf = [number, number, number, number, number, number];
export const IDENTITY: Xf = [1, 0, 0, 1, 0, 0];

/** `a` applied after `b`: compose(a, b)(p) = a(b(p)). */
export function compose(a: Xf, b: Xf): Xf {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export const apply = (m: Xf, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Mean linear scale of a transform (what a pen width or a font size is multiplied by). */
export const scaleOf = (m: Xf) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
