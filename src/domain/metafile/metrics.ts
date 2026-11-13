// Text widths for the SVG a metafile becomes. With a DOM, canvas measureText gives the real width in
// the font the browser will use; without one (node, tests, workers) built-in per-character width
// tables (Helvetica / Times / Courier, 1000 units per em; CJK and Hangul full width) are used.
// Either way the result is an estimate: the font the picture was made with is rarely installed.

const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921,
  722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333,
  444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];

type Kind = 'sans' | 'serif' | 'mono';
const kindOf = (family: string): Kind => {
  const f = family.toLowerCase();
  if (/courier|consolas|mono|gulimche|batangche|simsun|ms gothic/.test(f)) return 'mono';
  if (/times|georgia|serif|batang|myungjo|ming|song|palatino|garamond|cambria|book/.test(f) && !/sans/.test(f)) return 'serif';
  return 'sans';
};

function wideChar(c: number): boolean {
  return (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x20000;
}

/** Width of `text` in em, from the tables. */
export function tableWidthEm(text: string, family: string, bold = false): number {
  const kind = kindOf(family);
  const table = kind === 'serif' ? TIMES : HELV;
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x2e80 && wideChar(c)) w += 1000;
    else if (kind === 'mono') w += 600;
    else if (c >= 32 && c <= 126) w += table[c - 32];
    else if (wideChar(c)) w += 1000;
    else if (c === 9) w += 4 * table[0];
    else if (c < 32) w += 0;
    else w += c < 0x250 ? 556 : 600; // other Latin, Greek, Cyrillic: a typical letter
  }
  return (w / 1000) * (bold && kind !== 'mono' ? 1.06 : 1);
}

type Measurer = { font: string; measureText(s: string): { width: number } };
let ctx: Measurer | null | undefined;
const cache = new Map<string, number>();

function canvas(): Measurer | null {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const g = document.createElement('canvas').getContext('2d');
      // jsdom-style stubs return null or throw; only a real context measures.
      if (g && typeof g.measureText === 'function') ctx = g;
    }
  } catch { ctx = null; }
  return ctx;
}

/** Width of `text` in CSS px at `size` px. Never throws. */
export function textWidth(text: string, family: string, size: number, bold = false, italic = false): number {
  if (!text) return 0;
  const fam = family.replace(/['"\\<>&]/g, '');
  const g = canvas();
  if (g) {
    try {
      const key = `${fam}|${bold}|${italic}|${text}`;
      let w = cache.get(key);
      if (w === undefined) {
        g.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px '${fam}', 'Malgun Gothic', 'Apple SD Gothic Neo', Arial, sans-serif`;
        w = g.measureText(text).width / 100;
        if (!Number.isFinite(w) || w < 0) throw new Error('width');
        if (cache.size > 5000) cache.clear();
        cache.set(key, w);
      }
      return w * size;
    } catch { /* fall through to the tables */ }
  }
  return tableWidthEm(text, fam, bold) * size;
}
