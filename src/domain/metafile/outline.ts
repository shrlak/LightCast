// Glyph outlines from an sfnt's own tables, for the flood-fill rasteriser (raster.ts), which has to know
// which pixels a piece of text covered: TrueType 'glyf' (quadratic contours, composite glyphs) and
// OpenType 'CFF ' (Type 2 charstrings, subroutines, CID-keyed fonts with FDArray / FDSelect). CFF2
// (variable OpenType) is not read. Outlines come back in font units with y pointing up, as a flat
// command list: 'M' x y, 'L' x y, 'Q' x1 y1 x y, 'C' x1 y1 x2 y2 x y, 'Z'. Bad data gives null.

export type Outline = (string | number)[];

const MAX_OPS = 20_000;

export interface OutlineSource { outline(glyph: number): Outline | null }

export function outlineSource(v: DataView, tables: Map<string, [number, number]>): OutlineSource | null {
  try {
    const glyf = tables.get('glyf'), loca = tables.get('loca'), head = tables.get('head'), maxp = tables.get('maxp');
    if (glyf && loca && head && maxp) return glyfSource(v, glyf, loca, v.getInt16(head[0] + 50), v.getUint16(maxp[0] + 4));
    const cff = tables.get('CFF ');
    if (cff) return cffSource(v, cff[0], cff[1]);
  } catch { /* no outlines */ }
  return null;
}

// ---- TrueType ----

function glyfSource(v: DataView, glyf: [number, number], loca: [number, number], fmt: number, numGlyphs: number): OutlineSource {
  const at = (g: number): [number, number] | null => {
    if (g < 0 || g >= numGlyphs) return null;
    const s = fmt ? v.getUint32(loca[0] + g * 4) : v.getUint16(loca[0] + g * 2) * 2;
    const e = fmt ? v.getUint32(loca[0] + g * 4 + 4) : v.getUint16(loca[0] + g * 2 + 2) * 2;
    if (e <= s || s + 10 > glyf[1] || e > glyf[1]) return null;
    return [glyf[0] + s, e - s];
  };
  const build = (g: number, m: [number, number, number, number, number, number], out: Outline, depth: number) => {
    if (depth > 8 || out.length > MAX_OPS) return;
    const loc = at(g);
    if (!loc) return;
    const [o, len] = loc;
    const end = o + len;
    const n = v.getInt16(o);
    const T = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    if (n >= 0) {
      let p = o + 10;
      const ends: number[] = [];
      for (let i = 0; i < n; i++) { ends.push(v.getUint16(p)); p += 2; }
      const count = n ? ends[n - 1] + 1 : 0;
      if (count > 65535) return;
      p += 2 + v.getUint16(p); // instructions
      const flags = new Uint8Array(count);
      for (let i = 0; i < count && p < end;) {
        const f = v.getUint8(p++);
        flags[i++] = f;
        if (f & 8) { let r = v.getUint8(p++); while (r-- > 0 && i < count) flags[i++] = f; }
      }
      const xs = new Float64Array(count), ys = new Float64Array(count);
      let c = 0;
      for (let i = 0; i < count; i++) {
        const f = flags[i];
        if (f & 2) { const d = v.getUint8(p++); c += f & 16 ? d : -d; } else if (!(f & 16)) { c += v.getInt16(p); p += 2; }
        xs[i] = c;
      }
      c = 0;
      for (let i = 0; i < count; i++) {
        const f = flags[i];
        if (f & 4) { const d = v.getUint8(p++); c += f & 32 ? d : -d; } else if (!(f & 32)) { c += v.getInt16(p); p += 2; }
        ys[i] = c;
      }
      let s = 0;
      for (const e of ends) {
        if (e < s || e >= count) break;
        contour(xs, ys, flags, s, e, T, out);
        s = e + 1;
      }
      return;
    }
    // Composite: components, each with its own offset / scale.
    let p = o + 10;
    for (let guard = 0; guard < 256 && p + 4 <= end; guard++) {
      const f = v.getUint16(p), gi = v.getUint16(p + 2);
      p += 4;
      let dx: number, dy: number;
      if (f & 1) { dx = v.getInt16(p); dy = v.getInt16(p + 2); p += 4; } else { dx = v.getInt8(p); dy = v.getInt8(p + 1); p += 2; }
      if (!(f & 2)) { dx = 0; dy = 0; } // point matching: not done
      let a = 1, b = 0, cc = 0, d = 1;
      const f2 = (q: number) => v.getInt16(q) / 16384;
      if (f & 8) { a = d = f2(p); p += 2; }
      else if (f & 0x40) { a = f2(p); d = f2(p + 2); p += 4; }
      else if (f & 0x80) { a = f2(p); b = f2(p + 2); cc = f2(p + 4); d = f2(p + 6); p += 8; }
      const local: [number, number, number, number, number, number] = [a, b, cc, d, dx, dy];
      build(gi, mul(m, local), out, depth + 1);
      if (!(f & 0x20)) break;
    }
  };
  return {
    outline(g) {
      try { const out: Outline = []; build(g, [1, 0, 0, 1, 0, 0], out, 0); return out; } catch { return null; }
    },
  };
}

