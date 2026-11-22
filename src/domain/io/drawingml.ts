// PowerPoint's own clipboard copy of shapes (the "Art::GVML ClipFormat" part, a small Office package
// whose drawing is DrawingML in a locked canvas) and DrawingML shape trees in general → LightCast
// objects at the same place, size, rotation, fill, outline, font, size, colour and paragraph format.
// Positions are kept in physical units: 1 canvas px = 6350 EMU (the 4:3 slide is 10 in × 7.5 in at
// 1440 × 1080 px), so 1 pt of type is 2 canvas px, as everywhere else in LightCast.
import JSZip from 'jszip';
import type { DashStyle, ElementParagraph, HAlign, ListStyle, SlideElement, TextRun } from '../types';
import { uid } from '../lyrics';
import { normalizeRuns } from '../richText';
import { hasComplexScript, hasEastAsian, officeFont } from '../fonts';
import { splitWeightedFace, weightPatch } from '../fontWeight';
import { fromPptxVert } from '../textFormat';
import { child, find, kids, local, parseMarkup, path, type MNode } from './markup';
import { BEVELS, CAMERAS } from '../shapeEffects';
import { LIGHTINGS, LIGHT_DIRS, MATERIALS, patch3d } from '../shape3d';
import { shrinkBulletPicture } from '../pictureBullet';
import { metafileToBlob } from '../metafile/image';

export const EMU_PER_PX = 6350;
const px = (emu: string | undefined, dflt = 0) => (emu === undefined || emu === '' || !Number.isFinite(Number(emu)) ? dflt : Number(emu) / EMU_PER_PX);

export interface DmlTheme {
  /** dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink. */
  colors: Record<string, string>;
  majorLatin?: string; minorLatin?: string; majorEa?: string; minorEa?: string; majorCs?: string; minorCs?: string;
  /** The theme's format scheme: fill styles (fillRef idx 1–3), background fills (bgRef idx 1001–1003), line styles (lnRef) and effect styles (effectRef). */
  fills?: MNode[]; bgFills?: MNode[]; lines?: MNode[]; effects?: MNode[];
}

export const OFFICE_THEME: DmlTheme = {
  colors: { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72' },
  majorLatin: 'Calibri Light', minorLatin: 'Calibri', majorEa: '맑은 고딕', minorEa: '맑은 고딕',
};

/** A theme part (<a:theme>) → its colours and fonts. */
/**
 * The adjust values a preset's guide list gives. Guides are named adj1, adj2, … and a file may give only some of
 * them: a routing connector (bentConnector4, curvedConnector5 …) given only adj2 keeps its other guides at the spec's
 * 50000 instead of reading adj2 as its first value. Other presets keep the values in the order given.
 */
export function presetAdjust(guides: { name: string; value: number }[], prst: string): number[] {
  const valid = guides.filter((g) => Number.isFinite(g.value));
  if (!/^(bent|curved)Connector\d$/.test(prst)) return valid.map((g) => g.value);
  const out: number[] = [];
  for (const g of valid) {
    const n = Number(/^adj(\d+)$/.exec(g.name)?.[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 8) { while (out.length < n) out.push(50000); out[n - 1] = g.value; }
  }
  return out;
}

export function readDmlTheme(xml: string): DmlTheme {
  const doc = parseMarkup(xml);
  const scheme = find(doc, 'clrScheme')[0];
  const colors = { ...OFFICE_THEME.colors };
  for (const slot of scheme?.children ?? []) {
    const c = child(slot, 'srgbClr')?.attrs.val ?? child(slot, 'sysClr')?.attrs.lastClr;
    if (c && /^[0-9a-f]{6}$/i.test(c)) colors[local(slot)] = `#${c.toLowerCase()}`;
  }
  const font = (part: string, script: string) => child(find(doc, part)[0], script)?.attrs.typeface || undefined;
  const fmt = find(doc, 'fmtScheme')[0];
  const list = (name: string) => { const l = child(fmt, name)?.children.filter((c) => c.name !== '#text'); return l?.length ? l : undefined; };
  return { fills: list('fillStyleLst'), bgFills: list('bgFillStyleLst'), lines: list('lnStyleLst'), effects: list('effectStyleLst'), colors, majorLatin: font('majorFont', 'latin'), minorLatin: font('minorFont', 'latin'), majorEa: font('majorFont', 'ea'), minorEa: font('minorFont', 'ea'), majorCs: font('majorFont', 'cs'), minorCs: font('minorFont', 'cs') };
}

// ── Colours ─────────────────────────────────────────────────────────────────────────────────────

const PRESET: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', navy: '#000080', darkBlue: '#00008b', darkRed: '#8b0000', silver: '#c0c0c0' };
const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('')}`;

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => { c = clamp01(c); return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; };

/** A colour element (srgbClr, schemeClr, …) with its modifiers (lumMod, tint, alpha …). */
export function colorOf(node: MNode | null | undefined, theme: DmlTheme, ph?: string): { hex: string; alpha: number } | null {
  if (!node) return null;
  const n = local(node);
  let hex: string | undefined;
  if (n === 'srgbClr') hex = `#${node.attrs.val}`;
  else if (n === 'sysClr') hex = `#${node.attrs.lastClr ?? (node.attrs.val === 'window' ? 'ffffff' : '000000')}`;
  else if (n === 'schemeClr') hex = node.attrs.val === 'phClr' ? ph : theme.colors[node.attrs.val] ?? theme.colors[SCHEME_ALIAS[node.attrs.val] ?? node.attrs.val];
  else if (n === 'prstClr') hex = PRESET[node.attrs.val];
  else if (n === 'scrgbClr') hex = toHex(+node.attrs.r / 1e5, +node.attrs.g / 1e5, +node.attrs.b / 1e5);
  else if (n === 'hslClr') hex = toHex(...fromHsl(+node.attrs.hue / 21600000, +node.attrs.sat / 1e5, +node.attrs.lum / 1e5));
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  let rgb = rgbOf(hex);
  let alpha = 1;
  for (const m of node.children) {
    const v = Number(m.attrs.val) / 1e5;
    switch (local(m)) {
      case 'lumMod': case 'lumOff': {
        const [h, s, l] = toHsl(rgb);
        rgb = fromHsl(h, s, clamp01(local(m) === 'lumMod' ? l * v : l + v));
        break;
      }
      // Office applies tint and shade in linear light (DeckCraft's craft-drawingml does the same), which keeps
      // mid-tones from washing out: a 75 % tint of black is #898989, not #404040.
      case 'tint': { const f = clamp01(v); rgb = rgb.map((c) => fromLinear(toLinear(c) * f + (1 - f))) as typeof rgb; break; }
      case 'shade': { const f = clamp01(v); rgb = rgb.map((c) => fromLinear(toLinear(c) * f)) as typeof rgb; break; }
      case 'satMod': { const [h, s, l] = toHsl(rgb); rgb = fromHsl(h, clamp01(s * v), l); break; }
      case 'satOff': { const [h, s, l] = toHsl(rgb); rgb = fromHsl(h, clamp01(s + v), l); break; }
      case 'hueMod': { const [h, s, l] = toHsl(rgb); rgb = fromHsl(((h * v) % 1 + 1) % 1, s, l); break; }
      case 'hueOff': { const [h, s, l] = toHsl(rgb); rgb = fromHsl((((h + Number(m.attrs.val) / 21600000) % 1) + 1) % 1, s, l); break; }
      case 'comp': { const [h, s, l] = toHsl(rgb); rgb = fromHsl((h + 0.5) % 1, s, l); break; }
      case 'inv': rgb = rgb.map((c) => 1 - c) as typeof rgb; break;
      case 'gray': { const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]; rgb = [y, y, y]; break; }
      case 'redMod': rgb = [clamp01(rgb[0] * v), rgb[1], rgb[2]]; break;
      case 'greenMod': rgb = [rgb[0], clamp01(rgb[1] * v), rgb[2]]; break;
      case 'blueMod': rgb = [rgb[0], rgb[1], clamp01(rgb[2] * v)]; break;
      case 'alpha': alpha = clamp01(v); break;
      case 'alphaMod': alpha = clamp01(alpha * v); break;
      case 'alphaOff': alpha = clamp01(alpha + v); break;
      default:
    }
  }
  return { hex: toHex(...rgb), alpha };
}
/** The colour inside a fill-like element (solidFill, fontRef …). */
const colorIn = (n: MNode | null | undefined, theme: DmlTheme, ph?: string) => (n ? colorOf(n.children.find((c) => /Clr$/.test(local(c))), theme, ph) : null);

