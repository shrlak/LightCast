// OpenDocument Presentation (.odp): read into LightCast slides, and write a valid minimal file back.
// Pure logic — pictures go in and out through callbacks so tests need no browser storage.
import JSZip from 'jszip';
import type { DocProperties, ElementParagraph, HAlign, Presentation, Slide, SlideElement, TextRun } from '../types';
import type { TableData } from '../../engine';
import { CANVAS_H, CANVAS_W } from '../canvas';
import { uid } from '../lyrics';
import { childNamed, childrenNamed, elementsOf, escapeXml, parseXml, textOf, type XNode } from './miniXml';

export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';

// ── Units ─────────────────────────────────────────────────────────────────────────────────────
/** Length in an ODF unit → centimetres (undefined when it is not a length). */
export function lengthToCm(v: string | undefined): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?\s*$/i.exec(v ?? '');
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch ((m[2] ?? 'cm').toLowerCase()) {
    case 'mm': return n / 10;
    case 'in': return n * 2.54;
    case 'pt': return (n * 2.54) / 72;
    case 'pc': return (n * 2.54) / 6;
    case 'px': return (n * 2.54) / 96;
    default: return n;
  }
}

const DEFAULT_PAGE = { w: 28, h: 21 }; // cm: a 4:3 slide, the shape LightCast slides have
const PX_PER_PT = CANVAS_W / 720; // 10 in slide = 720 pt = 1440 canvas px
const fmtCm = (px: number, perPx: number) => `${Math.round(px * perPx * 1000) / 1000}cm`;

// ── Styles ────────────────────────────────────────────────────────────────────────────────────
type Props = Record<string, string>;
interface StyleDef { family: string; parent?: string; props: Props }

