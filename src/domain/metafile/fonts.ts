// Font files the metafile reader may consult: fonts imported into LightCast and fonts that came inside a
// deck register their bytes here (importedFonts.ts, embeddedFonts.ts), so that
//   - glyph-index text (EMF ETO_GLYPH_INDEX, EMF+ DrawDriverString without character codes) is mapped
//     back to characters through the font's cmap (formats 4 and 12, reversed), and
//   - text widths come from the font's own advance widths (hmtx) instead of the built-in tables,
//   - a font height means what GDI makes of it (a positive LOGFONT height is the cell, ascent + descent,
//     from the Windows metrics in OS/2, else hhea), and
//   - flood fills see the pixels text covers, from the glyph outlines (glyf or CFF, outline.ts).
// Only the cmap / hmtx / hhea / head / maxp / name / OS/2 / post / glyf / loca / CFF tables are read,
// synchronously, from the sfnt bytes; bad data gives no font, never an exception.
import { outlineSource, type Outline } from './outline';

export interface MetafileFont {
  family: string;
  weight: number;
  italic: boolean;
  unitsPerEm: number;
  /** Glyph of a code point (0: none). */
  glyphOf(cp: number): number;
  /** Advance of a glyph in font units. */
  advance(glyph: number): number;
  /** The code point a glyph stands for (the lowest one that maps to it), or -1. */
  charOf(glyph: number): number;
  /** Cell ascent and descent (both positive), cap height, underline and strikeout position (above the baseline) and thickness, in font units. */
  ascent: number;
  descent: number;
  capHeight: number;
  underline: [number, number];
  strike: [number, number];
  /** The glyph's outline in font units, y up (null: the font has no outlines this reader can read). */
  outline(glyph: number): Outline | null;
}

const MAX_FONTS = 64;
const MAX_REVERSE = 300_000;