function mul(a: number[], b: number[]): [number, number, number, number, number, number] {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** One quadratic contour: on-curve points joined by lines, off-curve points as controls (two in a row imply an on-curve point midway). */
function contour(xs: Float64Array, ys: Float64Array, flags: Uint8Array, s: number, e: number, T: (x: number, y: number) => number[], out: Outline) {
  const n = e - s + 1;
  if (n < 2) return;
  const on = (i: number) => (flags[s + (((i % n) + n) % n)] & 1) !== 0;
  const pt = (i: number) => T(xs[s + (((i % n) + n) % n)], ys[s + (((i % n) + n) % n)]);
  let first = -1;
  for (let i = 0; i < n; i++) if (on(i)) { first = i; break; }
  let start: number[], from: number, count: number;
  if (first >= 0) { start = pt(first); from = first + 1; count = n - 1; }
  else { const a = pt(n - 1), b = pt(0); start = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; from = 0; count = n; }
  out.push('M', start[0], start[1]);
  let ctrl: number[] | null = null;
  for (let k = 0; k < count; k++) {
    const i = from + k, p = pt(i);
    if (on(i)) { if (ctrl) out.push('Q', ctrl[0], ctrl[1], p[0], p[1]); else out.push('L', p[0], p[1]); ctrl = null; }
    else { if (ctrl) out.push('Q', ctrl[0], ctrl[1], (ctrl[0] + p[0]) / 2, (ctrl[1] + p[1]) / 2); ctrl = p; }
  }
  if (ctrl) out.push('Q', ctrl[0], ctrl[1], start[0], start[1]);
  out.push('Z');
}

// ---- CFF ----

interface Index { count: number; at(i: number): [number, number] | null; end: number }
function index(v: DataView, o: number, limit: number): Index {
  const count = v.getUint16(o);
  if (!count) return { count: 0, at: () => null, end: o + 2 };
  const os = v.getUint8(o + 2);
  if (os < 1 || os > 4) throw new Error('cff');
  const rd = (i: number) => { let x = 0; for (let k = 0; k < os; k++) x = x * 256 + v.getUint8(o + 3 + i * os + k); return x; };
  const data = o + 3 + (count + 1) * os - 1;
  const end = data + rd(count);
  if (end > limit) throw new Error('cff');
  return { count, end, at: (i) => (i < 0 || i >= count ? null : [data + rd(i), data + rd(i + 1)]) };
}

/** A DICT as operator -> operands (two-byte operators as 1200 + b1). */
function dict(v: DataView, s: number, e: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let ops: number[] = [];
  for (let p = s; p < e && p < v.byteLength;) {
    const b = v.getUint8(p);
    if (b <= 21) {
      let op = b; p++;
      if (b === 12) { op = 1200 + v.getUint8(p); p++; }
      out.set(op, ops); ops = [];
    } else if (b === 28) { ops.push(v.getInt16(p + 1)); p += 3; }
    else if (b === 29) { ops.push(v.getInt32(p + 1)); p += 5; }
    else if (b === 30) { // real
      let str = ''; p++;
      for (let done = false; !done && p < e;) {
        const byte = v.getUint8(p++);
        for (const nib of [byte >> 4, byte & 15]) {
          if (nib === 15) { done = true; break; }
          str += ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'E', 'E-', '', '-'][nib];
        }
      }
      ops.push(parseFloat(str) || 0);
    } else if (b >= 32 && b <= 246) { ops.push(b - 139); p++; }
    else if (b >= 247 && b <= 250) { ops.push((b - 247) * 256 + v.getUint8(p + 1) + 108); p += 2; }
    else if (b >= 251 && b <= 254) { ops.push(-(b - 251) * 256 - v.getUint8(p + 1) - 108); p += 2; }
    else p++;
  }
  return out;
}

