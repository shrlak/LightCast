// 그리기 › 잉크를 텍스트로 (Draw › Ink to Text): hand-drawn strokes in, text out.
//
// There is no handwriting model in LightCast and none is added as a dependency. Two ways to read ink:
//
//  1. The browser's own handwriting recogniser, when there is one: Chromium's Handwriting Recognition
//     API (`navigator.createHandwritingRecognizer`, here with Korean `ko` and English `en`). Where it is
//     present this is the real thing and reads Korean and Latin text, several lines included. It is
//     still an origin-trial / flagged API, so on most installs it is absent.
//  2. Otherwise a small recogniser of our own, written out below and honest about what it is: a point-
//     cloud template matcher ("$P", Vatavu et al. 2012) over built-in skeletons for the digits 0-9 and
//     the Latin letters A-Z / a-z. Strokes are grouped into characters by horizontal overlap, each
//     character is resampled to 32 points, scaled and centred, and the nearest template wins; stroke
//     order and count do not matter. Upper / lower case of look-alike letters (c C, o O, s S, v V, w W,
//     x X, z Z, k K, p P, u U) is decided by size against the tallest character on the line, 0 / O and
//     1 / I / l and 9 / q by their neighbours. It reads ONE line of separate, upright block-style
//     characters. It does not read cursive, Hangul, punctuation, accents or several lines, and its
//     accuracy on real handwriting has not been measured: only on synthetic strokes (see the tests).
//     A character it is not sure about is dropped rather than guessed, and the caller is told.
//
// Pure: canvas points in, text out. `inkTextBox` turns the result into a text box at the ink.
import { uid } from './lyrics';
import { newTextBox } from './textFit';
import type { SlideElement } from './types';

export type Pt = [number, number];
export type Stroke = Pt[];

// ---- the skeleton templates --------------------------------------------------------------------
// Drawn on a frame where the cap line is y = 0, the baseline y = 1, the x-height line y = 0.38 and the
// descender reaches 1.35; x grows to the right. Angles are degrees, 0 to the right, 90 down.

/** Points along an ellipse arc; a1 below a0 runs counter-clockwise on screen. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Stroke {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 15));
  const out: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
const cat = (...parts: Stroke[]): Stroke => parts.flat();

export interface Cls {
  /** The characters this shape can be, by context. */
  digit?: string;
  upper?: string;
  lower?: string;
  /** Upper / lower decided by size against the line (the shape is the same either way). */
  bySize?: boolean;
  /** A character that stands as tall as a capital (reference for the size rule). */
  tall?: boolean;
  variants: Stroke[][];
}

const bar = (x: number, y0 = 0, y1 = 1): Stroke => [[x, y0], [x, y1]];
const bowl = (cx = 0.28, cy = 0.69, rx = 0.28, ry = 0.31): Stroke => arc(cx, cy, rx, ry, -90, 270);

