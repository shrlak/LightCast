// Legacy .ppt → LightCast slides: the parsed PowerPoint records (pptBinary.ts) laid out on the 4:3
// canvas as styled text boxes, preset shapes, lines and pictures (groups kept, master objects under
// the slide's own), with background, transition, hidden flag and speaker notes. Pure apart from the
// `store` callback that keeps a picture's bytes in the media library (and the metafile → SVG / PNG
// conversion of WMF / EMF pictures).
import type { TableCell, TableData } from '../../engine';
import type { ElementParagraph, HAlign, ListStyle, Slide, SlideElement, TextRun, Transition } from '../types';
import { CANVAS_H, CANVAS_W } from '../canvas';
import { gradientCss } from '../backgroundFormat';
import { metafileToBlob } from '../metafile/image';
import { detectTables, type TablePlan } from './pptTable';
import { parsePpt, type PptDocument, type PptPara, type PptPicture, type PptShape, type PptSlide } from './pptBinary';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/svg+xml': 'svg' } as const;

/** Where a placeholder with no stored position goes (fractions of the slide). */
const DEFAULT_BOX = {
  title: { x: 0.07, y: 0.05, w: 0.86, h: 0.2 },
  subtitle: { x: 0.14, y: 0.45, w: 0.72, h: 0.3 },
  body: { x: 0.07, y: 0.28, w: 0.86, h: 0.64 },
};

// Placeholder ids: the master's 1-4 and the slide's 0x0d (title) / 0x10 (centre title) / 0x11 (subtitle).
const isTitle = (s: PptShape) => s.textType === 0 || s.textType === 6 || s.placeholder === 1 || s.placeholder === 3 || s.placeholder === 0x0d || s.placeholder === 0x10 || s.placeholder === 0x12;
const isSubtitle = (s: PptShape) => s.placeholder === 4 || s.placeholder === 0x11;
const isBody = (s: PptShape) => s.textType === 1 || s.placeholder === 2 || s.placeholder === 0x0e;

/** A picture the importer keeps: the formats a browser draws (metafiles are converted to SVG / PNG first). */
export type StoredPicture = { mime: 'image/jpeg' | 'image/png' | 'image/bmp' | 'image/tiff' | 'image/svg+xml'; bytes: Uint8Array };
export interface PptImportOptions {
  group: string;
  newId: (prefix: string) => string;
  /** Keep a picture; resolves to its media id (null: could not be stored). */
  store: (picture: StoredPicture, name: string) => Promise<string | null>;
}
export interface PptImportResult { slides: Slide[]; warnings: string[] }

/** Maps the file's sizes (master units, points, EMU) to canvas pixels. */
interface Scale { k: number; ox: number; oy: number; /** Canvas px per point. */ pt: number; emu: number }
const scaleOf = (doc: Pick<PptDocument, 'width' | 'height'>): Scale => {
  const k = Math.min(CANVAS_W / doc.width, CANVAS_H / doc.height);
  // 1 pt = 8 master units; a 10 inch slide is 1440 px wide, so 1 pt = 2 canvas px there.
  return { k, ox: (CANVAS_W - doc.width * k) / 2, oy: (CANVAS_H - doc.height * k) / 2, pt: 8 * k, emu: (8 * k) / 12700 };
};

const BULLET_BY_CODE: Record<number, ListStyle> = { 0xfc: 'check', 0xfe: 'check', 0xa7: 'square', 0x6e: 'square', 0x71: 'square', 0xd8: 'arrow', 0xe0: 'arrow', 0x76: 'diamond', 0x2022: 'bullet', 0x25cf: 'bullet', 0x25a0: 'square', 0x25aa: 'square', 0x2013: 'dash', 0x2014: 'dash', 0x2d: 'dash', 0x2605: 'star', 0x25cb: 'circle', 0x2192: 'arrow', 0x2713: 'check' };
function bulletStyle(b: { char?: number; font?: string }): ListStyle {
  const code = b.char ?? 0x2022;
  if (/wingdings|symbol/i.test(b.font ?? '')) return BULLET_BY_CODE[code] ?? 'bullet';
  if (code === 0x6f && /courier/i.test(b.font ?? '')) return 'circle';
  return BULLET_BY_CODE[code] ?? 'bullet';
}

