// OpenDocument Presentation (.odp): read into LightCast slides, and write a valid minimal file back.
// Pure logic — pictures go in and out through callbacks so tests need no browser storage.
import { splitWeightedFace, weightPatch } from '../fontWeight';
import JSZip from 'jszip';
import type { ArrowKind, Background, DashStyle, DocProperties, ListStyle, SlideAnimation, ElementParagraph, HAlign, Presentation, Slide, SlideElement, TextRun } from '../types';
import type { TableData } from '../../engine';
import { CANVAS_H, CANVAS_W } from '../canvas';
import { uid } from '../lyrics';
import { childNamed, childrenNamed, elementsOf, escapeXml, parseXml, textOf, type XNode } from './miniXml';
import { gradientCss } from '../backgroundFormat';
import {
  IDENTITY, applyPoint, gradientToLc, hexColor, isIdentity, lcToGradient, lengthToCm, mul, parseAngle, parseTransform, readTransition,
  parseStopsCss, rotationTransform, stopsCss, transformBox, transitionAttrs, withOpacity, opacityGradient, type Mat, type OdfGradient,
} from './odpGeometry';

export { hexColor, lengthToCm };

export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';

// ── Units ─────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_PAGE = { w: 28, h: 21 }; // cm: a 4:3 slide, the shape LightCast slides have
const PX_PER_PT = CANVAS_W / 720; // 10 in slide = 720 pt = 1440 canvas px
const fmtCm = (px: number, perPx: number) => `${Math.round(px * perPx * 1000) / 1000}cm`;

// ── Styles ────────────────────────────────────────────────────────────────────────────────────
type Props = Record<string, string>;
interface StyleDef { family: string; parent?: string; props: Props }

/** Everything the reader pulls out of the style sections besides the styles themselves. */
interface StyleLib {
  gradients: Map<string, OdfGradient>;
  /** draw:opacity transparency gradients (colour = grey of the opacity), by name. */
  opacities: Map<string, OdfGradient>;
  /** text:list-style name → the first level's list style. */
  lists: Map<string, ListStyle>;
  /** draw:marker name → arrowhead kind. */
  markers: Map<string, ArrowKind>;
  /** draw:stroke-dash name → dash. */
  dashes: Map<string, DashStyle>;
}

const markerKind = (name: string): ArrowKind => (/oval|circle/i.test(name) ? 'oval' : /diamond/i.test(name) ? 'diamond' : /stealth/i.test(name) ? 'stealth' : /open|line/i.test(name) ? 'arrow' : 'triangle');
const listOf = (lvl: XNode | undefined): ListStyle | undefined => {
  if (!lvl) return undefined;
  if (lvl.name === 'text:list-level-style-number') {
    const f = lvl.attrs['style:num-format'] ?? '1';
    return f === 'i' || f === 'I' ? 'roman' : f === 'a' || f === 'A' ? 'alpha' : /[가나]|ㄱ/.test(f) ? 'hangul' : (lvl.attrs['style:num-suffix'] ?? '').includes(')') && !(lvl.attrs['style:num-prefix'] ?? '').includes('(') ? 'number-paren' : 'number';
  }
  if (lvl.name !== 'text:list-level-style-bullet') return undefined;
  const c = lvl.attrs['text:bullet-char'] ?? '';
  return /[○◦o]/.test(c) ? 'circle' : /[■▪□◼]/.test(c) ? 'square' : /[✔✓☑]/.test(c) ? 'check' : /[➢➔➤→►▶➜]/.test(c) ? 'arrow' : 'bullet';
};
function dashOf(d: XNode): DashStyle {
  const len = Number(/\d+/.exec(d.attrs['draw:dots1-length'] ?? '')?.[0] ?? 100);
  const dist = Number(/\d+/.exec(d.attrs['draw:distance'] ?? '')?.[0] ?? 100);
  if (d.attrs['draw:dots2']) return 'dashDot';
  if (len >= 700) return 'lgDash';
  if (len >= 300) return 'dash';
  if (len <= 100 && Number(d.attrs['draw:dots1'] ?? 1) === 1) return dist >= 200 ? 'dot' : 'sysDot';
  return 'dash';
}
const grey = (v: number) => `#${Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0').repeat(3)}`;
const pctOf = (v: string | undefined) => { const m = /^([\d.]+)(%?)$/.exec(v ?? ''); return m ? Number(m[1]) / (m[2] ? 100 : 1) : 1; };

function readStyles(root: XNode | undefined, into: Map<string, StyleDef>, lib: StyleLib) {
  if (!root) return;
  const scan = (n: XNode) => {
    for (const s of elementsOf(n)) {
      if (s.name === 'style:style' || s.name === 'style:default-style') {
        const props: Props = {};
        for (const p of elementsOf(s)) if (/^(style|loext):.*-properties$/.test(p.name)) Object.assign(props, p.attrs);
        const name = s.attrs['style:name'] ?? `#default:${s.attrs['style:family']}`;
        if (s.attrs['style:list-style-name']) props['style:list-style-name'] = s.attrs['style:list-style-name'];
        into.set(`${s.attrs['style:family'] ?? ''}:${name}`, { family: s.attrs['style:family'] ?? '', parent: s.attrs['style:parent-style-name'], props });
      } else if (s.name === 'text:list-style' && s.attrs['style:name']) {
        const l = listOf(elementsOf(s).find((c) => c.name.startsWith('text:list-level-style-')));
        if (l) lib.lists.set(s.attrs['style:name'], l);
      } else if (s.name === 'draw:marker' && s.attrs['draw:name']) lib.markers.set(s.attrs['draw:name'], markerKind(`${s.attrs['draw:name']} ${s.attrs['draw:display-name'] ?? ''}`));
      else if (s.name === 'draw:stroke-dash' && s.attrs['draw:name']) lib.dashes.set(s.attrs['draw:name'], dashOf(s));
      else if (s.name === 'draw:opacity' && s.attrs['draw:name']) {
        const stops = elementsOf(s).filter((c) => c.name === 'loext:opacity-stop').map((c) => ({ pos: Math.round(pctOf(c.attrs['svg:offset']) * 1000) / 10, color: grey(pctOf(c.attrs['svg:stop-opacity'])) }));
        lib.opacities.set(s.attrs['draw:name'], { style: s.attrs['draw:style'] ?? 'linear', start: grey(pctOf(s.attrs['draw:start'])), end: grey(pctOf(s.attrs['draw:end'])), angle: parseAngle(s.attrs['draw:angle']), ...(stops.length >= 2 ? { stops } : {}) });
      } else if (s.name === 'draw:gradient' && s.attrs['draw:name']) {
        const start = colorOf(s.attrs['draw:start-color']), end = colorOf(s.attrs['draw:end-color']);
        const stops = elementsOf(s).filter((c) => c.name === 'loext:gradient-stop').flatMap((c) => {
          // LibreOffice writes loext:color-value; a draft of the spec used svg:stop-color.
          const color = colorOf(c.attrs['loext:color-value'] ?? c.attrs['svg:stop-color']);
          const off = /^([\d.]+)(%?)$/.exec(c.attrs['svg:offset'] ?? '');
          return color && off ? [{ pos: Math.round(Number(off[1]) * (off[2] ? 1 : 100) * 10) / 10, color }] : [];
        });
        if ((start && end) || stops.length >= 2) lib.gradients.set(s.attrs['draw:name'], { style: s.attrs['draw:style'] ?? 'linear', start: start ?? stops[0].color, end: end ?? stops[stops.length - 1].color, angle: parseAngle(s.attrs['draw:angle']), ...(stops.length >= 2 ? { stops } : {}) });
      } else if (s.name === 'office:styles' || s.name === 'office:automatic-styles' || s.name === 'office:master-styles') scan(s);
    }
  };
  scan(root);
}

function resolveStyle(styles: Map<string, StyleDef>, family: string, name: string | undefined): Props {
  const chain: Props[] = [];
  const seen = new Set<string>();
  for (let n = name; n && !seen.has(n); ) {
    seen.add(n);
    const d = styles.get(`${family}:${n}`);
    if (!d) break;
    chain.unshift(d.props);
    n = d.parent;
  }
  return Object.assign({}, styles.get(`${family}:#default:${family}`)?.props, ...chain);
}

const HEX = /^#[0-9a-f]{6}$/i;
const colorOf = (v: string | undefined): string | undefined => (v && HEX.test(v) ? v.toLowerCase() : undefined);

