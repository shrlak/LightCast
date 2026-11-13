// Text styling of legacy .ppt files (MS-PPT 2.9): the StyleTextPropAtom of a text box (paragraph and
// character runs), the TextMasterStyleAtoms of a master (per text type and indent level), the font
// collection, and the merge of the three into styled paragraphs. Never throws.
import { colorIndex, each, T, type Ctx, type Rec, type Scheme } from './pptRecords';

/** TextPFException: only the fields that were present (masks) are set. */
export interface PF { bullet?: boolean; bulletChar?: number; bulletFont?: number; align?: number; lineSpacing?: number; leftMargin?: number; indent?: number }
/** TextCFException. `size` is in points, `color` is the raw ColorIndexStruct (red, green, blue, index). */
export interface CF { bold?: boolean; italic?: boolean; underline?: boolean; font?: number; size?: number; color?: [number, number, number, number]; position?: number }
export interface Level { pf: PF; cf: CF }
/** TextMasterStyleAtom by text type (0 title, 1 body, 2 notes, 4 other, 5 centre body, 6 centre title, 7 half body, 8 quarter body): five indent levels. */
export type TextStyles = Map<number, Level[]>;

export interface PptRun {
  text: string;
  /** Points. */
  size?: number;
  bold?: boolean; italic?: boolean; underline?: boolean;
  color?: string;
  font?: string;
  baseline?: 'super' | 'sub';
}
export interface PptPara {
  text: string;
  /** Indent level 0-4. */
  level: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  /** The paragraph starts with a bullet; `char` is its character code and `font` its typeface (Wingdings and the like). */
  bullet?: { char?: number; font?: string };
  /** PowerPoint's line spacing: a percentage of the line (100 = single). */
  lineSpacing?: number;
  /** The line after a line break inside a paragraph: no bullet of its own. */
  cont?: boolean;
  runs: PptRun[];
}

const MAX_RUNS = 200_000;
const ALIGN = ['left', 'center', 'right', 'justify'] as const;

/** TextPFException at `o`: the fields and the offset after it; null when it runs past `end`. */
function readPF(c: Ctx, o: number, end: number): { pf: PF; next: number } | null {
  if (o + 4 > end) return null;
  const masks = c.v.getUint32(o, true);
  o += 4;
  const pf: PF = {};
  const need = (n: number) => o + n <= end;
  if (masks & 0x0f) { if (!need(2)) return null; if (masks & 1) pf.bullet = (c.v.getUint16(o, true) & 1) !== 0; o += 2; }
  if (masks & 0x80) { if (!need(2)) return null; pf.bulletChar = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x10) { if (!need(2)) return null; pf.bulletFont = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x40) { if (!need(2)) return null; o += 2; }
  if (masks & 0x20) { if (!need(4)) return null; o += 4; }
  if (masks & 0x800) { if (!need(2)) return null; pf.align = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x1000) { if (!need(2)) return null; pf.lineSpacing = c.v.getInt16(o, true); o += 2; }
  if (masks & 0x2000) { if (!need(2)) return null; o += 2; }
  if (masks & 0x4000) { if (!need(2)) return null; o += 2; }
  if (masks & 0x100) { if (!need(2)) return null; pf.leftMargin = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x400) { if (!need(2)) return null; pf.indent = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x8000) { if (!need(2)) return null; o += 2; }
  if (masks & 0x100000) { if (!need(2)) return null; const n = c.v.getUint16(o, true); o += 2 + n * 4; if (o > end) return null; }
  if (masks & 0x10000) { if (!need(2)) return null; o += 2; }
  if (masks & 0xe0000) { if (!need(2)) return null; o += 2; }
  if (masks & 0x200000) { if (!need(2)) return null; o += 2; }
  return { pf, next: o };
}

/** TextCFException at `o`. */
function readCF(c: Ctx, o: number, end: number): { cf: CF; next: number } | null {
  if (o + 4 > end) return null;
  const masks = c.v.getUint32(o, true);
  o += 4;
  const cf: CF = {};
  const need = (n: number) => o + n <= end;
  if (masks & 0x3fff) {
    if (!need(2)) return null;
    const s = c.v.getUint16(o, true);
    o += 2;
    if (masks & 0x1) cf.bold = (s & 0x1) !== 0;
    if (masks & 0x2) cf.italic = (s & 0x2) !== 0;
    if (masks & 0x4) cf.underline = (s & 0x4) !== 0;
  }
  let ref: number | undefined, eaRef: number | undefined, ansiRef: number | undefined;
  if (masks & 0x10000) { if (!need(2)) return null; ref = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x200000) { if (!need(2)) return null; eaRef = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x400000) { if (!need(2)) return null; ansiRef = c.v.getUint16(o, true); o += 2; }
  if (masks & 0x800000) { if (!need(2)) return null; o += 2; }
  if (masks & 0x20000) { if (!need(2)) return null; const sz = c.v.getUint16(o, true); if (sz >= 1 && sz <= 4000) cf.size = sz; o += 2; }
  if (masks & 0x40000) { if (!need(4)) return null; cf.color = [c.b[o], c.b[o + 1], c.b[o + 2], c.b[o + 3]]; o += 4; }
  if (masks & 0x80000) { if (!need(2)) return null; cf.position = c.v.getInt16(o, true); o += 2; }
  cf.font = ref ?? ansiRef ?? eaRef;
  if (cf.font === undefined) delete cf.font;
  return { cf, next: o };
}