interface RoleDefaults { size: number; bold: boolean; align: HAlign }
const roleDefaults = (s: PptShape): RoleDefaults => {
  const title = isTitle(s);
  // 1 pt = 2 canvas px (a 10 inch slide is 1440 px wide).
  return { size: title ? 88 : isSubtitle(s) ? 56 : isBody(s) ? 56 : 40, bold: title, align: title || isSubtitle(s) ? 'center' : 'left' };
};

/** The text fields of a shape from its styled paragraphs: element-level defaults from the first run, runs and paragraphs only where they differ. */
function textFields(s: PptShape, sc: Scale): Partial<SlideElement> {
  const d = roleDefaults(s);
  const paras: PptPara[] = s.paras?.length ? s.paras : (s.text ?? '').split('\n').map((text): PptPara => ({ text, level: 0, runs: text ? [{ text }] : [] }));
  const firstRun = paras.flatMap((p) => p.runs).find((r) => r.text);
  const own = {
    fontSize: firstRun?.size ? Math.round(firstRun.size * sc.pt) : d.size,
    color: firstRun?.color ?? '#111111',
    fontFamily: firstRun?.font,
    bold: firstRun?.bold ?? d.bold,
    italic: !!firstRun?.italic,
    underline: !!firstRun?.underline,
  };
  const lines = paras.map((p) => p.runs.filter((r) => r.text).map((r): TextRun => {
    const run: TextRun = { text: r.text };
    const size = r.size ? Math.round(r.size * sc.pt) : d.size;
    if (size !== own.fontSize) run.fontSize = size;
    const color = r.color ?? '#111111';
    if (color !== own.color) run.color = color;
    if (r.font && r.font !== own.fontFamily) run.fontFamily = r.font;
    const bold = r.bold ?? d.bold;
    if (bold !== own.bold) run.bold = bold;
    if (!!r.italic !== own.italic) run.italic = !!r.italic;
    if (!!r.underline !== own.underline) run.underline = !!r.underline;
    if (r.baseline) run.baseline = r.baseline;
    return run;
  }));
  const aligns = paras.map((p) => p.align ?? d.align);
  const mixedAlign = aligns.some((a) => a !== aligns[0]);
  const fields: Partial<SlideElement> = {
    text: paras.map((p) => p.text).join('\n'),
    fontSize: own.fontSize,
    color: own.color,
    ...(own.fontFamily ? { fontFamily: own.fontFamily } : {}),
    ...(own.bold ? { bold: true } : {}),
    ...(own.italic ? { italic: true } : {}),
    ...(own.underline ? { underline: true } : {}),
    align: aligns[0] ?? d.align,
    autoFit: 'shrink',
  };
  const runLines = lines.map((l, i) => (l.length ? l : [{ text: paras[i].text }]));
  // Bullets, indent level and spacing: one set for the whole box when every paragraph shares it, else each paragraph carries its own.
  const real = paras.filter((p) => p.text.trim() && !p.cont);
  const sizePx = (p: PptPara) => Math.round((p.runs.find((r) => r.text)?.size ?? 0) * sc.pt) || own.fontSize;
  // Space before / after: positive = percent of a line, negative = master units; |v| of 1 is rounding noise.
  const gap = (v: number | undefined, p: PptPara) => (!v ? 0 : v < 0 ? (-v > 2 ? Math.round(-v * sc.k) : 0) : Math.round((v / 100) * sizePx(p) * 1.2));
  const listOf = (p: PptPara): ListStyle | undefined => (p.bullet ? bulletStyle(p.bullet) : undefined);
  const lineOf = (p: PptPara) => (p.lineSpacing && p.lineSpacing !== 100 ? Math.round((p.lineSpacing / 100) * 1.2 * 100) / 100 : undefined);
  const first = real[0];
  const sameAll = !first || real.every((p) => listOf(p) === listOf(first) && p.level === first.level && gap(p.spaceBefore, p) === gap(first.spaceBefore, first) && gap(p.spaceAfter, p) === gap(first.spaceAfter, first) && lineOf(p) === lineOf(first));
  if (mixedAlign || !sameAll) {
    const anyList = real.some((p) => p.bullet);
    fields.paragraphs = runLines.map((runs, i): ElementParagraph => {
      const p = paras[i];
      const para: ElementParagraph = { text: p.text, runs, align: aligns[i] };
      if (!sameAll) {
        const list = p.cont ? undefined : listOf(p);
        if (list) para.list = list;
        else if (anyList) para.list = 'none';
        if (p.level) para.level = Math.min(8, p.level);
        const sb = p.cont ? 0 : gap(p.spaceBefore, p), sa = gap(p.spaceAfter, p);
        if (sb) para.spaceBefore = sb;
        if (sa) para.spaceAfter = sa;
        const lh = lineOf(p);
        if (lh) para.lineHeight = lh;
      }
      return para;
    });
  } else {
    if (runLines.some((l) => l.some((r) => Object.keys(r).length > 1))) fields.runs = runLines;
    if (first) {
      const list = listOf(first);
      if (list) fields.list = list;
      if (first.level) fields.indent = Math.min(8, first.level);
      const sb = gap(first.spaceBefore, first), sa = gap(first.spaceAfter, first);
      if (sb) fields.spaceBefore = sb;
      if (sa) fields.spaceAfter = sa;
      const lh = lineOf(first);
      if (lh) fields.lineHeight = lh;
    }
  }
  const stops = real.find((p) => p.tabStops?.length)?.tabStops;
  if (stops) fields.tabStops = stops.map((t) => ({ pos: Math.round(t.pos * sc.k), align: (['left', 'center', 'right', 'decimal'] as const)[t.type] ?? 'left' })).sort((x, y) => x.pos - y.pos);
  if (s.margins) fields.margins = s.margins.map((m) => Math.round(m * sc.emu)) as [number, number, number, number];
  if (s.wrap === false) fields.wrap = false;
  return fields;
}

