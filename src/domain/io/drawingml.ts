// PowerPoint's own clipboard copy of shapes (the "Art::GVML ClipFormat" part, a small Office package
// whose drawing is DrawingML in a locked canvas) and DrawingML shape trees in general → LightCast
// objects at the same place, size, rotation, fill, outline, font, size, colour and paragraph format.
// Positions are kept in physical units: 1 canvas px = 6350 EMU (the 4:3 slide is 10 in × 7.5 in at
// 1440 × 1080 px), so 1 pt of type is 2 canvas px, as everywhere else in LightCast.
import JSZip from 'jszip';
import type { DashStyle, ElementParagraph, HAlign, ListStyle, SlideElement, TextRun } from '../types';
import { uid } from '../lyrics';
import { normalizeRuns } from '../richText';
import { officeFont } from '../fonts';
import { child, find, kids, local, parseMarkup, path, type MNode } from './markup';

export const EMU_PER_PX = 6350;
const px = (emu: string | undefined, dflt = 0) => (emu === undefined || emu === '' || !Number.isFinite(Number(emu)) ? dflt : Number(emu) / EMU_PER_PX);

export interface DmlTheme {
  /** dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink. */
  colors: Record<string, string>;
  majorLatin?: string; minorLatin?: string; majorEa?: string; minorEa?: string;
}

export const OFFICE_THEME: DmlTheme = {
  colors: { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72' },
  majorLatin: 'Calibri Light', minorLatin: 'Calibri', majorEa: '맑은 고딕', minorEa: '맑은 고딕',
};

/** A theme part (<a:theme>) → its colours and fonts. */
export function readDmlTheme(xml: string): DmlTheme {
  const doc = parseMarkup(xml);
  const scheme = find(doc, 'clrScheme')[0];
  const colors = { ...OFFICE_THEME.colors };
  for (const slot of scheme?.children ?? []) {
    const c = child(slot, 'srgbClr')?.attrs.val ?? child(slot, 'sysClr')?.attrs.lastClr;
    if (c && /^[0-9a-f]{6}$/i.test(c)) colors[local(slot)] = `#${c.toLowerCase()}`;
  }
  const font = (part: string, script: string) => child(find(doc, part)[0], script)?.attrs.typeface || undefined;
  return { colors, majorLatin: font('majorFont', 'latin'), minorLatin: font('minorFont', 'latin'), majorEa: font('majorFont', 'ea'), minorEa: font('minorFont', 'ea') };
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

/** A colour element (srgbClr, schemeClr, …) with its modifiers (lumMod, tint, alpha …). */
export function colorOf(node: MNode | null | undefined, theme: DmlTheme, ph?: string): { hex: string; alpha: number } | null {
  if (!node) return null;
  const n = local(node);
  let hex: string | undefined;
  if (n === 'srgbClr') hex = `#${node.attrs.val}`;
  else if (n === 'sysClr') hex = `#${node.attrs.lastClr ?? (node.attrs.val === 'window' ? 'ffffff' : '000000')}`;
  else if (n === 'schemeClr') hex = node.attrs.val === 'phClr' ? ph : theme.colors[SCHEME_ALIAS[node.attrs.val] ?? node.attrs.val];
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
      case 'tint': rgb = rgb.map((c) => c + (1 - c) * (1 - v)) as typeof rgb; break;
      case 'shade': rgb = rgb.map((c) => c * v) as typeof rgb; break;
      case 'satMod': { const [h, s, l] = toHsl(rgb); rgb = fromHsl(h, clamp01(s * v), l); break; }
      case 'alpha': alpha = clamp01(v); break;
      default:
    }
  }
  return { hex: toHex(...rgb), alpha };
}
/** The colour inside a fill-like element (solidFill, fontRef …). */
const colorIn = (n: MNode | null | undefined, theme: DmlTheme, ph?: string) => (n ? colorOf(n.children.find((c) => /Clr$/.test(local(c))), theme, ph) : null);

// ── Text ────────────────────────────────────────────────────────────────────────────────────────