const CLASSES: Cls[] = [
  // digits
  { digit: '0', upper: 'O', lower: 'o', bySize: true, tall: true, variants: [[arc(0.3, 0.5, 0.3, 0.5, -90, 270)], [arc(0.4, 0.5, 0.4, 0.5, -90, 270)]] },
  { digit: '1', upper: 'I', lower: 'l', tall: true, variants: [[[[0.1, 0.25], [0.35, 0], [0.35, 1]]], [bar(0.3)], [[[0.1, 0.25], [0.35, 0], [0.35, 1]], [[0.1, 1], [0.6, 1]]], [[[0.1, 0], [0.5, 0]], bar(0.3), [[0.1, 1], [0.5, 1]]]] },
  { digit: '2', tall: true, variants: [[cat(arc(0.35, 0.3, 0.3, 0.3, -180, 30), [[0.05, 1], [0.65, 1]])]] },
  { digit: '3', tall: true, variants: [[cat(arc(0.33, 0.25, 0.28, 0.25, -150, 90), arc(0.33, 0.74, 0.32, 0.26, -90, 150))], [cat([[0.05, 0], [0.6, 0], [0.25, 0.45]], arc(0.3, 0.72, 0.32, 0.28, -90, 150))]] },
  { digit: '4', tall: true, variants: [[[[0.5, 0], [0, 0.7], [0.7, 0.7]], bar(0.5, 0.25, 1)], [cat([[0.5, 0], [0, 0.7], [0.7, 0.7]]), [[0.5, 0], [0.5, 1]]], [[[0, 0], [0, 0.6], [0.6, 0.6]], [[0.6, 0], [0.6, 1]]]] },
  { digit: '5', tall: true, variants: [[[[0.62, 0], [0.12, 0], [0.06, 0.45]], arc(0.33, 0.68, 0.3, 0.32, -120, 150)], [cat([[0.62, 0], [0.12, 0], [0.06, 0.45]], arc(0.33, 0.68, 0.3, 0.32, -120, 150))]] },
  { digit: '6', tall: true, variants: [[cat([[0.55, 0], [0.25, 0.3], [0.05, 0.65]], arc(0.33, 0.68, 0.3, 0.32, 180, 540))], [[[0.5, 0], [0.1, 0.5], [0.05, 0.68]], arc(0.33, 0.68, 0.3, 0.32, 0, 360)]] },
  { digit: '7', tall: true, variants: [[[[0.05, 0], [0.65, 0], [0.25, 1]]], [[[0.05, 0], [0.65, 0], [0.25, 1]], [[0.2, 0.5], [0.5, 0.5]]]] },
  { digit: '8', tall: true, variants: [[arc(0.35, 0.25, 0.25, 0.25, -90, 270), arc(0.35, 0.74, 0.3, 0.26, -90, 270)], [cat(arc(0.35, 0.25, 0.25, 0.25, 60, -240), arc(0.35, 0.74, 0.3, 0.26, -60, 240))]] },
  { digit: '9', lower: 'q', variants: [[arc(0.35, 0.28, 0.3, 0.28, 0, 360), [[0.65, 0.28], [0.62, 0.65], [0.3, 1]]], [arc(0.3, 0.28, 0.3, 0.28, 0, 360), bar(0.6, 0.28, 1)], [bowl(), bar(0.56, 0.38, 1.35)]] },
  // capitals whose shape is capital only
  { upper: 'A', tall: true, variants: [[[[0, 1], [0.35, 0], [0.7, 1]], [[0.14, 0.62], [0.56, 0.62]]]] },
  { upper: 'B', tall: true, variants: [[bar(0), cat([[0, 0], [0.3, 0]], arc(0.3, 0.25, 0.3, 0.25, -90, 90), [[0, 0.5]]), cat([[0, 0.5], [0.3, 0.5]], arc(0.3, 0.75, 0.38, 0.25, -90, 90), [[0, 1]])]] },
  { upper: 'D', tall: true, variants: [[bar(0), [[0, 0], [0.2, 0]], arc(0.2, 0.5, 0.5, 0.5, -90, 90), [[0.2, 1], [0, 1]]]] },
  { upper: 'E', tall: true, variants: [[[[0.6, 0], [0, 0], [0, 1], [0.6, 1]], [[0, 0.5], [0.45, 0.5]]]] },
  { upper: 'F', tall: true, variants: [[[[0.6, 0], [0, 0], [0, 1]], [[0, 0.5], [0.45, 0.5]]]] },
  { upper: 'G', tall: true, variants: [[cat(arc(0.38, 0.5, 0.38, 0.5, -35, -330), [[0.72, 0.72], [0.76, 0.55], [0.42, 0.55]])]] },
  { upper: 'H', tall: true, variants: [[bar(0), bar(0.65), [[0, 0.5], [0.65, 0.5]]]] },
  { upper: 'J', tall: true, variants: [[cat([[0.55, 0], [0.55, 0.7]], arc(0.3, 0.72, 0.25, 0.28, 0, 150))]] },
  { upper: 'L', tall: true, variants: [[[[0, 0], [0, 1], [0.55, 1]]]] },
  { upper: 'M', tall: true, variants: [[[[0, 1], [0, 0], [0.4, 0.7], [0.8, 0], [0.8, 1]]]] },
  { upper: 'N', tall: true, variants: [[[[0, 1], [0, 0], [0.65, 1], [0.65, 0]]]] },
  { upper: 'Q', tall: true, variants: [[arc(0.4, 0.5, 0.4, 0.5, -90, 270), [[0.4, 0.7], [0.72, 1.05]]]] },
  { upper: 'R', tall: true, variants: [[bar(0), cat([[0, 0], [0.3, 0]], arc(0.3, 0.27, 0.3, 0.27, -90, 90), [[0, 0.55]]), [[0.25, 0.55], [0.65, 1]]]] },
  { upper: 'T', tall: true, variants: [[[[0, 0], [0.7, 0]], bar(0.35)]] },
  { upper: 'Y', tall: true, variants: [[[[0, 0], [0.35, 0.5], [0.7, 0]], bar(0.35, 0.5, 1)]] },
  // same shape, case by size
  { upper: 'C', lower: 'c', bySize: true, variants: [[arc(0.38, 0.5, 0.38, 0.5, -40, -320)]] },
  { upper: 'K', lower: 'k', bySize: true, tall: false, variants: [[bar(0), [[0.6, 0], [0, 0.6]], [[0.2, 0.45], [0.65, 1]]]] },
  { upper: 'P', lower: 'p', bySize: true, variants: [[bar(0), cat([[0, 0], [0.3, 0]], arc(0.3, 0.27, 0.3, 0.27, -90, 90), [[0, 0.55]])]] },
  { upper: 'S', lower: 's', bySize: true, variants: [[cat(arc(0.35, 0.26, 0.3, 0.26, -30, -270), arc(0.35, 0.76, 0.32, 0.26, -90, 150))]] },
  { upper: 'U', lower: 'u', bySize: true, variants: [[cat([[0, 0], [0, 0.65]], arc(0.33, 0.65, 0.33, 0.35, 180, 0), [[0.66, 0]]), [[0.66, 0], [0.66, 1]]]] },
  { upper: 'V', lower: 'v', bySize: true, variants: [[[[0, 0], [0.35, 1], [0.7, 0]]]] },
  { upper: 'W', lower: 'w', bySize: true, variants: [[[[0, 0], [0.2, 1], [0.45, 0.3], [0.7, 1], [0.9, 0]]]] },
  { upper: 'X', lower: 'x', bySize: true, variants: [[[[0, 0], [0.65, 1]], [[0.65, 0], [0, 1]]]] },
  { upper: 'Z', lower: 'z', bySize: true, variants: [[[[0, 0], [0.65, 0], [0, 1], [0.65, 1]]]] },
  // lower-case shapes
  { lower: 'a', variants: [[bowl(0.28, 0.69, 0.28, 0.31), bar(0.56, 0.38, 1)], [[[0.04, 0.48], [0.22, 0.38], [0.45, 0.4], [0.5, 0.55], [0.5, 1]], [[0.5, 0.68], [0.2, 0.66], [0.04, 0.82], [0.2, 1], [0.5, 0.95]]]] },
  { lower: 'b', tall: true, variants: [[bar(0), bowl(0.3, 0.69, 0.3, 0.31)]] },
  { lower: 'd', tall: true, variants: [[bowl(0.3, 0.69, 0.3, 0.31), bar(0.6)]] },
  { lower: 'e', variants: [[[[0.02, 0.69], [0.58, 0.69]], arc(0.3, 0.69, 0.3, 0.31, 0, -320)], [cat([[0.02, 0.69], [0.58, 0.69]], arc(0.3, 0.69, 0.3, 0.31, 0, -320))]] },
  { lower: 'f', tall: true, variants: [[[[0.55, 0.08], [0.4, 0], [0.28, 0.1], [0.28, 1]], [[0.05, 0.38], [0.5, 0.38]]]] },
  { lower: 'g', variants: [[bowl(0.28, 0.69, 0.28, 0.31), [[0.56, 0.38], [0.56, 1.05], [0.4, 1.33], [0.15, 1.3], [0.03, 1.2]]]] },
  { lower: 'h', tall: true, variants: [[bar(0), [[0, 0.6], [0.15, 0.4], [0.4, 0.4], [0.55, 0.55], [0.55, 1]]]] },
  { lower: 'i', variants: [[bar(0.2, 0.38, 1), [[0.2, 0.12], [0.2, 0.16]]]] },
  { lower: 'j', variants: [[[[0.25, 0.38], [0.25, 1.2], [0.1, 1.35], [0, 1.3]], [[0.25, 0.12], [0.25, 0.16]]]] },
  { lower: 'l', tall: true, variants: [[[[0.1, 0.1], [0.2, 0], [0.2, 0.9], [0.35, 1]]]] },
  { lower: 'm', variants: [[bar(0, 0.38, 1), [[0, 0.55], [0.12, 0.4], [0.3, 0.4], [0.4, 0.55], [0.4, 1]], [[0.4, 0.55], [0.52, 0.4], [0.7, 0.4], [0.8, 0.55], [0.8, 1]]]] },
  { lower: 'n', variants: [[bar(0, 0.38, 1), [[0, 0.55], [0.15, 0.4], [0.38, 0.4], [0.5, 0.55], [0.5, 1]]]] },
  { lower: 'r', variants: [[bar(0, 0.38, 1), [[0, 0.6], [0.12, 0.42], [0.35, 0.4]]]] },
  { lower: 't', tall: true, variants: [[[[0.25, 0.05], [0.25, 0.9], [0.4, 1]], [[0.02, 0.38], [0.5, 0.38]]]] },
  { lower: 'y', variants: [[[[0, 0.38], [0.3, 1]], [[0.6, 0.38], [0.25, 1.1], [0.1, 1.35]]]] },
];

