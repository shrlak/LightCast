// Custom geometry of legacy .ppt shapes (MS-ODRAW 2.3.6 Geometry property set): pVertices + pSegmentInfo with the
// guide formulas (pGuides, msofbtShapeGuides) evaluated, adjust values (adjust..adjust8) and the arc / curve escapes.
// Pure and never throws: anything unreadable gives null. Output is SVG path data.

/** What the evaluator reads from a shape's property table. */
export interface GeoInput {
  vertices?: Uint8Array;
  segments?: Uint8Array;
  guides?: Uint8Array;
  /** adjust1..adjust8 (property ids 0x147-0x14e) and the geometry rectangle (0x140-0x143), when present. */
  adjust: (number | undefined)[];
  rect?: { left: number; top: number; right: number; bottom: number };
}

export interface GeoResult {
  path: string;
  /** The path's coordinate space: the geometry rectangle, or the extent of what is drawn. */
  left: number; top: number; w: number; h: number;
  /** The coordinate space was not stated by the file (it is the extent of the drawn points). */
  guessedSpace: boolean;
  noFill?: boolean;
  noLine?: boolean;
}

const MAX_POINTS = 20000;
const MAX_GUIDES = 512;
const num = (v: number) => String(Math.round(v * 100) / 100);

interface Guide { op: number; a: number; b: number; c: number; ra: boolean; rb: boolean; rc: boolean }

/** The formulas of a pGuides array (6-byte array header, then 8 bytes each: operation + three parameters). */
export function readGuides(b: Uint8Array | undefined): Guide[] {
  const out: Guide[] = [];
  if (!b || b.length < 6) return out;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = Math.min(v.getUint16(0, true), Math.floor((b.length - 6) / 8), MAX_GUIDES);
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 8, w = v.getUint16(o, true);
    // A set flag bit (0x2000 first, 0x4000 second, 0x8000 third parameter) means the parameter is a reference, else a constant.
    out.push({ op: w & 0x1fff, ra: (w & 0x2000) !== 0, rb: (w & 0x4000) !== 0, rc: (w & 0x8000) !== 0, a: v.getInt16(o + 2, true), b: v.getInt16(o + 4, true), c: v.getInt16(o + 6, true) });
  }
  return out;
}

const DEG = Math.PI / 180;

/** A guide evaluator over the file's formulas. Unknown operations and reference cycles evaluate to 0. */
export function makeEvaluator(guides: Guide[], input: GeoInput, space: { left: number; top: number; right: number; bottom: number }, lossy = false): (i: number) => number {
  const memo = new Map<number, number>();
  const active = new Set<number>();
  const ref = (v: number): number => {
    if (v >= 0x400 && v < 0x400 + MAX_GUIDES) return value(v - 0x400);
    if (v >= 0x147 && v <= 0x14e) return input.adjust[v - 0x147] ?? 0;
    if (v === 0x140) return space.left;
    if (v === 0x141) return space.top;
    if (v === 0x142) return space.right;
    if (v === 0x143) return space.bottom;
    return 0;
  };
  const value = (i: number): number => {
    const known = memo.get(i);
    if (known !== undefined) return known;
    const g = guides[i];
    if (!g || active.has(i)) return 0;
    active.add(i);
    // LibreOffice's export keeps formula constants in 16 bits: its 100000 (a DrawingML ratio's whole) arrives as 32767.
    const k = (v: number) => (lossy && v === 32767 ? 100000 : v);
    const a = g.ra ? ref(g.a) : k(g.a), b = g.rb ? ref(g.b) : k(g.b), c = g.rc ? ref(g.c) : k(g.c);
    let r = 0;
    switch (g.op) {
      case 0: r = a + b - c; break;                       // sum
      case 1: r = c ? (a * b) / c : 0; break;             // product
      case 2: r = (a + b) / 2; break;                     // mid
      case 3: r = Math.abs(a); break;                     // absolute
      case 4: r = Math.min(a, b); break;
      case 5: r = Math.max(a, b); break;
      case 6: r = a > 0 ? b : c; break;                   // if
      case 7: r = Math.sqrt(a * a + b * b + c * c); break; // mod
      case 8: r = Math.atan2(b, a) / DEG * 65536; break;  // atan2, 16.16 degrees
      case 9: r = a * Math.sin((b / 65536) * DEG); break;
      case 10: r = a * Math.cos((b / 65536) * DEG); break;
      case 11: r = a * Math.cos(Math.atan2(c, b)); break; // cosatan2
      case 12: r = a * Math.sin(Math.atan2(c, b)); break; // sinatan2
      case 13: r = Math.sqrt(Math.max(0, a)); break;
      case 14: r = a + (b - c) * 65536; break;            // sumangle: b and c in degrees, a in 16.16
      case 15: r = b ? c * Math.sqrt(Math.max(0, 1 - (a / b) ** 2)) : 0; break; // ellipse
      case 16: r = a * Math.tan((b / 65536) * DEG); break;
      case 0x80: r = a; break;                            // val
      default: r = 0;
    }
    active.delete(i);
    if (!Number.isFinite(r)) r = 0;
    memo.set(i, r);
    return r;
  };
  return value;
}