const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

function cffSource(v: DataView, base: number, len: number): OutlineSource | null {
  const limit = base + len;
  const hdr = v.getUint8(base + 2);
  const names = index(v, base + hdr, limit);
  const tops = index(v, names.end, limit);
  const strings = index(v, tops.end, limit);
  const gsubrs = index(v, strings.end, limit);
  const t0 = tops.at(0);
  if (!t0) return null;
  const top = dict(v, t0[0], t0[1]);
  const cs = top.get(17)?.[0];
  if (cs === undefined) return null;
  const chars = index(v, base + cs, limit);
  const privOf = (d: Map<number, number[]>): Index | null => {
    const pr = d.get(18);
    if (!pr || pr.length < 2) return null;
    const pd = dict(v, base + pr[1], base + pr[1] + pr[0]);
    const sub = pd.get(19)?.[0];
    return sub !== undefined ? index(v, base + pr[1] + sub, limit) : null;
  };
  let subrs: Index | null = privOf(top);
  let fdSubrs: (Index | null)[] | null = null;
  let fdSelect: ((g: number) => number) | null = null;
  const fda = top.get(1236)?.[0], fds = top.get(1237)?.[0];
  if (fda !== undefined && fds !== undefined) {
    const arr = index(v, base + fda, limit);
    fdSubrs = [];
    for (let i = 0; i < Math.min(arr.count, 256); i++) { const r = arr.at(i)!; fdSubrs.push(privOf(dict(v, r[0], r[1]))); }
    const so = base + fds, f = v.getUint8(so);
    if (f === 0) fdSelect = (g) => v.getUint8(so + 1 + g);
    else if (f === 3) {
      const nr = v.getUint16(so + 1);
      fdSelect = (g) => {
        for (let i = 0; i < nr; i++) {
          const first = v.getUint16(so + 3 + i * 3), next = v.getUint16(so + 3 + (i + 1) * 3);
          if (g >= first && g < next) return v.getUint8(so + 5 + i * 3);
        }
        return 0;
      };
    }
  }
  return {
    outline(g) {
      try {
        const r = chars.at(g);
        if (!r) return null;
        const local = fdSubrs && fdSelect ? fdSubrs[fdSelect(g)] ?? null : subrs;
        return charstring(v, r[0], r[1], gsubrs, local);
      } catch { return null; }
    },
  };
}