// ---- the point-cloud matcher ($P) --------------------------------------------------------------

const N = 32;
const dist = (a: Pt, b: Pt) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
interface CPt { x: number; y: number; id: number }

/** All strokes as one cloud of N points (spaced evenly along the combined stroke length), scaled to a unit box by its longer side and centred on its centroid. */
export function toCloud(strokes: Stroke[]): CPt[] | null {
  const clean = strokes.map((s) => s.filter((p, i) => i === 0 || dist(p, s[i - 1]) > 1e-9)).filter((s) => s.length > 0);
  if (!clean.length) return null;
  const length = clean.reduce((t, s) => t + s.reduce((a, p, i) => (i ? a + dist(s[i - 1], p) : 0), 0), 0);
  const out: CPt[] = [];
  if (length < 1e-9) return null;
  const step = length / (N - 1);
  let carry = 0;
  clean.forEach((s, id) => {
    out.push({ x: s[0][0], y: s[0][1], id });
    let prev = s[0];
    for (let i = 1; i < s.length; i++) {
      const cur = s[i];
      let d = dist(prev, cur);
      while (carry + d >= step && d > 0) {
        const t = (step - carry) / d;
        const q: Pt = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
        out.push({ x: q[0], y: q[1], id });
        prev = q; d = dist(prev, cur); carry = 0;
      }
      carry += d;
      prev = cur;
    }
    carry = 0;
  });
  // The resampling can land a point or two off N; thin or pad evenly to exactly N.
  while (out.length > N) out.splice(Math.floor(out.length / 2), 1);
  while (out.length < N) out.push({ ...out[out.length - 1] });
  const xs = out.map((p) => p.x), ys = out.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
  const scaled = out.map((p) => ({ x: (p.x - x0) / size, y: (p.y - y0) / size, id: p.id }));
  const cx = scaled.reduce((a, p) => a + p.x, 0) / N, cy = scaled.reduce((a, p) => a + p.y, 0) / N;
  return scaled.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}

