// Transitions › Morph, as DeckCraft does it (crates/anim/src/morph.rs): objects on the two slides
// are paired — first by a forced `!!name`, then by name, then by the same kind and text, then by
// the same kind and preset shape when neither carries text — and each pair moves, resizes, turns
// (the short way round) and changes colour from the old slide's look to the new one. Objects with
// no partner fade out (old) or in (new).
import type { SlideElement } from './types';

type Key = (e: SlideElement) => string | null;
const passes: Key[] = [
  (e) => (e.name?.startsWith('!!') ? `n:${e.name}` : null),
  (e) => (e.name ? `n:${e.name}` : null),
  (e) => (e.text?.trim() ? `t:${e.kind}:${e.text}` : null),
  (e) => (!e.text?.trim() && e.shape ? `g:${e.kind}:${e.shape}` : null),
];

/** Pairs of (old object id, new object id); each object is used once. */
export function morphPairs(a: SlideElement[], b: SlideElement[]): [string, string][] {
  const pairs: [string, string][] = [];
  const usedA = new Set<string>(), usedB = new Set<string>();
  for (const key of passes) {
    const index = new Map<string, string[]>();
    for (const e of b) {
      if (usedB.has(e.id)) continue;
      const k = key(e);
      if (k) index.set(k, [...(index.get(k) ?? []), e.id]);
    }
    if (!index.size) continue;
    for (const e of a) {
      if (usedA.has(e.id)) continue;
      const k = key(e);
      const j = k ? index.get(k)?.shift() : undefined;
      if (!j) continue;
      usedA.add(e.id);
      usedB.add(j);
      pairs.push([e.id, j]);
    }
  }
  return pairs;
}

/** Cubic smoothstep, DeckCraft's Morph easing. */
export const smooth = (p: number) => { const t = Math.max(0, Math.min(1, p)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mixHex(a: string | undefined, b: string | undefined, t: number): string | undefined {
  const re = /^#([0-9a-f]{6})$/i;
  if (!a || !b || !re.test(a) || !re.test(b)) return t < 0.5 ? a : b;
  const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((ca >> s) & 255, (cb >> s) & 255, t));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** An object between its old and new look at `t` (0..1, already eased). */
export function morphElement(a: SlideElement, b: SlideElement, t: number): SlideElement {
  let d = ((((b.rotation ?? 0) - (a.rotation ?? 0)) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  const late = t >= 0.5;
  return {
    ...(late ? b : a),
    id: b.id,
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
    rotation: (a.rotation ?? 0) + d * t || undefined,
    fill: mixHex(a.fill, b.fill, t), color: mixHex(a.color, b.color, t), stroke: mixHex(a.stroke, b.stroke, t),
    fontSize: a.fontSize && b.fontSize ? lerp(a.fontSize, b.fontSize, t) : (late ? b : a).fontSize,
    opacity: lerp(a.opacity ?? 1, b.opacity ?? 1, t),
  };
}

export interface MorphFrame {
  /** Paired objects with the same content, drawn once between their two looks. */
  moving: SlideElement[];
  /** Paired objects whose text changes: the old one fading out and the new one in, both moving. */
  fadingOut: SlideElement[];
  fadingIn: SlideElement[];
  /** Unpaired objects: old ones fade out, new ones fade in, where they are. */
  oldOnly: SlideElement[];
  newOnly: SlideElement[];
}

export function morphFrame(a: SlideElement[], b: SlideElement[], progress: number): MorphFrame {
  const t = smooth(progress);
  const pairs = morphPairs(a, b);
  const A = new Map(a.map((e) => [e.id, e])), B = new Map(b.map((e) => [e.id, e]));
  const f: MorphFrame = { moving: [], fadingOut: [], fadingIn: [], oldOnly: [], newOnly: [] };
  for (const [ia, ib] of pairs) {
    const ea = A.get(ia)!, eb = B.get(ib)!;
    const m = morphElement(ea, eb, t);
    if ((ea.text ?? '') === (eb.text ?? '')) f.moving.push(m);
    else {
      f.fadingOut.push({ ...m, id: `${ia}~old`, text: ea.text, runs: ea.runs, paragraphs: ea.paragraphs, opacity: (m.opacity ?? 1) * (1 - t) });
      f.fadingIn.push({ ...m, text: eb.text, runs: eb.runs, paragraphs: eb.paragraphs, opacity: (m.opacity ?? 1) * t });
    }
  }
  const pa = new Set(pairs.map((p) => p[0])), pb = new Set(pairs.map((p) => p[1]));
  f.oldOnly = a.filter((e) => !pa.has(e.id)).map((e) => ({ ...e, opacity: (e.opacity ?? 1) * (1 - t) }));
  f.newOnly = b.filter((e) => !pb.has(e.id)).map((e) => ({ ...e, opacity: (e.opacity ?? 1) * t }));
  return f;
}