function textProps(p: Props): Omit<TextRun, 'text'> {
  const out: Omit<TextRun, 'text'> = {};
  const size = /^([\d.]+)pt$/.exec(p['fo:font-size'] ?? '');
  if (size) out.fontSize = Math.round(Number(size[1]) * PX_PER_PT);
  else { const cm = /^[\d.]+(cm|mm|in)$/.test(p['fo:font-size'] ?? '') ? lengthToCm(p['fo:font-size']) : undefined; if (cm) out.fontSize = Math.round((cm / 2.54) * 72 * PX_PER_PT); }
  if (p['fo:font-weight'] === 'bold' || Number(p['fo:font-weight']) >= 600) out.bold = true;
  const numericWeight = Number(p['fo:font-weight']);
  if (numericWeight >= 100 && numericWeight <= 900 && numericWeight !== 400 && numericWeight !== 700) Object.assign(out, weightPatch(numericWeight));
  if (p['fo:font-style'] === 'italic' || p['fo:font-style'] === 'oblique') out.italic = true;
  const color = colorOf(p['fo:color']);
  if (color) out.color = color;
  if (p['style:text-underline-style'] && p['style:text-underline-style'] !== 'none') out.underline = true;
  if (p['style:text-line-through-style'] && p['style:text-line-through-style'] !== 'none') out.strike = true;
  const family = (p['fo:font-family'] ?? p['style:font-name'] ?? '').replace(/^['"]|['"]$/g, '');
  if (family) {
    // "Noto Sans KR Light" → the family and weight 300 (names of families that have such weights only).
    const split = splitWeightedFace(family);
    out.fontFamily = split.family;
    if (split.weight !== undefined && out.weight === undefined) Object.assign(out, weightPatch(split.weight));
  }
  const pos = /^(super|sub|-?\d+%)/.exec(p['style:text-position'] ?? '')?.[1];
  if (pos === 'super' || (pos && parseInt(pos, 10) > 0)) out.baseline = 'super';
  else if (pos === 'sub' || (pos && parseInt(pos, 10) < 0)) out.baseline = 'sub';
  return out;
}

const alignOf = (v: string | undefined): HAlign | undefined =>
  v === 'center' ? 'center' : v === 'end' || v === 'right' ? 'right' : v === 'justify' ? 'justify' : v === 'start' || v === 'left' ? 'left' : undefined;

// ── Reading ───────────────────────────────────────────────────────────────────────────────────
export interface OdpReadOptions {
  /** The file's name for the slides' import source (taken from a File when it is one). */
  name?: string;
  /** Keep a picture; returns the media id the slide refers to it by. */
  storeImage: (bytes: Uint8Array, mime: string, name: string) => string | Promise<string>;
}
export interface OdpDocument { title: string; properties: DocProperties; slides: Slide[] }

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

interface Ctx {
  styles: Map<string, StyleDef>;
  zip: JSZip;
  opts: OdpReadOptions;
  /** cm → canvas px, per axis. */
  kx: number; ky: number;
  images: Map<string, string>;
  lib: StyleLib;
  /** xml:id / draw:id → the element made from that object (for animations), per slide. */
  ids: Map<string, string>;
}

type Line = { runs: TextRun[]; align?: HAlign; list?: ListStyle };

/** One text:p / text:h as lines (a text:line-break starts a new line). */
function paragraphLines(ctx: Ctx, p: XNode, inList: ListStyle | undefined, inherited: Props): Line[] {
  const paraProps = { ...inherited, ...resolveStyle(ctx.styles, 'paragraph', p.attrs['text:style-name']) };
  const base = textProps(paraProps);
  const align = alignOf(paraProps['fo:text-align']);
  const lines: Line[] = [{ runs: [], align, list: inList }];
  const push = (text: string, style: Omit<TextRun, 'text'>) => {
    if (!text) return;
    const runs = lines[lines.length - 1].runs;
    const last = runs[runs.length - 1];
    if (last && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...style, text: '' })) last.text += text;
    else runs.push({ ...style, text });
  };
  const walk = (n: XNode, style: Omit<TextRun, 'text'>) => {
    for (const c of n.children) {
      if (typeof c === 'string') push(c.replace(/[ \t\r\n]+/g, ' '), style);
      else if (c.name === 'text:s') push(' '.repeat(Math.max(1, Number(c.attrs['text:c'] ?? 1))), style);
      else if (c.name === 'text:tab') push('\t', style);
      else if (c.name === 'text:line-break') lines.push({ runs: [], align, list: inList });
      else if (c.name === 'text:span') walk(c, { ...style, ...textProps(resolveStyle(ctx.styles, 'text', c.attrs['text:style-name'])) });
      else if (c.name === 'text:a') walk(c, style);
    }
  };
  walk(p, base);
  return lines;
}

function textLines(ctx: Ctx, box: XNode): Line[] {
  const out: Line[] = [];
  const visit = (n: XNode, inList: ListStyle | undefined) => {
    for (const c of elementsOf(n)) {
      if (c.name === 'text:p' || c.name === 'text:h') out.push(...paragraphLines(ctx, c, inList, {}));
      else if (c.name === 'text:list') visit(c, ctx.lib.lists.get(c.attrs['text:style-name'] ?? '') ?? inList ?? 'bullet');
      else if (c.name === 'text:list-item' || c.name === 'text:list-header') visit(c, inList ?? 'bullet');
    }
  };
  visit(box, undefined);
  return out;
}

const sameStyle = (a: TextRun, b: TextRun) => JSON.stringify({ ...a, text: '' }) === JSON.stringify({ ...b, text: '' });

/** Lines → the element's paragraphs (formatting hoisted onto the paragraph when the whole line shares it). */
function toParagraphs(lines: Line[]): ElementParagraph[] {
  return lines.map((l) => {
    const text = l.runs.map((r) => r.text).join('');
    const para: ElementParagraph = { text };
    if (l.align) para.align = l.align;
    if (!l.runs.length) return para;
    if (l.runs.every((r) => sameStyle(r, l.runs[0]))) {
      const { text: _t, ...st } = l.runs[0];
      if (st.fontSize) para.fontSize = st.fontSize;
      if (st.bold) para.bold = true;
      if (st.italic) para.italic = true;
      if (st.color) para.color = st.color;
      const extra = { ...st };
      delete extra.fontSize; delete extra.bold; delete extra.italic; delete extra.color;
      if (Object.keys(extra).length) para.runs = [{ ...extra, text }];
    } else para.runs = l.runs;
    return para;
  });
}

function applyText(el: SlideElement, lines: Line[]) {
  if (!lines.some((l) => l.runs.length)) return;
  const paragraphs = toParagraphs(lines);
  el.text = paragraphs.map((p) => p.text).join('\n');
  el.paragraphs = paragraphs;
  const first = paragraphs.find((p) => p.text) ?? paragraphs[0];
  if (first.fontSize) el.fontSize = first.fontSize;
  if (first.bold) el.bold = true;
  if (first.italic) el.italic = true;
  // The box's bold / italic come from its first line: the other lines say outright that they have none.
  for (const p of paragraphs) {
    if (el.bold && p.bold === undefined) p.bold = false;
    if (el.italic && p.italic === undefined) p.italic = false;
  }
  if (first.color) el.color = first.color;
  if (first.align) el.align = first.align;
  const family = first.runs?.find((r) => r.fontFamily)?.fontFamily;
  if (family) el.fontFamily = family;
  const list = lines.find((l) => l.list)?.list;
  if (list) el.list = list;
}

interface Box { x: number; y: number; w: number; h: number }
interface Placed extends Box { rotation?: number; flipH?: boolean; flipV?: boolean }

/** Where an object sits on the slide in canvas pixels, with its own and its groups' draw:transform applied. */
function boxOf(ctx: Ctx, n: XNode, m: Mat): Placed | undefined {
  const g = (k: string) => lengthToCm(n.attrs[k]);
  if (n.name === 'draw:line' || n.name === 'draw:connector') {
    const x1 = g('svg:x1'), y1 = g('svg:y1'), x2 = g('svg:x2'), y2 = g('svg:y2');
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return undefined;
    const [ax, ay] = applyPoint(m, x1, y1), [bx, by] = applyPoint(m, x2, y2);
    const out: Placed = { x: Math.round(Math.min(ax, bx) * ctx.kx), y: Math.round(Math.min(ay, by) * ctx.ky), w: Math.max(1, Math.round(Math.abs(bx - ax) * ctx.kx)), h: Math.max(1, Math.round(Math.abs(by - ay) * ctx.ky)) };
    if (bx < ax) out.flipH = true;
    if (by < ay) out.flipV = true;
    return out;
  }
  const moved = !isIdentity(m);
  const x = g('svg:x') ?? (moved ? 0 : undefined), y = g('svg:y') ?? (moved ? 0 : undefined), w = g('svg:width'), h = g('svg:height');
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  const t = transformBox(m, { x, y, w, h });
  const pw = Math.max(1, Math.round(t.w * ctx.kx)), ph = Math.max(1, Math.round(t.h * ctx.ky));
  const out: Placed = { x: Math.round(t.cx * ctx.kx - pw / 2), y: Math.round(t.cy * ctx.ky - ph / 2), w: pw, h: ph };
  if (t.rotation) out.rotation = t.rotation;
  return out;
}

const SHAPES: Record<string, string> = {
  rectangle: 'rect', ellipse: 'ellipse', 'round-rectangular': 'roundRect', diamond: 'diamond', 'isosceles-triangle': 'triangle', 'right-triangle': 'rtTriangle', 'mso-spt20': 'line',
  pentagon: 'homePlate', 'pentagon-right': 'homePlate', star5: 'star5', star4: 'star4', star6: 'star6', star8: 'star8', star12: 'star12', star24: 'star24', heart: 'heart', 'right-arrow': 'rightArrow', 'left-arrow': 'leftArrow',
  'up-arrow': 'upArrow', 'down-arrow': 'downArrow', 'left-right-arrow': 'leftRightArrow', 'up-down-arrow': 'upDownArrow', hexagon: 'hexagon', octagon: 'octagon', parallelogram: 'parallelogram',
  trapezoid: 'trapezoid', cross: 'plus', cloud: 'cloud', sun: 'sun', moon: 'moon', smiley: 'smileyFace', 'lightning-bolt': 'lightningBolt', forbidden: 'noSmoking', 'bracket-pair': 'bracketPair', 'brace-pair': 'bracePair',
  'left-bracket': 'leftBracket', 'right-bracket': 'rightBracket', 'left-brace': 'leftBrace', 'right-brace': 'rightBrace', 'quad-bevel': 'bevel', 'circular-arrow': 'circularArrow', 'u-turn-arrow': 'uturnArrow',
  'flowchart-process': 'flowChartProcess', 'flowchart-decision': 'flowChartDecision', 'flowchart-terminator': 'flowChartTerminator', 'flowchart-document': 'flowChartDocument', 'flowchart-connector': 'flowChartConnector',
};
/** A draw:enhanced-geometry's preset: LibreOffice writes OOXML presets as "ooxml-<name>", its own as a hyphenated name. */
const presetOf = (type: string | undefined): string => (type?.startsWith('ooxml-') ? type.slice(6) : SHAPES[type ?? ''] ?? 'rect');

function graphicStyle(ctx: Ctx, n: XNode): Props {
  return { ...resolveStyle(ctx.styles, 'graphic', n.attrs['draw:style-name']), ...resolveStyle(ctx.styles, 'presentation', n.attrs['presentation:style-name']) };
}