/** A table rebuilt from a group of cell rectangles. */
function tableElement(plan: TablePlan, sc: Scale, newId: (p: string) => string): SlideElement {
  const cols = plan.colWidths.map((w) => Math.max(1, Math.round(w * sc.k)));
  const heights = plan.rowHeights.map((h) => Math.max(1, Math.round(h * sc.k)));
  const grid: TableCell[][] = plan.rowHeights.map(() => plan.colWidths.map((): TableCell => ({ text: '' })));
  const border = plan.border ? { color: plan.border.color, width: Math.max(1, Math.round(plan.border.width * sc.emu)) } : undefined;
  for (const c of plan.cells) {
    const sh = c.shape;
    const cell: TableCell = { text: sh.text ?? '' };
    const run = sh.paras?.flatMap((p) => p.runs).find((r) => r.text);
    if (run?.bold) cell.bold = true;
    if (run?.color) cell.color = run.color;
    const align = sh.paras?.find((p) => p.text)?.align;
    if (align) cell.align = align;
    if (sh.fill?.color) cell.fill = sh.fill.color;
    if (sh.vAlign) cell.anchor = sh.vAlign;
    if (border) cell.borders = { t: border, r: border, b: border, l: border };
    if (c.colSpan > 1) cell.span = c.colSpan;
    if (c.rowSpan > 1) cell.rowSpan = c.rowSpan;
    grid[c.row][c.col] = cell;
    for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) {
      if (r === c.row && k === c.col) continue;
      grid[r][k] = { text: '', ...(k > c.col ? { hMerge: true } : {}), ...(r > c.row ? { vMerge: true } : {}) };
    }
  }
  const data: TableData = { rows: grid, cols, heights, style: '', firstRow: false, firstCol: false, lastRow: false, lastCol: false, bandRow: false, bandCol: false };
  return {
    id: newId('e'), kind: 'table', x: Math.round(sc.ox + plan.x * sc.k), y: Math.round(sc.oy + plan.y * sc.k),
    w: cols.reduce((a, b) => a + b, 0), h: heights.reduce((a, b) => a + b, 0), table: data,
  };
}