interface Entry { key: string; font: MetafileFont }
const registry: Entry[] = [];

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
const norm = (s: string) => s.trim().toLowerCase().replace(/^['"]|['"]$/g, '');

/** Reads one sfnt (TrueType / OpenType; a collection's first face). Null when the tables are missing or damaged. */
export function parseMetafileFont(u8: Uint8Array, family?: string): MetafileFont | null {
  try {
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let base = 0;
    if (u8.length >= 16 && tag(v, 0) === 'ttcf') base = v.getUint32(12);
    if (base + 12 > u8.length) return null;
    const sig = v.getUint32(base);
    if (sig !== 0x00010000 && sig !== 0x4f54544f && sig !== 0x74727565) return null;
    const n = v.getUint16(base + 4);
    if (!n || n > 256 || base + 12 + n * 16 > u8.length) return null;
    const tables = new Map<string, [number, number]>();
    for (let i = 0; i < n; i++) {
      const o = base + 12 + i * 16, off = v.getUint32(o + 8), len = v.getUint32(o + 12);
      if (off <= u8.length && len <= u8.length - off) tables.set(tag(v, o), [off, len]);
    }
    const head = tables.get('head'), hhea = tables.get('hhea'), hmtx = tables.get('hmtx'), cmap = tables.get('cmap');
    if (!head || head[1] < 54 || !cmap) return null;
    const unitsPerEm = v.getUint16(head[0] + 18) || 1000;
    // Advances: numberOfHMetrics long metrics, the last one repeated for the glyphs after it.
    const nh = hhea && hhea[1] >= 36 ? v.getUint16(hhea[0] + 34) : 0;
    const nhOk = hmtx ? Math.min(nh, Math.floor(hmtx[1] / 4)) : 0;
    const advance = (g: number) => (nhOk ? v.getUint16(hmtx![0] + Math.min(g, nhOk - 1) * 4) : unitsPerEm / 2);
    const sub = pickCmap(v, cmap[0], cmap[1]);
    if (!sub) return null;
    let weight = 400, italic = false;
    const os2 = tables.get('OS/2');
    if (os2 && os2[1] >= 64) { weight = v.getUint16(os2[0] + 4) || 400; italic = (v.getUint16(os2[0] + 62) & 1) !== 0; }
    const fam = family?.trim() || nameOf(v, tables.get('name')) || '';
    if (!fam) return null;
    // GDI's cell: usWinAscent / usWinDescent, else the hhea ascender / descender.
    let ascent = Math.round(unitsPerEm * 0.8), descent = Math.round(unitsPerEm * 0.2), capHeight = Math.round(unitsPerEm * 0.7);
    if (hhea && hhea[1] >= 8) { ascent = v.getInt16(hhea[0] + 4) || ascent; descent = Math.abs(v.getInt16(hhea[0] + 6)) || descent; }
    let strike: [number, number] = [Math.round(unitsPerEm * 0.26), Math.round(unitsPerEm * 0.05)];
    if (os2 && os2[1] >= 78) {
      const wa = v.getUint16(os2[0] + 74), wd = v.getUint16(os2[0] + 76);
      if (wa + wd > 0) { ascent = wa; descent = wd; }
      strike = [v.getInt16(os2[0] + 28), v.getInt16(os2[0] + 26) || strike[1]];
      if (v.getUint16(os2[0]) >= 2 && os2[1] >= 90) capHeight = v.getInt16(os2[0] + 88) || capHeight;
    }
    let underline: [number, number] = [-Math.round(unitsPerEm * 0.1), Math.round(unitsPerEm * 0.05)];
    const post = tables.get('post');
    if (post && post[1] >= 12) underline = [v.getInt16(post[0] + 8), v.getInt16(post[0] + 10) || underline[1]];
    const outlines = outlineSource(v, tables);
    const shapes = new Map<number, Outline | null>();
    let reverse: Map<number, number> | null = null;
    return {
      family: fam, weight, italic, unitsPerEm, ascent, descent, capHeight, underline, strike,
      outline: (g) => {
        if (!outlines) return null;
        if (shapes.has(g)) return shapes.get(g)!;
        let o: Outline | null = null;
        try { o = outlines.outline(g); } catch { o = null; }
        if (shapes.size > 4096) shapes.clear();
        shapes.set(g, o);
        return o;
      },
      glyphOf: (cp) => { try { return sub.lookup(cp); } catch { return 0; } },
      advance: (g) => { try { return advance(g); } catch { return unitsPerEm / 2; } },
      charOf: (g) => {
        if (!reverse) { reverse = new Map(); try { sub.each((cp, gl) => { if (gl && !reverse!.has(gl)) reverse!.set(gl, cp); }); } catch { /* what was read so far */ } }
        return reverse.get(g) ?? -1;
      },
    };
  } catch { return null; }
}

interface Sub { lookup(cp: number): number; each(f: (cp: number, g: number) => void): void }

/** The best Unicode subtable: (3, 10) or (0, 4+) format 12, else (3, 1) / (0, *) format 4. */
function pickCmap(v: DataView, off: number, len: number): Sub | null {
  const end = off + len;
  const count = Math.min(v.getUint16(off + 2), 64);
  let best: Sub | null = null, rank = -1;
  for (let i = 0; i < count && off + 4 + i * 8 + 8 <= end; i++) {
    const p = off + 4 + i * 8;
    const plat = v.getUint16(p), enc = v.getUint16(p + 2), so = off + v.getUint32(p + 4);
    if (so + 4 > end) continue;
    const fmt = v.getUint16(so);
    const unicode = plat === 0 || (plat === 3 && (enc === 1 || enc === 10));
    if (!unicode) continue;
    const r = fmt === 12 ? 2 : fmt === 4 ? 1 : 0;
    if (r <= rank) continue;
    const s = fmt === 12 ? format12(v, so, end) : fmt === 4 ? format4(v, so, end) : null;
    if (s) { best = s; rank = r; }
  }
  return best;
}

function format4(v: DataView, o: number, end: number): Sub | null {
  const segX2 = v.getUint16(o + 6), segs = segX2 >> 1;
  if (!segs || o + 16 + segX2 * 4 > end) return null;
  const endAt = o + 14, startAt = endAt + segX2 + 2, deltaAt = startAt + segX2, rangeAt = deltaAt + segX2;
  const glyph = (i: number, c: number) => {
    const start = v.getUint16(startAt + i * 2), delta = v.getInt16(deltaAt + i * 2), ro = v.getUint16(rangeAt + i * 2);
    if (!ro) return (c + delta) & 0xffff;
    const a = rangeAt + i * 2 + ro + (c - start) * 2;
    if (a + 2 > end) return 0;
    const g = v.getUint16(a);
    return g ? (g + delta) & 0xffff : 0;
  };
  return {
    lookup(cp) {
      if (cp > 0xffff) return 0;
      let lo = 0, hi = segs - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (v.getUint16(endAt + mid * 2) < cp) lo = mid + 1; else hi = mid - 1;
      }
      if (lo >= segs || v.getUint16(startAt + lo * 2) > cp) return 0;
      return glyph(lo, cp);
    },
    each(f) {
      let seen = 0;
      for (let i = 0; i < segs; i++) {
        const s = v.getUint16(startAt + i * 2), e = v.getUint16(endAt + i * 2);
        for (let c = s; c <= e && c !== 0xffff; c++) { if (++seen > MAX_REVERSE) return; f(c, glyph(i, c)); }
      }
    },
  };
}

function format12(v: DataView, o: number, end: number): Sub | null {
  const n = v.getUint32(o + 12);
  if (o + 16 + n * 12 > end || n > 1_000_000) return null;
  const g = (i: number) => [v.getUint32(o + 16 + i * 12), v.getUint32(o + 20 + i * 12), v.getUint32(o + 24 + i * 12)];
  return {
    lookup(cp) {
      let lo = 0, hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [s, e, sg] = g(mid);
        if (cp < s) hi = mid - 1; else if (cp > e) lo = mid + 1; else return (sg + cp - s) >>> 0;
      }
      return 0;
    },
    each(f) {
      let seen = 0;
      for (let i = 0; i < n; i++) {
        const [s, e, sg] = g(i);
        for (let c = s; c <= e && c <= 0x10ffff; c++) { if (++seen > MAX_REVERSE) return; f(c, sg + c - s); }
      }
    },
  };
}