/** A solid or gradient fill from graphic properties (undefined when the object has none). */
function fillOf(ctx: Ctx, g: Props): Partial<SlideElement> | undefined {
  if (g['draw:fill'] === 'solid' && colorOf(g['draw:fill-color'])) {
    const t = g['draw:opacity'] !== undefined ? 1 - pctOf(g['draw:opacity']) : 0;
    return { fill: colorOf(g['draw:fill-color']), ...(t > 0.005 && t < 1 ? { fillTransparency: Math.round(t * 100) / 100 } : {}) };
  }
  const def = g['draw:fill'] === 'gradient' ? ctx.lib.gradients.get(g['draw:fill-gradient-name'] ?? '') : undefined;
  if (!def) return undefined;
  const lc = gradientToLc(def);
  const op = g['draw:opacity-name'] ? ctx.lib.opacities.get(g['draw:opacity-name']) : undefined;
  return op ? withOpacity(lc, gradientToLc(op)) : lc;
}

/** Colours, outline and effects of a shape from its graphic properties. */
function shapeStyle(ctx: Ctx, el: SlideElement, g: Props) {
  Object.assign(el, fillOf(ctx, g) ?? { fill: 'transparent' });
  if (g['draw:stroke'] !== 'none' && colorOf(g['svg:stroke-color'])) {
    el.stroke = colorOf(g['svg:stroke-color']);
    const w = lengthToCm(g['svg:stroke-width']);
    if (w) el.strokeWidth = Math.max(1, Math.round((w / 2.54) * 72 * PX_PER_PT));
    const dash = g['draw:stroke'] === 'dash' ? ctx.lib.dashes.get(g['draw:stroke-dash'] ?? '') : undefined;
    if (dash) el.dash = dash;
    if (g['svg:stroke-linecap'] === 'round') el.cap = 'round';
    else if (g['svg:stroke-linecap'] === 'square') el.cap = 'square';
  }
  const ms = g['draw:marker-start'], me = g['draw:marker-end'];
  if (ms) { el.arrowStart = true; el.arrowStartKind = ctx.lib.markers.get(ms) ?? 'triangle'; }
  if (me) { el.arrowEnd = true; el.arrowEndKind = ctx.lib.markers.get(me) ?? 'triangle'; }
  const va = g['draw:textarea-vertical-align'];
  if (va === 'top' || va === 'bottom' || va === 'middle') el.vAlign = va;
  const sh = shadowOf(ctx, g);
  if (sh) Object.assign(el, sh);
  if (g['style:shrink-to-fit'] === 'true') el.autoFit = 'shrink';
  else if (g['draw:auto-grow-height'] === 'true' && el.kind === 'text') el.autoFit = 'resize';
}

/** draw:shadow="visible" with an offset (LibreOffice writes the property on every shape, with a zero offset when there is no shadow). */
function shadowOf(ctx: Ctx, g: Props): Partial<SlideElement> | undefined {
  if (g['draw:shadow'] !== 'visible') return undefined;
  const ox = lengthToCm(g['draw:shadow-offset-x']) ?? 0, oy = lengthToCm(g['draw:shadow-offset-y']) ?? 0;
  const dist = Math.hypot(ox, oy);
  if (dist < 0.005) return undefined;
  const color = colorOf(g['draw:shadow-color']) ?? '#000000';
  const blur = lengthToCm(g['loext:shadow-blur']);
  const alpha = g['draw:shadow-opacity'] !== undefined ? pctOf(g['draw:shadow-opacity']) : 1;
  const dir = ((Math.round((Math.atan2(oy, ox) * 180) / Math.PI * 10) / 10) % 360 + 360) % 360;
  return { dropShadow: true, shadowKind: 'outer', shadowOpts: { color, transparency: Math.round((1 - alpha) * 100) / 100, blur: Math.round((blur ?? 0) * ctx.kx), dist: Math.round(dist * ctx.kx), dir } };
}

/** A table's cells and sizes (canvas px, scaled to `box`) plus each cell's font size (px). */
async function readTableParts(ctx: Ctx, table: XNode, box: Box): Promise<{ data: TableData; sizes: (number | undefined)[][] }> {
  const cols: number[] = [];
  const colStyle: (string | undefined)[] = [];
  const sizes: (number | undefined)[][] = [];
  const heights: number[] = [];
  const rows: TableData['rows'] = [];
  const colWidth = (n: XNode) => lengthToCm(resolveStyle(ctx.styles, 'table-column', n.attrs['table:style-name'])['style:column-width']) ?? 3;
  const rowHeight = (n: XNode) => lengthToCm(resolveStyle(ctx.styles, 'table-row', n.attrs['table:style-name'])['style:row-height'] ?? resolveStyle(ctx.styles, 'table-row', n.attrs['table:style-name'])['style:min-row-height']) ?? 1;
  const walk = (n: XNode) => {
    for (const c of elementsOf(n)) {
      if (c.name === 'table:table-column') for (let i = 0; i < Math.min(50, Number(c.attrs['table:number-columns-repeated'] ?? 1)); i++) { cols.push(colWidth(c)); colStyle.push(c.attrs['table:default-cell-style-name']); }
      else if (c.name === 'table:table-columns' || c.name === 'table:table-header-columns' || c.name === 'table:table-header-rows' || c.name === 'table:table-rows') walk(c);
      else if (c.name === 'table:table-row') {
        for (let rep = 0; rep < Math.min(200, Number(c.attrs['table:number-rows-repeated'] ?? 1)); rep++) {
          const row: TableData['rows'][number] = [];
          const srow: (number | undefined)[] = [];
          for (const cell of elementsOf(c)) {
            if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell') continue;
            for (let k = 0; k < Math.min(50, Number(cell.attrs['table:number-columns-repeated'] ?? 1)); k++) {
              if (cell.name === 'table:covered-table-cell') { row.push({ text: '', hMerge: true }); srow.push(undefined); continue; }
              const lines = textLines(ctx, cell);
              const paras = toParagraphs(lines);
              const first = paras.find((p) => p.text) ?? paras[0];
              const cs = resolveStyle(ctx.styles, 'table-cell', cell.attrs['table:style-name'] ?? c.attrs['table:default-cell-style-name'] ?? colStyle[row.length]);
              const t: TableData['rows'][number][number] = { text: paras.map((p) => p.text).join('\n') };
              const span = Number(cell.attrs['table:number-columns-spanned'] ?? 1);
              const rowSpan = Number(cell.attrs['table:number-rows-spanned'] ?? 1);
              if (span > 1) t.span = span;
              if (rowSpan > 1) t.rowSpan = rowSpan;
              if (first?.bold) t.bold = true;
              if (first?.color) t.color = first.color;
              if (first?.align) t.align = first.align;
              const fill = colorOf(cs['fo:background-color']) ?? (cs['draw:fill'] === 'solid' ? colorOf(cs['draw:fill-color']) : undefined);
              if (fill) t.fill = fill;
              row.push(t);
              srow.push(first?.fontSize);
            }
          }
          rows.push(row);
          sizes.push(srow);
          heights.push(rowHeight(c));
        }
      }
    }
  };
  walk(table);
  const n = Math.max(cols.length, ...rows.map((r) => r.length), 1);
  while (cols.length < n) cols.push(3);
  for (const row of rows) while (row.length < n) row.push({ text: '' });
  // A cell covered by a vertical merge sits under the cell that spans it.
  rows.forEach((row, r) => row.forEach((cell, c) => { if (cell.rowSpan && cell.rowSpan > 1) for (let k = 1; k < cell.rowSpan && rows[r + k]; k++) rows[r + k][c] = { ...rows[r + k][c], vMerge: true }; }));
  const sumW = cols.reduce((a, b) => a + b, 0) || 1;
  const sumH = heights.reduce((a, b) => a + b, 0) || 1;
  const data: TableData = {
    rows, cols: cols.map((w) => Math.round((w / sumW) * box.w)), heights: heights.map((h) => Math.round((h / sumH) * box.h)),
    style: '', firstRow: false, firstCol: false, lastRow: false, lastCol: false, bandRow: false, bandCol: false,
  };
  return { data, sizes };
}

async function readTable(ctx: Ctx, table: XNode, box: Box): Promise<SlideElement> {
  return { id: uid('el'), kind: 'table', ...box, table: (await readTableParts(ctx, table, box)).data };
}

/**
 * A turned table: the editor's tables cannot be rotated, so every cell becomes its own rectangle (fill, thin
 * outline, the cell's text), placed where the cell lands after the table's rotation about its centre, and
 * all of them grouped. `box` is the table's unrotated frame.
 */
async function flattenTable(ctx: Ctx, table: XNode, box: Box, rotation: number, groupId: string): Promise<SlideElement[]> {
  const { data: t, sizes } = await readTableParts(ctx, table, box);
  const sumC = t.cols.reduce((a, b) => a + b, 0) || 1, sumR = t.heights.reduce((a, b) => a + b, 0) || 1;
  const cols = t.cols.map((w) => (w * box.w) / sumC), rows = t.heights.map((h) => (h * box.h) / sumR);
  const colX: number[] = [], rowY: number[] = [];
  cols.reduce((x, w, i) => { colX[i] = x; return x + w; }, 0);
  rows.reduce((y, h, i) => { rowY[i] = y; return y + h; }, 0);
  const th = (rotation * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const out: SlideElement[] = [];
  t.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.hMerge || cell.vMerge || c >= cols.length || r >= rows.length) return;
    const w = cols.slice(c, c + Math.max(1, cell.span ?? 1)).reduce((a, b) => a + b, 0);
    const h = rows.slice(r, r + Math.max(1, cell.rowSpan ?? 1)).reduce((a, b) => a + b, 0);
    const lx = colX[c] + w / 2 - box.w / 2, ly = rowY[r] + h / 2 - box.h / 2;
    const el: SlideElement = {
      id: uid('el'), kind: 'shape', shape: 'rect', name: `표 ${r + 1}-${c + 1}`, groupId,
      x: Math.round(cx + lx * cos - ly * sin - w / 2), y: Math.round(cy + lx * sin + ly * cos - h / 2), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)),
      rotation, fill: cell.fill ?? 'transparent', stroke: '#999999', strokeWidth: 1,
    };
    if (cell.text) Object.assign(el, { text: cell.text, fontSize: sizes[r]?.[c] ?? Math.round(18 * PX_PER_PT), color: cell.color ?? '#000000', align: cell.align ?? 'left', vAlign: 'middle', ...(cell.bold ? { bold: true } : {}) });
    out.push(el);
  }));
  return out;
}

