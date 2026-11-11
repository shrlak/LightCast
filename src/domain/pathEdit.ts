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