function cloudDistance(a: CPt[], b: CPt[], start: number): number {
  const matched = new Array<boolean>(N).fill(false);
  let sum = 0, i = start;
  do {
    let min = Infinity, at = -1;
    for (let j = 0; j < N; j++) {
      if (matched[j]) continue;
      const d = (a[i].x - b[j].x) ** 2 + (a[i].y - b[j].y) ** 2;
      if (d < min) { min = d; at = j; }
    }
    matched[at] = true;
    const weight = 1 - ((i - start + N) % N) / N;
    sum += weight * Math.sqrt(min);
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}
/** Greedy cloud match, both directions, from several starting points. Lower is closer. */
export function cloudMatch(a: CPt[], b: CPt[]): number {
  const step = Math.floor(Math.pow(N, 0.5));
  let min = Infinity;
  for (let i = 0; i < N; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  return min;
}

interface Template { cls: Cls; cloud: CPt[] }
let library: Template[] | null = null;
const templates = (): Template[] => {
  if (!library) {
    library = [];
    for (const cls of CLASSES) for (const v of cls.variants) { const cloud = toCloud(v); if (cloud) library.push({ cls, cloud }); }
  }
  return library;
};

/** A character whose best template is farther than this is not read (calibrated on synthetic strokes: 97% of distorted genuine characters fall under it and 95% of random scribbles over it; real handwriting is not measured). */
export const REJECT_DISTANCE = 1.35;

/** The nearest template to one character's strokes. */
export function classify(strokes: Stroke[]): { cls: Cls; distance: number; runnerUp?: { cls: Cls; distance: number } } | null {
  const cloud = toCloud(strokes);
  if (!cloud) return null;
  let best: { cls: Cls; distance: number } | null = null;
  let second: { cls: Cls; distance: number } | null = null;
  const seen = new Map<Cls, number>();
  for (const t of templates()) {
    const d = cloudMatch(cloud, t.cloud);
    const prev = seen.get(t.cls);
    if (prev === undefined || d < prev) seen.set(t.cls, d);
  }
  for (const [cls, distance] of seen) {
    if (!best || distance < best.distance) { second = best; best = { cls, distance }; }
    else if (!second || distance < second.distance) second = { cls, distance };
  }
  return best ? { ...best, runnerUp: second ?? undefined } : null;
}

// ---- characters, words, lines ------------------------------------------------------------------

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxOf = (pts: Pt[]): Box => ({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) });
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

interface Glyph { strokes: Stroke[]; box: Box }

/** Strokes grouped into characters left to right: strokes whose horizontal extents overlap belong together (a dot over an i, the bar across a t). */
export function groupGlyphs(strokes: Stroke[]): Glyph[] {
  const items = strokes.filter((s) => s.length > 0).map((s) => ({ s, box: boxOf(s) })).sort((a, b) => a.box.x0 - b.box.x0);
  if (!items.length) return [];
  const medH = [...items.map((i) => i.box.y1 - i.box.y0)].sort((a, b) => a - b)[Math.floor(items.length / 2)] || 1;
  const glyphs: Glyph[] = [];
  for (const it of items) {
    const g = glyphs[glyphs.length - 1];
    if (g) {
      const overlap = Math.min(g.box.x1, it.box.x1) - Math.max(g.box.x0, it.box.x0);
      const narrow = Math.min(g.box.x1 - g.box.x0, it.box.x1 - it.box.x0);
      // Overlapping extents merge; so does a tiny mark (a dot) that lies within the glyph's span.
      const inside = it.box.x1 - it.box.x0 < medH * 0.2 && it.box.x0 >= g.box.x0 - medH * 0.1 && it.box.x1 <= g.box.x1 + medH * 0.1;
      if (inside || overlap > Math.max(narrow, 1) * 0.15 || (narrow < medH * 0.12 && overlap >= 0)) { g.strokes.push(it.s); g.box = union(g.box, it.box); continue; }
    }
    glyphs.push({ strokes: [it.s], box: it.box });
  }
  return glyphs;
}

export type InkTextResult =
  | { ok: true; text: string; engine: 'handwriting' | 'template'; /** Characters that were drawn but not read (template reader only). */ skipped: number; /** The tallest character's height in canvas px (template reader), to size the text. */ capHeight?: number }
  | { ok: false; reason: 'empty' | 'unavailable' | 'unrecognized' };

/** Reads one line of separate block-style characters with the template matcher. Pure and synchronous. */
export function recognizeTemplates(strokes: Stroke[]): InkTextResult {
  const glyphs = groupGlyphs(strokes);
  if (!glyphs.length) return { ok: false, reason: 'empty' };
  const heights = glyphs.map((g) => g.box.y1 - g.box.y0);
  const medH = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)] || 1;
  interface Read { glyph: Glyph; cls: Cls | null }
  const reads: Read[] = glyphs.map((glyph) => {
    const w = glyph.box.x1 - glyph.box.x0, h = glyph.box.y1 - glyph.box.y0;
    if (Math.max(w, h) < 4) return { glyph, cls: null }; // a speck
    const r = classify(glyph.strokes);
    return { glyph, cls: r && r.distance <= REJECT_DISTANCE ? r.cls : null };
  });
  const known = reads.filter((r) => r.cls);
  if (!known.length) return { ok: false, reason: 'unrecognized' };

  // Context: digits against letters among the characters that can only be one of them.
  const digits = known.filter((r) => r.cls!.digit && !r.cls!.upper && !r.cls!.lower).length;
  const letters = known.filter((r) => !r.cls!.digit).length;
  const preferDigit = digits >= letters;
  // Size reference for the case of look-alike letters: the tallest character that stands as tall as a capital.
  const tallRefs = known.filter((r) => r.cls!.tall && (r.cls!.upper || r.cls!.digit) && !(r.cls!.bySize)).map((r) => r.glyph.box.y1 - r.glyph.box.y0);
  const ref = tallRefs.length ? Math.max(...tallRefs) : 0;
  const lowerNeighbours = known.some((r) => !!r.cls!.lower && !r.cls!.digit && !r.cls!.upper);

  const pieces: { x0: number; x1: number; text: string }[] = [];
  let skipped = 0;
  for (const r of reads) {
    const c = r.cls;
    if (!c) { skipped++; continue; }
    const h = r.glyph.box.y1 - r.glyph.box.y0;
    let ch: string;
    if (c.digit && (c.upper || c.lower)) {
      // 0 / O / o, 1 / I / l, 9 / q
      if (preferDigit) ch = c.digit;
      else if (c.bySize) ch = ref && h < ref * 0.72 ? c.lower! : c.upper!;
      else ch = c.lower && lowerNeighbours ? c.lower : (c.upper ?? c.lower)!;
    } else if (c.bySize) ch = ref && h < ref * 0.72 ? c.lower! : c.upper!;
    else ch = (c.digit ?? c.upper ?? c.lower)!;
    pieces.push({ x0: r.glyph.box.x0, x1: r.glyph.box.x1, text: ch });
  }
  // Spaces where the gap between characters is wide.
  let text = '';
  pieces.forEach((p, i) => {
    if (i && p.x0 - pieces[i - 1].x1 > Math.max(ref, medH) * 0.75) text += ' ';
    text += p.text;
  });
  const capHeight = Math.max(ref, ...known.map((r) => (r.cls!.tall ? r.glyph.box.y1 - r.glyph.box.y0 : 0)));
  return { ok: true, text, engine: 'template', skipped, capHeight: capHeight || undefined };
}