async function readImage(ctx: Ctx, href: string, box: Box, name?: string): Promise<SlideElement | undefined> {
  const path = href.replace(/^\.\//, '');
  const file = ctx.zip.file(path);
  if (!file) return undefined;
  let mediaId = ctx.images.get(path);
  if (!mediaId) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_BY_EXT[ext];
    if (!mime) return undefined;
    mediaId = await ctx.opts.storeImage(await file.async('uint8array'), mime, path.split('/').pop() ?? path);
    ctx.images.set(path, mediaId);
  }
  const el: SlideElement = { id: uid('el'), kind: 'image', ...box, mediaId, fit: 'fill' };
  if (name) el.name = name;
  return el;
}

interface Walk { m: Mat; group?: { id: string; name?: string }; /** Master page: leave out placeholders (title, footer, page number…). */ master?: boolean }

async function readShapes(ctx: Ctx, parent: XNode, out: SlideElement[], walk: Walk = { m: IDENTITY }) {
  for (const n of elementsOf(parent)) {
    const m = mul(walk.m, parseTransform(n.attrs['draw:transform'] ?? n.attrs['svg:transform']));
    // A group is flattened into the slide: its members keep their own place (transforms applied) and stay grouped.
    if (n.name === 'draw:g') { await readShapes(ctx, n, out, { ...walk, m, group: walk.group ?? { id: uid('g'), name: n.attrs['draw:name'] } }); continue; }
    if (n.name === 'draw:a') { await readShapes(ctx, n, out, walk); continue; }
    if (walk.master && (n.attrs['presentation:class'] || n.attrs['presentation:placeholder'] === 'true')) continue;
    const placed = boxOf(ctx, n, m);
    if (!placed) continue;
    const { rotation, flipH, flipV, ...box } = placed;
    const first = out.length;
    const name = n.attrs['draw:name'];
    if (n.name === 'draw:frame') {
      const textBox = childNamed(n, 'draw:text-box');
      const image = childNamed(n, 'draw:image');
      const table = childNamed(n, 'table:table');
      if (table) {
        if (rotation) out.push(...await flattenTable(ctx, table, box, rotation, walk.group?.id ?? uid('g')));
        else out.push(await readTable(ctx, table, box));
      }
      else if (image?.attrs['xlink:href']) {
        const el = await readImage(ctx, image.attrs['xlink:href'], box, name);
        if (el) out.push(el);
      } else if (textBox) {
        const el: SlideElement = { id: uid('el'), kind: 'text', ...box, autoFit: false };
        if (name) el.name = name;
        applyText(el, textLines(ctx, textBox));
        const g = graphicStyle(ctx, n);
        shapeStyle(ctx, el, g);
        if (el.fill === 'transparent') delete el.fill;
        if (el.text || el.fill || el.stroke) out.push(el);
      }
    } else if (/^draw:(rect|ellipse|circle|custom-shape|line|connector|polygon)$/.test(n.name)) {
      const type = childNamed(n, 'draw:enhanced-geometry')?.attrs['draw:type'];
      const shape = n.name === 'draw:ellipse' || n.name === 'draw:circle' ? 'ellipse' : n.name === 'draw:line' || n.name === 'draw:connector' ? 'line' : n.name === 'draw:rect' ? ((n.attrs['draw:corner-radius'] ?? n.attrs['svg:rx']) ? 'roundRect' : 'rect') : presetOf(type);
      const el: SlideElement = { id: uid('el'), kind: 'shape', shape, ...box };
      if (name) el.name = name;
      shapeStyle(ctx, el, graphicStyle(ctx, n));
      if (shape === 'line') {
        if (flipH) el.flipH = true;
        if (flipV) el.flipV = true;
        el.stroke ??= '#000000';
      }
      applyText(el, textLines(ctx, n));
      // LibreOffice writes a PowerPoint text box as a plain custom shape: no fill, no line, a rectangle.
      if (n.name === 'draw:custom-shape' && shape === 'rect' && el.text && el.fill === 'transparent' && !el.stroke) { el.kind = 'text'; delete el.shape; delete el.fill; el.autoFit ??= false; }
      out.push(el);
    }
    const xid = n.attrs['xml:id'] ?? n.attrs['draw:id'];
    if (xid && out.length > first) ctx.ids.set(xid, out[first].id);
    for (const el of out.slice(first)) {
      if (rotation && el.kind !== 'table') el.rotation = rotation;
      if (walk.group) { el.groupId = walk.group.id; if (walk.group.name) el.groupName = walk.group.name; }
    }
  }
}

const PRESET_EFFECT: Record<string, string> = {
  'ooo-entrance-appear': 'appear', 'ooo-entrance-fade-in': 'fade', 'ooo-entrance-fly-in': 'fly', 'ooo-entrance-wipe': 'wipe',
  'ooo-exit-disappear': 'disappear', 'ooo-exit-fade-out': 'fadeOut', 'ooo-exit-wipe': 'wipeOut',
};
const beginMs = (v: string | undefined): number => { const m = /^([\d.]+)(ms|s)$/.exec((v ?? '').trim()); return m ? Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1)) : 0; };

/** The slide's animation timing tree (LibreOffice's anim:par): the effects it names a preset for, on objects that were read. */
function readAnimations(ctx: Ctx, pg: XNode): SlideAnimation[] {
  const find = (n: XNode, type: string): XNode | undefined => { for (const c of elementsOf(n)) { if (c.attrs['presentation:node-type'] === type) return c; const f = find(c, type); if (f) return f; } return undefined; };
  const seq = find(pg, 'main-sequence');
  if (!seq) return [];
  const targetOf = (n: XNode): string | undefined => { for (const c of elementsOf(n)) { const t = c.attrs['smil:targetElement']; if (t) return t; const d = targetOf(c); if (d) return d; } return undefined; };
  const durOf = (n: XNode): number => { let best = 0; const walk = (x: XNode) => { for (const c of elementsOf(x)) { if (c.name === 'anim:transitionFilter' || c.name === 'anim:animate') best = Math.max(best, beginMs(c.attrs['smil:dur'])); walk(c); } }; walk(n); return best || 500; };
  const out: SlideAnimation[] = [];
  for (const step of elementsOf(seq).filter((c) => c.name === 'anim:par')) {
    for (const group of elementsOf(step).filter((c) => c.name === 'anim:par')) {
      for (const eff of elementsOf(group).filter((c) => c.name === 'anim:par')) {
        const effect = PRESET_EFFECT[eff.attrs['presentation:preset-id'] ?? ''];
        const target = ctx.ids.get(targetOf(eff) ?? '');
        if (!effect || !target) continue;
        const node = eff.attrs['presentation:node-type'];
        out.push({
          id: uid('an'), elementId: target, effect, class: eff.attrs['presentation:preset-class'] === 'exit' ? 'exit' : 'entrance',
          start: node === 'with-previous' ? 'with' : node === 'after-previous' ? 'after' : 'click', durationMs: durOf(eff), delayMs: beginMs(eff.attrs['smil:begin']),
        });
      }
    }
  }
  return out;
}