/** A TextMasterStyleAtom: its text type (record instance) and the style of each indent level. */
export function readMasterStyle(c: Ctx, r: Rec): { type: number; levels: Level[] } | null {
  if (r.end - r.pos < 2) return null;
  const count = Math.min(c.v.getUint16(r.pos, true), 5);
  let o = r.pos + 2;
  const levels: Level[] = [];
  for (let i = 0; i < count; i++) {
    if (r.inst >= 5) o += 2; // the level number, present for the centre / half / quarter text types
    const pf = readPF(c, o, r.end);
    if (!pf) break;
    const cf = readCF(c, pf.next, r.end);
    if (!cf) break;
    levels.push({ pf: pf.pf, cf: cf.cf });
    o = cf.next;
  }
  return levels.length ? { type: r.inst, levels } : null;
}

/** Every TextMasterStyleAtom directly inside a container. */
export function readMasterStyles(c: Ctx, from: number, to: number, into: TextStyles = new Map()): TextStyles {
  each(c, from, to, (r) => {
    if (r.type !== T.TextMasterStyle) return;
    const s = readMasterStyle(c, r);
    if (s && !into.has(s.type)) into.set(s.type, s.levels);
  });
  return into;
}

/** The typefaces of the FontCollection (Document → Environment), by font index. */
export function readFonts(c: Ctx, doc: Rec): string[] {
  const out: string[] = [];
  each(c, doc.pos, doc.end, (env) => {
    if (env.type !== T.Environment) return;
    each(c, env.pos, env.end, (fc) => {
      if (fc.type !== T.FontCollection) return;
      each(c, fc.pos, fc.end, (f) => {
        if (f.type !== T.FontEntityAtom || out.length >= 4096) return;
        let name = '';
        for (let o = f.pos; o + 2 <= Math.min(f.end, f.pos + 64); o += 2) {
          const ch = c.v.getUint16(o, true);
          if (!ch) break;
          name += String.fromCharCode(ch);
        }
        out.push(name);
      });
      return false;
    });
    return false;
  });
  return out;
}

/** The default text style of the document (Environment → TextMasterStyleAtom), the last fallback. */
export function readEnvironmentStyles(c: Ctx, doc: Rec): TextStyles {
  const out: TextStyles = new Map();
  each(c, doc.pos, doc.end, (env) => {
    if (env.type !== T.Environment) return;
    readMasterStyles(c, env.pos, env.end, out);
    return false;
  });
  return out;
}

export interface StyleRuns { pf: { count: number; level: number; pf: PF }[]; cf: { count: number; cf: CF }[] }

/** A StyleTextPropAtom for a text of `length` characters (the runs cover the text plus the final implicit paragraph mark). */
export function readStyleRuns(c: Ctx, r: Rec, length: number): StyleRuns {
  const out: StyleRuns = { pf: [], cf: [] };
  let o = r.pos;
  let covered = 0;
  while (covered <= length && o + 6 <= r.end && out.pf.length < MAX_RUNS) {
    const count = c.v.getUint32(o, true);
    const level = Math.min(c.v.getUint16(o + 4, true), 4);
    const pf = readPF(c, o + 6, r.end);
    if (!pf) return out;
    out.pf.push({ count, level, pf: pf.pf });
    covered += count;
    o = pf.next;
  }
  covered = 0;
  while (covered <= length && o + 4 <= r.end && out.cf.length < MAX_RUNS) {
    const count = c.v.getUint32(o, true);
    const cf = readCF(c, o + 4, r.end);
    if (!cf) return out;
    out.cf.push({ count, cf: cf.cf });
    covered += count;
    o = cf.next;
  }
  return out;
}

export interface TextEnv { styles?: TextStyles; fallback?: TextStyles; fonts: string[]; scheme?: Scheme }