const ALIGN: Record<string, HAlign> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
const AUTONUM: Record<string, ListStyle> = { arabicPeriod: 'number', arabicParenR: 'number-paren', arabicParenBoth: 'number-paren', romanUcPeriod: 'roman', romanLcPeriod: 'roman', alphaLcPeriod: 'alpha', alphaUcPeriod: 'alpha', alphaLcParenR: 'alpha', hangulGanadaPeriod: 'hangul', ganada: 'hangul' };
const EAST_ASIAN = /[ᄀ-ᇿ　-鿿가-힯豈-﫿＀-￯]/;

interface TextDefaults { size: number; color?: string; font: 'minor' | 'major'; bold?: boolean; italic?: boolean }

function resolveFace(face: string | undefined, theme: DmlTheme, which: 'minor' | 'major', ea: boolean): string | undefined {
  const pick = (f: 'Latin' | 'Ea', w: 'minor' | 'major') => theme[`${w}${f}` as keyof DmlTheme] as string | undefined;
  if (face) {
    const m = /^\+(mn|mj)-(lt|ea|cs)$/.exec(face);
    if (!m) return face;
    return pick(m[2] === 'ea' ? 'Ea' : 'Latin', m[1] === 'mj' ? 'major' : 'minor');
  }
  return (ea ? pick('Ea', which) : undefined) ?? pick('Latin', which);
}

type Run = TextRun & { fontFamily?: string };

function readRun(r: MNode, text: string, base: MNode | null, d: TextDefaults, theme: DmlTheme, scale: number): Run {
  const rPr = child(r, 'rPr');
  const attr = (k: string) => rPr?.attrs[k] ?? base?.attrs[k];
  const sz = attr('sz');
  const ea = EAST_ASIAN.test(text);
  const face = (ea ? child(rPr, 'ea') ?? child(base, 'ea') : null)?.attrs.typeface ?? child(rPr, 'latin')?.attrs.typeface ?? child(base, 'latin')?.attrs.typeface ?? (ea ? undefined : child(rPr, 'ea')?.attrs.typeface);
  const fill = child(rPr, 'solidFill') ?? child(base, 'solidFill');
  const hl = child(rPr, 'highlight');
  const bl = Number(attr('baseline') ?? 0);
  const b = attr('b'), i = attr('i'), u = attr('u'), st = attr('strike');
  const family = resolveFace(face, theme, d.font, ea);
  return {
    text,
    fontSize: Math.round((sz ? (Number(sz) / 100) * 2 : d.size) * scale * 10) / 10,
    bold: b !== undefined ? b === '1' || b === 'true' : d.bold,
    italic: i !== undefined ? i === '1' || i === 'true' : d.italic,
    underline: u && u !== 'none' ? true : undefined,
    strike: st && st !== 'noStrike' ? true : undefined,
    baseline: bl > 0 ? 'super' : bl < 0 ? 'sub' : undefined,
    color: colorIn(fill, theme)?.hex ?? d.color,
    highlight: colorIn(hl, theme)?.hex,
    fontFamily: family ? officeFont(family) : undefined,
  };
}

interface Para { runs: Run[]; align?: HAlign; list?: ListStyle; lineHeight?: number; before?: number; after?: number; empty: Run }