// ---- the browser's handwriting recogniser ------------------------------------------------------

interface HwPoint { x: number; y: number; t?: number }
interface HwStroke { addPoint(p: HwPoint): void }
interface HwDrawing { addStroke(s: HwStroke): void; getPrediction(): Promise<{ text: string }[]>; clear?(): void }
interface HwRecognizer { startDrawing(hints?: Record<string, unknown>): HwDrawing; finish(): void }
export interface HandwritingEnv {
  nav?: { createHandwritingRecognizer?: (c: { languages: string[] }) => Promise<HwRecognizer> };
  Stroke?: new () => HwStroke;
}

const browserEnv = (): HandwritingEnv => ({
  nav: typeof navigator !== 'undefined' ? (navigator as unknown as HandwritingEnv['nav']) : undefined,
  Stroke: (globalThis as unknown as { HandwritingStroke?: HandwritingEnv['Stroke'] }).HandwritingStroke,
});

/** Is the browser's handwriting recogniser there? */
export const hasHandwritingApi = (env: HandwritingEnv = browserEnv()): boolean => typeof env.nav?.createHandwritingRecognizer === 'function' && typeof env.Stroke === 'function';

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** Reads with the browser's recogniser, Korean and English; the Korean reading wins when it contains Hangul, else English, else whatever came back. */
async function recognizeHandwritingApi(strokes: Stroke[], env: HandwritingEnv): Promise<string | null> {
  const results: Record<string, string> = {};
  for (const lang of ['ko', 'en']) {
    let rec: HwRecognizer | null = null;
    try {
      rec = await env.nav!.createHandwritingRecognizer!({ languages: [lang] });
      const drawing = rec.startDrawing({ recognitionType: 'text', inputType: 'mouse', alternatives: 1 });
      let t = 0;
      for (const s of strokes) {
        const hs = new env.Stroke!();
        for (const [x, y] of s) { hs.addPoint({ x, y, t }); t += 8; }
        drawing.addStroke(hs);
        t += 120;
      }
      const best = (await drawing.getPrediction())?.[0]?.text?.trim();
      if (best) results[lang] = best;
    } catch { /* this language is not installed here */ } finally {
      try { rec?.finish(); } catch { /* nothing to release */ }
    }
  }
  if (results.ko && HANGUL.test(results.ko)) return results.ko;
  return results.en ?? results.ko ?? null;
}