/** The family from the name table (typographic family 16, else 1; Windows Unicode, else Mac Roman). */
function nameOf(v: DataView, t: [number, number] | undefined): string {
  if (!t || t[1] < 6) return '';
  const [off, len] = t;
  const count = Math.min(v.getUint16(off + 2), 2000), strings = off + v.getUint16(off + 4);
  let best = '', rank = -1;
  for (let i = 0; i < count && off + 6 + i * 12 + 12 <= off + len; i++) {
    const p = off + 6 + i * 12;
    const plat = v.getUint16(p), id = v.getUint16(p + 6), l = v.getUint16(p + 8), so = strings + v.getUint16(p + 10);
    if ((id !== 1 && id !== 16) || so + l > v.byteLength || l > 512) continue;
    const r = (id === 16 ? 10 : 0) + (plat === 3 ? 2 : plat === 0 ? 1 : 0);
    if (r <= rank) continue;
    let s = '';
    if (plat === 3 || plat === 0) for (let k = 0; k + 1 < l; k += 2) s += String.fromCharCode(v.getUint16(so + k));
    else for (let k = 0; k < l; k++) s += String.fromCharCode(v.getUint8(so + k));
    s = s.replace(/\0/g, '').trim();
    if (s) { best = s; rank = r; }
  }
  return best;
}

/** Makes a font file known to the metafile reader (sfnt bytes; `family` overrides the name table). Never throws. */
export function addMetafileFont(bytes: Uint8Array | ArrayBuffer, family?: string): boolean {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const font = parseMetafileFont(u8, family);
    if (!font) return false;
    const key = norm(font.family);
    const i = registry.findIndex((e) => e.key === key && e.font.weight === font.weight && e.font.italic === font.italic);
    if (i >= 0) registry.splice(i, 1);
    registry.push({ key, font });
    while (registry.length > MAX_FONTS) registry.shift();
    return true;
  } catch { return false; }
}

/** Like addMetafileFont, and unwraps a WOFF first (WOFF2 cannot be read here). */
export async function addMetafileFontFile(bytes: Uint8Array | ArrayBuffer, family?: string): Promise<boolean> {
  try {
    let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length >= 4 && u8[0] === 0x77 && u8[1] === 0x4f && u8[2] === 0x46 && u8[3] === 0x46) {
      const { woffToSfnt } = await import('../fontFile');
      const s = await woffToSfnt(u8);
      if (!s) return false;
      u8 = s;
    }
    return addMetafileFont(u8, family);
  } catch { return false; }
}

/** Forgets every registered font (tests). */
export function clearMetafileFonts() { registry.length = 0; }

/** The registered font of a family closest to the weight and slant asked for, or null. */
export function metafileFont(family: string, bold = false, italic = false): MetafileFont | null {
  const key = norm(family);
  let best: MetafileFont | null = null, score = Infinity;
  for (const e of registry) {
    if (e.key !== key) continue;
    const s = Math.abs(e.font.weight - (bold ? 700 : 400)) + (e.font.italic !== italic ? 1000 : 0);
    if (s < score) { score = s; best = e.font; }
  }
  return best;
}

/** Characters for glyph indices with the font of `family`; null when that font is not registered. Unknown glyphs come back as ''. */
export function glyphsToText(family: string, glyphs: number[], bold = false, italic = false): string[] | null {
  const f = metafileFont(family, bold, italic);
  if (!f) return null;
  return glyphs.map((g) => { const c = f.charOf(g); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; });
}

/** Width of `text` in em from the font's advance widths; null when the font is not registered. */
export function fontWidthEm(text: string, family: string, bold = false, italic = false): number | null {
  const f = metafileFont(family, bold, italic);
  if (!f) return null;
  let w = 0;
  for (const ch of text) w += f.advance(f.glyphOf(ch.codePointAt(0)!));
  return w / f.unitsPerEm;
}

/**
 * The em size (in the same units) of a LOGFONT height: a negative height is the character height (the
 * em), a positive one the cell height (ascent + descent), 0 a default of 12. Without the font file the
 * cell is taken as 1 / 0.85 em.
 */
export function emOfHeight(height: number, family: string, bold = false, italic = false): number {
  if (height < 0) return -height;
  if (height === 0) return 12;
  const f = metafileFont(family, bold, italic);
  return f && f.ascent + f.descent > 0 ? (height * f.unitsPerEm) / (f.ascent + f.descent) : height * 0.85;
}

/** Cell ascent and descent of a font as fractions of the em (0.8 / 0.2 without the font file). */
export function cellOf(family: string, bold = false, italic = false): { ascent: number; descent: number } {
  const f = metafileFont(family, bold, italic);
  return f ? { ascent: f.ascent / f.unitsPerEm, descent: f.descent / f.unitsPerEm } : { ascent: 0.8, descent: 0.2 };
}

/** Advances in em of glyph indices; null when the font is not registered. */
export function glyphAdvancesEm(family: string, glyphs: number[], bold = false, italic = false): number[] | null {
  const f = metafileFont(family, bold, italic);
  return f ? glyphs.map((g) => f.advance(g) / f.unitsPerEm) : null;
}
