// Edit Points: a custom outline (absolute M / L / C / Q / Z commands, as the engine writes them)
// as anchor points that can be dragged; control points travel with their anchor.
export interface Seg { cmd: 'M' | 'L' | 'C' | 'Q' | 'Z'; pts: [number, number][] }

export function parsePath(d: string): Seg[] {
  const out: Seg[] = [];
  const re = /([MLCQZmlcqz])([^MLCQZmlcqz]*)/g;
  let m: RegExpExecArray | null;
  let cur: [number, number] = [0, 0];
  while ((m = re.exec(d))) {
    const c = m[1];
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const up = c.toUpperCase() as Seg['cmd'];
    const rel = c !== up;
    if (up === 'Z') { out.push({ cmd: 'Z', pts: [] }); continue; }
    const per = up === 'C' ? 6 : up === 'Q' ? 4 : 2;
    for (let i = 0; i + per <= nums.length; i += per) {
      const pts: [number, number][] = [];
      for (let k = 0; k < per; k += 2) pts.push(rel ? [cur[0] + nums[i + k], cur[1] + nums[i + k + 1]] : [nums[i + k], nums[i + k + 1]]);
      // Extra pairs after a moveto are linetos.
      out.push({ cmd: up === 'M' && i > 0 ? 'L' : up, pts });
      cur = pts[pts.length - 1];
    }
  }
  return out;
}

const n = (v: number) => String(Math.round(v * 100) / 100);
export const writePath = (segs: Seg[]) => segs.map((s) => (s.cmd === 'Z' ? 'Z' : `${s.cmd}${s.pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' ')}`)).join(' ');

/** The anchors (end points of each segment) with the segment each belongs to. */
export const anchors = (segs: Seg[]) => segs.flatMap((s, i) => (s.cmd === 'Z' ? [] : [{ seg: i, p: s.pts[s.pts.length - 1] }]));

/** Move anchor `seg` by (dx, dy): its incoming control point and the next segment's outgoing one go with it. */
export function moveAnchor(segs: Seg[], seg: number, dx: number, dy: number): Seg[] {
  return segs.map((s, i) => {
    if (i === seg) return { ...s, pts: s.pts.map((p, k) => (k === s.pts.length - 1 || (s.cmd === 'C' && k === 1) ? [p[0] + dx, p[1] + dy] as [number, number] : p)) };
    if (i === seg + 1 && s.cmd === 'C') return { ...s, pts: s.pts.map((p, k) => (k === 0 ? [p[0] + dx, p[1] + dy] as [number, number] : p)) };
    return s;
  });
}