function readParagraphs(txBody: MNode, d: TextDefaults, theme: DmlTheme): Para[] {
  const lst = child(txBody, 'lstStyle');
  const scale = Number(path(txBody, 'bodyPr', 'normAutofit')?.attrs.fontScale ?? 100000) / 100000;
  return kids(txBody, 'p').map((p) => {
    const pPr = child(p, 'pPr');
    const lvl = Number(pPr?.attrs.lvl ?? 0);
    const lvlPr = child(lst, `lvl${lvl + 1}pPr`);
    const base = child(lvlPr, 'defRPr');
    const runs: Run[] = [];
    for (const r of p.children) {
      const n = local(r);
      if (n === 'r' || n === 'fld') runs.push(readRun(r, find(r, 't').map((t) => t.children.map((c) => c.text ?? '').join('')).join(''), base, d, theme, scale));
      else if (n === 'br') runs.push({ ...readRun(r, '\v', base, d, theme, scale) });
    }
    const end = child(p, 'endParaRPr');
    const empty = readRun({ name: 'a:r', attrs: {}, children: end ? [{ ...end, name: 'a:rPr' }] : [] }, '', base, d, theme, scale);
    const spc = (k: string) => {
      const pts = path(pPr, k, 'spcPts')?.attrs.val;
      return pts ? (Number(pts) / 100) * 2 : undefined;
    };
    const pct = path(pPr, 'lnSpc', 'spcPct')?.attrs.val;
    const auto = child(pPr, 'buAutoNum')?.attrs.type;
    const list: ListStyle | undefined = child(pPr, 'buNone') ? undefined : auto ? AUTONUM[auto] ?? 'number' : child(pPr, 'buChar') ? (/[○◦]/.test(child(pPr, 'buChar')!.attrs.char ?? '') ? 'circle' : /[■▪§]/.test(child(pPr, 'buChar')!.attrs.char ?? '') ? 'square' : /[✓ü]/.test(child(pPr, 'buChar')!.attrs.char ?? '') ? 'check' : /[➢Ø→]/.test(child(pPr, 'buChar')!.attrs.char ?? '') ? 'arrow' : 'bullet') : undefined;
    const algn = pPr?.attrs.algn ?? lvlPr?.attrs.algn;
    return { runs, align: algn ? ALIGN[algn] : undefined, list, lineHeight: pct ? (Number(pct) / 100000) * 1.2 : undefined, before: spc('spcBef'), after: spc('spcAft'), empty };
  });
}

const RUN_KEYS = ['fontSize', 'bold', 'italic', 'underline', 'strike', 'baseline', 'color', 'highlight', 'fontFamily'] as const;