/** The elements of one slide, for a canvas scale `k` and offset. */
export function shapesToElements(shapes: PptShape[], doc: Pick<PptDocument, 'width' | 'height'>, newId: (p: string) => string, mediaOf: (picture: number) => string | null): SlideElement[] {
  const sc = scaleOf(doc);
  const groups = new Map<number, string>();
  const out: SlideElement[] = [];
  const tables = detectTables(shapes);
  const tableAt = new Map<number, TablePlan>();
  const inTable = new Set<number>();
  for (const plan of tables.values()) { tableAt.set(Math.min(...plan.members), plan); for (const m of plan.members) inTable.add(m); }
  for (const [at, s] of shapes.entries()) {
    const plan = tableAt.get(at);
    if (plan) { out.push(tableElement(plan, sc, newId)); continue; }
    if (inTable.has(at)) continue;
    const isLine = s.kind === 'shape' && s.shape === 'line';
    let box: { x: number; y: number; w: number; h: number };
    if (s.x !== undefined && s.y !== undefined && s.w !== undefined && s.h !== undefined && (s.w > 0 || s.h > 0) && (isLine || (s.w > 0 && s.h > 0))) box = { x: sc.ox + s.x * sc.k, y: sc.oy + s.y * sc.k, w: s.w * sc.k, h: s.h * sc.k };
    else {
      const d = isTitle(s) ? DEFAULT_BOX.title : isSubtitle(s) ? DEFAULT_BOX.subtitle : DEFAULT_BOX.body;
      box = { x: d.x * CANVAS_W, y: d.y * CANVAS_H, w: d.w * CANVAS_W, h: d.h * CANVAS_H };
    }
    // Keep it on the canvas: a damaged anchor must not put an object out of reach.
    const x = Math.max(-CANVAS_W, Math.min(CANVAS_W, box.x)), y = Math.max(-CANVAS_H, Math.min(CANVAS_H, box.y));
    const minSize = isLine ? 1 : 8;
    const w = Math.max(minSize, Math.min(CANVAS_W * 2, box.w)), h = Math.max(minSize, Math.min(CANVAS_H * 2, box.h));
    const rounded = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    const common: Partial<SlideElement> = {
      ...(s.rotation ? { rotation: s.rotation } : {}),
      ...(s.flipH ? { flipH: true } : {}),
      ...(s.flipV ? { flipV: true } : {}),
      ...(s.master ? { name: '마스터 개체' } : {}),
    };
    if (s.group) {
      if (!groups.has(s.group)) groups.set(s.group, newId('g'));
      common.groupId = groups.get(s.group);
    }
    const lineFields: Partial<SlideElement> = s.line ? {
      stroke: s.line.color,
      strokeWidth: Math.max(1, Math.round(s.line.width * sc.emu)),
      ...(s.line.dash ? { dash: s.line.dash } : {}),
      ...(s.line.arrowStart ? { arrowStart: true } : {}),
      ...(s.line.arrowEnd ? { arrowEnd: true } : {}),
    } : {};
    const fillFields = (): Partial<SlideElement> => {
      const f = s.fill;
      if (!f) return {};
      const t = f.transparency ? { fillTransparency: f.transparency } : {};
      if (f.gradient) return { fill: f.gradient.from, gradient: [f.gradient.from, f.gradient.to], gradientAngle: f.gradient.angle, ...(f.gradient.radial ? { gradientType: 'radial' as const } : {}), ...t };
      if (f.picture) { const id = mediaOf(f.picture); return id ? { fillImage: id, fill: '#ffffff', ...t } : {}; }
      return f.color ? { fill: f.color, ...t } : {};
    };
    if (s.kind === 'picture') {
      const mediaId = s.picture ? mediaOf(s.picture) : null;
      if (mediaId) out.push({ id: newId('e'), kind: 'image', ...rounded, mediaId, fit: 'fill', ...(s.crop ? { crop: s.crop } : {}), ...lineFields, ...common });
    } else if (s.kind === 'shape') {
      const el: SlideElement = { id: newId('e'), kind: 'shape', ...(s.path ? { path: s.path.d, pathW: s.path.w, pathH: s.path.h } : { shape: s.shape ?? 'rect' }), ...rounded, ...common };
      if (isLine) Object.assign(el, { stroke: s.line?.color ?? '#000000', strokeWidth: Math.max(1, Math.round((s.line?.width ?? 9525) * sc.emu)) }, lineFields);
      else Object.assign(el, { fill: 'transparent' }, fillFields(), lineFields);
      out.push(el);
    } else if (s.text) {
      const title = isTitle(s);
      const tf = textFields(s, sc);
      const frame = s.vAlign ?? (title ? 'middle' : 'top');
      if (s.shape || s.path) out.push({ id: newId('e'), kind: 'shape', ...(s.path ? { path: s.path.d, pathW: s.path.w, pathH: s.path.h } : { shape: s.shape }), ...rounded, fill: 'transparent', ...fillFields(), ...lineFields, ...tf, vAlign: s.vAlign ?? 'middle', ...common });
      else out.push({ id: newId('e'), kind: 'text', ...rounded, ...fillFields(), ...lineFields, ...tf, vAlign: frame, ...common });
    } else if (s.fill || s.line) {
      // A box with no text but a fill or outline.
      out.push({ id: newId('e'), kind: 'shape', shape: 'rect', ...rounded, fill: 'transparent', ...fillFields(), ...lineFields, ...common });
    }
  }
  return out;
}