// ── Text ────────────────────────────────────────────────────────────────────────────────────────

const ALIGN: Record<string, HAlign> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'distributed', justLow: 'justLow', thaiDist: 'distributed' };
const AUTONUM: Record<string, ListStyle> = { arabicPeriod: 'number', arabicParenR: 'number-paren', arabicParenBoth: 'number-paren', arabicPlain: 'number', romanUcPeriod: 'roman', romanLcPeriod: 'roman-lower', alphaLcPeriod: 'alpha-lower', alphaUcPeriod: 'alpha', alphaLcParenR: 'alpha-lower-paren', alphaLcParenBoth: 'alpha-lower-paren', hangulGanadaPeriod: 'hangul', hangul: 'hangul', ganada: 'hangul' };

interface TextDefaults { size: number; color?: string; font: 'minor' | 'major'; bold?: boolean; italic?: boolean }

const STRUCTURAL = new Set(['lstStyle', 'defPPr', 'pPr', 'defRPr', 'rPr', 'bodyPr', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `lvl${n}pPr`)]);
const FILL_KINDS = ['solidFill', 'gradFill', 'noFill', 'blipFill', 'pattFill', 'grpFill'];
const BULLET_KINDS = ['buNone', 'buChar', 'buAutoNum', 'buBlip'];
const EXCLUSIVE = [FILL_KINDS, BULLET_KINDS, ['buClrTx', 'buClr'], ['buSzTx', 'buSzPct', 'buSzPts'], ['buFontTx', 'buFont'], ['noAutofit', 'normAutofit', 'spAutoFit']];

/**
 * Layer one style node (lstStyle, lvlNpPr, defRPr, bodyPr …) over another, as PowerPoint layers master, layout
 * and slide: attributes of `b` win, structural children merge, anything else (fills, spacing, bullets) of `b`
 * replaces the same kind of `a`.
 */
export function mergeStyle(a: MNode | null | undefined, b: MNode | null | undefined): MNode | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const out = a.children.filter((c) => c.name !== '#text');
  for (const c of b.children) {
    if (c.name === '#text') continue;
    const at = out.findIndex((k) => local(k) === local(c));
    if (at >= 0 && STRUCTURAL.has(local(c))) { out[at] = mergeStyle(out[at], c)!; continue; }
    const group = EXCLUSIVE.find((g) => g.includes(local(c)));
    for (let i = out.length - 1; i >= 0; i--) if (i !== at && group?.includes(local(out[i]))) out.splice(i, 1);
    const same = out.findIndex((k) => local(k) === local(c));
    if (same >= 0) out[same] = c; else out.push(c);
  }
  return { name: b.name, attrs: { ...a.attrs, ...b.attrs }, children: out };
}

function resolveFace(face: string | undefined, theme: DmlTheme, which: 'minor' | 'major', ea: boolean): string | undefined {
  const pick = (f: 'Latin' | 'Ea' | 'Cs', w: 'minor' | 'major') => theme[`${w}${f}` as keyof DmlTheme] as string | undefined;
  if (face) {
    const m = /^\+(mn|mj)-(lt|ea|cs)$/.exec(face);
    if (!m) return face;
    const w = m[1] === 'mj' ? 'major' : 'minor';
    return m[2] === 'lt' ? pick('Latin', w) : pick(m[2] === 'ea' ? 'Ea' : 'Cs', w) ?? pick('Latin', w);
  }
  return (ea ? pick('Ea', which) : undefined) ?? pick('Latin', which);
}

/** `shadow`: the run's text has an outer shadow (a:effectLst/a:outerShdw), its own or inherited. */
type Run = TextRun & { fontFamily?: string; shadow?: boolean };

function readRun(r: MNode, text: string, base: MNode | null, d: TextDefaults, theme: DmlTheme, scale: number, ctx?: DmlContext): Run {
  const rPr = child(r, 'rPr');
  const attr = (k: string) => rPr?.attrs[k] ?? base?.attrs[k];
  const sz = attr('sz');
  const ea = hasEastAsian(text);
  // A typeface per script (a:latin, a:ea, a:cs): the run's own, else its paragraph style's, else the theme's.
  const typeface = (script: string) => (child(rPr, script) ?? child(base, script))?.attrs.typeface || undefined;
  const latinFace = resolveFace(typeface('latin'), theme, d.font, false);
  const eaFace = resolveFace(typeface('ea'), theme, d.font, true) ?? latinFace;
  const csFace = typeface('cs') ? resolveFace(typeface('cs'), theme, d.font, false) : undefined;
  const fill = child(rPr, 'solidFill') ?? child(base, 'solidFill');
  const hl = child(rPr, 'highlight') ?? child(base, 'highlight');
  const bl = Number(attr('baseline') ?? 0);
  const b = attr('b'), i = attr('i'), u = attr('u'), st = attr('strike');
  const spc = Number(attr('spc') ?? 0);
  const cap = attr('cap');
  // "Noto Sans KR Light" is the family "Noto Sans KR" at weight 300 (only for families that have such weights);
  // a run with Hangul / CJK takes the weight from its East Asian typeface.
  const split = latinFace ? splitWeightedFace(latinFace) : undefined;
  const eaSplit = eaFace ? splitWeightedFace(eaFace) : undefined;
  const family = split?.family;
  // Kept on the run only when it has characters of that script (the rest draw in the Latin typeface anyway).
  const eaFamily = ea && eaSplit?.family !== family ? eaSplit?.family : undefined;
  const csFamily = csFace && hasComplexScript(text) ? splitWeightedFace(csFace).family : undefined;
  const wSplit = ea && eaSplit ? eaSplit : split;
  const wp = wSplit?.weight !== undefined ? weightPatch(wSplit.weight) : undefined;
  const hlink = child(rPr, 'hlinkClick');
  const link = hlink ? ctx?.link?.(hlink) : undefined;
  // Text effects come from the run, else from its paragraph's defRPr, the list style or the presentation's default
  // text style (all merged into `base`), as DeckCraft reads them.
  const shadow = !!child(child(rPr, 'effectLst') ?? child(base, 'effectLst'), 'outerShdw');
  return {
    text,
    fontSize: Math.round((sz ? (Number(sz) / 100) * 2 : d.size) * scale * 10) / 10,
    bold: wp ? (b !== undefined ? b === '1' || b === 'true' : wp.bold) : b !== undefined ? b === '1' || b === 'true' : d.bold,
    weight: wp?.weight,
    italic: i !== undefined ? i === '1' || i === 'true' : d.italic,
    underline: u && u !== 'none' ? true : undefined,
    strike: st && st !== 'noStrike' ? true : undefined,
    baseline: bl > 0 ? 'super' : bl < 0 ? 'sub' : undefined,
    color: colorIn(fill, theme)?.hex ?? d.color,
    highlight: colorIn(hl, theme)?.hex,
    fontFamily: family ? officeFont(family) : undefined,
    ...(eaFamily ? { fontFamilyEa: officeFont(eaFamily) } : {}),
    ...(csFamily && csFamily !== family ? { fontFamilyCs: officeFont(csFamily) } : {}),
    ...(spc ? { letterSpacing: Math.round((spc / 100) * 2 * 10) / 10 } : {}),
    ...(cap === 'all' ? { caps: 'all' as const } : cap === 'small' ? { caps: 'small' as const } : {}),
    ...(link ? { link } : {}),
    ...(shadow ? { shadow } : {}),
  } as Run;
}