/** Read a .odp: slides with text boxes (paragraphs, bold / italic / size / colour), pictures, simple shapes, tables and notes. */
export async function parseOdp(file: Blob | ArrayBuffer | Uint8Array, opts: OdpReadOptions): Promise<OdpDocument> {
  const data = file instanceof Uint8Array || file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const sourceName = opts.name ?? (typeof (file as File).name === 'string' ? (file as File).name : '');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('OpenDocument 파일(.odp)이 아닙니다.'); }
  const mime = (await zip.file('mimetype')?.async('string'))?.trim();
  const contentFile = zip.file('content.xml');
  if (!contentFile || (mime && mime !== ODP_MIME && !/presentation/.test(mime))) throw new Error('OpenDocument 프레젠테이션(.odp)이 아닙니다.');
  const content = parseXml(await contentFile.async('string'));
  const stylesXml = await zip.file('styles.xml')?.async('string');
  const stylesRoot = stylesXml ? parseXml(stylesXml) : undefined;

  const styles = new Map<string, StyleDef>();
  const lib: StyleLib = { gradients: new Map(), opacities: new Map(), lists: new Map(), markers: new Map(), dashes: new Map() };
  readStyles(stylesRoot, styles, lib);
  readStyles(childNamed(content, 'office:automatic-styles'), styles, lib);
  const masterPages = new Map<string, XNode>();
  for (const mp of stylesRoot ? childrenNamed(childNamed(stylesRoot, 'office:master-styles') ?? { name: '', attrs: {}, children: [] }, 'style:master-page') : []) masterPages.set(mp.attrs['style:name'], mp);

  // Slide size from the first page layout; positions scale onto LightCast's 4:3 canvas.
  let page = DEFAULT_PAGE;
  const layoutName = [...masterPages.values()][0]?.attrs['style:page-layout-name'];
  const layouts = stylesRoot ? childrenNamed(childNamed(stylesRoot, 'office:automatic-styles') ?? { name: '', attrs: {}, children: [] }, 'style:page-layout') : [];
  const layout = layouts.find((l) => l.attrs['style:name'] === layoutName) ?? layouts[0];
  const lp = layout ? childNamed(layout, 'style:page-layout-properties') : undefined;
  const pw = lengthToCm(lp?.attrs['fo:page-width']), ph = lengthToCm(lp?.attrs['fo:page-height']);
  if (pw && ph) page = { w: pw, h: ph };
  const ctx: Ctx = { styles, zip, opts, kx: CANVAS_W / page.w, ky: CANVAS_H / page.h, images: new Map(), lib, ids: new Map() };

  const body = childNamed(childNamed(content, 'office:body') ?? { name: '', attrs: {}, children: [] }, 'office:presentation');
  if (!body) throw new Error('OpenDocument 파일에 슬라이드가 없습니다.');
  const slides: Slide[] = [];
  // Objects on a master page (logos, lines, plain text) become background shapes at the bottom of each slide that shows it.
  const masterObjects = new Map<string, SlideElement[]>();
  const masterElements = async (name: string): Promise<SlideElement[]> => {
    let list = masterObjects.get(name);
    if (!list) {
      list = [];
      const mp = masterPages.get(name);
      if (mp) await readShapes(ctx, mp, list, { m: IDENTITY, master: true });
      for (const el of list) el.name = `마스터: ${el.name ?? el.kind}`;
      masterObjects.set(name, list);
    }
    return list.map((el) => ({ ...structuredClone(el), id: uid('el') }));
  };
  for (const pg of childrenNamed(body, 'draw:page')) {
    const elements: SlideElement[] = [];
    const own = resolveStyle(styles, 'drawing-page', pg.attrs['draw:style-name']);
    const pageStyle = { ...resolveStyle(styles, 'drawing-page', masterPages.get(pg.attrs['draw:master-page-name'] ?? '')?.attrs['draw:style-name']), ...own };
    if (own['presentation:background-objects-visible'] !== 'false' && pg.attrs['draw:master-page-name']) elements.push(...await masterElements(pg.attrs['draw:master-page-name']));
    ctx.ids.clear();
    await readShapes(ctx, pg, elements);
    const slide: Slide = { id: uid('s'), group: '', text: '', elements, importSource: { format: 'odp', name: sourceName, page: slides.length + 1 } };
    const animations = readAnimations(ctx, pg);
    if (animations.length) slide.animations = animations;
    const fill = fillOf(ctx, pageStyle);
    if (pageStyle['draw:fill'] === 'solid' && fill?.fill) slide.background = { kind: 'color', value: fill.fill };
    else if (fill?.gradientStops && fill.gradientStops.length > 2) slide.background = { kind: 'gradient', value: stopsCss({ type: fill.gradientType === 'radial' ? 'radial' : 'linear', angle: fill.gradientAngle ?? 90, stops: fill.gradientStops }) };
    else if (fill?.gradient) slide.background = { kind: 'gradient', value: gradientCss({ type: fill.gradientType === 'radial' ? 'radial' : 'linear', angle: fill.gradientAngle ?? 90, from: fill.gradient[0], to: fill.gradient[1] }) };
    // Hidden slide, transition and automatic advance.
    const flags = { ...own, ...pg.attrs };
    if (flags['presentation:visibility'] === 'hidden' || flags['draw:display'] === 'none' || flags['draw:display'] === 'false' || flags['presentation:display'] === 'false') slide.disabled = true;
    const filter = (function find(n: XNode): XNode | undefined { for (const c of elementsOf(n)) { if (c.name === 'anim:transitionFilter') return c; const f = find(c); if (f) return f; } return undefined; })(pg);
    const timing = readTransition({ ...own, ...pg.attrs, ...(filter ? { 'smil:type': filter.attrs['smil:type'], 'smil:dur': filter.attrs['smil:dur'] } : {}) });
    if (timing.transition) slide.transition = timing.transition;
    if (timing.autoAdvance) slide.autoAdvance = timing.autoAdvance;
    const notes = childNamed(pg, 'presentation:notes');
    if (notes) {
      const text = elementsOf(notes).filter((f) => f.name === 'draw:frame' && f.attrs['presentation:class'] === 'notes')
        .flatMap((f) => { const tb = childNamed(f, 'draw:text-box'); return tb ? textLines(ctx, tb).map((l) => l.runs.map((r) => r.text).join('')) : []; }).join('\n').trim();
      if (text) slide.notes = text;
    }
    slides.push(slide);
  }

  const metaXml = await zip.file('meta.xml')?.async('string');
  const properties: DocProperties = {};
  if (metaXml) {
    const meta = childNamed(parseXml(metaXml), 'office:meta');
    const pick = (n: string) => (meta && childNamed(meta, n) ? textOf(childNamed(meta, n)!).trim() : '') || undefined;
    properties.title = pick('dc:title');
    properties.subject = pick('dc:subject');
    properties.author = pick('meta:initial-creator') ?? pick('dc:creator');
    properties.keywords = pick('meta:keyword');
    properties.comments = pick('dc:description');
    for (const k of Object.keys(properties) as (keyof DocProperties)[]) if (!properties[k]) delete properties[k];
  }
  return { title: properties.title ?? '', properties, slides };
}

// ── Writing ───────────────────────────────────────────────────────────────────────────────────
export interface OdpWriteOptions {
  /** The bytes and type of a stored picture (null when it is missing; the picture is then left out). */
  loadMedia: (id: string) => Promise<{ bytes: Uint8Array; mime: string } | null> | { bytes: Uint8Array; mime: string } | null;
}

const NS = 'xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" xmlns:lc="urn:lightcast:odp" xmlns:drawooo="http://openoffice.org/2010/draw" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"';

/** Text with spaces / tabs the way ODF needs them (text:s, text:tab). */
function odfText(s: string): string {
  return escapeXml(s)
    .replace(/\t/g, '<text:tab/>')
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)
    .replace(/^ /, '<text:s/>');
}

class Styles {
  private xml: string[] = [];
  private seen = new Map<string, string>();
  private n = 0;
  /** `namePrefix` keeps the names of two style sets (the slides' and the master page's) apart. */
  constructor(private namePrefix = '') {}
  name(family: string, prefix: string, body: string, extra = ''): string {
    const key = `${family}|${body}|${extra}`;
    let name = this.seen.get(key);
    if (!name) {
      name = `${this.namePrefix}${prefix}${++this.n}`;
      this.seen.set(key, name);
      this.xml.push(`<style:style style:name="${name}" style:family="${family}"${extra}>${body}</style:style>`);
    }
    return name;
  }
  /** A text:list-style of one kind of bullet or numbering (all levels use it); returns its name. */
  list(kind: ListStyle): string {
    const key = `list|${kind}`;
    let name = this.seen.get(key);
    if (!name) {
      name = `${this.namePrefix}L${++this.n}`;
      this.seen.set(key, name);
      const num: Record<string, [string, string]> = { number: ['1', '.'], 'number-paren': ['1', ')'], roman: ['i', '.'], alpha: ['a', '.'], hangul: ['가', '.'] };
      const bullet: Record<string, string> = { bullet: '•', circle: '○', square: '■', check: '✔', arrow: '➢' };
      const levels = Array.from({ length: 9 }, (_, i) => {
        const props = `<style:list-level-properties text:space-before="${Math.round(i * 0.9 * 100) / 100}cm" text:min-label-width="0.9cm"/>`;
        return num[kind]
          ? `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="${num[kind][1]}" style:num-format="${num[kind][0]}">${props}<style:text-properties style:use-window-font-color="true" fo:font-size="100%"/></text:list-level-style-number>`
          : `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${bullet[kind] ?? '•'}">${props}<style:text-properties fo:font-family="OpenSymbol" style:use-window-font-color="true" fo:font-size="100%"/></text:list-level-style-bullet>`;
      }).join('');
      this.xml.push(`<text:list-style style:name="${name}">${levels}</text:list-style>`);
    }
    return name;
  }
  toString() { return this.xml.join(''); }
}

const ptOf = (px: number) => `${Math.round((px / PX_PER_PT) * 10) / 10}pt`;

function runProps(r: Omit<TextRun, 'text'>): string {
  const a: string[] = [];
  if (r.fontSize) a.push(`fo:font-size="${ptOf(r.fontSize)}"`);
  if (r.bold) a.push('fo:font-weight="bold"');
  if (r.italic) a.push('fo:font-style="italic"');
  const color = hexColor(r.color);
  if (color) a.push(`fo:color="${color}"`);
  if (r.underline) a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
  if (r.strike) a.push('style:text-line-through-style="solid"');
  if (r.fontFamily) a.push(`fo:font-family="${escapeXml(r.fontFamily)}"`);
  if (r.baseline) a.push(`style:text-position="${r.baseline === 'super' ? 'super 58%' : 'sub 58%'}"`);
  return a.length ? `<style:text-properties ${a.join(' ')}/>` : '';
}

const ALIGN_ODF: Record<string, string> = { left: 'start', center: 'center', right: 'end', justify: 'justify', distributed: 'justify', justLow: 'justify' };

/** A text object's lines, each with its runs and formatting. */
function elementLines(el: SlideElement): { align?: HAlign; runs: TextRun[]; list?: ListStyle }[] {
  const base: Omit<TextRun, 'text'> = { fontSize: el.fontSize, bold: el.bold, italic: el.italic, color: el.color, underline: el.underline, strike: el.strike, fontFamily: el.fontFamily };
  const lines = (el.text ?? '').split('\n');
  return lines.map((text, i) => {
    const p = el.paragraphs?.[i];
    const lineBase = { ...base, ...(p ? { fontSize: p.fontSize ?? base.fontSize, bold: p.bold ?? base.bold, italic: p.italic ?? base.italic, color: p.color ?? base.color } : {}) };
    const src = p?.runs && p.runs.map((r) => r.text).join('') === (p.text ?? text) ? p.runs : el.paragraphs ? undefined : el.runs?.[i];
    const runs = src && src.map((r) => r.text).join('') === (p?.text ?? text) ? src : [{ text: p?.text ?? text }];
    return { align: p?.align ?? el.align, runs: runs.map((r) => ({ ...lineBase, ...r })), ...(el.list ? { list: el.list } : {}) };
  });
}

function paragraphsXml(st: Styles, lines: { align?: HAlign; runs: TextRun[]; list?: ListStyle }[]): string {
  const out: string[] = [];
  const para = (l: { align?: HAlign; runs: TextRun[] }) => {
    const pAttr = l.align ? ` text:style-name="${st.name('paragraph', 'P', `<style:paragraph-properties fo:text-align="${ALIGN_ODF[l.align] ?? 'start'}"/>`)}"` : '';
    const spans = l.runs.filter((r) => r.text).map((r) => {
      const { text, ...props } = r;
      const body = runProps(props);
      return body ? `<text:span text:style-name="${st.name('text', 'T', body)}">${odfText(text)}</text:span>` : odfText(text);
    }).join('');
    return `<text:p${pAttr}>${spans}</text:p>`;
  };
  // Lines with the same list style share one text:list.
  for (let i = 0; i < lines.length; ) {
    const kind = lines[i].list;
    let j = i + 1;
    while (kind && j < lines.length && lines[j].list === kind) j++;
    out.push(kind ? `<text:list text:style-name="${st.list(kind)}">${lines.slice(i, j).map((l) => `<text:list-item>${para(l)}</text:list-item>`).join('')}</text:list>` : para(lines[i]));
    i = j;
  }
  return out.join('');
}

