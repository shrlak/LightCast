import { describe, expect, it } from 'vitest';
import {
  GLYPH_CLASSES, classify, cloudMatch, groupGlyphs, hasHandwritingApi, inkElementStroke, inkElements, inkTextBox, recognizeInkText, recognizeTemplates, toCloud,
  type HandwritingEnv, type Stroke,
} from '../src/domain/inkText';
import { makeInk } from '../src/domain/editOps';
import type { SlideElement } from '../src/domain/types';

// ---- synthetic strokes --------------------------------------------------------------------------

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** A template distorted like a hand would: scale, slant, rotation, wobble, jitter, uneven sampling. */
function perturb(strokes: Stroke[], r: () => number, scale = 100): Stroke[] {
  const sx = 0.8 + r() * 0.4, sy = 0.8 + r() * 0.4, rot = (r() - 0.5) * 0.28, sh = (r() - 0.5) * 0.2, jit = 0.025;
  const wob = r() * 0.03, ph = r() * 6;
  return strokes.map((s, si) => {
    const dense: Stroke = [];
    for (let i = 0; i < s.length - 1; i++) {
      const k = 2 + Math.floor(r() * 4);
      for (let j = 0; j < k; j++) dense.push([s[i][0] + ((s[i + 1][0] - s[i][0]) * j) / k, s[i][1] + ((s[i + 1][1] - s[i][1]) * j) / k]);
    }
    dense.push(s[s.length - 1]);
    return dense.map(([x, y], i) => {
      let X = x * sx + sh * y, Y = y * sy;
      const c = Math.cos(rot), sn = Math.sin(rot);
      [X, Y] = [X * c - Y * sn, X * sn + Y * c];
      return [(X + (r() - 0.5) * jit * 2 + Math.sin(i / 3 + ph + si) * wob) * scale + 200, (Y + (r() - 0.5) * jit * 2 + Math.cos(i / 4 + ph) * wob) * scale + 300] as [number, number];
    });
  });
}

/** Glyphs drawn separately from the templates (other stroke counts and polygon arcs), in unit boxes: width, strokes. */
const poly = (cx: number, cy: number, rx: number, ry: number, n = 10): Stroke => Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2), cy + ry * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2)] as [number, number]);
const HAND: Record<string, { w: number; strokes: Stroke[] }> = {
  H: { w: 0.6, strokes: [[[0, 0], [0.02, 1]], [[0, 0.52], [0.6, 0.48]], [[0.6, 0], [0.58, 1]]] },
  E: { w: 0.55, strokes: [[[0.55, 0], [0, 0.02], [0, 0.5], [0.45, 0.5]], [[0, 0.5], [0.02, 1], [0.58, 1]]] },
  L: { w: 0.5, strokes: [[[0, 0], [0.02, 1], [0.5, 0.98]]] },
  O: { w: 0.8, strokes: [poly(0.4, 0.5, 0.4, 0.5)] },
  A: { w: 0.7, strokes: [[[0, 1], [0.34, 0]], [[0.34, 0], [0.7, 1]], [[0.12, 0.66], [0.58, 0.66]]] },
  T: { w: 0.7, strokes: [[[0, 0.02], [0.7, 0]], [[0.36, 0], [0.34, 1]]] },
  Z: { w: 0.65, strokes: [[[0, 0], [0.65, 0.02], [0.02, 0.98], [0.66, 1]]] },
  '0': { w: 0.55, strokes: [poly(0.275, 0.5, 0.27, 0.5)] },
  '1': { w: 0.3, strokes: [[[0.05, 0.25], [0.3, 0], [0.3, 1]]] },
  '2': { w: 0.6, strokes: [[[0, 0.22], [0.12, 0.04], [0.32, 0], [0.52, 0.08], [0.58, 0.28], [0.4, 0.55], [0, 1], [0.62, 1]]] },
  '4': { w: 0.65, strokes: [[[0.45, 0], [0, 0.66], [0.65, 0.66]], [[0.45, 0.2], [0.45, 1]]] },
  '7': { w: 0.6, strokes: [[[0, 0], [0.6, 0.02], [0.2, 1]]] },
  o: { w: 0.45, strokes: [poly(0.22, 0.5, 0.22, 0.5)] },
};
/** A line of hand-drawn characters, each `h` tall, left to right with a gap; lower-case `o` is drawn at 0.55 of the height at the baseline. */
function line(text: string, h = 120, gap = 0.35, x0 = 100, y0 = 200): Stroke[] {
  const out: Stroke[] = [];
  let x = x0;
  for (const ch of text) {
    if (ch === ' ') { x += h * 0.9; continue; }
    const g = HAND[ch];
    const k = ch === 'o' ? 0.55 : 1;
    const oy = y0 + (1 - k) * h;
    for (const s of g.strokes) out.push(s.map(([px, py]) => [x + px * h * k * (ch === 'o' ? 1.2 : 1), oy + py * h * k] as [number, number]));
    x += g.w * h * (ch === 'o' ? 0.66 : 1) + h * gap;
  }
  return out;
}