/** Paragraphs → the element's text, its own formatting (that of most of its text) and runs for the rest. */
export function textFields(paras: Para[], fallbackAlign: HAlign = 'left'): Partial<SlideElement> {
  // A soft line break (<a:br/>) is a new line of the same paragraph; LightCast keeps lines.
  const lines: { runs: Run[]; p: Para }[] = [];
  for (const p of paras) {
    let cur: Run[] = [];
    for (const r of p.runs) {
      if (r.text === '\v') { lines.push({ runs: cur, p }); cur = []; } else cur.push(r);
    }
    lines.push({ runs: cur, p });
  }
  const all = lines.flatMap((l) => l.runs).filter((r) => r.text);
  const first = all[0] ?? paras[0]?.empty ?? { text: '' };
  // The box's own formatting is its first text's (as PowerPoint shows it when the box is selected).
  const own: Partial<Record<(typeof RUN_KEYS)[number], unknown>> = {};
  for (const k of RUN_KEYS) own[k] = first[k];
  const strip = (r: Run): TextRun => {
    const out: TextRun = { text: r.text };
    for (const k of RUN_KEYS) if (r[k] !== own[k] && r[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = r[k];
    // A run that is not bold / italic inside a bold / italic box says so.
    if (own.bold && !r.bold) out.bold = false;
    if (own.italic && !r.italic) out.italic = false;
    return out;
  };
  const text = lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n');
  const runLines = lines.map((l) => normalizeRuns(l.runs.map(strip)));
  const aligns = lines.map((l) => l.p.align ?? fallbackAlign);
  const mixedAlign = aligns.some((a) => a !== aligns[0]);
  const lp = paras[0];
  const fields: Partial<SlideElement> = {
    text,
    fontSize: (own.fontSize as number | undefined) ?? 36,
    color: own.color as string | undefined,
    fontFamily: own.fontFamily as string | undefined,
    bold: (own.bold as boolean | undefined) || undefined,
    italic: (own.italic as boolean | undefined) || undefined,
    underline: (own.underline as boolean | undefined) || undefined,
    strike: (own.strike as boolean | undefined) || undefined,
    highlight: own.highlight as string | undefined,
    align: aligns[0],
    list: lp?.list,
    lineHeight: lp?.lineHeight,
    spaceBefore: lp?.before,
    spaceAfter: lp?.after,
  };
  const formatted = runLines.some((l) => l.some((r) => Object.keys(r).length > 1));
  if (mixedAlign) fields.paragraphs = lines.map((_l, i): ElementParagraph => ({ text: runLines[i].map((r) => r.text).join(''), runs: runLines[i], align: aligns[i] }));
  else if (formatted) fields.runs = runLines;
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

const DASH: Record<string, DashStyle> = { dash: 'dash', lgDash: 'dash', sysDash: 'dash', dot: 'dot', sysDot: 'dot', dashDot: 'dashDot', lgDashDot: 'dashDot', sysDashDot: 'dashDot', lgDashDotDot: 'dashDot', sysDashDotDot: 'dashDot' };
const LINE_STYLE_W = [6350, 12700, 19050];

export interface DmlContext {
  theme: DmlTheme;
  /** A picture's relationship id → the LightCast media id it was stored under. */
  media?: (rId: string) => string | undefined;
}

function fillFields(spPr: MNode | null, style: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const t = ctx.theme;
  if (child(spPr, 'noFill')) return {};
  const solid = child(spPr, 'solidFill');
  if (solid) { const c = colorIn(solid, t); return c ? { fill: c.hex } : {}; }
  const grad = child(spPr, 'gradFill');
  if (grad) {
    const stops = kids(child(grad, 'gsLst'), 'gs').sort((a, b) => Number(a.attrs.pos) - Number(b.attrs.pos)).map((g) => colorIn(g, t)?.hex).filter(Boolean) as string[];
    if (stops.length) return { fill: stops[0], gradient: [stops[0], stops[stops.length - 1]], gradientAngle: Number(child(grad, 'lin')?.attrs.ang ?? 0) / 60000, ...(child(grad, 'path') ? { gradientType: 'radial' as const } : {}) };
  }
  const blip = path(spPr, 'blipFill', 'blip');
  const media = blip && ctx.media?.(blip.attrs['r:embed'] ?? '');
  if (media) return { fillImage: media };
  const patt = child(spPr, 'pattFill');
  if (patt) {
    const fg = colorIn(child(patt, 'fgClr'), t)?.hex ?? '#000000', bg = colorIn(child(patt, 'bgClr'), t)?.hex ?? '#ffffff';
    return { fill: bg, pattern: { kind: patt.attrs.prst ?? 'pct50', fg, bg } };
  }
  if (spPr && (solid || grad)) return {};
  const ref = child(style, 'fillRef');
  if (ref && Number(ref.attrs.idx) > 0) { const c = colorIn(ref, t); if (c) return { fill: c.hex }; }
  return {};
}

function lineFields(spPr: MNode | null, style: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const ln = child(spPr, 'ln');
  const ref = child(style, 'lnRef');
  const refIdx = Number(ref?.attrs.idx ?? 0);
  if (child(ln, 'noFill')) return {};
  const c = colorIn(child(ln, 'solidFill'), ctx.theme) ?? colorIn(path(ln, 'gradFill', 'gsLst', 'gs'), ctx.theme) ?? (refIdx > 0 ? colorIn(ref, ctx.theme) : null);
  if (!c) return {};
  const w = ln?.attrs.w ? Number(ln.attrs.w) : LINE_STYLE_W[Math.min(refIdx, 3) - 1] ?? 12700;
  const dash = DASH[child(ln, 'prstDash')?.attrs.val ?? ''];
  const arrow = (k: string) => { const ty = child(ln, k)?.attrs.type; return !!ty && ty !== 'none'; };
  return { stroke: c.hex, strokeWidth: Math.max(0.5, Math.round((w / EMU_PER_PX) * 10) / 10), ...(dash ? { dash } : {}), ...(arrow('headEnd') ? { arrowStart: true } : {}), ...(arrow('tailEnd') ? { arrowEnd: true } : {}) };
}

function effectFields(spPr: MNode | null, ctx: DmlContext): Partial<SlideElement> {
  const fx = child(spPr, 'effectLst');
  if (!fx) return {};
  const out: Partial<SlideElement> = {};
  if (child(fx, 'outerShdw')) out.dropShadow = true;
  if (child(fx, 'innerShdw')) { out.dropShadow = true; out.shadowKind = 'inner'; }
  const glow = child(fx, 'glow');
  if (glow) { out.glow = colorIn(glow, ctx.theme)?.hex; out.glowSize = px(glow.attrs.rad, 10); }
  const soft = child(fx, 'softEdge');
  if (soft) out.softEdge = px(soft.attrs.rad);
  if (child(fx, 'reflection')) out.reflection = true;
  return out;
}

function shapeElement(sp: MNode, place: Map2, ctx: DmlContext, groupId?: string): SlideElement | null {
  const spPr = child(sp, 'spPr');
  const raw = xfrmOf(child(spPr, 'xfrm'));
  if (!raw) return null;
  const b = place(raw);
  const style = child(sp, 'style');
  const nv = child(sp, 'nvSpPr') ?? child(sp, 'nvCxnSpPr');
  const name = child(nv, 'cNvPr')?.attrs.name;
  const prst = child(spPr, 'prstGeom')?.attrs.prst ?? (child(spPr, 'custGeom') ? 'rect' : 'rect');
  const adj = kids(path(spPr, 'prstGeom', 'avLst'), 'gd').map((g) => Number(/val\s+(-?\d+)/.exec(g.attrs.fmla ?? '')?.[1])).filter((v) => Number.isFinite(v));
  const isLine = local(sp) === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst);
  const txBody = child(sp, 'txBody') ?? path(sp, 'txSp', 'txBody');
  const isTextBox = child(nv, 'cNvSpPr')?.attrs.txBox === '1';
  const fill = isLine ? {} : fillFields(spPr, style, ctx);
  const line = lineFields(spPr, style, ctx);
  const fontRef = child(style, 'fontRef');
  const d: TextDefaults = { size: 36, color: colorIn(fontRef, ctx.theme)?.hex ?? ctx.theme.colors.dk1, font: fontRef?.attrs.idx === 'major' ? 'major' : 'minor' };
  const paras = txBody ? readParagraphs(txBody, d, ctx.theme) : [];
  const hasText = paras.some((p) => p.runs.some((r) => r.text && r.text !== '\v'));
  const bodyPr = child(txBody, 'bodyPr');
  const anchor = bodyPr?.attrs.anchor;
  const textBits: Partial<SlideElement> = hasText || isTextBox ? {
    ...textFields(paras, isTextBox ? 'left' : 'center'),
    vAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : isTextBox ? 'top' : anchor === 't' ? 'top' : 'middle',
    margins: [px(bodyPr?.attrs.lIns, 14.4), px(bodyPr?.attrs.tIns, 7.2), px(bodyPr?.attrs.rIns, 14.4), px(bodyPr?.attrs.bIns, 7.2)],
    autoFit: !!child(bodyPr, 'spAutoFit'),
    ...(bodyPr?.attrs.wrap === 'none' ? { wrap: false } : {}),
    ...(/^(vert|eaVert|wordArtVert|vert270)$/.test(bodyPr?.attrs.vert ?? '') ? { vertical: true } : {}),
    ...(bodyPr?.attrs.numCol && Number(bodyPr.attrs.numCol) > 1 ? { columns: Number(bodyPr.attrs.numCol) } : {}),
    ...(child(bodyPr, 'prstTxWarp') && child(bodyPr, 'prstTxWarp')!.attrs.prst !== 'textNoShape' ? { warp: child(bodyPr, 'prstTxWarp')!.attrs.prst } : {}),
  } : {};
  const plainBox = !isLine && isTextBox && prst === 'rect' && !('fill' in fill) && !('stroke' in line);
  const el: SlideElement = {
    id: uid('el'),
    kind: plainBox ? 'text' : 'shape',
    ...(plainBox ? {} : { shape: prst }),
    ...(adj.length ? { adj } : {}),
    x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10,
    ...(b.rot ? { rotation: Math.round(b.rot * 100) / 100 } : {}),
    ...(b.flipH ? { flipH: true } : {}), ...(b.flipV ? { flipV: true } : {}),
    ...fill, ...line, ...effectFields(spPr, ctx), ...textBits,
    ...(name ? { name } : {}),
    ...(groupId ? { groupId } : {}),
  };
  if (!plainBox && !hasText) { delete el.text; }
  if (sp.attrs.hidden === '1' || child(nv, 'cNvPr')?.attrs.hidden === '1') el.hidden = true;
  const descr = child(nv, 'cNvPr')?.attrs.descr;
  if (descr) el.alt = descr;
  return el;
}

function pictureElement(pic: MNode, place: Map2, ctx: DmlContext, groupId?: string): SlideElement | null {
  const spPr = child(pic, 'spPr');
  const raw = xfrmOf(child(spPr, 'xfrm'));
  const blipFill = child(pic, 'blipFill');
  const media = ctx.media?.(child(blipFill, 'blip')?.attrs['r:embed'] ?? '');
  if (!raw || !media) return null;
  const b = place(raw);
  const src = child(blipFill, 'srcRect');
  const f = (k: string) => Number(src?.attrs[k] ?? 0) / 100000;
  const crop: [number, number, number, number] = [f('l'), f('t'), f('r'), f('b')];
  const prst = child(spPr, 'prstGeom')?.attrs.prst;
  const nv = child(child(pic, 'nvPicPr'), 'cNvPr');
  return {
    id: uid('el'), kind: 'image', mediaId: media, fit: 'fill',
    x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10,
    ...(b.rot ? { rotation: Math.round(b.rot * 100) / 100 } : {}),
    ...(b.flipH ? { flipH: true } : {}), ...(b.flipV ? { flipV: true } : {}),
    ...(crop.some((v) => v) ? { crop } : {}),
    ...(prst && prst !== 'rect' ? { maskShape: prst } : {}),
    ...lineFields(spPr, child(pic, 'style'), ctx), ...effectFields(spPr, ctx),
    ...(nv?.attrs.name ? { name: nv.attrs.name } : {}),
    ...(nv?.attrs.descr ? { alt: nv.attrs.descr } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

function walk(container: MNode, place: Map2, ctx: DmlContext, out: SlideElement[], groupId?: string) {
  for (const n of container.children) {
    const k = local(n);
    if (k === 'sp' || k === 'cxnSp') { const el = shapeElement(n, place, ctx, groupId); if (el) out.push(el); }
    else if (k === 'pic') { const el = pictureElement(n, place, ctx, groupId); if (el) out.push(el); }
    else if (k === 'grpSp') walk(n, groupMap(child(child(n, 'grpSpPr'), 'xfrm'), place), ctx, out, groupId ?? uid('g'));
    else if (k === 'graphicFrame' || k === 'AlternateContent' || k === 'Choice' || k === 'Fallback') {
      // Only fall-backs that are plain shapes or pictures are read (tables and charts come as a picture).
      if (k === 'AlternateContent') { const fb = child(n, 'Fallback') ?? child(n, 'Choice'); if (fb) walk(fb, place, ctx, out, groupId); }
    }
  }
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
export async function readGvml(bytes: ArrayBuffer | Uint8Array, newMediaId: () => string = () => uid('m')): Promise<GvmlResult | null> {
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
  for (const r of rels ? find(rels, 'Relationship') : []) {
    if (!/\/image$/.test(r.attrs.Type ?? '')) continue;
    const target = new URL(r.attrs.Target, `http://x/${drawing}`).pathname.slice(1);
    const f = zip.file(target);
    if (!f) continue;
    const ext = target.split('.').pop()?.toLowerCase() ?? 'png';
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'emf' || ext === 'wmf' ? '' : 'image/png';
    if (!type) continue;
    media.push({ rId: r.attrs.Id, id: newMediaId(), name: target.split('/').pop() ?? 'image', blob: new Blob([await f.async('arraybuffer')], { type }) });
  }
  const elements = drawingToElements(xml, { theme, media: (rId) => media.find((m) => m.rId === rId)?.id });
  return { elements: keepOnSlide(elements), media };
}