/** The animation effects ODF can carry here, by LightCast effect id: [LibreOffice preset id, class]. */
const ANIM_PRESETS: Record<string, [string, 'entrance' | 'exit']> = {
  appear: ['ooo-entrance-appear', 'entrance'], fade: ['ooo-entrance-fade-in', 'entrance'], fly: ['ooo-entrance-fly-in', 'entrance'], wipe: ['ooo-entrance-wipe', 'entrance'],
  disappear: ['ooo-exit-disappear', 'exit'], fadeOut: ['ooo-exit-fade-out', 'exit'], wipeOut: ['ooo-exit-wipe', 'exit'],
};
const secs = (ms: number) => `${Math.round(ms) / 1000}s`;

/** A slide's animations as LibreOffice's anim:par timing tree (clicks are steps; with / after effects share the step). */
export function animationsXml(list: SlideAnimation[] | undefined, ids: Map<string, string>): string {
  const usable = (list ?? []).filter((a) => ANIM_PRESETS[a.effect] && ids.has(a.elementId));
  if (!usable.length) return '';
  const steps: SlideAnimation[][] = [];
  for (const a of usable) { if (a.start === 'click' || !steps.length) steps.push([a]); else steps[steps.length - 1].push(a); }
  const body = (a: SlideAnimation, id: string, exit: boolean): string => {
    const dur = secs(Math.max(1, a.durationMs));
    const set = `<anim:set smil:begin="0s" smil:dur="0.001s" smil:fill="hold" smil:targetElement="${id}" smil:attributeName="visibility" smil:to="${exit ? 'hidden' : 'visible'}"/>`;
    if (a.effect === 'fade' || a.effect === 'fadeOut') return `${set}<anim:transitionFilter smil:dur="${dur}" smil:targetElement="${id}" smil:type="fade" smil:subtype="crossfade"${exit ? ' smil:mode="out"' : ''}/>`;
    if (a.effect === 'wipe' || a.effect === 'wipeOut') return `${set}<anim:transitionFilter smil:dur="${dur}" smil:targetElement="${id}" smil:type="barWipe" smil:subtype="leftToRight"${exit ? ' smil:mode="out"' : ''}/>`;
    if (a.effect === 'fly') return `${set}<anim:animate smil:dur="${dur}" smil:fill="hold" smil:targetElement="${id}" smil:attributeName="y" smil:values="1+height/2;y" smil:keyTimes="0;1"/>`;
    return set;
  };
  const stepXml = steps.map((step) => {
    // Groups of effects that start together: an "after previous" effect begins when the group before it ends.
    const groups: { begin: number; effects: SlideAnimation[] }[] = [];
    let clock = 0;
    for (const a of step) {
      if (a.start === 'after' && groups.length) { clock = Math.max(...groups[groups.length - 1].effects.map((e) => e.delayMs + e.durationMs)) + groups[groups.length - 1].begin; groups.push({ begin: clock, effects: [a] }); } else if (groups.length) groups[groups.length - 1].effects.push(a); else groups.push({ begin: 0, effects: [a] });
    }
    const inner = groups.map((g) => `<anim:par smil:begin="${secs(g.begin * 1000)}" smil:fill="hold">${g.effects.map((a) => {
      const [preset, cls] = ANIM_PRESETS[a.effect];
      const node = a === step[0] ? 'on-click' : a.start === 'after' ? 'after-previous' : 'with-previous';
      return `<anim:par smil:begin="${secs(a.delayMs)}" smil:fill="hold" presentation:node-type="${node}" presentation:preset-class="${cls}" presentation:preset-id="${preset}">${body(a, ids.get(a.elementId)!, cls === 'exit')}</anim:par>`;
    }).join('')}</anim:par>`).join('');
    return `<anim:par smil:begin="next" smil:fill="hold">${inner}</anim:par>`;
  }).join('');
  return `<anim:par smil:dur="indefinite" smil:restart="never" presentation:node-type="timing-root"><anim:seq smil:dur="indefinite" presentation:node-type="main-sequence">${stepXml}</anim:seq></anim:par>`;
}

type PresetTable = typeof import('./odpPresets').ODP_PRESETS;
const RANGE = ' draw:handle-range-x-maximum="2147483647" draw:handle-range-x-minimum="-2147483647" draw:handle-range-y-maximum="2147483647" draw:handle-range-y-minimum="-2147483647"';
/**
 * The draw:enhanced-geometry of a PowerPoint preset shape, as LibreOffice itself writes it (its equations, paths and
 * handles), with the preset's adjust values (the yellow handles) put in when the object has its own. A preset that
 * is not in the table is a plain rectangle.
 */
export function geometryXml(table: PresetTable, shape: string, adj?: number[]): string {
  const g = table[shape];
  if (!g) return '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="rectangle"/>';
  const attrs = Object.entries(g.a).map(([k, v]) => `${k}="${escapeXml(k === 'draw:modifiers' && adj?.length && v.split(' ').length === adj.length ? adj.map((n) => Math.round(n)).join(' ') : v)}"`).join(' ');
  const eq = g.e.map((f, i) => `<draw:equation draw:name="f${i}" draw:formula="${escapeXml(f)}"/>`).join('');
  const handles = (g.h ?? '').replace(/~R/g, RANGE).replace(/~H/g, '<draw:handle draw:handle-position=');
  return `<draw:enhanced-geometry ${attrs} draw:type="ooxml-${escapeXml(shape)}">${eq}${handles}</draw:enhanced-geometry>`;
}

/** Dash patterns as [dash %, second dash %, gap %] of the line width (PowerPoint's presets, as LibreOffice reads them). */
const DASHES: Record<DashStyle, [number, number, number] | undefined> = {
  solid: undefined, dash: [400, 0, 300], dot: [100, 0, 300], dashDot: [400, 100, 300], lgDash: [800, 0, 300], sysDash: [300, 0, 100], sysDot: [100, 0, 100],
  lgDashDot: [800, 100, 300], lgDashDotDot: [800, 100, 300], sysDashDot: [300, 100, 100], sysDashDotDot: [300, 100, 100],
};
/** Arrowhead outlines: [viewBox, path]. */
const MARKERS: Record<ArrowKind, [string, string]> = {
  triangle: ['0 0 20 30', 'M10 0l-10 30h20z'], stealth: ['0 0 20 30', 'M10 0l10 30-10-8-10 8z'], diamond: ['0 0 30 30', 'M15 0l15 15-15 15-15-15z'],
  oval: ['0 0 30 30', 'M0 15a15 15 0 1 0 30 0 15 15 0 1 0-30 0z'], arrow: ['0 0 30 30', 'M15 0l15 28-4 2-11-20-11 20-4-2z'],
};

const MEDIA_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