// ---- the template matcher ----------------------------------------------------------------------

describe('point clouds', () => {
  it('resamples every drawing to 32 points, centred, in a unit box', () => {
    const c = toCloud([[[0, 0], [100, 0]], [[50, 0], [50, 100]]])!;
    expect(c).toHaveLength(32);
    const mean = c.reduce((a, p) => [a[0] + p.x / 32, a[1] + p.y / 32], [0, 0]);
    expect(Math.abs(mean[0])).toBeLessThan(1e-9);
    expect(Math.abs(mean[1])).toBeLessThan(1e-9);
    expect(Math.max(...c.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))).toBeLessThanOrEqual(1);
    expect(toCloud([])).toBeNull();
    expect(toCloud([[[5, 5]]])).toBeNull();
  });

  it('ignores size, position and the order and direction the strokes were drawn in', () => {
    const t: Stroke[] = [[[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.5], [0.6, 0.5]]];
    const moved = t.map((s) => s.map(([x, y]) => [x * 90 + 400, y * 90 + 50] as [number, number])).reverse().map((s) => [...s].reverse());
    const same = cloudMatch(toCloud(t)!, toCloud(moved)!);
    const other: Stroke[] = [[[0, 0], [0.65, 1]], [[0.65, 0], [0, 1]]];
    const different = cloudMatch(toCloud(t)!, toCloud(other)!);
    expect(same).toBeLessThan(0.5); // resampling differs a little with the order, so not zero
    expect(different).toBeGreaterThan(same * 1.4);
  });
});

describe('the built-in glyphs', () => {
  it('covers 0-9, A-Z and a-z', () => {
    const covered = new Set<string>();
    for (const c of GLYPH_CLASSES) for (const ch of [c.digit, c.upper, c.lower]) if (ch) covered.add(ch);
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') expect(covered.has(ch), ch).toBe(true);
  });

  it('names its own templates, distorted by hand-like noise, about nine times in ten (synthetic strokes, not real handwriting)', { timeout: 120_000 }, () => {
    const r = rng(11);
    let ok = 0, n = 0;
    for (const cls of GLYPH_CLASSES) for (const v of cls.variants) for (let k = 0; k < 4; k++) {
      const res = classify(perturb(v, r));
      n++;
      if (res?.cls === cls) ok++;
    }
    expect(n).toBeGreaterThan(250);
    // Measured about 0.90 over 1280 draws; the margin keeps the test steady across seeds.
    expect(ok / n).toBeGreaterThan(0.82);
  });

  it('rejects scribbles instead of guessing', () => {
    const r = rng(5);
    let rejected = 0;
    for (let k = 0; k < 40; k++) {
      const st: Stroke[] = [];
      for (let i = 0; i < 1 + Math.floor(r() * 3); i++) {
        const pts: [number, number][] = [];
        let x = r() * 100, y = r() * 100;
        for (let j = 0; j < 25; j++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; pts.push([x, y]); }
        st.push(pts);
      }
      const res = recognizeTemplates(st);
      if (!res.ok || res.text === '') rejected++;
    }
    expect(rejected / 40).toBeGreaterThan(0.8);
  });
});