/**
 * Ink to text. The browser's handwriting recogniser when it is there, else the template matcher for
 * digits and Latin letters. `unavailable` means neither can read this (no recogniser and nothing the
 * template matcher knows).
 */
export async function recognizeInkText(strokes: Stroke[], env: HandwritingEnv = browserEnv()): Promise<InkTextResult> {
  const usable = strokes.filter((s) => s.length > 1);
  if (!usable.length) return { ok: false, reason: 'empty' };
  if (hasHandwritingApi(env)) {
    const text = await recognizeHandwritingApi(usable, env);
    if (text) return { ok: true, text, engine: 'handwriting', skipped: 0 };
  }
  const r = recognizeTemplates(usable);
  if (!r.ok && r.reason === 'unrecognized') return { ok: false, reason: 'unavailable' };
  return r;
}

// ---- ink objects to strokes and back to a text box ---------------------------------------------

/** The points of an ink object's path (M / L / C / Q with absolute coordinates, curves sampled), in canvas px. */
export function inkElementStroke(el: Pick<SlideElement, 'path' | 'pathW' | 'pathH' | 'x' | 'y' | 'w' | 'h'>): Stroke {
  const path = el.path ?? '';
  const kx = el.pathW ? el.w / el.pathW : 1, ky = el.pathH ? el.h / el.pathH : 1;
  const out: Stroke = [];
  let cur: Pt | null = null;
  const put = (p: Pt) => { out.push([el.x + p[0] * kx, el.y + p[1] * ky]); cur = p; };
  for (const m of path.matchAll(/([MLCQ])([^MLCQZ]*)/g)) {
    const n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    if (m[1] === 'M' || m[1] === 'L') { for (let i = 0; i + 1 < n.length; i += 2) put([n[i], n[i + 1]]); }
    else if (m[1] === 'C') {
      for (let i = 0; i + 5 < n.length; i += 6) {
        const p0 = cur ?? [n[i], n[i + 1]] as Pt;
        for (const t of [0.25, 0.5, 0.75]) {
          const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
          put([a * p0[0] + b * n[i] + c * n[i + 2] + d * n[i + 4], a * p0[1] + b * n[i + 1] + c * n[i + 3] + d * n[i + 5]]);
        }
        put([n[i + 4], n[i + 5]]);
      }
    } else if (m[1] === 'Q') {
      for (let i = 0; i + 3 < n.length; i += 4) {
        const p0 = cur ?? [n[i], n[i + 1]] as Pt;
        for (const t of [0.5]) { const u = 1 - t; put([u * u * p0[0] + 2 * u * t * n[i] + t * t * n[i + 2], u * u * p0[1] + 2 * u * t * n[i + 1] + t * t * n[i + 3]]); }
        put([n[i + 2], n[i + 3]]);
      }
    }
  }
  return out;
}