export interface Para {
  runs: Run[]; align?: HAlign; list?: ListStyle; bulletPicture?: string; lineHeight?: number; lineExactPx?: number; before?: number; after?: number; empty: Run;
  /** Outline level (a:pPr@lvl). */
  level?: number;
  /** Left margin and first-line indent of the paragraph in canvas px (a:pPr@marL, @indent). */
  marL?: number; indentPx?: number;
}

/** The bullet an a:pPr sets (inherited ones included). */
function bulletOf(pPr: MNode | null, bulletPicture?: (rId: string) => string | undefined): { list?: ListStyle; picture?: string } {
  if (!pPr || child(pPr, 'buNone')) return {};
  const auto = child(pPr, 'buAutoNum')?.attrs.type;
  if (auto) return { list: AUTONUM[auto] ?? 'number' };
  const blipRid = path(pPr, 'buBlip', 'blip')?.attrs['r:embed'];
  if (child(pPr, 'buBlip')) { const picture = blipRid ? bulletPicture?.(blipRid) : undefined; return picture ? { list: 'picture', picture } : { list: 'bullet' }; }
  const ch = child(pPr, 'buChar')?.attrs.char;
  if (ch === undefined) return {};
  return { list: /[–—−-]/.test(ch) ? 'dash' : /[□q]/.test(ch) ? 'box' : /[◆♦v]/.test(ch) ? 'diamond' : /[★☆«]/.test(ch) ? 'star' : /[○◦o]/.test(ch) ? 'circle' : /[■▪§n]/.test(ch) ? 'square' : /[✓ü]/.test(ch) ? 'check' : /[➢Ø→➔]/.test(ch) ? 'arrow' : 'bullet' };
}

function readParagraphs(txBody: MNode, d: TextDefaults, theme: DmlTheme, ctx?: DmlContext, lst?: MNode | null): Para[] {
  const lstNode = lst ?? child(txBody, 'lstStyle');
  const scale = Number(path(txBody, 'bodyPr', 'normAutofit')?.attrs.fontScale ?? 100000) / 100000;
  return kids(txBody, 'p').map((p) => {
    const own = child(p, 'pPr');
    const lvl = Number(own?.attrs.lvl ?? 0);
    const lvlPr = mergeStyle(child(lstNode, 'defPPr'), child(lstNode, `lvl${Math.min(9, lvl + 1)}pPr`));
    const pPr = mergeStyle(lvlPr, own);
    const base = mergeStyle(child(pPr, 'defRPr'), null);
    const runs: Run[] = [];
    for (const r of p.children) {
      const n = local(r);
      if (n === 'r' || n === 'fld') runs.push(readRun(r, find(r, 't').map((t) => t.children.map((c) => c.text ?? '').join('')).join(''), base, d, theme, scale, ctx));
      else if (n === 'br') runs.push({ ...readRun(r, '\v', base, d, theme, scale, ctx) });
      else if (n === 'AlternateContent') {
        // An equation (a14:m): its plain text stands in for it.
        const math = find(r, 't').filter((t) => /^m:/.test(t.name)).map((t) => t.children.map((c) => c.text ?? '').join('')).join('');
        if (math) runs.push(readRun({ name: 'a:r', attrs: {}, children: [] }, math, base, d, theme, scale, ctx));
      }
    }
    const end = child(p, 'endParaRPr');
    const empty = readRun({ name: 'a:r', attrs: {}, children: end ? [{ ...end, name: 'a:rPr' }] : [] }, '', base, d, theme, scale, ctx);
    const spc = (k: string) => {
      const pts = path(pPr, k, 'spcPts')?.attrs.val;
      if (pts) return (Number(pts) / 100) * 2;
      const pct = path(pPr, k, 'spcPct')?.attrs.val;
      return pct ? Math.round(((Number(pct) / 100000) * 1.2 * (empty.fontSize ?? d.size)) * 10) / 10 : undefined;
    };
    const pct = path(pPr, 'lnSpc', 'spcPct')?.attrs.val;
    const lnPts = path(pPr, 'lnSpc', 'spcPts')?.attrs.val;
    const { list, picture } = bulletOf(pPr, ctx?.bulletPicture);
    const algn = pPr?.attrs.algn;
    const marL = pPr?.attrs.marL !== undefined ? px(pPr.attrs.marL) : undefined;
    const ind = pPr?.attrs.indent !== undefined ? px(pPr.attrs.indent) : undefined;
    return { runs, align: algn ? ALIGN[algn] : undefined, list, bulletPicture: list === 'picture' ? picture : undefined, lineHeight: pct ? (Number(pct) / 100000) * 1.2 : undefined, lineExactPx: lnPts ? (Number(lnPts) / 100) * 2 : undefined, before: spc('spcBef'), after: spc('spcAft'), empty, level: lvl || undefined, marL, indentPx: ind };
  });
}

const RUN_KEYS = ['fontSize', 'bold', 'weight', 'italic', 'underline', 'strike', 'baseline', 'color', 'highlight', 'fontFamily', 'fontFamilyEa', 'fontFamilyCs', 'letterSpacing', 'caps', 'link'] as const;