function readStyles(root: XNode | undefined, into: Map<string, StyleDef>) {
  if (!root) return;
  const scan = (n: XNode) => {
    for (const s of elementsOf(n)) {
      if (s.name === 'style:style' || s.name === 'style:default-style') {
        const props: Props = {};
        for (const p of elementsOf(s)) if (/^style:.*-properties$/.test(p.name)) Object.assign(props, p.attrs);
        const name = s.attrs['style:name'] ?? `#default:${s.attrs['style:family']}`;
        into.set(`${s.attrs['style:family'] ?? ''}:${name}`, { family: s.attrs['style:family'] ?? '', parent: s.attrs['style:parent-style-name'], props });
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
  if (p['fo:font-style'] === 'italic' || p['fo:font-style'] === 'oblique') out.italic = true;
  const color = colorOf(p['fo:color']);
  if (color) out.color = color;
  if (p['style:text-underline-style'] && p['style:text-underline-style'] !== 'none') out.underline = true;
  if (p['style:text-line-through-style'] && p['style:text-line-through-style'] !== 'none') out.strike = true;
  const family = (p['fo:font-family'] ?? p['style:font-name'] ?? '').replace(/^['"]|['"]$/g, '');
  if (family) out.fontFamily = family;
  const pos = /^(super|sub|-?\d+%)/.exec(p['style:text-position'] ?? '')?.[1];
  if (pos === 'super' || (pos && parseInt(pos, 10) > 0)) out.baseline = 'super';
  else if (pos === 'sub' || (pos && parseInt(pos, 10) < 0)) out.baseline = 'sub';
  return out;
}

const alignOf = (v: string | undefined): HAlign | undefined =>
  v === 'center' ? 'center' : v === 'end' || v === 'right' ? 'right' : v === 'justify' ? 'justify' : v === 'start' || v === 'left' ? 'left' : undefined;

// ── Reading ───────────────────────────────────────────────────────────────────────────────────
export interface OdpReadOptions {
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
}

type Line = { runs: TextRun[]; align?: HAlign; list: boolean };

/** One text:p / text:h as lines (a text:line-break starts a new line). */
function paragraphLines(ctx: Ctx, p: XNode, inList: boolean, inherited: Props): Line[] {
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
  const visit = (n: XNode, inList: boolean) => {
    for (const c of elementsOf(n)) {
      if (c.name === 'text:p' || c.name === 'text:h') out.push(...paragraphLines(ctx, c, inList, {}));
      else if (c.name === 'text:list' || c.name === 'text:list-item' || c.name === 'text:list-header') visit(c, true);
    }
  };
  visit(box, false);
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
  if (first.color) el.color = first.color;
  if (first.align) el.align = first.align;
  const family = first.runs?.find((r) => r.fontFamily)?.fontFamily;
  if (family) el.fontFamily = family;
  if (lines.some((l) => l.list)) el.list = 'bullet';
}

interface Box { x: number; y: number; w: number; h: number }
function boxOf(ctx: Ctx, n: XNode): Box | undefined {
  const g = (k: string) => lengthToCm(n.attrs[k]);
  let x = g('svg:x'), y = g('svg:y'), w = g('svg:width'), h = g('svg:height');
  if (n.name === 'draw:line' || n.name === 'draw:connector') {
    const x1 = g('svg:x1'), y1 = g('svg:y1'), x2 = g('svg:x2'), y2 = g('svg:y2');
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return undefined;
    x = Math.min(x1, x2); y = Math.min(y1, y2); w = Math.abs(x2 - x1); h = Math.abs(y2 - y1);
  }
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x: Math.round(x * ctx.kx), y: Math.round(y * ctx.ky), w: Math.max(1, Math.round(w * ctx.kx)), h: Math.max(1, Math.round(h * ctx.ky)) };
}

const SHAPES: Record<string, string> = { rectangle: 'rect', ellipse: 'ellipse', 'round-rectangular': 'roundRect', diamond: 'diamond', 'isosceles-triangle': 'triangle', 'right-triangle': 'rtTriangle', 'mso-spt20': 'line', pentagon: 'homePlate', 'star5': 'star5', 'heart': 'heart', 'right-arrow': 'rightArrow' };

function graphicStyle(ctx: Ctx, n: XNode): Props {
  return { ...resolveStyle(ctx.styles, 'graphic', n.attrs['draw:style-name']), ...resolveStyle(ctx.styles, 'presentation', n.attrs['presentation:style-name']) };
}

function shapeStyle(el: SlideElement, g: Props) {
  if (g['draw:fill'] === 'solid' && colorOf(g['draw:fill-color'])) el.fill = colorOf(g['draw:fill-color']);
  else el.fill = 'transparent';
  if (g['draw:stroke'] !== 'none' && colorOf(g['svg:stroke-color'])) {
    el.stroke = colorOf(g['svg:stroke-color']);
    const w = lengthToCm(g['svg:stroke-width']);
    if (w) el.strokeWidth = Math.max(1, Math.round((w / 2.54) * 72 * PX_PER_PT));
  }
  const va = g['draw:textarea-vertical-align'];
  if (va === 'top' || va === 'bottom' || va === 'middle') el.vAlign = va;
}

async function readTable(ctx: Ctx, table: XNode, box: Box): Promise<SlideElement> {
  const cols: number[] = [];
  const heights: number[] = [];
  const rows: TableData['rows'] = [];
  const colWidth = (n: XNode) => lengthToCm(resolveStyle(ctx.styles, 'table-column', n.attrs['table:style-name'])['style:column-width']) ?? 3;
  const rowHeight = (n: XNode) => lengthToCm(resolveStyle(ctx.styles, 'table-row', n.attrs['table:style-name'])['style:row-height'] ?? resolveStyle(ctx.styles, 'table-row', n.attrs['table:style-name'])['style:min-row-height']) ?? 1;
  const walk = (n: XNode) => {
    for (const c of elementsOf(n)) {
      if (c.name === 'table:table-column') for (let i = 0; i < Math.min(50, Number(c.attrs['table:number-columns-repeated'] ?? 1)); i++) cols.push(colWidth(c));
      else if (c.name === 'table:table-columns' || c.name === 'table:table-header-columns' || c.name === 'table:table-header-rows' || c.name === 'table:table-rows') walk(c);
      else if (c.name === 'table:table-row') {
        for (let rep = 0; rep < Math.min(200, Number(c.attrs['table:number-rows-repeated'] ?? 1)); rep++) {
          const row: TableData['rows'][number] = [];
          for (const cell of elementsOf(c)) {
            if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell') continue;
            for (let k = 0; k < Math.min(50, Number(cell.attrs['table:number-columns-repeated'] ?? 1)); k++) {
              if (cell.name === 'table:covered-table-cell') { row.push({ text: '', hMerge: true }); continue; }
              const lines = textLines(ctx, cell);
              const paras = toParagraphs(lines);
              const first = paras.find((p) => p.text) ?? paras[0];
              const cs = resolveStyle(ctx.styles, 'table-cell', cell.attrs['table:style-name']);
              const t: TableData['rows'][number][number] = { text: paras.map((p) => p.text).join('\n') };
              const span = Number(cell.attrs['table:number-columns-spanned'] ?? 1);
              const rowSpan = Number(cell.attrs['table:number-rows-spanned'] ?? 1);
              if (span > 1) t.span = span;
              if (rowSpan > 1) t.rowSpan = rowSpan;
              if (first?.bold) t.bold = true;
              if (first?.color) t.color = first.color;
              if (first?.align) t.align = first.align;
              const fill = colorOf(cs['fo:background-color']);
              if (fill) t.fill = fill;
              row.push(t);
            }
          }
          rows.push(row);
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
  return { id: uid('el'), kind: 'table', ...box, table: data };
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

async function readShapes(ctx: Ctx, parent: XNode, out: SlideElement[]) {
  for (const n of elementsOf(parent)) {
    if (n.name === 'draw:g' || n.name === 'draw:a') { await readShapes(ctx, n, out); continue; }
    const box = boxOf(ctx, n);
    if (!box) continue;
    const name = n.attrs['draw:name'];
    if (n.name === 'draw:frame') {
      const textBox = childNamed(n, 'draw:text-box');
      const image = childNamed(n, 'draw:image');
      const table = childNamed(n, 'table:table');
      if (table) out.push(await readTable(ctx, table, box));
      else if (image?.attrs['xlink:href']) {
        const el = await readImage(ctx, image.attrs['xlink:href'], box, name);
        if (el) out.push(el);
      } else if (textBox) {
        const el: SlideElement = { id: uid('el'), kind: 'text', ...box, autoFit: false };
        if (name) el.name = name;
        applyText(el, textLines(ctx, textBox));
        const g = graphicStyle(ctx, n);
        const va = g['draw:textarea-vertical-align'];
        if (va === 'top' || va === 'bottom' || va === 'middle') el.vAlign = va;
        if (g['draw:fill'] === 'solid' && colorOf(g['draw:fill-color'])) el.fill = colorOf(g['draw:fill-color']);
        if (el.text || el.fill) out.push(el);
      }
    } else if (/^draw:(rect|ellipse|circle|custom-shape|line|connector|polygon)$/.test(n.name)) {
      const type = childNamed(n, 'draw:enhanced-geometry')?.attrs['draw:type'];
      const shape = n.name === 'draw:ellipse' || n.name === 'draw:circle' ? 'ellipse' : n.name === 'draw:line' || n.name === 'draw:connector' ? 'line' : n.name === 'draw:rect' ? ((n.attrs['draw:corner-radius'] ?? n.attrs['svg:rx']) ? 'roundRect' : 'rect') : SHAPES[type ?? ''] ?? 'rect';
      const el: SlideElement = { id: uid('el'), kind: 'shape', shape, ...box };
      if (name) el.name = name;
      shapeStyle(el, graphicStyle(ctx, n));
      if (shape === 'line') {
        const x1 = lengthToCm(n.attrs['svg:x1']), x2 = lengthToCm(n.attrs['svg:x2']), y1 = lengthToCm(n.attrs['svg:y1']), y2 = lengthToCm(n.attrs['svg:y2']);
        if (x1 !== undefined && x2 !== undefined && x2 < x1) el.flipH = true;
        if (y1 !== undefined && y2 !== undefined && y2 < y1) el.flipV = true;
        el.stroke ??= '#000000';
      }
      applyText(el, textLines(ctx, n));
      out.push(el);
    }
  }
}

/** Read a .odp: slides with text boxes (paragraphs, bold / italic / size / colour), pictures, simple shapes, tables and notes. */
export async function parseOdp(file: Blob | ArrayBuffer | Uint8Array, opts: OdpReadOptions): Promise<OdpDocument> {
  const data = file instanceof Uint8Array || file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('OpenDocument 파일(.odp)이 아닙니다.'); }
  const mime = (await zip.file('mimetype')?.async('string'))?.trim();
  const contentFile = zip.file('content.xml');
  if (!contentFile || (mime && mime !== ODP_MIME && !/presentation/.test(mime))) throw new Error('OpenDocument 프레젠테이션(.odp)이 아닙니다.');
  const content = parseXml(await contentFile.async('string'));
  const stylesXml = await zip.file('styles.xml')?.async('string');
  const stylesRoot = stylesXml ? parseXml(stylesXml) : undefined;

  const styles = new Map<string, StyleDef>();
  readStyles(stylesRoot, styles);
  readStyles(childNamed(content, 'office:automatic-styles'), styles);
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
  const ctx: Ctx = { styles, zip, opts, kx: CANVAS_W / page.w, ky: CANVAS_H / page.h, images: new Map() };

  const body = childNamed(childNamed(content, 'office:body') ?? { name: '', attrs: {}, children: [] }, 'office:presentation');
  if (!body) throw new Error('OpenDocument 파일에 슬라이드가 없습니다.');
  const slides: Slide[] = [];
  for (const pg of childrenNamed(body, 'draw:page')) {
    const elements: SlideElement[] = [];
    await readShapes(ctx, pg, elements);
    const slide: Slide = { id: uid('s'), group: '', text: '', elements };
    const pageStyle = { ...resolveStyle(styles, 'drawing-page', masterPages.get(pg.attrs['draw:master-page-name'] ?? '')?.attrs['draw:style-name']), ...resolveStyle(styles, 'drawing-page', pg.attrs['draw:style-name']) };
    const bg = colorOf(pageStyle['draw:fill-color']);
    if (pageStyle['draw:fill'] === 'solid' && bg) slide.background = { kind: 'color', value: bg };
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

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';

/** Any CSS colour LightCast stores → #rrggbb, or undefined when transparent / unknown. */
export function hexColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const h = /^#([0-9a-f]{3})$/i.exec(c);
  if (h) return `#${[...h[1]].map((x) => x + x).join('')}`.toLowerCase();
  if (HEX.test(c)) return c.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : Number(rgb[4]);
    if (a === 0) return undefined;
    return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
  }
  if (c === 'white') return '#ffffff';
  if (c === 'black') return '#000000';
  return undefined;
}

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
  name(family: string, prefix: string, body: string, extra = ''): string {
    const key = `${family}|${body}|${extra}`;
    let name = this.seen.get(key);
    if (!name) {
      name = `${prefix}${++this.n}`;
      this.seen.set(key, name);
      this.xml.push(`<style:style style:name="${name}" style:family="${family}"${extra}>${body}</style:style>`);
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
function elementLines(el: SlideElement): { align?: HAlign; runs: TextRun[] }[] {
  const base: Omit<TextRun, 'text'> = { fontSize: el.fontSize, bold: el.bold, italic: el.italic, color: el.color, underline: el.underline, strike: el.strike, fontFamily: el.fontFamily };
  const lines = (el.text ?? '').split('\n');
  return lines.map((text, i) => {
    const p = el.paragraphs?.[i];
    const lineBase = { ...base, ...(p ? { fontSize: p.fontSize ?? base.fontSize, bold: p.bold ?? base.bold, italic: p.italic ?? base.italic, color: p.color ?? base.color } : {}) };
    const src = p?.runs && p.runs.map((r) => r.text).join('') === (p.text ?? text) ? p.runs : el.paragraphs ? undefined : el.runs?.[i];
    const runs = src && src.map((r) => r.text).join('') === (p?.text ?? text) ? src : [{ text: p?.text ?? text }];
    return { align: p?.align ?? el.align, runs: runs.map((r) => ({ ...lineBase, ...r })) };
  });
}

function paragraphsXml(st: Styles, lines: { align?: HAlign; runs: TextRun[] }[]): string {
  return lines.map((l) => {
    const pAttr = l.align ? ` text:style-name="${st.name('paragraph', 'P', `<style:paragraph-properties fo:text-align="${ALIGN_ODF[l.align] ?? 'start'}"/>`)}"` : '';
    const spans = l.runs.filter((r) => r.text).map((r) => {
      const { text, ...props } = r;
      const body = runProps(props);
      return body ? `<text:span text:style-name="${st.name('text', 'T', body)}">${odfText(text)}</text:span>` : odfText(text);
    }).join('');
    return `<text:p${pAttr}>${spans}</text:p>`;
  }).join('');
}

const MEDIA_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

/** Write a minimal, valid .odp (mimetype stored first, META-INF/manifest.xml, content.xml, styles.xml, meta.xml, Pictures/*). */
export async function writeOdp(p: Pick<Presentation, 'title' | 'slides' | 'properties'>, opts: OdpWriteOptions): Promise<Uint8Array> {
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
  const imageXml = (path: string, b: Box, name: string, style: string) => `<draw:frame draw:style-name="${style}" draw:name="${escapeXml(name)}" ${geo(b)}><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  const plainFrame = st.name('graphic', 'gr', '<style:graphic-properties draw:stroke="none" draw:fill="none"/>');
  let shapeNo = 0;

  const pages: string[] = [];
  for (const [i, slide] of p.slides.entries()) {
    const parts: string[] = [];
    const bg = slide.background;
    if (bg?.kind === 'media' && bg.mediaType === 'image') {
      const path = await pic(bg.mediaId);
      if (path) parts.push(imageXml(path, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, 'Background', plainFrame));
    }
    const elements: SlideElement[] = slide.elements?.length ? slide.elements : [
      ...(slide.title ? [{ id: 't', kind: 'text' as const, x: 90, y: 60, w: 1260, h: 160, text: slide.title, fontSize: 72, bold: true, align: 'center' as const }] : []),
      ...(slide.text ? [{ id: 'b', kind: 'text' as const, x: 90, y: 260, w: 1260, h: 700, text: slide.text, fontSize: 48, align: 'left' as const, vAlign: 'top' as const }] : []),
    ];
    for (const el of elements) {
      const b: Box = { x: el.x, y: el.y, w: Math.max(1, el.w), h: Math.max(1, el.h) };
      const name = el.name ?? `${el.kind} ${++shapeNo}`;
      if (el.kind === 'image' && el.mediaId) {
        const path = await pic(el.mediaId);
        if (path) parts.push(imageXml(path, b, name, plainFrame));
      } else if (el.kind === 'table' && el.table) {
        const t = el.table;
        const sum = (a: number[]) => a.reduce((x, y) => x + y, 0) || 1;
        const colStyle = (w: number) => st.name('table-column', 'co', `<style:table-column-properties style:column-width="${fmtCm(w * b.w / sum(t.cols), K)}"/>`);
        const rowStyle = (h: number) => st.name('table-row', 'ro', `<style:table-row-properties style:row-height="${fmtCm(h * b.h / sum(t.heights), K)}"/>`);
        const rows = t.rows.map((row, r) => `<table:table-row table:style-name="${rowStyle(t.heights[r] ?? 60)}">${row.map((cell) => {
          if (cell.hMerge || cell.vMerge) return '<table:covered-table-cell/>';
          const fill = hexColor(cell.fill);
          const cs = st.name('table-cell', 'ce', `<style:table-cell-properties ${fill ? `fo:background-color="${fill}" ` : ''}fo:border="0.05pt solid #999999"/>`);
          const lines = (cell.text || '').split('\n').map((text) => ({ align: cell.align as HAlign | undefined, runs: [{ text, bold: cell.bold, color: cell.color, fontSize: el.fontSize }] as TextRun[] }));
          const span = `${cell.span && cell.span > 1 ? ` table:number-columns-spanned="${cell.span}"` : ''}${cell.rowSpan && cell.rowSpan > 1 ? ` table:number-rows-spanned="${cell.rowSpan}"` : ''}`;
          return `<table:table-cell table:style-name="${cs}"${span} office:value-type="string">${paragraphsXml(st, lines)}</table:table-cell>`;
        }).join('')}</table:table-row>`).join('');
        parts.push(`<draw:frame draw:style-name="${plainFrame}" draw:name="${escapeXml(name)}" ${geo(b)}><table:table table:name="${escapeXml(name)}">${t.cols.map((w) => `<table:table-column table:style-name="${colStyle(w)}"/>`).join('')}${rows}</table:table></draw:frame>`);
      } else if (el.kind === 'shape') {
        const fill = hexColor(el.fill);
        const stroke = hexColor(el.stroke);
        const sw = el.stroke ? ` svg:stroke-width="${Math.round(((el.strokeWidth ?? 4) / PX_PER_PT / 72 * 2.54) * 1000) / 1000}cm"` : '';
        const g = `<style:graphic-properties draw:fill="${fill ? 'solid' : 'none'}"${fill ? ` draw:fill-color="${fill}"` : ''} draw:stroke="${stroke ? 'solid' : 'none'}"${stroke ? ` svg:stroke-color="${stroke}"${sw}` : ''}${el.vAlign ? ` draw:textarea-vertical-align="${el.vAlign}"` : ''}/>`;
        const style = st.name('graphic', 'gr', g);
        const shape = el.shape ?? (el.ellipse ? 'ellipse' : el.radius ? 'roundRect' : 'rect');
        const body = el.text ? paragraphsXml(st, elementLines(el)) : '';
        if (shape === 'line') {
          const [x1, x2] = el.flipH ? [b.x + b.w, b.x] : [b.x, b.x + b.w];
          const [y1, y2] = el.flipV ? [b.y + b.h, b.y] : [b.y, b.y + b.h];
          parts.push(`<draw:line draw:style-name="${style}" draw:name="${escapeXml(name)}" svg:x1="${fmtCm(x1, K)}" svg:y1="${fmtCm(y1, K)}" svg:x2="${fmtCm(x2, K)}" svg:y2="${fmtCm(y2, K)}">${body}</draw:line>`);
        } else {
          const type = Object.entries(SHAPES).find(([, v]) => v === shape)?.[0] ?? 'rectangle';
          parts.push(`<draw:custom-shape draw:style-name="${style}" draw:name="${escapeXml(name)}" ${geo(b)}>${body}<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="${type}"/></draw:custom-shape>`);
        }
      } else if (el.kind === 'text' && el.text) {
        const fill = hexColor(el.fill);
        const style = st.name('graphic', 'gr', `<style:graphic-properties draw:stroke="none" draw:fill="${fill ? 'solid' : 'none'}"${fill ? ` draw:fill-color="${fill}"` : ''} draw:textarea-vertical-align="${el.vAlign ?? 'top'}"/>`);
        parts.push(`<draw:frame draw:style-name="${style}" draw:name="${escapeXml(name)}" ${geo(b)}><draw:text-box>${paragraphsXml(st, elementLines(el))}</draw:text-box></draw:frame>`);
      }
    }
    const bgColor = bg?.kind === 'color' ? hexColor(bg.value) : undefined;
    const dp = st.name('drawing-page', 'dp', bgColor ? `<style:drawing-page-properties draw:fill="solid" draw:fill-color="${bgColor}"/>` : '<style:drawing-page-properties draw:fill="none"/>');
    const notes = slide.notes
      ? `<presentation:notes><draw:frame presentation:class="notes" draw:style-name="${plainFrame}" ${geo({ x: 90, y: 700, w: 1260, h: 300 })}><draw:text-box>${slide.notes.split('\n').map((l) => `<text:p>${odfText(l)}</text:p>`).join('')}</draw:text-box></draw:frame></presentation:notes>`
      : '';
    pages.push(`<draw:page draw:name="page${i + 1}" draw:style-name="${dp}" draw:master-page-name="Default">${parts.join('')}${notes}</draw:page>`);
  }

  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.3"><office:automatic-styles>${st}</office:automatic-styles><office:body><office:presentation>${pages.join('')}</office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NS} office:version="1.3"><office:styles><style:default-style style:family="graphic"><style:text-properties fo:font-size="18pt"/></style:default-style></office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles></office:document-styles>`;
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