describe('reading a line', () => {
  it('groups strokes into characters by horizontal overlap (the bar across a t, the dot over an i)', () => {
    const glyphs = groupGlyphs(line('HEL'));
    expect(glyphs).toHaveLength(3);
    expect(glyphs.map((g) => g.strokes.length)).toEqual([3, 2, 1]);
    const dot: Stroke[] = [[[100, 100], [100, 190]], [[100, 60], [101, 64]], [[160, 100], [160, 190]]];
    expect(groupGlyphs(dot).map((g) => g.strokes.length)).toEqual([2, 1]);
  });

  it('reads hand-drawn capitals and digits', () => {
    const hello = recognizeTemplates(line('HELLO'));
    expect(hello).toMatchObject({ ok: true, engine: 'template' });
    expect(hello.ok && hello.text).toBe('HELLO');
    const year = recognizeTemplates(line('2024'));
    expect(year.ok && year.text).toBe('2024');
    const mixed = recognizeTemplates(line('47'));
    expect(mixed.ok && mixed.text).toBe('47');
  });

  it('puts a space where the gap is wide', () => {
    const r = recognizeTemplates([...line('HE'), ...line('AT', 120, 0.35, 100 + 450)]);
    expect(r.ok && r.text).toBe('HE AT');
  });

  it('decides the case of a look-alike letter by its height against the tall characters', () => {
    const upper = recognizeTemplates(line('HOT'));
    expect(upper.ok && upper.text).toBe('HOT');
    const lower = recognizeTemplates(line('HoT'));
    expect(lower.ok && lower.text).toBe('HoT');
  });

  it('turns an oval among digits into a zero and among letters into an O', () => {
    const digits = recognizeTemplates(line('2O24'));
    expect(digits.ok && digits.text).toBe('2024');
    const letters = recognizeTemplates(line('HOLE'));
    expect(letters.ok && letters.text).toBe('HOLE');
  });

  it('reports the height of the tallest character so the text can be sized', () => {
    const r = recognizeTemplates(line('HE', 120));
    expect(r.ok && r.capHeight).toBeGreaterThan(100);
    expect(r.ok && r.capHeight).toBeLessThan(140);
  });

  it('says what it could not do: empty ink, scribbles, and characters it drops', async () => {
    expect(await recognizeInkText([], {})).toEqual({ ok: false, reason: 'empty' });
    expect(await recognizeInkText([[[1, 1]]], {})).toEqual({ ok: false, reason: 'empty' });
    const r = rng(3);
    const scribble: Stroke = Array.from({ length: 40 }, () => [r() * 200, r() * 200] as [number, number]);
    expect(await recognizeInkText([scribble], {})).toEqual({ ok: false, reason: 'unavailable' });
    const partial = recognizeTemplates([...line('HE'), scribble.map(([x, y]) => [x + 400, y] as [number, number])]);
    expect(partial.ok && partial.skipped).toBeGreaterThanOrEqual(1);
    expect(partial.ok && partial.text.startsWith('HE')).toBe(true);
  });
});

// ---- the browser's recogniser -------------------------------------------------------------------