/** Text type → the master text type whose style it uses when its own is missing. */
const STYLE_FALLBACK: Record<number, number[]> = { 5: [1], 6: [0], 7: [1], 8: [1], 3: [4], 2: [4, 1] };

function levelStyle(env: TextEnv, textType: number, level: number): Level | undefined {
  for (const styles of [env.styles, env.fallback]) {
    if (!styles) continue;
    for (const t of [textType, ...(STYLE_FALLBACK[textType] ?? [])]) {
      const lv = styles.get(t);
      if (lv) return lv[Math.min(level, lv.length - 1)];
    }
  }
  return undefined;
}

const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000c\u000e-\u001f\ufffe\uffff]/g, '');

/**
 * The raw characters of a text atom (\r ends a paragraph, \v is a line break inside one) with the
 * styles that apply: the master's style for the text type and indent level, then the paragraph's and
 * each character run's own. Lines after a line break come out as continuation paragraphs.
 */
export function buildParas(raw: string, sty: StyleRuns | null, textType: number, env: TextEnv): PptPara[] {
  const out: PptPara[] = [];
  const cfBounds: { from: number; cf: CF }[] = [];
  let at = 0;
  for (const r of sty?.cf ?? []) { cfBounds.push({ from: at, cf: r.cf }); at += r.count; }
  const cfAt = (i: number): CF => {
    let lo = 0, hi = cfBounds.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (cfBounds[mid].from <= i) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best >= 0 ? cfBounds[best].cf : {};
  };
  const pfRuns: { from: number; level: number; pf: PF }[] = [];
  at = 0;
  for (const r of sty?.pf ?? []) { pfRuns.push({ from: at, level: r.level, pf: r.pf }); at += r.count; }
  const pfAt = (i: number) => {
    let best: { level: number; pf: PF } = { level: 0, pf: {} };
    for (const r of pfRuns) { if (r.from <= i) best = r; else break; }
    return best;
  };

  const resolveRun = (text: string, cf0: CF, level: number): PptRun => {
    const base = levelStyle(env, textType, level)?.cf ?? {};
    const cf = { ...base, ...cf0 };
    const run: PptRun = { text };
    if (cf.size) run.size = cf.size;
    if (cf.bold !== undefined) run.bold = cf.bold;
    if (cf.italic !== undefined) run.italic = cf.italic;
    if (cf.underline !== undefined) run.underline = cf.underline;
    if (cf.color) { const col = colorIndex(cf.color[0], cf.color[1], cf.color[2], cf.color[3], env.scheme); if (col) run.color = col; }
    const font = cf.font !== undefined ? env.fonts[cf.font] : undefined;
    if (font) run.font = font;
    if (cf.position) run.baseline = cf.position > 0 ? 'super' : 'sub';
    return run;
  };

  let p0 = 0;
  while (p0 <= raw.length) {
    let p1 = raw.indexOf('\r', p0);
    const hasMark = p1 >= 0;
    if (!hasMark) p1 = raw.length;
    if (!hasMark && p0 === raw.length && out.length) break; // text ended with a paragraph mark
    const own = pfAt(p0);
    const lv = levelStyle(env, textType, own.level);
    const pf = { ...(lv?.pf ?? {}), ...own.pf };
    // Characters of the paragraph, broken into lines at \v and into runs where the character style changes.
    let lineRuns: PptRun[] = [];
    let first = true;
    const flush = () => {
      const text = lineRuns.map((r) => r.text).join('');
      const para: PptPara = { text, level: own.level, runs: lineRuns };
      if (pf.align !== undefined && ALIGN[pf.align]) para.align = ALIGN[pf.align];
      if (pf.lineSpacing && pf.lineSpacing > 0) para.lineSpacing = pf.lineSpacing;
      if (first) {
        if (pf.bullet) para.bullet = { char: pf.bulletChar, font: pf.bulletFont !== undefined ? env.fonts[pf.bulletFont] : undefined };
      } else para.cont = true;
      out.push(para);
      lineRuns = [];
      first = false;
    };
    let i = p0;
    while (i < p1) {
      const cf = cfAt(i);
      let j = i + 1;
      while (j < p1 && cfAt(j) === cf) j++;
      const segment = raw.slice(i, j).replace(/[\v\u2028]/g, '\u000b');
      const parts = segment.split('\u000b');
      parts.forEach((part, k) => {
        if (k > 0) flush();
        const t = cleanText(part);
        if (t) lineRuns.push(resolveRun(t, cf, own.level));
      });
      i = j;
    }
    flush();
    if (!hasMark) break;
    p0 = p1 + 1;
  }
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}