/** Write a minimal, valid .odp (mimetype stored first, META-INF/manifest.xml, content.xml, styles.xml, meta.xml, Pictures/*). */
export async function writeOdp(p: Pick<Presentation, 'title' | 'slides' | 'properties' | 'master'>, opts: OdpWriteOptions): Promise<Uint8Array> {
  const st = new Styles();
  const pictures = new Map<string, { path: string; bytes: Uint8Array; mime: string }>();
  const pic = async (id: string): Promise<string | undefined> => {
    const have = pictures.get(id);
    if (have) return have.path;
    const m = await opts.loadMedia(id);
    const ext = m && EXT_BY_MIME[m.mime];
    if (!m || !ext) return undefined;
    const path = `Pictures/image${pictures.size + 1}.${ext}`;
    pictures.set(id, { path, bytes: m.bytes, mime: m.mime });
    return path;
  };
  const K = 28 / CANVAS_W; // canvas px → cm
  const geo = (b: Box) => `svg:x="${fmtCm(b.x, K)}" svg:y="${fmtCm(b.y, K)}" svg:width="${fmtCm(b.w, K)}" svg:height="${fmtCm(b.h, K)}"`;
  /** Position attributes: svg:x / y / width / height, or a draw:transform when the object is turned. */
  const place = (b: Box, rot?: number) => {
    if (!rot || Math.abs(rot % 360) < 0.005) return geo(b);
    return `svg:width="${fmtCm(b.w, K)}" svg:height="${fmtCm(b.h, K)}" draw:transform="${rotationTransform((b.x + b.w / 2) * K, (b.y + b.h / 2) * K, b.w * K, b.h * K, rot)}"`;
  };
  const gradients: string[] = [];
  const gradientNames = new Map<string, string>();
  const gradientName = (g: OdfGradient): string => {
    const key = `${g.style}|${g.start}|${g.end}|${g.angle}|${(g.stops ?? []).map((x) => `${x.pos}:${x.color}`).join(',')}`;
    let name = gradientNames.get(key);
    if (!name) {
      name = `Gradient${gradientNames.size + 1}`;
      gradientNames.set(key, name);
      gradients.push(`<draw:gradient draw:name="${name}" draw:display-name="${name}" draw:style="${g.style}" draw:start-color="${g.start}" draw:end-color="${g.end}" draw:start-intensity="100%" draw:end-intensity="100%" draw:angle="${g.angle}deg" draw:border="0%"${g.style === 'radial' ? ' draw:cx="50%" draw:cy="50%"' : ''}>${(g.stops ?? []).map((x) => `<loext:gradient-stop svg:offset="${Math.round(x.pos * 100) / 10000}" svg:stop-color="${x.color}" loext:color-type="rgb" loext:color-value="${x.color}"/>`).join('')}</draw:gradient>`);
    }
    return name;
  };
  const opacities = new Map<string, string>();
  /** A draw:opacity (transparency gradient) for a gradient whose stops are transparent; returns its name. */
  const opacityName = (el: SlideElement, base: OdfGradient): string | undefined => {
    const o = opacityGradient(el, base);
    if (!o) return undefined;
    const op = (c: string) => Math.round((parseInt(c.slice(1, 3), 16) / 255) * 1000) / 1000;
    const body = `draw:style="${o.style}" draw:start="${Math.round(op(o.start) * 100)}%" draw:end="${Math.round(op(o.end) * 100)}%" draw:angle="${o.angle}deg" draw:border="0%"${o.style === 'radial' ? ' draw:cx="50%" draw:cy="50%"' : ''}>${(o.stops ?? []).map((x) => `<loext:opacity-stop svg:offset="${Math.round(x.pos * 100) / 10000}" svg:stop-opacity="${op(x.color)}"/>`).join('')}</draw:opacity>`;
    let name = opacities.get(body);
    if (!name) { name = `Transparency${opacities.size + 1}`; opacities.set(body, name); }
    return name;
  };
  /** draw:fill attributes of a solid, gradient or empty fill. */
  const fillAttrs = (el: SlideElement): string => {
    const gr = lcToGradient(el);
    if (gr) {
      const on = opacityName(el, gr);
      return `draw:fill="gradient" draw:fill-gradient-name="${gradientName(gr)}"${on ? ` draw:opacity-name="${on}"` : ''}`;
    }
    const fill = hexColor(el.fill);
    const t = el.fillTransparency;
    return `draw:fill="${fill ? 'solid' : 'none'}"${fill ? ` draw:fill-color="${fill}"` : ''}${fill && t && t > 0 && t < 1 ? ` draw:opacity="${Math.round((1 - t) * 100)}%"` : ''}`;
  };
  const markers = new Map<string, string>();
  const dashes = new Map<string, string>();
  /** Outline attributes: colour, width, dash, arrowheads, cap and join. */
  const strokeAttrs = (el: SlideElement, line: boolean): string => {
    const stroke = hexColor(el.stroke);
    if (!stroke) return 'draw:stroke="none"';
    const wCm = Math.round(((el.strokeWidth ?? 4) / PX_PER_PT / 72 * 2.54) * 1000) / 1000;
    const dash = el.dash && el.dash !== 'solid' ? DASHES[el.dash] : undefined;
    let dashName = '';
    if (dash) {
      dashName = `Dash_${el.dash}`;
      if (!dashes.has(dashName)) dashes.set(dashName, `<draw:stroke-dash draw:name="${dashName}" draw:style="rect" draw:dots1="1" draw:dots1-length="${dash[0]}%"${dash[1] ? ` draw:dots2="1" draw:dots2-length="${dash[1]}%"` : ''} draw:distance="${dash[2]}%"/>`);
    }
    const arrow = (kind: ArrowKind | undefined, side: 'start' | 'end') => {
      const k = kind ?? 'triangle';
      const name = `Arrow_${k}`;
      if (!markers.has(name)) markers.set(name, `<draw:marker draw:name="${name}" svg:viewBox="${MARKERS[k][0]}" svg:d="${MARKERS[k][1]}"/>`);
      const size = Math.max(0.25, wCm * (el.arrowSize === 'lg' ? 5 : el.arrowSize === 'sm' ? 2 : 3.5));
      return ` draw:marker-${side}="${name}" draw:marker-${side}-width="${Math.round(size * 1000) / 1000}cm" draw:marker-${side}-center="${k === 'oval' || k === 'diamond' ? 'true' : 'false'}"`;
    };
    return `draw:stroke="${dash ? 'dash' : 'solid'}"${dash ? ` draw:stroke-dash="${dashName}"` : ''} svg:stroke-color="${stroke}" svg:stroke-width="${wCm}cm"`
      + (el.cap ? ` svg:stroke-linecap="${el.cap === 'flat' ? 'butt' : el.cap}"` : '')
      + (el.join ? ` draw:stroke-linejoin="${el.join === 'miter' ? 'miter' : el.join === 'bevel' ? 'bevel' : 'round'}"` : '')
      + (line && el.arrowStart ? arrow(el.arrowStartKind, 'start') : '') + (line && el.arrowEnd ? arrow(el.arrowEndKind, 'end') : '');
  };
  /** Drop shadow attributes (an outer shadow: offset by distance and angle, blurred, with its transparency). */
  const shadowAttrs = (el: SlideElement): string => {
    if (!el.dropShadow) return '';
    const o = el.shadowOpts ?? {};
    const dist = (o.dist ?? 8) * K, th = ((o.dir ?? 45) * Math.PI) / 180;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return ` draw:shadow="visible" draw:shadow-offset-x="${r(Math.cos(th) * dist)}cm" draw:shadow-offset-y="${r(Math.sin(th) * dist)}cm" draw:shadow-color="${hexColor(o.color) ?? '#000000'}" draw:shadow-opacity="${Math.round((1 - (o.transparency ?? 0.6)) * 100)}%" loext:shadow-blur="${r((o.blur ?? 8) * K)}cm"`;
  };
  /** How the text sits in its object: no automatic growth (the editor already sized it), shrink on overflow when asked. */
  const fitAttrs = (el: SlideElement): string => `draw:auto-grow-height="${el.autoFit === 'resize' ? 'true' : 'false'}" draw:auto-grow-width="false" fo:wrap-option="wrap"${el.autoFit === 'shrink' ? ' style:shrink-to-fit="true"' : ''}`;
  const imageXml = (path: string, b: Box, name: string, style: string, rot?: number) => `<draw:frame draw:style-name="${style}" draw:name="${escapeXml(name)}" ${place(b, rot)}><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  const plainOf = (s: Styles) => s.name('graphic', 'gr', '<style:graphic-properties draw:stroke="none" draw:fill="none"/>');
  const plainFrame = plainOf(st);
  let shapeNo = 0;
  let xmlIdNo = 0;
  const xmlIds = new Map<string, string>();
  let presets: PresetTable | undefined;
  const presetTable = async () => (presets ??= (await import('./odpPresets')).ODP_PRESETS);

  /** The ODF of a list of objects: one string per object, or per run of grouped objects. Their styles go into `st`. */
  const renderElements = async (elements: SlideElement[], st: Styles): Promise<string[]> => {
    const plainFrame = plainOf(st);
    const parts: string[] = [];
    const rendered: { el: SlideElement; xml: string }[] = [];
    for (const el of elements) {
      const b: Box = { x: el.x, y: el.y, w: Math.max(1, el.w), h: Math.max(1, el.h) };
      const name = el.name ?? `${el.kind} ${++shapeNo}`;
      const parts: string[] = [];
      if (el.kind === 'image' && el.mediaId) {
        const path = await pic(el.mediaId);
        if (path) parts.push(imageXml(path, b, name, plainFrame, el.rotation));
      } else if (el.kind === 'table' && el.table) {
        const t = el.table;
        const sum = (a: number[]) => a.reduce((x, y) => x + y, 0) || 1;
        const colStyle = (w: number) => st.name('table-column', 'co', `<style:table-column-properties style:column-width="${fmtCm(w * b.w / sum(t.cols), K)}"/>`);
        const rowStyle = (h: number) => st.name('table-row', 'ro', `<style:table-row-properties style:row-height="${fmtCm(h * b.h / sum(t.heights), K)}"/>`);
        const rows = t.rows.map((row, r) => `<table:table-row table:style-name="${rowStyle(t.heights[r] ?? 60)}">${row.map((cell) => {
          if (cell.hMerge || cell.vMerge) return '<table:covered-table-cell/>';
          const fill = hexColor(cell.fill);
          const cs = st.name('table-cell', 'ce', `<style:table-cell-properties fo:background-color="${fill ?? 'transparent'}" fo:border="0.05pt solid #999999"/>`);
          const lines = (cell.text || '').split('\n').map((text) => ({ align: cell.align as HAlign | undefined, runs: [{ text, bold: cell.bold, color: cell.color, fontSize: el.fontSize }] as TextRun[] }));
          const span = `${cell.span && cell.span > 1 ? ` table:number-columns-spanned="${cell.span}"` : ''}${cell.rowSpan && cell.rowSpan > 1 ? ` table:number-rows-spanned="${cell.rowSpan}"` : ''}`;
          return `<table:table-cell table:style-name="${cs}"${span} office:value-type="string">${paragraphsXml(st, lines)}</table:table-cell>`;
        }).join('')}</table:table-row>`).join('');
        parts.push(`<draw:frame draw:style-name="${plainFrame}" draw:name="${escapeXml(name)}" ${geo(b)}><table:table table:name="${escapeXml(name)}">${t.cols.map((w) => `<table:table-column table:style-name="${colStyle(w)}"/>`).join('')}${rows}</table:table></draw:frame>`);
      } else if (el.kind === 'shape') {
        const shape = el.shape ?? (el.ellipse ? 'ellipse' : el.radius ? 'roundRect' : 'rect');
        const g = `<style:graphic-properties ${fillAttrs(el)} ${strokeAttrs(el, shape === 'line')}${shadowAttrs(el)} ${fitAttrs(el)}${el.vAlign ? ` draw:textarea-vertical-align="${el.vAlign}"` : ''}/>`;
        const style = st.name('graphic', 'gr', g);
        const body = el.text ? paragraphsXml(st, elementLines(el)) : '';
        if (shape === 'line') {
          let [x1, x2] = el.flipH ? [b.x + b.w, b.x] : [b.x, b.x + b.w];
          let [y1, y2] = el.flipV ? [b.y + b.h, b.y] : [b.y, b.y + b.h];
          if (el.rotation) {
            // A line is written by its end points, so a turned one has them turned about its centre.
            const th = (el.rotation * Math.PI) / 180, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const turn = (x: number, y: number): [number, number] => [cx + (x - cx) * Math.cos(th) - (y - cy) * Math.sin(th), cy + (x - cx) * Math.sin(th) + (y - cy) * Math.cos(th)];
            [x1, y1] = turn(x1, y1);
            [x2, y2] = turn(x2, y2);
          }
          parts.push(`<draw:line draw:style-name="${style}" draw:name="${escapeXml(name)}" svg:x1="${fmtCm(x1, K)}" svg:y1="${fmtCm(y1, K)}" svg:x2="${fmtCm(x2, K)}" svg:y2="${fmtCm(y2, K)}">${body}</draw:line>`);
        } else {
          parts.push(`<draw:custom-shape draw:style-name="${style}" draw:name="${escapeXml(name)}" ${place(b, el.rotation)}>${body}${geometryXml(await presetTable(), shape, el.adj)}</draw:custom-shape>`);
        }
      } else if (el.kind === 'text' && el.text) {
        const style = st.name('graphic', 'gr', `<style:graphic-properties ${strokeAttrs(el, false)} ${fillAttrs(el)}${shadowAttrs(el)} ${fitAttrs(el)} draw:textarea-vertical-align="${el.vAlign ?? 'top'}"/>`);
        parts.push(`<draw:frame draw:style-name="${style}" draw:name="${escapeXml(name)}" ${place(b, el.rotation)}><draw:text-box>${paragraphsXml(st, elementLines(el))}</draw:text-box></draw:frame>`);
      }
      if (parts.length) {
        // Animations name their object by id.
        const id = `id${++xmlIdNo}`;
        xmlIds.set(el.id, id);
        parts[0] = parts[0].replace(/^<(draw:[\w-]+) /, `<$1 xml:id="${id}" draw:id="${id}" `);
        rendered.push({ el, xml: parts.join('') });
      }
    }
    // Objects that were grouped stay grouped: a run of neighbours with the same group id becomes one draw:g.
    for (let k = 0; k < rendered.length; ) {
      const gid = rendered[k].el.groupId;
      let end = k + 1;
      while (gid && end < rendered.length && rendered[end].el.groupId === gid) end++;
      const xml = rendered.slice(k, end).map((r) => r.xml).join('');
      parts.push(gid && end - k > 1 ? `<draw:g${rendered[k].el.groupName ? ` draw:name="${escapeXml(rendered[k].el.groupName!)}"` : ''}>${xml}</draw:g>` : xml);
      k = end;
    }
    return parts;
  };

  /** draw:fill attributes of a page background (a colour, or a gradient with all its stops). */
  const backgroundFill = (bg: Background | undefined): string => {
    const bgColor = bg?.kind === 'color' ? hexColor(bg.value) : undefined;
    const spec = bg?.kind === 'gradient' ? parseStopsCss(bg.value) : null;
    const bgGradient = spec ? lcToGradient({ gradient: [spec.stops[0].color, spec.stops[spec.stops.length - 1].color], gradientStops: spec.stops.length > 2 ? spec.stops : undefined, gradientAngle: spec.angle, gradientType: spec.type }) : null;
    return bgGradient ? `draw:fill="gradient" draw:fill-gradient-name="${gradientName(bgGradient)}"` : bgColor ? `draw:fill="solid" draw:fill-color="${bgColor}"` : 'draw:fill="none"';
  };

  // The master page: the master's own objects (placeholders are prompts, so they stay out) and background.
  const mst = new Styles('m');
  const masterObjects = (p.master?.elements ?? []).filter((e) => !e.placeholder && !e.hidden);
  let masterBody = '';
  let masterStyle = '';
  let masterFilled = false;
  if (p.master) {
    const mbg = p.master.background;
    if (mbg?.kind === 'media' && mbg.mediaType === 'image') {
      const path = await pic(mbg.mediaId);
      if (path) masterBody += imageXml(path, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, 'Background', plainOf(mst));
    }
    masterBody += (await renderElements(masterObjects, mst)).join('');
    const fill = backgroundFill(mbg);
    masterFilled = fill !== 'draw:fill="none"';
    if (masterFilled) masterStyle = ` draw:style-name="${mst.name('drawing-page', 'dp', `<style:drawing-page-properties ${fill}/>`)}"`;
  }
  // Each layout of the master is a master page of its own: the master's objects, the layout's own objects and its placeholders.
  const PLACEHOLDER_CLASS: Record<string, string> = { title: 'title', body: 'outline', text: 'subtitle', content: 'outline', footer: 'footer', date: 'date-time', slideNumber: 'page-number' };
  const layoutPages: { id: string; name: string; xml: string }[] = [];
  const holderStyle = mst.name('presentation', 'pr', '<style:graphic-properties draw:stroke="none" draw:fill="none"/>');
  for (const [li, lay] of (p.master?.layouts ?? []).entries()) {
    const own = lay.elements.filter((e) => !e.placeholder && !e.hidden);
    const holders = lay.elements.filter((e) => e.placeholder && !e.hidden && PLACEHOLDER_CLASS[e.placeholder]).map((e) => {
      const cls = PLACEHOLDER_CLASS[e.placeholder!];
      const prompt = cls === 'page-number' ? '<text:p><text:page-number>&lt;number&gt;</text:page-number></text:p>' : `<text:p>${odfText(e.text || e.name || cls)}</text:p>`;
      return `<draw:frame presentation:style-name="${holderStyle}" presentation:class="${cls}" presentation:placeholder="true" draw:layer="layout" ${geo({ x: e.x, y: e.y, w: Math.max(1, e.w), h: Math.max(1, e.h) })}><draw:text-box>${prompt}</draw:text-box></draw:frame>`;
    }).join('');
    layoutPages.push({ id: lay.id, name: lay.name, xml: `<style:master-page style:name="Layout${li + 1}" style:display-name="${escapeXml(lay.name)}" style:page-layout-name="PM1"${masterStyle}>${masterBody}${(await renderElements(own, mst)).join('')}${holders}</style:master-page>` });
  }

  const pages: string[] = [];
  for (const [i, slide] of p.slides.entries()) {
    const parts: string[] = [];
    const bg = slide.background;
    if (bg?.kind === 'media' && bg.mediaType === 'image') {
      const path = await pic(bg.mediaId);
      if (path) parts.push(imageXml(path, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, 'Background', plainFrame));
    }
    const all: SlideElement[] = slide.elements?.length ? slide.elements : [
      ...(slide.title ? [{ id: 't', kind: 'text' as const, x: 90, y: 60, w: 1260, h: 160, text: slide.title, fontSize: 72, bold: true, align: 'center' as const }] : []),
      ...(slide.text ? [{ id: 'b', kind: 'text' as const, x: 90, y: 260, w: 1260, h: 700, text: slide.text, fontSize: 48, align: 'left' as const, vAlign: 'top' as const }] : []),
    ];
    // Copies of the master's objects that the editor keeps on each slide are written once, on the master page.
    parts.push(...await renderElements(masterObjects.length ? all.filter((e) => !e.master) : all, st));
    // A slide with no background of its own shows the master's (the fill property is left out so it is inherited).
    const bgFill = !bg && masterFilled ? '' : backgroundFill(bg);
    const dp = st.name('drawing-page', 'dp', `<style:drawing-page-properties ${bgFill}${slide.disabled ? ' presentation:visibility="hidden"' : ''}${slide.hideMaster ? ' presentation:background-objects-visible="false"' : ''}${transitionAttrs(slide.transition, slide.autoAdvance)}/>`);
    const anims = animationsXml(slide.animations, xmlIds);
    const notes = slide.notes
      ? `<presentation:notes><draw:page-thumbnail draw:layer="layout" svg:width="12.7cm" svg:height="9.525cm" svg:x="3.175cm" svg:y="1.905cm" draw:page-number="${i + 1}" presentation:class="page"/><draw:frame presentation:style-name="${st.name('presentation', 'pr', '<style:graphic-properties draw:stroke="none" draw:fill="none"/>')}" presentation:class="notes" draw:layer="layout" svg:width="16.8cm" svg:height="11.2cm" svg:x="2.1cm" svg:y="14.8cm"><draw:text-box>${slide.notes.split('\n').map((l) => `<text:p>${odfText(l)}</text:p>`).join('')}</draw:text-box></draw:frame></presentation:notes>`
      : '';
    pages.push(`<draw:page draw:name="page${i + 1}" draw:style-name="${dp}" draw:master-page-name="${(() => { const k = layoutPages.findIndex((l) => l.id === slide.layoutId); return k >= 0 ? `Layout${k + 1}` : 'Default'; })()}">${parts.join('')}${anims}${notes}</draw:page>`);
  }

  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.3"><office:automatic-styles>${st}</office:automatic-styles><office:body><office:presentation>${pages.join('')}</office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NS} office:version="1.3"><office:styles><style:default-style style:family="graphic"><style:text-properties fo:font-size="18pt"/></style:default-style>${gradients.join('')}${[...opacities].map(([body, name]) => `<draw:opacity draw:name="${name}" ${body}`).join('')}${[...dashes.values()].join('')}${[...markers.values()].join('')}</office:styles><office:automatic-styles>${mst}<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"${masterStyle}>${masterBody}</style:master-page>${layoutPages.map((l) => l.xml).join('')}</office:master-styles></office:document-styles>`;
  const pr = p.properties ?? {};
  const meta = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${escapeXml(pr.title ?? p.title)}</dc:title>${pr.subject ? `<dc:subject>${escapeXml(pr.subject)}</dc:subject>` : ''}${pr.author ? `<meta:initial-creator>${escapeXml(pr.author)}</meta:initial-creator><dc:creator>${escapeXml(pr.author)}</dc:creator>` : ''}${pr.comments ? `<dc:description>${escapeXml(pr.comments)}</dc:description>` : ''}<meta:generator>LightCast</meta:generator></office:meta></office:document-meta>`;
  const entries = [
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODP_MIME}"/>`,
    ...['content.xml', 'styles.xml', 'meta.xml'].map((f) => `<manifest:file-entry manifest:full-path="${f}" manifest:media-type="text/xml"/>`),
    ...[...pictures.values()].map((x) => `<manifest:file-entry manifest:full-path="${x.path}" manifest:media-type="${MEDIA_TYPES[x.path.split('.').pop()!] ?? x.mime}"/>`),
  ];
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">${entries.join('')}</manifest:manifest>`;

  const zip = new JSZip();
  zip.file('mimetype', ODP_MIME, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifest, { createFolders: false });
  zip.file('content.xml', content);
  zip.file('styles.xml', styles);
  zip.file('meta.xml', meta);
  for (const x of pictures.values()) zip.file(x.path, x.bytes, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: ODP_MIME });
}