/**
 * SlideShowSlideInfoAtom effect type → LightCast transition and its option. The ids and directions were read from files
 * LibreOffice wrote for known transitions (0 cut, 1 random, 2 blinds, 3 checker, 4 cover, 5 dissolve, 7 uncover, 8 random bars,
 * 10 wipe, 13 split, 17 diamond, 18 plus, 19 wedge, 20 push, 21 comb, 22 newsflash, 23 fade, 26 wheel, 27 circle); 6, 9, 11 and 12
 * follow the older PowerPoint numbering.
 */
const MOVE = ['l', 'u', 'r', 'd'];
const SIDE = ['r', 'd', 'l', 'u'];
const EFFECT: Record<number, (dir: number) => { kind: Transition['kind']; option?: string }> = {
  1: () => ({ kind: 'fx:random' }),
  2: (d) => ({ kind: 'fx:blinds', option: d === 1 ? 'horz' : 'vert' }),
  3: (d) => ({ kind: 'fx:checker', option: d === 1 ? 'vert' : 'horz' }),
  4: (d) => ({ kind: 'fx:cover', ...(SIDE[d] ? { option: SIDE[d] } : {}) }),
  5: () => ({ kind: 'fx:dissolve' }),
  6: () => ({ kind: 'fade' }),
  7: (d) => ({ kind: 'fx:uncover', ...(SIDE[d] ? { option: SIDE[d] } : {}) }),
  8: (d) => ({ kind: 'fx:randomBar', option: d === 1 ? 'vert' : 'horz' }),
  9: () => ({ kind: 'fx:wipe' }),
  10: (d) => ({ kind: 'fx:wipe', ...(MOVE[d] ? { option: MOVE[d] } : {}) }),
  11: (d) => ({ kind: 'fx:shape', option: d === 1 ? 'in' : 'out' }),
  12: (d) => ({ kind: 'fx:shape', option: d === 1 ? 'in' : 'out' }),
  13: (d) => ({ kind: 'fx:split', option: d === 0 ? 'horzOut' : d === 1 ? 'horzIn' : d === 3 ? 'vertIn' : 'vertOut' }),
  17: () => ({ kind: 'fx:shape', option: 'diamond' }),
  18: () => ({ kind: 'fx:shape', option: 'plus' }),
  19: () => ({ kind: 'fx:clock', option: 'wedge' }),
  20: (d) => ({ kind: 'fx:push', ...(MOVE[d] ? { option: MOVE[d] } : {}) }),
  21: (d) => ({ kind: 'fx:comb', option: d === 1 ? 'vert' : 'horz' }),
  22: () => ({ kind: 'fx:flash' }),
  23: () => ({ kind: 'fade', option: 'smoothly' }),
  26: () => ({ kind: 'fx:clock', option: 'clockwise' }),
  27: () => ({ kind: 'fx:shape', option: 'circle' }),
};
const SPEED_MS = [1500, 1000, 500];