type Pt = [number, number];

/** SVG arc commands for an ellipse arc from angle a1 to a2 (degrees, y down, clockwise positive), starting at the current point. */
function arcPath(cx: number, cy: number, rx: number, ry: number, a1: number, sweepDeg: number): { d: string; end: Pt } {
  const rad = (a: number) => a * DEG;
  const at = (a: number): Pt => [cx + rx * Math.cos(rad(a)), cy + ry * Math.sin(rad(a))];
  const total = Math.max(-360, Math.min(360, sweepDeg));
  const sweepFlag = total >= 0 ? 1 : 0;
  // Split into pieces of at most 90 degrees: exact for any ellipse and no ambiguity in the large-arc flag.
  const pieces = Math.max(1, Math.ceil(Math.abs(total) / 90 - 1e-9));
  let d = '';
  let end = at(a1);
  for (let i = 1; i <= pieces; i++) {
    end = at(a1 + (total * i) / pieces);
    d += `A${num(rx)} ${num(ry)} 0 0 ${sweepFlag} ${num(end[0])} ${num(end[1])}`;
  }
  return { d, end };
}

/** The angle (degrees, y down) of the ellipse parameter of a point relative to the ellipse's centre and radii. */
const angleOf = (px: number, py: number, cx: number, cy: number, rx: number, ry: number) => Math.atan2((py - cy) / (ry || 1), (px - cx) / (rx || 1)) / DEG;

/**
 * A fingerprint of a shape's formulas: segment commands, the operation of each guide, the point and adjust counts. The size and the
 * adjust values do not change it, so it names the preset a producer wrote the shape from (see pptLoPresets.ts).
 */
export function geometryFingerprint(input: GeoInput): string {
  const vb = input.vertices;
  let pts = '0';
  if (vb && vb.length >= 6) {
    const v = new DataView(vb.buffer, vb.byteOffset, vb.byteLength);
    const n = v.getUint16(0, true), size = v.getUint16(4, true), elem = size === 0xfff0 ? 4 : size;
    const toks: string[] = [];
    if (elem === 4 || elem === 8) for (let i = 0; i < Math.min(n, Math.floor((vb.length - 6) / elem), 1024) * 2; i++) {
      const c = elem === 8 ? v.getInt32(6 + i * 4, true) : v.getInt16(6 + i * 2, true);
      toks.push(c < 0 ? String(c & 0xffff) : 'k');
    }
    pts = `${n}:${toks.join(',')}`;
  }
  const sb = input.segments;
  const segs: string[] = [];
  if (sb && sb.length >= 6) {
    const sv = new DataView(sb.buffer, sb.byteOffset, sb.byteLength);
    for (let i = 0; i < Math.min(sv.getUint16(0, true), Math.floor((sb.length - 6) / 2), 512); i++) segs.push(sv.getUint16(6 + i * 2, true).toString(16));
  }
  const ops = readGuides(input.guides).map((g) => `${g.op.toString(16)}${g.ra ? 'a' : ''}${g.rb ? 'b' : ''}${g.rc ? 'c' : ''}`);
  return `${pts}|${segs.join('.')}|${ops.join('.')}|${input.adjust.filter((v) => v !== undefined).length}`;
}