describe('the handwriting recognition API', () => {
  const fake = (answers: Record<string, string | null>, seen?: { strokes: number; points: number; langs: string[] }): HandwritingEnv => ({
    nav: {
      createHandwritingRecognizer: async ({ languages }) => {
        const lang = languages[0];
        seen?.langs.push(lang);
        if (answers[lang] === undefined) throw new Error('not installed');
        return {
          startDrawing: () => {
            const d = { strokes: 0 };
            return {
              addStroke: (s: unknown) => { d.strokes++; if (seen) { seen.strokes++; seen.points += ((s as { points?: unknown[] }).points ?? []).length; } },
              getPrediction: async () => (answers[lang] ? [{ text: answers[lang]! }] : []),
            };
          },
          finish: () => undefined,
        };
      },
    },
    Stroke: class { points: unknown[] = []; addPoint(p: unknown) { this.points.push(p); } },
  });
  const ink: Stroke[] = [[[0, 0], [10, 10], [20, 0]], [[5, 5], [15, 5]]];

  it('is detected by feature', () => {
    expect(hasHandwritingApi({})).toBe(false);
    expect(hasHandwritingApi({ nav: {} })).toBe(false);
    expect(hasHandwritingApi(fake({ ko: 'a' }))).toBe(true);
  });

  it('is used when it is there: Korean wins when the Korean reading has Hangul', async () => {
    const seen = { strokes: 0, points: 0, langs: [] as string[] };
    const r = await recognizeInkText(ink, fake({ ko: '안녕하세요', en: 'ahnyeong' }, seen));
    expect(r).toEqual({ ok: true, text: '안녕하세요', engine: 'handwriting', skipped: 0 });
    expect(seen.langs).toEqual(['ko', 'en']);
    expect(seen.strokes).toBe(4); // both strokes to both recognisers
    expect(seen.points).toBe(10);
  });

  it('falls to English when Korean returns Latin letters, and survives a missing language', async () => {
    expect((await recognizeInkText(ink, fake({ ko: 'Hel1o', en: 'Hello' }))) as { text: string }).toMatchObject({ text: 'Hello' });
    expect((await recognizeInkText(ink, fake({ en: 'Hello' }))) as { text: string }).toMatchObject({ text: 'Hello' });
  });

  it('falls back to the template reader when the API gives nothing', async () => {
    const r = await recognizeInkText(line('HE'), fake({ ko: null, en: null }));
    expect(r).toMatchObject({ ok: true, engine: 'template', text: 'HE' });
  });

  it('is not used when the browser has none: the template reader reads digits and letters', async () => {
    const r = await recognizeInkText(line('2024'), {});
    expect(r).toMatchObject({ ok: true, engine: 'template', text: '2024' });
  });
});

// ---- ink objects and the text box ---------------------------------------------------------------

describe('ink objects to a text box', () => {
  it('reads an ink object path back into canvas points', () => {
    const el = { path: 'M6 36 C8.5 40.2 16.8 56.3 21 61.2 L40 70', pathW: 112, pathH: 72, x: 94, y: 64, w: 224, h: 72 } as SlideElement;
    const pts = inkElementStroke(el);
    expect(pts[0]).toEqual([94 + 6 * 2, 64 + 36]); // x scaled by w / pathW = 2
    expect(pts[pts.length - 1]).toEqual([94 + 40 * 2, 64 + 70]);
    expect(pts.length).toBe(1 + 3 + 1 + 1);
  });

  it('a stroke made by the pen survives makeInk and reads back as the same character', async () => {
    const strokes = line('H', 160);
    const els = strokes.map((s) => makeInk(s, '#ffffff', 6, false)!);
    expect(els.every(Boolean)).toBe(true);
    const back = inkElements(els).map(inkElementStroke);
    const r = await recognizeInkText(back, {});
    expect(r).toMatchObject({ ok: true, text: 'H' });
  });

  it('sizes the text from the stroke height and puts the box at the ink', () => {
    const ink = [makeInk(line('H', 160)[0], '#ffcc00', 6, false)!, ...line('H', 160).slice(1).map((s) => makeInk(s, '#ffcc00', 6, false)!)];
    const box = inkTextBox('H', ink, 160);
    expect(box.kind).toBe('text');
    expect(box.text).toBe('H');
    expect(box.color).toBe('#ffcc00');
    expect(box.fontSize).toBe(Math.round(160 / 0.72));
    expect(box.x).toBeGreaterThan(90);
    expect(box.x).toBeLessThan(110);
    // A taller drawing gives a bigger font, a smaller one a smaller font.
    const small = inkTextBox('H', line('H', 60).map((s) => makeInk(s, '#fff', 6, false)!), 60);
    expect(small.fontSize!).toBeLessThan(box.fontSize!);
    const two = inkTextBox('a\nb', ink);
    expect(two.h).toBe(Math.round(two.fontSize! * 1.25 * 2));
  });
});