/** A Type 2 charstring as outline commands. */
function charstring(v: DataView, s: number, e: number, gsubrs: Index, subrs: Index | null): Outline {
  const out: Outline = [];
  const st: number[] = [];
  let x = 0, y = 0, nStems = 0, haveWidth = false, open = false, depth = 0, steps = 0;
  const gb = bias(gsubrs.count), lb = subrs ? bias(subrs.count) : 0;
  const move = (dx: number, dy: number) => { if (open) out.push('Z'); x += dx; y += dy; out.push('M', x, y); open = true; };
  const line = (dx: number, dy: number) => { x += dx; y += dy; out.push('L', x, y); };
  const curve = (a: number, b: number, c: number, d: number, ee: number, f: number) => {
    const x1 = x + a, y1 = y + b, x2 = x1 + c, y2 = y1 + d; x = x2 + ee; y = y2 + f;
    out.push('C', x1, y1, x2, y2, x, y);
  };
  const stems = () => { if (!haveWidth && st.length % 2) st.shift(); haveWidth = true; nStems += st.length >> 1; st.length = 0; };
  const run = (p: number, end: number): boolean => { // false: endchar
    if (++depth > 10) return false;
    while (p < end) {
      if (++steps > 100_000 || out.length > MAX_OPS) return false;
      const b = v.getUint8(p++);
      if (b >= 32 || b === 28) {
        if (b === 28) { st.push(v.getInt16(p)); p += 2; }
        else if (b <= 246) st.push(b - 139);
        else if (b <= 250) st.push((b - 247) * 256 + v.getUint8(p++) + 108);
        else if (b <= 254) st.push(-(b - 251) * 256 - v.getUint8(p++) - 108);
        else { st.push(v.getInt32(p) / 65536); p += 4; }
        if (st.length > 96) return false;
        continue;
      }
      switch (b) {
        case 1: case 3: case 18: case 23: stems(); break;
        case 19: case 20: stems(); p += (nStems + 7) >> 3; break; // hintmask, cntrmask
        case 21: if (!haveWidth && st.length > 2) st.shift(); haveWidth = true; move(st[0] ?? 0, st[1] ?? 0); st.length = 0; break;
        case 22: if (!haveWidth && st.length > 1) st.shift(); haveWidth = true; move(st[0] ?? 0, 0); st.length = 0; break;
        case 4: if (!haveWidth && st.length > 1) st.shift(); haveWidth = true; move(0, st[0] ?? 0); st.length = 0; break;
        case 5: for (let i = 0; i + 1 < st.length; i += 2) line(st[i], st[i + 1]); st.length = 0; break;
        case 6: case 7: { let h = b === 6; for (const d of st) { if (h) line(d, 0); else line(0, d); h = !h; } st.length = 0; break; }
        case 8: for (let i = 0; i + 5 < st.length; i += 6) curve(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]); st.length = 0; break;
        case 24: { let i = 0; for (; i + 5 < st.length - 2; i += 6) curve(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]); line(st[i] ?? 0, st[i + 1] ?? 0); st.length = 0; break; }
        case 25: { let i = 0; for (; i + 1 < st.length - 6; i += 2) line(st[i], st[i + 1]); curve(st[i] ?? 0, st[i + 1] ?? 0, st[i + 2] ?? 0, st[i + 3] ?? 0, st[i + 4] ?? 0, st[i + 5] ?? 0); st.length = 0; break; }
        case 26: { let i = 0, d1 = 0; if (st.length % 2) d1 = st[i++]; for (; i + 3 < st.length; i += 4) { curve(d1, st[i], st[i + 1], st[i + 2], 0, st[i + 3]); d1 = 0; } st.length = 0; break; } // vvcurveto
        case 27: { let i = 0, d1 = 0; if (st.length % 2) d1 = st[i++]; for (; i + 3 < st.length; i += 4) { curve(st[i], d1, st[i + 1], st[i + 2], st[i + 3], 0); d1 = 0; } st.length = 0; break; } // hhcurveto
        case 30: case 31: { // vhcurveto, hvcurveto
          let h = b === 31, i = 0;
          while (i + 3 < st.length) {
            const last = st.length - i === 5 ? st[i + 4] : 0;
            if (h) curve(st[i], 0, st[i + 1], st[i + 2], last, st[i + 3]);
            else curve(0, st[i], st[i + 1], st[i + 2], st[i + 3], last);
            i += st.length - i === 5 ? 5 : 4;
            h = !h;
          }
          st.length = 0; break;
        }
        case 10: case 29: { // callsubr, callgsubr
          const idx = (st.pop() ?? 0) + (b === 10 ? lb : gb);
          const r = (b === 10 ? subrs : gsubrs)?.at(idx);
          if (!r) return false;
          if (!run(r[0], r[1])) { depth--; return false; }
          break;
        }
        case 11: depth--; return true; // return
        case 14: if (!haveWidth && (st.length === 1 || st.length === 5)) st.shift(); if (open) out.push('Z'); open = false; return false; // endchar (seac not drawn)
        case 12: {
          const b2 = v.getUint8(p++);
          const a = st;
          if (b2 === 35 && a.length >= 13) { curve(a[0], a[1], a[2], a[3], a[4], a[5]); curve(a[6], a[7], a[8], a[9], a[10], a[11]); }
          else if (b2 === 34 && a.length >= 7) { const y0 = y; curve(a[0], 0, a[1], a[2], a[3], 0); curve(a[4], 0, a[5], y0 - y, a[6], 0); }
          else if (b2 === 36 && a.length >= 9) { const y0 = y; curve(a[0], a[1], a[2], a[3], a[4], 0); curve(a[5], 0, a[6], a[7], a[8], y0 - y - a[7]); }
          else if (b2 === 37 && a.length >= 11) {
            const x0 = x, y0 = y;
            let dx = 0, dy = 0;
            for (let k = 0; k < 10; k += 2) { dx += a[k]; dy += a[k + 1]; }
            curve(a[0], a[1], a[2], a[3], a[4], a[5]);
            const lx = x + a[6] + a[8], ly = y + a[7] + a[9];
            if (Math.abs(dx) > Math.abs(dy)) curve(a[6], a[7], a[8], a[9], a[10], y0 - ly);
            else curve(a[6], a[7], a[8], a[9], x0 - lx, a[10]);
          }
          st.length = 0; break;
        }
        default: st.length = 0; break;
      }
    }
    depth--;
    return true;
  };
  run(s, e);
  if (open) out.push('Z');
  return out;
}