/** Paragraphs → the element's text, its own formatting (that of most of its text) and runs for the rest. */
export function textFields(paras: Para[], fallbackAlign: HAlign = 'left'): Partial<SlideElement> {
  // A soft line break (<a:br/>) stays inside its paragraph's line as a \v character (Shift+Enter).
  const lines: { runs: Run[]; p: Para }[] = paras.map((p) => ({ runs: p.runs, p }));
  const all = lines.flatMap((l) => l.runs).filter((r) => r.text && r.text !== '\v');
  const first = all[0] ?? paras[0]?.empty ?? { text: '' };
  // The box's own formatting is its first text's (as PowerPoint shows it when the box is selected).
  const own: Partial<Record<(typeof RUN_KEYS)[number], unknown>> = {};
  // A link stays on its own characters (the box has no link of its own).
  // Nor a script typeface: the box has only one font, so a run's 한글 글꼴 stays on the run.
  for (const k of RUN_KEYS) if (k !== 'link' && k !== 'fontFamilyEa' && k !== 'fontFamilyCs') own[k] = first[k];
  const strip = (r: Run): TextRun => {
    const out: TextRun = { text: r.text };
    for (const k of RUN_KEYS) if (r[k] !== own[k] && r[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = r[k];
    // A run that is not bold / italic inside a bold / italic box says so.
    if (own.bold && !r.bold) out.bold = false;
    if (own.italic && !r.italic) out.italic = false;
    // A run without the box's weight says its own plain / bold look.
    if (own.weight !== undefined && r.weight === undefined) out.bold = !!r.bold;
    return out;
  };
  const text = lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n');
  const runLines = lines.map((l) => normalizeRuns(l.runs.map(strip)));
  const aligns = lines.map((l) => l.p.align ?? fallbackAlign);
  const mixedAlign = aligns.some((a) => a !== aligns[0]);
  const lp = paras[0];
  // Outline levels, bullets and spacing that differ between paragraphs are kept per paragraph.
  const lvl = (p: Para) => p.level ?? 0;
  const mixedPara = paras.some((p) => lvl(p) !== lvl(lp) || p.list !== lp.list || (p.before ?? 0) !== (lp.before ?? 0) || (p.after ?? 0) !== (lp.after ?? 0) || p.lineHeight !== lp.lineHeight || p.lineExactPx !== lp.lineExactPx);
  const fields: Partial<SlideElement> = {
    text,
    fontSize: (own.fontSize as number | undefined) ?? 36,
    color: own.color as string | undefined,
    fontFamily: own.fontFamily as string | undefined,
    bold: (own.bold as boolean | undefined) || undefined,
    weight: own.weight as number | undefined,
    italic: (own.italic as boolean | undefined) || undefined,
    underline: (own.underline as boolean | undefined) || undefined,
    strike: (own.strike as boolean | undefined) || undefined,
    highlight: own.highlight as string | undefined,
    align: aligns[0],
    list: lp?.list,
    ...(own.letterSpacing ? { letterSpacing: own.letterSpacing as number } : {}),
    ...(own.caps ? { caps: own.caps as 'all' | 'small' } : {}),
    // 텍스트 그림자: the box draws one shadow for all its text, so the shadow of its first text.
    ...((first as Run).shadow ? { shadow: true } : {}),
    ...(lp?.list === 'picture' && lp.bulletPicture ? { bulletPicture: lp.bulletPicture } : {}),
    lineHeight: lp?.lineHeight,
    ...(lp?.lineExactPx ? { lineExact: { mode: 'exact' as const, px: lp.lineExactPx } } : {}),
    spaceBefore: lp?.before,
    spaceAfter: lp?.after,
    ...(lvl(lp) ? { indent: lvl(lp) } : {}),
  };
  const formatted = runLines.some((l) => l.some((r) => Object.keys(r).length > 1));
  if (mixedAlign || mixedPara) {
    fields.paragraphs = lines.map((l, i): ElementParagraph => ({
      text: runLines[i].map((r) => r.text).join(''), runs: runLines[i], align: aligns[i],
      ...(mixedPara ? {
        list: l.p.list ?? (lp.list ? 'none' : undefined), ...(lvl(l.p) ? { level: lvl(l.p) } : {}),
        ...(l.p.before ? { spaceBefore: l.p.before } : {}), ...(l.p.after ? { spaceAfter: l.p.after } : {}),
        // Each paragraph says its own line spacing (an exact one as a multiple of its text size).
        lineHeight: l.p.lineHeight ?? (l.p.lineExactPx ? Math.round((l.p.lineExactPx / ((l.runs.find((r) => r.text)?.fontSize ?? l.p.empty.fontSize) || 36)) * 100) / 100 : 1.2),
      } : {}),
    }));
    if (mixedPara) delete fields.indent;
  } else if (formatted) fields.runs = runLines;
  return fields;
}

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────────

interface Xf { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }
const xfrmOf = (n: MNode | null): Xf | null => {
  if (!n) return null;
  const off = child(n, 'off'), ext = child(n, 'ext');
  if (!off || !ext) return null;
  return { x: px(off.attrs.x), y: px(off.attrs.y), w: px(ext.attrs.cx), h: px(ext.attrs.cy), rot: Number(n.attrs.rot ?? 0) / 60000, flipH: n.attrs.flipH === '1', flipV: n.attrs.flipV === '1' };
};
/** A group's child coordinates → its parent's. */
type Map2 = (b: Xf) => Xf;
const groupMap = (xf: MNode | null, outer: Map2): Map2 => {
  const g = xfrmOf(xf);
  const chOff = child(xf, 'chOff'), chExt = child(xf, 'chExt');
  if (!g || !chOff || !chExt) return outer;
  const cx = px(chOff.attrs.x), cy = px(chOff.attrs.y), cw = px(chExt.attrs.cx) || 1, ch = px(chExt.attrs.cy) || 1;
  const sx = g.w / cw, sy = g.h / ch;
  return (b) => outer({ ...b, x: g.x + (b.x - cx) * sx, y: g.y + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy, rot: b.rot + g.rot });
};

const DASH: Record<string, DashStyle> = { dash: 'dash', lgDash: 'lgDash', sysDash: 'sysDash', dot: 'dot', sysDot: 'sysDot', dashDot: 'dashDot', lgDashDot: 'lgDashDot', sysDashDot: 'sysDashDot', lgDashDotDot: 'lgDashDotDot', sysDashDotDot: 'sysDashDotDot' };
const CAP_IN: Record<string, 'flat' | 'round' | 'square'> = { flat: 'flat', rnd: 'round', sq: 'square' };
const CMPD_IN: Record<string, 'single' | 'double' | 'thickThin' | 'thinThick' | 'triple'> = { sng: 'single', dbl: 'double', thickThin: 'thickThin', thinThick: 'thinThick', tri: 'triple' };
const ARROW_IN: Record<string, 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow'> = { triangle: 'triangle', stealth: 'stealth', diamond: 'diamond', oval: 'oval', arrow: 'arrow' };
const LINE_STYLE_W = [6350, 12700, 19050];

export interface DmlContext {
  theme: DmlTheme;
  /** A picture's relationship id → the LightCast media id it was stored under. */
  media?: (rId: string) => string | undefined;
  /** A picture bullet's (a:buBlip) relationship id → the small PNG data URL it becomes (`bulletPicture`). */
  bulletPicture?: (rId: string) => string | undefined;
  /** A text hyperlink (a:hlinkClick) → the address it opens (undefined: not an address, e.g. a jump to a slide). */
  link?: (h: MNode) => string | undefined;
  /** A hyperlink or action on a whole object → what clicking it does in a slide show. */
  action?: (h: MNode) => Pick<SlideElement, 'href' | 'action'> | undefined;
  /** A p:graphicFrame (table, chart, SmartArt, OLE object …) → the objects it becomes; null: not handled (the frame is reported and left out). */
  frame?: (frame: MNode, box: { x: number; y: number; w: number; h: number; rot: number }, groupId?: string) => SlideElement[] | null;
  /** The layout / master a placeholder takes its place, text style and look from. */
  inherit?: (sp: MNode) => Inherit | null;
  /** The presentation's default text style (presentation.xml defaultTextStyle), under every text. */
  defaults?: MNode | null;
  /** The stored video / audio file of a picture's video or audio relationship. */
  mediaFile?: (rId: string) => { id: string; type: 'video' | 'audio' } | undefined;
  /** An object was made from the drawing shape (or group) with this shape id — animations name their targets by it. */
  made?: (shapeId: string, els: SlideElement[]) => void;
  /** Something in the drawing could only be approximated or left out (for the import report). */
  note?: (event: 'approximated' | 'dropped', what: string) => void;
  /** Follow the file exactly: text starts at the left top unless the file says otherwise. */
  strict?: boolean;
}

/** What a placeholder inherits (already layered master → layout): frame, shape properties, body properties and list style of its text. */
export interface Inherit { spPr?: MNode | null; bodyPr?: MNode | null; lst?: MNode | null; font?: 'major' | 'minor' }

const solidOf = (hex: string): MNode => ({ name: 'a:solidFill', attrs: {}, children: [{ name: 'a:srgbClr', attrs: { val: hex.replace('#', '') }, children: [] }] });
const fillKindOf = (spPr: MNode | null) => spPr?.children.find((c) => FILL_KINDS.includes(local(c))) ?? null;

/** The fill a shape draws: its own, else the theme fill its style points at (fillRef), with that style's colour in place of phClr. */
function fillSource(spPr: MNode | null, style: MNode | null, ctx: DmlContext): { node: MNode; ph?: string } | null {
  const own = fillKindOf(spPr);
  if (own) return local(own) === 'noFill' || local(own) === 'grpFill' ? null : { node: own };
  const ref = child(style, 'fillRef');
  const idx = Number(ref?.attrs.idx ?? 0);
  if (!ref || idx <= 0) return null;
  const ph = colorIn(ref, ctx.theme)?.hex;
  const themed = idx >= 1001 ? ctx.theme.bgFills?.[idx - 1001] : ctx.theme.fills?.[idx - 1];
  if (themed && local(themed) !== 'noFill') return { node: themed, ph };
  return ph ? { node: solidOf(ph) } : null;
}

/** A fill element (solidFill, gradFill, blipFill, pattFill) → the object's fill fields. */
export function fillFromNode(node: MNode, ph: string | undefined, ctx: DmlContext): Partial<SlideElement> {
  const t = ctx.theme;
  switch (local(node)) {
    case 'solidFill': { const c = colorIn(node, t, ph); return c ? { fill: c.hex, ...(c.alpha < 1 ? { fillTransparency: Math.round((1 - c.alpha) * 1000) / 1000 } : {}) } : {}; }
    case 'gradFill': {
      const gs = kids(child(node, 'gsLst'), 'gs').sort((a, b) => Number(a.attrs.pos) - Number(b.attrs.pos)).map((g) => ({ c: colorIn(g, t, ph), pos: Number(g.attrs.pos) / 1000 })).filter((g) => g.c);
      const stops = gs.map((g) => g.c!.hex);
      // More than two stops, or a stop that is partly transparent, keep every stop (Format Shape › Gradient stops).
      // Two stops moved off the ends keep their positions too.
      const rich = gs.length > 2 || gs.some((g) => g.c!.alpha < 1) || (gs.length === 2 && (gs[0].pos > 0 || gs[1].pos < 100));
      if (!stops.length) return {};
      const lin = child(node, 'lin'), pathFill = child(node, 'path');
      // lin@scaled (default off): off, the angle is measured on the shape as it is drawn, not on its box squeezed to a square.
      const scaled = lin ? /^(1|true)$/.test(lin.attrs.scaled ?? '') : undefined;
      // A path gradient's focus is the middle of its fillToRect (insets from the box's edges).
      const ftr = child(pathFill, 'fillToRect');
      const inset = (k: string) => Number(ftr?.attrs[k] ?? 0) / 100000;
      const center: [number, number] | undefined = pathFill ? [Math.round(((inset('l') + 1 - inset('r')) / 2) * 1000) / 1000, Math.round(((inset('t') + 1 - inset('b')) / 2) * 1000) / 1000] : undefined;
      return { fill: stops[0], gradient: [stops[0], stops[stops.length - 1]], gradientAngle: Number(lin?.attrs.ang ?? 0) / 60000, ...(scaled !== undefined ? { gradientScaled: scaled } : {}), ...(pathFill ? { gradientType: 'radial' as const } : {}), ...(center ? { gradientCenter: center } : {}), ...(rich ? { gradientStops: gs.map((g) => ({ pos: Math.round(g.pos * 10) / 10, color: g.c!.hex, ...(g.c!.alpha < 1 ? { transparency: Math.round((1 - g.c!.alpha) * 1000) / 1000 } : {}) })) } : {}) };
    }
    case 'blipFill': {
      const blip = child(node, 'blip');
      const media = blip && ctx.media?.(blip.attrs['r:embed'] ?? '');
      if (!media) return {};
      const keep = Number(child(blip, 'alphaModFix')?.attrs.amt ?? 100000) / 100000;
      return { fillImage: media, ...(keep < 1 ? { fillTransparency: Math.round((1 - keep) * 1000) / 1000 } : {}) };
    }
    case 'pattFill': {
      const fg = colorIn(child(node, 'fgClr'), t, ph)?.hex ?? '#000000', bg = colorIn(child(node, 'bgClr'), t, ph)?.hex ?? '#ffffff';
      return { fill: bg, pattern: { kind: node.attrs.prst ?? 'pct50', fg, bg } };
    }
    default: return {};
  }
}

function fillFields(spPr: MNode | null, style: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const src = fillSource(spPr, style, ctx);
  return src ? fillFromNode(src.node, src.ph, ctx) : {};
}

function lineFields(spPr: MNode | null, style: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const own = child(spPr, 'ln');
  const ref = child(style, 'lnRef');
  const refIdx = Number(ref?.attrs.idx ?? 0);
  const ph = ref ? colorIn(ref, ctx.theme)?.hex : undefined;
  const themed = refIdx > 0 ? ctx.theme.lines?.[Math.min(refIdx, ctx.theme.lines.length) - 1] : undefined;
  const ln = mergeStyle(themed, own);
  if (child(ln, 'noFill')) return {};
  const c = colorIn(child(ln, 'solidFill'), ctx.theme, ph) ?? colorIn(path(ln, 'gradFill', 'gsLst', 'gs'), ctx.theme, ph) ?? (refIdx > 0 && !fillKindOf(ln) ? colorIn(ref, ctx.theme) : null);
  if (!c) return {};
  const w = ln?.attrs.w ? Number(ln.attrs.w) : LINE_STYLE_W[Math.min(Math.max(refIdx, 1), 3) - 1] ?? 12700;
  const dash = DASH[child(ln, 'prstDash')?.attrs.val ?? ''];
  const arrow = (k: string) => { const ty = child(ln, k)?.attrs.type; return !!ty && ty !== 'none'; };
  const kind = (k: string) => ARROW_IN[child(ln, k)?.attrs.type ?? ''];
  const cap = CAP_IN[ln?.attrs.cap ?? ''], compound = CMPD_IN[ln?.attrs.cmpd ?? ''];
  const join = child(ln, 'bevel') ? 'bevel' as const : child(ln, 'miter') ? 'miter' as const : child(ln, 'round') ? 'round' as const : undefined;
  return {
    stroke: c.hex, strokeWidth: Math.max(0.5, Math.round((w / EMU_PER_PX) * 10) / 10), ...(dash ? { dash } : {}),
    ...(cap ? { cap } : {}), ...(compound && compound !== 'single' ? { compound } : {}), ...(join ? { join } : {}),
    ...(arrow('headEnd') ? { arrowStart: true, ...(kind('headEnd') && kind('headEnd') !== 'triangle' ? { arrowStartKind: kind('headEnd') } : {}) } : {}),
    ...(arrow('tailEnd') ? { arrowEnd: true, ...(kind('tailEnd') && kind('tailEnd') !== 'triangle' ? { arrowEndKind: kind('tailEnd') } : {}) } : {}),
  };
}

/** a:scene3d / a:sp3d → the tilt, bevels and Format3d (anything outside the known presets is dropped). */
function format3dFields(spPr: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const scene = child(spPr, 'scene3d'), sp3d = child(spPr, 'sp3d');
  if (!scene && !sp3d) return {};
  const out: Partial<SlideElement> = {};
  const cam = child(scene, 'camera');
  const preset = CAMERAS.find((c) => c.id === cam?.attrs.prst);
  const rot = child(cam, 'rot');
  if (preset) { out.camera3d = preset.id; out.rotate3d = { x: preset.x, y: preset.y, ...(preset.z ? { z: preset.z } : {}), ...(preset.persp ? { persp: true } : {}) }; }
  else if (rot) {
    const d = (n: string) => Math.round(Number(rot.attrs[n] ?? 0) / 600) / 100;
    const r = { x: d('lon'), y: d('lat'), z: d('rev') };
    if (r.x || r.y || r.z) out.rotate3d = { x: r.x, y: r.y, ...(r.z ? { z: r.z } : {}), ...(/^perspective/.test(cam?.attrs.prst ?? '') ? { persp: true } : {}) };
  }
  const rig = child(scene, 'lightRig');
  const pt = (v: string | undefined) => (v == null ? undefined : Math.round((Number(v) / 12700) * 100) / 100);
  const top = child(sp3d, 'bevelT'), bottom = child(sp3d, 'bevelB');
  if (top && BEVELS.some((b) => b.id === top.attrs.prst)) { out.bevel = true; out.bevelKind = top.attrs.prst; }
  const f = patch3d(undefined, {
    lighting: LIGHTINGS.some((l) => l.id === rig?.attrs.rig) && rig?.attrs.rig !== 'threePt' ? rig?.attrs.rig : undefined,
    lightDir: LIGHT_DIRS.some((l) => l.id === rig?.attrs.dir) && rig?.attrs.dir !== 't' ? rig?.attrs.dir : undefined,
    depth: pt(sp3d?.attrs.extrusionH), contour: pt(sp3d?.attrs.contourW),
    material: MATERIALS.some((m) => m.id === sp3d?.attrs.prstMaterial) && sp3d?.attrs.prstMaterial !== 'warmMatte' ? sp3d?.attrs.prstMaterial : undefined,
    depthColor: colorIn(child(sp3d, 'extrusionClr'), ctx.theme)?.hex, contourColor: colorIn(child(sp3d, 'contourClr'), ctx.theme)?.hex,
    ...(top && out.bevel ? { bevelW: pt(top.attrs.w), bevelH: pt(top.attrs.h) } : {}),
    ...(bottom && BEVELS.some((b) => b.id === bottom.attrs.prst) ? { bevelBottom: bottom.attrs.prst, bevelBottomW: pt(bottom.attrs.w), bevelBottomH: pt(bottom.attrs.h) } : {}),
  });
  if (f) out.format3d = f;
  return out;
}

function effectFields(spPr: MNode | null, style: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const out: Partial<SlideElement> = format3dFields(spPr, ctx);
  // The shape's own effects, else those of the theme effect style its style points at.
  let fx = child(spPr, 'effectLst');
  let ph: string | undefined;
  if (!fx && !child(spPr, 'effectDag')) {
    const ref = child(style, 'effectRef');
    const idx = Number(ref?.attrs.idx ?? 0);
    const themed = idx > 0 ? ctx.theme.effects?.[Math.min(idx, ctx.theme.effects.length) - 1] : undefined;
    fx = child(themed, 'effectLst');
    ph = ref ? colorIn(ref, ctx.theme)?.hex : undefined;
  }
  if (!fx) return out;
  const shadow = child(fx, 'outerShdw');
  if (shadow) {
    const c = colorIn(shadow, ctx.theme, ph);
    out.dropShadow = true;
    out.shadowOpts = {
      ...(c ? { color: c.hex } : {}), ...(c && c.alpha < 1 ? { transparency: Math.round((1 - c.alpha) * 100) / 100 } : {}),
      blur: Math.round(px(shadow.attrs.blurRad, 0) * 10) / 10, dist: Math.round(px(shadow.attrs.dist, 0) * 10) / 10, dir: Number(shadow.attrs.dir ?? 0) / 60000,
    };
  }
  if (child(fx, 'innerShdw')) { out.dropShadow = true; out.shadowKind = 'inner'; }
  const glow = child(fx, 'glow');
  if (glow) {
    const c = colorIn(glow, ctx.theme, ph);
    out.glow = c?.hex; out.glowSize = px(glow.attrs.rad, 10);
    if (c && c.alpha < 1) out.glowAlpha = Math.round((1 - c.alpha) * 100) / 100;
  }
  const soft = child(fx, 'softEdge');
  if (soft) out.softEdge = px(soft.attrs.rad);
  const refl = child(fx, 'reflection');
  if (refl) {
    out.reflection = true;
    const end = Number(refl.attrs.endPos ?? 100000) / 100000, startA = Number(refl.attrs.stA ?? 100000) / 100000;
    out.reflectionOpts = { size: Math.round(end * 100) / 100, transparency: Math.round((1 - startA) * 100) / 100, dist: px(refl.attrs.dist, 0) };
  }
  return out;
}

// ── Freeform geometry (a:custGeom) → an SVG path ────────────────────────────────────────────────

/** A freeform's paths as one SVG path in the first path's coordinate box; null when it uses guides or formulas this reader does not evaluate. */
export function custGeomPath(geom: MNode): { path: string; w: number; h: number } | null {
  const paths = kids(child(geom, 'pathLst'), 'path');
  if (!paths.length) return null;
  const w0 = Number(paths[0].attrs.w) || 0, h0 = Number(paths[0].attrs.h) || 0;
  if (!(w0 > 0) || !(h0 > 0)) return null;
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = '';
  for (const p of paths) {
    if (p.attrs.fill === 'none' && p.attrs.stroke === 'false') continue;
    const sx = (Number(p.attrs.w) || w0) / w0, sy = (Number(p.attrs.h) || h0) / h0;
    const pt = (n: MNode | undefined): [number, number] | null => {
      if (!n) return null;
      const x = Number(n.attrs.x), y = Number(n.attrs.y);
      return Number.isFinite(x) && Number.isFinite(y) ? [x / sx, y / sy] : null;
    };
    let cur: [number, number] = [0, 0];
    for (const c of p.children) {
      const pts = kids(c, 'pt').map(pt);
      if (pts.some((q) => !q)) return null;
      const P = pts as [number, number][];
      switch (local(c)) {
        case 'moveTo': d += `M${f(P[0][0])} ${f(P[0][1])} `; cur = P[0]; break;
        case 'lnTo': d += `L${f(P[0][0])} ${f(P[0][1])} `; cur = P[0]; break;
        case 'cubicBezTo': d += `C${P.map((q) => `${f(q[0])} ${f(q[1])}`).join(' ')} `; cur = P[2]; break;
        case 'quadBezTo': d += `Q${P.map((q) => `${f(q[0])} ${f(q[1])}`).join(' ')} `; cur = P[1]; break;
        case 'close': d += 'Z '; break;
        case 'arcTo': {
          const wR = Number(c.attrs.wR) / sx, hR = Number(c.attrs.hR) / sy, st = Number(c.attrs.stAng) / 60000, sw = Number(c.attrs.swAng) / 60000;
          if (![wR, hR, st, sw].every(Number.isFinite) || !wR || !hR) return null;
          const param = (deg: number) => { const a = (deg * Math.PI) / 180; return Math.atan2(wR * Math.sin(a), hR * Math.cos(a)); };
          const t0 = param(st), cx = cur[0] - wR * Math.cos(t0), cy = cur[1] - hR * Math.sin(t0);
          const steps = Math.max(1, Math.ceil(Math.abs(sw) / 180));
          for (let i = 1; i <= steps; i++) {
            const deg = st + (sw * i) / steps;
            let t1 = param(deg);
            // Keep the parametric angle on the same turn as the visual one.
            const turn = Math.round((((deg * Math.PI) / 180) - t1) / (2 * Math.PI));
            t1 += turn * 2 * Math.PI;
            const end: [number, number] = [cx + wR * Math.cos(t1), cy + hR * Math.sin(t1)];
            d += `A${f(wR)} ${f(hR)} 0 ${Math.abs(sw / steps) > 180 ? 1 : 0} ${sw > 0 ? 1 : 0} ${f(end[0])} ${f(end[1])} `;
            cur = end;
          }
          break;
        }
        default:
      }
    }
  }
  return d ? { path: d.trim(), w: w0, h: h0 } : null;
}

const idOf = (n: MNode) => child(child(n, 'nvSpPr') ?? child(n, 'nvCxnSpPr') ?? child(n, 'nvPicPr') ?? child(n, 'nvGrpSpPr') ?? child(n, 'nvGraphicFramePr'), 'cNvPr')?.attrs.id;

/** The link or action of a shape's / picture's own hyperlink (a:hlinkClick in its cNvPr). */
const clickOf = (nv: MNode | null, ctx: DmlContext) => { const h = child(child(nv, 'cNvPr'), 'hlinkClick'); return h ? ctx.action?.(h) : undefined; };

function shapeElement(sp: MNode, place: Map2, ctx: DmlContext, groupId?: string): SlideElement | null {
  const inh = ctx.inherit?.(sp) ?? null;
  const ownSpPr = child(sp, 'spPr');
  const spPr = inh?.spPr ? mergeStyle(inh.spPr, ownSpPr) : ownSpPr;
  const raw = xfrmOf(child(spPr, 'xfrm'));
  if (!raw) return null;
  const b = place(raw);
  const style = child(sp, 'style');
  const nv = child(sp, 'nvSpPr') ?? child(sp, 'nvCxnSpPr');
  const name = child(nv, 'cNvPr')?.attrs.name;
  const cust = child(spPr, 'custGeom');
  const prst = child(spPr, 'prstGeom')?.attrs.prst ?? 'rect';
  const freeform = cust ? custGeomPath(cust) : null;
  if (cust && !freeform) ctx.note?.('approximated', '자유형 도형');
  const adj = presetAdjust(kids(path(spPr, 'prstGeom', 'avLst'), 'gd').map((g) => ({ name: g.attrs.name ?? '', value: Number(/val\s+(-?\d+)/.exec(g.attrs.fmla ?? '')?.[1]) })), prst);
  const isLine = local(sp) === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst);
  const txBody = child(sp, 'txBody') ?? path(sp, 'txSp', 'txBody');
  const isTextBox = child(nv, 'cNvSpPr')?.attrs.txBox === '1';
  const fill = isLine ? {} : fillFields(spPr, style, ctx);
  const line = lineFields(spPr, style, ctx);
  const fontRef = child(style, 'fontRef');
  const fontColor = colorIn(fontRef, ctx.theme)?.hex;
  const d: TextDefaults = { size: 36, color: fontColor ?? ctx.theme.colors.dk1, font: inh?.font ?? (fontRef?.attrs.idx === 'major' ? 'major' : 'minor') };
  // Text style layers: presentation default (without its colour when the shape's style names one), the placeholder's inherited
  // style, the shape's own list style.
  let defaults = ctx.defaults ?? null;
  if (defaults && fontColor) defaults = { ...defaults, children: defaults.children.map((l) => ({ ...l, children: l.children.map((r) => (local(r) === 'defRPr' ? { ...r, children: r.children.filter((c) => local(c) !== 'solidFill') } : r)) })) };
  const lst = mergeStyle(mergeStyle(inh ? null : defaults, inh?.lst), child(txBody, 'lstStyle'));
  const paras = txBody ? readParagraphs(txBody, d, ctx.theme, ctx, lst) : [];
  const hasText = paras.some((p) => p.runs.some((r) => r.text && r.text !== '\v'));
  const bodyPr = mergeStyle(inh?.bodyPr, child(txBody, 'bodyPr'));
  const anchor = bodyPr?.attrs.anchor;
  const normFit = child(bodyPr, 'normAutofit');
  const textBits: Partial<SlideElement> = hasText || isTextBox ? {
    ...textFields(paras, isTextBox || ctx.strict ? 'left' : 'center'),
    vAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : isTextBox || ctx.strict ? 'top' : anchor === 't' ? 'top' : 'middle',
    margins: [px(bodyPr?.attrs.lIns, 14.4), px(bodyPr?.attrs.tIns, 7.2), px(bodyPr?.attrs.rIns, 14.4), px(bodyPr?.attrs.bIns, 7.2)],
    autoFit: !ctx.strict ? !!child(bodyPr, 'spAutoFit') : normFit ? ('shrink' as const) : child(bodyPr, 'spAutoFit') ? ('resize' as const) : false,
    ...(bodyPr?.attrs.wrap === 'none' ? { wrap: false } : {}),
    ...fromPptxVert(bodyPr?.attrs.vert),
    ...(bodyPr?.attrs.numCol && Number(bodyPr.attrs.numCol) > 1 ? { columns: Number(bodyPr.attrs.numCol), columnSpacing: Math.round((Number(bodyPr.attrs.spcCol ?? 0) / EMU_PER_PX) * 10) / 10 } : {}),
    ...(child(bodyPr, 'prstTxWarp') && child(bodyPr, 'prstTxWarp')!.attrs.prst !== 'textNoShape' ? { warp: child(bodyPr, 'prstTxWarp')!.attrs.prst } : {}),
  } : {};
  if (normFit && Number(normFit.attrs.fontScale) > 0 && 'fontSize' in textBits) {
    // The sizes are already scaled (readParagraphs applied fontScale); the box fits itself from there.
    textBits.fontScale = undefined;
  }
  const plainBox = !isLine && (isTextBox || (!!ctx.strict && hasText)) && prst === 'rect' && !cust && !('fill' in fill) && !('stroke' in line);
  const el: SlideElement = {
    id: uid('el'),
    kind: plainBox ? 'text' : 'shape',
    ...(plainBox ? {} : freeform ? { path: freeform.path, pathW: freeform.w, pathH: freeform.h } : { shape: prst }),
    ...(adj.length && !freeform ? { adj } : {}),
    x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10,
    ...(b.rot ? { rotation: Math.round(b.rot * 100) / 100 } : {}),
    ...(b.flipH ? { flipH: true } : {}), ...(b.flipV ? { flipV: true } : {}),
    // A line's theme effect (a soft shadow) is not drawn; its own effects are.
    ...fill, ...line, ...effectFields(spPr, isLine ? null : style, ctx), ...textBits,
    ...(name ? { name } : {}),
    ...(groupId ? { groupId } : {}),
    ...clickOf(nv, ctx),
  };
  if (!plainBox && !hasText) { delete el.text; }
  if (sp.attrs.hidden === '1' || child(nv, 'cNvPr')?.attrs.hidden === '1') el.hidden = true;
  const descr = child(nv, 'cNvPr')?.attrs.descr;
  if (descr) el.alt = descr;
  return el;
}

function pictureElement(pic: MNode, place: Map2, ctx: DmlContext, groupId?: string): SlideElement[] | SlideElement | null {
  const spPr = child(pic, 'spPr');
  const raw = xfrmOf(child(spPr, 'xfrm'));
  const blipFill = child(pic, 'blipFill');
  const blip = child(blipFill, 'blip');
  // PowerPoint's SVG picture: the vector (asvg:svgBlip) when the file has it, else the PNG fallback blip.
  const svgRid = find(blip ?? { name: '', attrs: {}, children: [] }, 'svgBlip')[0]?.attrs['r:embed'];
  const poster = (svgRid ? ctx.media?.(svgRid) : undefined) ?? ctx.media?.(blip?.attrs['r:embed'] ?? '');
  const nvPr = child(child(pic, 'nvPicPr'), 'nvPr');
  const clip = child(nvPr, 'videoFile') ?? child(nvPr, 'audioFile') ?? find(nvPr ?? { name: '', attrs: {}, children: [] }, 'media')[0];
  const file = clip ? ctx.mediaFile?.(clip.attrs['r:link'] ?? clip.attrs['r:embed'] ?? '') : undefined;
  const mediaId = file?.id ?? poster;
  if (!raw || !mediaId) return null;
  const b = place(raw);
  const src = child(blipFill, 'srcRect');
  const f = (k: string) => Number(src?.attrs[k] ?? 0) / 100000;
  const crop: [number, number, number, number] = [f('l'), f('t'), f('r'), f('b')];
  const prst = child(spPr, 'prstGeom')?.attrs.prst;
  const nv = child(child(pic, 'nvPicPr'), 'cNvPr');
  const geometry = {
    x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10,
    ...(b.rot ? { rotation: Math.round(b.rot * 100) / 100 } : {}),
    ...(b.flipH ? { flipH: true } : {}), ...(b.flipV ? { flipV: true } : {}),
  };
  const common = {
    ...(nv?.attrs.name ? { name: nv.attrs.name } : {}),
    ...(nv?.attrs.descr ? { alt: nv.attrs.descr } : {}),
    ...(groupId ? { groupId } : {}),
  };
  if (file) {
    const clipEl: SlideElement = { id: uid('el'), kind: file.type, mediaId: file.id, ...geometry, ...common, fit: 'contain' };
    // The poster frame PowerPoint shows before the clip plays stays as a picture under it, grouped with it.
    if (!poster || file.type === 'audio') return [clipEl];
    const gid = groupId ?? uid('g');
    ctx.note?.('approximated', '동영상 포스터 프레임');
    return [{ id: uid('el'), kind: 'image', mediaId: poster, fit: 'fill', ...geometry, name: '포스터 프레임', groupId: gid }, { ...clipEl, groupId: gid }];
  }
  const pictureFilter = blipFilter(blip);
  // Colour changes CSS cannot draw (a:duotone, a:clrChange, a:hsl, a:tint) are left out.
  const tone = (blip?.children ?? []).find((c) => ['duotone', 'clrChange', 'hsl', 'tint'].includes(local(c)));
  if (tone) ctx.note?.('approximated', '그림 색 변경');
  const alpha = Number(child(blip, 'alphaModFix')?.attrs.amt ?? 100000) / 100000;
  return {
    id: uid('el'), kind: 'image', mediaId, fit: 'fill', ...geometry,
    ...(crop.some((v) => v) ? { crop } : {}),
    ...(prst && prst !== 'rect' ? { maskShape: prst } : {}),
    ...(alpha < 1 ? { opacity: alpha } : {}),
    ...(pictureFilter ? { pictureFilter } : {}),
    ...lineFields(spPr, child(pic, 'style'), ctx), ...effectFields(spPr, child(pic, 'style'), ctx),
    ...common, ...clickOf(child(pic, 'nvPicPr'), ctx),
  };
}

/**
 * The picture's own colour effects as a CSS filter, as PowerPoint draws them: Grayscale (a:grayscl), Black and
 * White (a:biLevel, a threshold, here at 50 %) and Brightness / Contrast (a:lum, both -100 %..100 %).
 */
export function blipFilter(blip: MNode | null | undefined): string | undefined {
  const out: string[] = [];
  for (const c of blip?.children ?? []) {
    const k = local(c);
    if (k === 'grayscl') out.push('grayscale(1)');
    else if (k === 'biLevel') out.push('grayscale(1)', 'contrast(100)');
    else if (k === 'lum') {
      const bright = Number(c.attrs.bright ?? 0) / 100000, contrast = Number(c.attrs.contrast ?? 0) / 100000;
      if (bright) out.push(`brightness(${Math.round((1 + bright) * 1000) / 1000})`);
      if (contrast) out.push(`contrast(${Math.round((contrast > 0 ? 1 / Math.max(0.01, 1 - contrast) : 1 + contrast) * 1000) / 1000})`);
    }
  }
  return out.length ? out.join(' ') : undefined;
}

function walk(container: MNode, place: Map2, ctx: DmlContext, out: SlideElement[], groupId?: string) {
  for (const n of container.children) {
    const k = local(n);
    const start = out.length;
    if (k === 'sp' || k === 'cxnSp') { const el = shapeElement(n, place, ctx, groupId); if (el) out.push(el); }
    else if (k === 'pic') { const el = pictureElement(n, place, ctx, groupId); if (Array.isArray(el)) out.push(...el); else if (el) out.push(el); }
    else if (k === 'grpSp') walk(n, groupMap(child(child(n, 'grpSpPr'), 'xfrm'), place), ctx, out, groupId ?? uid('g'));
    else if (k === 'graphicFrame') {
      const raw = xfrmOf(child(n, 'xfrm'));
      const made = raw && ctx.frame ? ctx.frame(n, place(raw), groupId) : null;
      if (made) out.push(...made);
    } else if (k === 'AlternateContent') {
      const fb = child(n, 'Fallback') ?? child(n, 'Choice');
      if (fb) walk(fb, place, ctx, out, groupId);
    }
    const id = idOf(n);
    if (id && out.length > start) ctx.made?.(id, out.slice(start));
  }
}

/** The objects of an already parsed shape tree (or any node holding shapes), moved by `offset` and put in `groupId`. */
export function nodeToElements(container: MNode, ctx: DmlContext, offset?: { x: number; y: number; sx?: number; sy?: number }, groupId?: string): SlideElement[] {
  const out: SlideElement[] = [];
  const place: Map2 = offset ? (b) => ({ ...b, x: offset.x + b.x * (offset.sx ?? 1), y: offset.y + b.y * (offset.sy ?? 1), w: b.w * (offset.sx ?? 1), h: b.h * (offset.sy ?? 1) }) : (b) => b;
  walk(container, place, ctx, out, groupId);
  return out;
}

/**
 * A DrawingML drawing (a GVML locked canvas, or a slide's <p:spTree>) → LightCast objects. The locked
 * canvas's own group transform is ignored: its children keep their slide positions.
 */
export function drawingToElements(xml: string, ctx: DmlContext): SlideElement[] {
  const doc = parseMarkup(xml);
  const top = find(doc, 'lockedCanvas')[0] ?? find(doc, 'spTree')[0] ?? doc;
  const out: SlideElement[] = [];
  walk(top, (b) => b, ctx, out);
  return out;
}

/** Objects that lie mostly off a 4:3 slide (copied from a wide one) are moved in, keeping their layout. */
export function keepOnSlide(els: SlideElement[], W = 1440, H = 1080): SlideElement[] {
  if (!els.length) return els;
  const minX = Math.min(...els.map((e) => e.x)), minY = Math.min(...els.map((e) => e.y));
  const maxX = Math.max(...els.map((e) => e.x + e.w)), maxY = Math.max(...els.map((e) => e.y + e.h));
  const dx = maxX > W ? Math.max(-minX, W - maxX) : minX < 0 ? -minX : 0;
  const dy = maxY > H ? Math.max(-minY, H - maxY) : minY < 0 ? -minY : 0;
  return dx || dy ? els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })) : els;
}