export function evaluateGeometry(input: GeoInput): GeoResult | null {
  const vb = input.vertices;
  if (!vb || vb.length < 6) return null;
  const vv = new DataView(vb.buffer, vb.byteOffset, vb.byteLength);
  const n = vv.getUint16(0, true), size = vv.getUint16(4, true);
  const elem = size === 0xfff0 ? 4 : size;
  if (elem !== 4 && elem !== 8) return null;
  const count = Math.min(n, Math.floor((vb.length - 6) / elem), MAX_POINTS);
  const raw: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * elem;
    raw.push(elem === 8 ? [vv.getInt32(o, true), vv.getInt32(o + 4, true)] : [vv.getInt16(o, true), vv.getInt16(o + 2, true)]);
  }
  let segs: number[] = [];
  const sb = input.segments;
  if (sb && sb.length >= 6) {
    const sv = new DataView(sb.buffer, sb.byteOffset, sb.byteLength);
    const m = Math.min(sv.getUint16(0, true), Math.floor((sb.length - 6) / 2), MAX_POINTS);
    for (let i = 0; i < m; i++) segs.push(sv.getUint16(6 + i * 2, true));
  } else if (raw.length) segs = [0x4000, Math.max(0, raw.length - 1)];

  const r = input.rect;
  const stated = !!r && r.right > r.left && r.bottom > r.top;
  const guides = readGuides(input.guides);
  const evalAt = makeEvaluator(guides, input, stated ? r! : { left: 0, top: 0, right: 21600, bottom: 21600 }, !stated && guides.length > 0);
  // A coordinate with the formula flag (high bit) is the result of a guide.
  const coord = (v: number) => (v < 0 ? evalAt(v & (elem === 8 ? 0xffff : 0x7fff)) : v);
  const pts = raw.map(([x, y]): Pt => [coord(x), coord(y)]);

  // Walk the segments into absolute commands, tracking the current point (arcs start from it).
  let d = '';
  let i = 0;
  let cur: Pt = [0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  const out: GeoResult = { path: '', left: 0, top: 0, w: 0, h: 0, guessedSpace: !stated };
  const P = (q: Pt) => `${num(q[0])} ${num(q[1])}`;
  // Commands are collected in absolute coordinates; the origin shift happens once the extent is known.
  const cmds: { c: string; pts: Pt[]; tail?: string }[] = [];
  const line = (q: Pt) => { cmds.push({ c: 'L', pts: [q] }); grow(q[0], q[1]); cur = q; };
  const move = (q: Pt) => { cmds.push({ c: 'M', pts: [q] }); grow(q[0], q[1]); cur = q; };
  const arc = (cx: number, cy: number, rx: number, ry: number, a1: number, sweep: number, connect: boolean) => {
    if (!(rx > 0 && ry > 0)) return;
    const start: Pt = [cx + rx * Math.cos(a1 * DEG), cy + ry * Math.sin(a1 * DEG)];
    if (connect) line(start); else move(start);
    const { d: ad, end } = arcPath(cx, cy, rx, ry, a1, sweep);
    cmds.push({ c: 'raw', pts: [], tail: ad });
    // The extent of the ellipse's bounding box part swept (conservative: the whole ellipse box when it sweeps a quadrant or more).
    grow(Math.min(start[0], end[0]), Math.min(start[1], end[1]));
    grow(Math.max(start[0], end[0]), Math.max(start[1], end[1]));
    if (Math.abs(sweep) >= 90) { grow(cx - rx, cy - ry); grow(cx + rx, cy + ry); }
    cur = end;
  };
  for (const s of segs) {
    const type = (s >> 13) & 7, k = s & 0x1fff;
    if (type === 2) { if (i >= pts.length) return null; move(pts[i++]); }
    else if (type === 0) { const m = k || pts.length - i; if (i + m > pts.length) return null; for (let j = 0; j < m; j++) line(pts[i++]); }
    else if (type === 1) {
      if (i + 3 * k > pts.length) return null;
      for (let j = 0; j < k; j++, i += 3) { cmds.push({ c: 'C', pts: [pts[i], pts[i + 1], pts[i + 2]] }); for (let q = 0; q < 3; q++) grow(pts[i + q][0], pts[i + q][1]); cur = pts[i + 2]; }
    } else if (type === 3) cmds.push({ c: 'Z', pts: [] });
    else if (type === 4) break;
    else if (type === 5) {
      const code = (s >> 8) & 0x1f, m = s & 0xff;
      if (code === 0xa) out.noFill = true;
      else if (code === 0xb) out.noLine = true;
      else if (code === 0x1 || code === 0x2) {
        // ANGLEELLIPSETO / ANGLEELLIPSE: centre, radii, then start and end angle (16.16 degrees) per segment.
        const segCount = m || Math.floor((pts.length - i) / 3);
        if (i + 3 * segCount > pts.length) return null;
        for (let j = 0; j < segCount; j++, i += 3) {
          const [cx, cy] = pts[i], [rx, ry] = pts[i + 1];
          const a1 = pts[i + 2][0] / 65536, a2 = pts[i + 2][1] / 65536;
          let sweep = a2 - a1;
          if (sweep <= 0) sweep += 360;
          arc(cx, cy, Math.abs(rx), Math.abs(ry), a1, sweep, code === 0x1);
        }
      } else if (code >= 0x3 && code <= 0x6) {
        // ARCTO / ARC / CLOCKWISEARCTO / CLOCKWISEARC: bounding box (2 points), then the start and end direction points.
        const segCount = m || Math.floor((pts.length - i) / 4);
        if (i + 4 * segCount > pts.length) return null;
        const clockwise = code >= 0x5;
        for (let j = 0; j < segCount; j++, i += 4) {
          const [l, t] = pts[i], [rgt, bot] = pts[i + 1];
          const cx = (l + rgt) / 2, cy = (t + bot) / 2, rx = Math.abs(rgt - l) / 2, ry = Math.abs(bot - t) / 2;
          const a1 = angleOf(pts[i + 2][0], pts[i + 2][1], cx, cy, rx, ry), a2 = angleOf(pts[i + 3][0], pts[i + 3][1], cx, cy, rx, ry);
          let sweep = clockwise ? a2 - a1 : a2 - a1 - 360;
          if (clockwise && sweep <= 0) sweep += 360;
          if (!clockwise && sweep <= -360) sweep += 360;
          if (!clockwise && sweep > 0) sweep -= 360;
          arc(cx, cy, rx, ry, a1, sweep, code === 0x3 || code === 0x5);
        }
      } else if (code === 0x7 || code === 0x8) {
        // ELLIPTICALQUADRANTX / Y: a quarter ellipse to each point, leaving the current point horizontally (X) or vertically (Y).
        const segCount = m || pts.length - i;
        if (i + segCount > pts.length) return null;
        let horizontal = code === 0x7;
        for (let j = 0; j < segCount; j++) {
          const q = pts[i++];
          const rx = Math.abs(q[0] - cur[0]), ry = Math.abs(q[1] - cur[1]);
          // The control points of a quarter ellipse (kappa = 0.5523).
          const kx = 0.5523 * (q[0] - cur[0]), ky = 0.5523 * (q[1] - cur[1]);
          const c1: Pt = horizontal ? [cur[0] + kx, cur[1]] : [cur[0], cur[1] + ky];
          const c2: Pt = horizontal ? [q[0], q[1] - ky] : [q[0] - kx, q[1]];
          void rx; void ry;
          cmds.push({ c: 'C', pts: [c1, c2, q] });
          grow(q[0], q[1]); grow(c1[0], c1[1]); cur = q;
          horizontal = !horizontal;
        }
      } else if (code === 0x9) {
        // QUADRATICBEZIER: control point and end point per segment.
        const segCount = m || Math.floor((pts.length - i) / 2);
        if (i + 2 * segCount > pts.length) return null;
        for (let j = 0; j < segCount; j++, i += 2) { cmds.push({ c: 'Q', pts: [pts[i], pts[i + 1]] }); grow(pts[i][0], pts[i][1]); grow(pts[i + 1][0], pts[i + 1][1]); cur = pts[i + 1]; }
      } else if (code >= 0xc && code <= 0x13) {
        // Auto / corner / smooth / symmetric lines and curves: drawn as straight lines through their points.
        const segCount = m || pts.length - i;
        if (i + segCount > pts.length) return null;
        for (let j = 0; j < segCount; j++) line(pts[i++]);
      } else if (code === 0x15 || code === 0x16 || code === 0x0) { /* fill / line colour escapes, extensions: no geometry */ }
      else return null;
    } else return null;
  }
  if (!cmds.some((c) => c.c !== 'Z') || !Number.isFinite(minX)) return null;
  // Coordinate space: the stated geometry rectangle, else the extent of the drawn points.
  let left: number, top: number, w: number, h: number;
  if (stated) { left = r!.left; top = r!.top; w = r!.right - r!.left; h = r!.bottom - r!.top; }
  else { left = minX; top = minY; w = Math.max(1, maxX - minX); h = Math.max(1, maxY - minY); }
  // Arcs were written relative to the absolute origin: shift every coordinate by (left, top).
  const sh = (q: Pt): Pt => [q[0] - left, q[1] - top];
  for (const c of cmds) {
    if (c.c === 'raw') d += shiftArcs(c.tail ?? '', left, top);
    else if (c.c === 'Z') d += 'Z';
    else d += c.c + c.pts.map((q) => P(sh(q))).join(' ');
  }
  void P;
  out.path = d; out.left = left; out.top = top; out.w = w; out.h = h;
  return out;
}

/** Shift the end points of `A rx ry 0 0 sweep x y` commands by (-dx, -dy). */
function shiftArcs(s: string, dx: number, dy: number): string {
  return s.replace(/A([^\sA]+) ([^\sA]+) 0 0 (\d) ([^\sA]+) ([^\sA]+)/g, (_m, rx: string, ry: string, sw: string, x: string, y: string) => `A${rx} ${ry} 0 0 ${sw} ${num(Number(x) - dx)} ${num(Number(y) - dy)}`);
}