/** Bounds of all points, to re-fit an edited outline to its box. */
export function bounds(segs: Seg[]): { x: number; y: number; w: number; h: number } {
  const pts = segs.flatMap((s) => s.pts);
  if (!pts.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

export const shiftPath = (segs: Seg[], dx: number, dy: number): Seg[] => segs.map((s) => ({ ...s, pts: s.pts.map((p) => [p[0] + dx, p[1] + dy] as [number, number]) }));

// ── Edit Points operations (DeckCraft shape.addPoint / deletePoint / pointType / segmentType /
// deleteSegment / openPath / closePath) on the same absolute M / L / C / Q / Z commands. ─────────
type P = [number, number];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The point a segment starts from (the previous anchor), or null for a moveto. */
export function segStart(segs: Seg[], i: number): P | null {
  if (segs[i]?.cmd === 'M') return null;
  for (let j = i - 1; j >= 0; j--) {
    if (segs[j].cmd === 'Z') {
      // After a close, drawing continues from that subpath's start.
      for (let k = j - 1; k >= 0; k--) if (segs[k].cmd === 'M') return segs[k].pts[0];
      return null;
    }
    return segs[j].pts[segs[j].pts.length - 1];
  }
  return null;
}

/** A point on segment i at parameter t. */
export function pointOn(segs: Seg[], i: number, t: number): P | null {
  const s = segs[i], a = segStart(segs, i);
  if (!s || !a || s.cmd === 'M' || s.cmd === 'Z') return null;
  if (s.cmd === 'L') return lerp(a, s.pts[0], t);
  if (s.cmd === 'Q') return lerp(lerp(a, s.pts[0], t), lerp(s.pts[0], s.pts[1], t), t);
  const [c1, c2, b] = s.pts;
  const ab = lerp(a, c1, t), bc = lerp(c1, c2, t), cd = lerp(c2, b, t);
  return lerp(lerp(ab, bc, t), lerp(bc, cd, t), t);
}

/** The segment and parameter nearest to `p` (path units), sampled. */
export function nearestOnPath(segs: Seg[], p: P, map: (q: P) => P = (q) => q): { seg: number; t: number; dist: number } | null {
  let best: { seg: number; t: number; dist: number } | null = null;
  segs.forEach((s, i) => {
    if (s.cmd === 'M' || s.cmd === 'Z') return;
    for (let k = 1; k < 32; k++) {
      const q = pointOn(segs, i, k / 32);
      if (!q) continue;
      const m = map(q);
      const d = Math.hypot(m[0] - p[0], m[1] - p[1]);
      if (!best || d < best.dist) best = { seg: i, t: k / 32, dist: d };
    }
  });
  return best;
}

/** 점 추가: split segment i at t; the new anchor is segment i (the old one becomes i + 1). */
export function insertPoint(segs: Seg[], i: number, t: number): Seg[] {
  const s = segs[i], a = segStart(segs, i);
  if (!s || !a || s.cmd === 'M' || s.cmd === 'Z') return segs;
  let first: Seg, second: Seg;
  if (s.cmd === 'L') {
    first = { cmd: 'L', pts: [lerp(a, s.pts[0], t)] };
    second = { cmd: 'L', pts: [s.pts[0]] };
  } else {
    const [c1, c2, b] = s.cmd === 'Q'
      ? [lerp(a, s.pts[0], 2 / 3), lerp(s.pts[1], s.pts[0], 2 / 3), s.pts[1]] as P[]
      : s.pts as P[];
    const ab = lerp(a, c1, t), bc = lerp(c1, c2, t), cd = lerp(c2, b, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
    first = { cmd: 'C', pts: [ab, abc, m] };
    second = { cmd: 'C', pts: [bcd, cd, b] };
  }
  return [...segs.slice(0, i), first, second, ...segs.slice(i + 1)];
}

/** The subpath (from its M to before the next M) holding segment i, and whether it is closed. */
function subpath(segs: Seg[], i: number): { start: number; end: number; closed: boolean } {
  let start = i;
  while (start > 0 && segs[start].cmd !== 'M') start--;
  let end = start + 1;
  while (end < segs.length && segs[end].cmd !== 'M') end++;
  return { start, end, closed: segs.slice(start, end).some((s) => s.cmd === 'Z') };
}

/** 점 삭제: the anchor at the end of segment i goes; its neighbours join. Needs two anchors left. */
export function deletePoint(segs: Seg[], i: number): Seg[] {
  const sp = subpath(segs, i);
  const count = segs.slice(sp.start, sp.end).filter((s) => s.cmd !== 'Z').length;
  if (count <= 2 || !segs[i] || segs[i].cmd === 'Z') return segs;
  if (segs[i].cmd === 'M') {
    // The first point: the next anchor starts the subpath.
    const next = segs[i + 1];
    if (!next || next.cmd === 'Z' || next.cmd === 'M') return segs;
    return [...segs.slice(0, i), { cmd: 'M', pts: [next.pts[next.pts.length - 1]] }, ...segs.slice(i + 2)];
  }
  const next = segs[i + 1];
  const keepCurve = segs[i].cmd === 'C' || next?.cmd === 'C';
  if (next && next.cmd !== 'M' && next.cmd !== 'Z') {
    const end = next.pts[next.pts.length - 1];
    const joined: Seg = keepCurve
      ? { cmd: 'C', pts: [segs[i].cmd === 'C' ? segs[i].pts[0] : segStart(segs, i)!, next.cmd === 'C' ? next.pts[1] : end, end] }
      : { cmd: 'L', pts: [end] };
    return [...segs.slice(0, i), joined, ...segs.slice(i + 2)];
  }
  return [...segs.slice(0, i), ...segs.slice(i + 1)];
}

/** 직선 세그먼트 / 곡선 세그먼트. */
export function setSegmentType(segs: Seg[], i: number, type: 'line' | 'curve'): Seg[] {
  const s = segs[i], a = segStart(segs, i);
  if (!s || !a || s.cmd === 'M' || s.cmd === 'Z') return segs;
  const b = s.pts[s.pts.length - 1];
  const next: Seg = type === 'line' ? { cmd: 'L', pts: [b] } : s.cmd === 'C' ? s : { cmd: 'C', pts: [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b] };
  return segs.map((x, k) => (k === i ? next : x));
}

/**
 * 부드러운 점 / 직선 점 / 꼭짓점 for the anchor ending segment i: smooth makes the two handles
 * one straight line with equal arms, straight keeps their lengths on one line, corner frees them.
 */
export function setPointType(segs: Seg[], i: number, type: 'smooth' | 'straight' | 'corner'): Seg[] {
  if (type === 'corner') return segs;
  let out = segs;
  const nextIdx = i + 1 < segs.length && segs[i + 1].cmd !== 'M' && segs[i + 1].cmd !== 'Z' ? i + 1 : -1;
  if (out[i]?.cmd === 'L' || out[i]?.cmd === 'Q') out = setSegmentType(out, i, 'curve');
  if (nextIdx >= 0 && (out[nextIdx].cmd === 'L' || out[nextIdx].cmd === 'Q')) out = setSegmentType(out, nextIdx, 'curve');
  const s = out[i];
  if (!s || s.cmd !== 'C' || nextIdx < 0) return out;
  const n = out[nextIdx];
  const p = s.pts[2], inH = s.pts[1], outH = n.pts[0];
  const vin: P = [p[0] - inH[0], p[1] - inH[1]], vout: P = [outH[0] - p[0], outH[1] - p[1]];
  const lin = Math.hypot(...vin) || 1, lout = Math.hypot(...vout) || 1;
  let dir: P = [vin[0] / lin + vout[0] / lout, vin[1] / lin + vout[1] / lout];
  const dl = Math.hypot(...dir) || 1;
  dir = [dir[0] / dl, dir[1] / dl];
  const [a, b] = type === 'smooth' ? [(lin + lout) / 2, (lin + lout) / 2] : [lin, lout];
  return out.map((x, k) => (k === i ? { ...x, pts: [x.pts[0], [p[0] - dir[0] * a, p[1] - dir[1] * a], x.pts[2]] } : k === nextIdx ? { ...x, pts: [[p[0] + dir[0] * b, p[1] + dir[1] * b], x.pts[1], x.pts[2]] } : x));
}

/** Move a Bézier handle: `which` 0 is segment i's first control point, 1 its second. */
export function moveControl(segs: Seg[], i: number, which: 0 | 1, dx: number, dy: number): Seg[] {
  return segs.map((s, k) => (k === i && s.cmd === 'C' ? { ...s, pts: s.pts.map((p, j) => (j === which ? [p[0] + dx, p[1] + dy] as P : p)) } : s));
}

/** A closed subpath rewritten to start (and stay open) at the anchor ending segment i. */
function openAt(segs: Seg[], i: number): Seg[] {
  const sp = subpath(segs, i);
  const body = segs.slice(sp.start, sp.end).filter((s) => s.cmd !== 'Z');
  const startPt = body[0].pts[0];
  const draw = body.slice(1);
  const last = draw[draw.length - 1]?.pts.slice(-1)[0];
  // The implicit closing line becomes a real segment.
  if (last && (last[0] !== startPt[0] || last[1] !== startPt[1])) draw.push({ cmd: 'L', pts: [startPt] });
  const k = i === sp.start ? draw.length - 1 : draw.findIndex((s) => s === segs[i]);
  const at = k < 0 ? draw.length - 1 : k;
  const rotated = [...draw.slice(at + 1), ...draw.slice(0, at + 1)];
  const anchor = draw[at].pts[draw[at].pts.length - 1];
  return [...segs.slice(0, sp.start), { cmd: 'M', pts: [anchor] }, ...rotated, ...segs.slice(sp.end)];
}

/** 경로 열기: a closed outline opened at this point. */
export const openPath = (segs: Seg[], i: number): Seg[] => (subpath(segs, i).closed ? openAt(segs, i) : segs);

/** 경로 닫기: the subpath gets its closing segment. */
export function closePath(segs: Seg[], i: number): Seg[] {
  const sp = subpath(segs, i);
  if (sp.closed) return segs;
  return [...segs.slice(0, sp.end), { cmd: 'Z', pts: [] }, ...segs.slice(sp.end)];
}

/** 세그먼트 삭제: segment i goes; a closed outline opens there, an open one splits in two. */
export function deleteSegment(segs: Seg[], i: number): Seg[] {
  const s = segs[i];
  if (!s || s.cmd === 'M' || s.cmd === 'Z') return segs;
  const sp = subpath(segs, i);
  if (sp.closed) {
    // Open the outline at the end of this segment, then drop it (now the last one).
    const opened = openAt(segs, i);
    const sp2 = subpath(opened, sp.start);
    return [...opened.slice(0, sp2.end - 1), ...opened.slice(sp2.end)];
  }
  const end = s.pts[s.pts.length - 1];
  return [...segs.slice(0, i), { cmd: 'M', pts: [end] }, ...segs.slice(i + 1)];
}