export interface GvmlResult { elements: SlideElement[]; media: { rId: string; id: string; name: string; blob: Blob }[] }

/** PowerPoint's "Art::GVML ClipFormat" package → objects and the pictures they use (to be stored). */
export async function readGvml(bytes: ArrayBuffer | Uint8Array, newMediaId: () => string = () => uid('m'), shrink: (blob: Blob) => Promise<string | null> = shrinkBulletPicture): Promise<GvmlResult | null> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return null; }
  const names = Object.keys(zip.files);
  const drawing = names.find((n) => /drawings\/drawing\d*\.xml$/.test(n));
  if (!drawing) return null;
  const xml = await zip.file(drawing)!.async('string');
  const themePart = names.find((n) => /theme\/theme\d*\.xml$/.test(n));
  const theme = themePart ? readDmlTheme(await zip.file(themePart)!.async('string')) : OFFICE_THEME;
  const relsName = drawing.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = zip.file(relsName) ? parseMarkup(await zip.file(relsName)!.async('string')) : null;
  const media: GvmlResult['media'] = [];
  // Pictures that only serve as bullets (a:buBlip) become `bulletPicture`s, not media of the file.
  const parsed = parseMarkup(xml);
  const uses = (rId: string, nodes: MNode[]) => nodes.filter((b) => b.attrs['r:embed'] === rId).length;
  const allBlips = find(parsed, 'blip');
  const bulletBlips = find(parsed, 'buBlip').flatMap((n) => find(n, 'blip'));
  const bulletIds = new Set(bulletBlips.map((b) => b.attrs['r:embed']));
  const bullets = new Map<string, string>();
  for (const r of rels ? find(rels, 'Relationship') : []) {
    if (!/\/image$/.test(r.attrs.Type ?? '')) continue;
    const target = new URL(r.attrs.Target, `http://x/${drawing}`).pathname.slice(1);
    const f = zip.file(target);
    if (!f) continue;
    const ext = target.split('.').pop()?.toLowerCase() ?? 'png';
    const file = target.split('/').pop() ?? 'image';
    if (ext === 'emf' || ext === 'wmf') {
      // Windows metafile pictures are drawn at import (a PNG with a DOM, else an SVG), not dropped.
      if (bulletIds.has(r.attrs.Id) && uses(r.attrs.Id, allBlips) <= uses(r.attrs.Id, bulletBlips)) continue;
      const mblob = await metafileToBlob(await f.async('arraybuffer'));
      if (mblob) media.push({ rId: r.attrs.Id, id: newMediaId(), name: file.replace(/\.(emf|wmf)$/i, mblob.type === 'image/png' ? '.png' : '.svg'), blob: mblob });
      continue;
    }
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
    const blob = new Blob([await f.async('arraybuffer')], { type });
    if (bulletIds.has(r.attrs.Id)) {
      const url = await shrink(blob);
      if (url) bullets.set(r.attrs.Id, url);
      if (uses(r.attrs.Id, allBlips) <= uses(r.attrs.Id, bulletBlips)) continue;
    }
    media.push({ rId: r.attrs.Id, id: newMediaId(), name: file, blob });
  }
  const elements = drawingToElements(xml, { theme, media: (rId) => media.find((m) => m.rId === rId)?.id, bulletPicture: (rId) => bullets.get(rId) });
  return { elements: keepOnSlide(elements), media };
}