/** The ink objects among `els` (by id when given), left to right. */
export const inkElements = (els: SlideElement[], ids?: string[]): SlideElement[] => els.filter((e) => e.kind === 'ink' && !!e.path && (!ids || ids.includes(e.id)));

/** A text box holding `text` at the ink: left edge and baseline of the ink, a font size from the stroke height. */
export function inkTextBox(text: string, ink: SlideElement[], capHeight?: number): SlideElement {
  const pts = ink.flatMap((e) => [[e.x, e.y], [e.x + e.w, e.y + e.h]] as Pt[]);
  const b = boxOf(pts);
  const pad = Math.max(0, ...ink.map((e) => e.strokeWidth ?? 0)); // makeInk grows each ink box by the pen width
  const inkH = Math.max(1, b.y1 - b.y0 - 2 * pad);
  const lines = text.split('\n').length;
  // A capital or digit is about 0.72 em tall; text made only of small letters reads smaller, so take 0.6.
  const fontSize = Math.max(12, Math.min(600, Math.round((capHeight && capHeight > 0 ? capHeight : inkH / lines) / (capHeight ? 0.72 : 0.62))));
  const el = newTextBox(uid('el'), { x: b.x0 + pad, y: b.y0 + pad - fontSize * 0.14 });
  const color = ink[0]?.stroke && ink[0].stroke !== 'transparent' ? ink[0].stroke : '#ffffff';
  return { ...el, text, fontSize, color, h: Math.round(fontSize * 1.25 * lines), name: '잉크 텍스트' };
}

/** The built-in glyph classes (for tests). */
export const GLYPH_CLASSES: readonly Cls[] = CLASSES;