/** A slide's transition and automatic advance from its SlideShowSlideInfoAtom. */
export function transitionOf(t: NonNullable<PptSlide['transition']>): { transition?: Transition; autoAdvance?: number } {
  const mapped: { kind: Transition['kind']; option?: string } = t.effect > 0 ? (EFFECT[t.effect] ?? (() => ({ kind: 'fade' as const })))(t.direction ?? 0) : { kind: 'cut' };
  const out: { transition?: Transition; autoAdvance?: number } = {};
  if (mapped.kind !== 'cut' || !t.onClick) out.transition = { kind: mapped.kind, duration: mapped.kind === 'cut' ? 1 : SPEED_MS[t.speed] ?? 1000, ...(mapped.option ? { option: mapped.option } : {}), ...(t.onClick ? {} : { advanceOnClick: false }) };
  if (t.afterMs > 0) out.autoAdvance = Math.round(t.afterMs / 100) / 10;
  return out;
}

/** Slides from the bytes of a .ppt. Never throws; `slides` is empty (with a warning) when nothing could be read. */
export async function importPpt(bytes: Uint8Array, name: string, opts: PptImportOptions): Promise<PptImportResult> {
  const doc = parsePpt(bytes);
  const warnings = [...doc.warnings];
  const mediaIds = new Map<number, string | null>();
  const pictureIndexes = new Set<number>();
  for (const s of doc.slides) {
    for (const x of s.shapes) {
      if (x.kind === 'picture' && x.picture) pictureIndexes.add(x.picture);
      if (x.fill?.picture) pictureIndexes.add(x.fill.picture);
    }
    if (s.background?.kind === 'picture') pictureIndexes.add(s.background.picture);
  }
  let metafileFailed = false;
  const keep = async (pic: PptPicture, i: number): Promise<string | null> => {
    let stored: StoredPicture | null;
    if (pic.mime === 'image/x-emf' || pic.mime === 'image/x-wmf') {
      // Windows metafile: drawn into an SVG / PNG picture.
      const blob = await metafileToBlob(pic.bytes).catch(() => null);
      if (!blob) { metafileFailed = true; return null; }
      stored = { mime: blob.type === 'image/png' ? 'image/png' : 'image/svg+xml', bytes: new Uint8Array(await blob.arrayBuffer()) };
    } else stored = { mime: pic.mime, bytes: pic.bytes };
    return opts.store(stored, `${name} 그림 ${i}.${EXT[stored.mime]}`).catch(() => null);
  };
  for (const i of pictureIndexes) {
    const pic = doc.pictures[i - 1];
    mediaIds.set(i, pic ? await keep(pic, i) : null);
  }
  if (metafileFailed) warnings.push('일부 WMF/EMF 그림은 가져오지 못했습니다.');
  const mediaOf = (n: number) => mediaIds.get(n) ?? null;
  const slides = doc.slides.map((s, i): Slide => {
    const slide: Slide = {
      id: opts.newId('s'),
      group: opts.group,
      text: '',
      background: { kind: 'color', value: '#ffffff' },
      elements: shapesToElements(s.shapes, doc, opts.newId, mediaOf),
      notes: s.notes,
      importSource: { format: 'ppt', name, page: i + 1 },
    };
    const bg = s.background;
    if (bg?.kind === 'color') slide.background = { kind: 'color', value: bg.color };
    else if (bg?.kind === 'gradient') slide.background = { kind: 'gradient', value: gradientCss({ type: bg.radial ? 'radial' : 'linear', angle: bg.angle, from: bg.from, to: bg.to }) };
    else if (bg?.kind === 'picture') { const id = mediaOf(bg.picture); if (id) slide.background = { kind: 'media', mediaId: id, mediaType: 'image', fit: 'cover' }; }
    if (s.hidden) slide.disabled = true;
    if (s.transition) Object.assign(slide, transitionOf(s.transition));
    return slide;
  });
  return { slides, warnings };
}
