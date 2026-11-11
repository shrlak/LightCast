// FreeCast's PowerPoint engine: Rust compiled to WebAssembly (engine/ — DeckCraft's geometry, colour,
// model and slide-show timing crates behind a small JSON interface). This file loads the module and
// gives the rest of the app typed calls. Every call is synchronous once the module is loaded; before
// that (or if it failed to load) calls return null and the caller draws a plain fallback.

interface Exports {
  memory: WebAssembly.Memory;
  fc_reserve(len: number): number;
  fc_call(len: number): number;
  fc_ptr(): number;
  fc_img_reserve(len: number): number;
  fc_img_ptr(): number;
  fc_img_len(): number;
}

let module: WebAssembly.Module | null = null;
let exports: Exports | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Is the engine loaded? */
export const engineReady = () => exports !== null;

/** Run `fn` when the engine becomes ready (or again after it is reloaded). */
export function onEngineReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function attach(instance: WebAssembly.Instance) {
  exports = instance.exports as unknown as Exports;
  caches.forEach((c) => c.clear());
  listeners.forEach((fn) => fn());
}

/** Load the engine from its bytes (the app fetches them; tests read the file). */
export async function initEngine(bytes: BufferSource): Promise<boolean> {
  try {
    module = await WebAssembly.compile(bytes);
    attach(await WebAssembly.instantiate(module, {}));
    return true;
  } catch (e) {
    console.error('FreeCast engine failed to load', e);
    exports = null;
    return false;
  }
}

/** Load once from a URL (see load.ts). */
export function loadEngineFrom(url: string): Promise<boolean> {
  loading ??= fetch(url).then((r) => r.arrayBuffer()).then(initEngine).catch((e) => { console.error('FreeCast engine failed to load', e); return false; });
  return loading;
}

/**
 * One request. Returns null when the engine is not loaded or refuses the request. A trap inside the
 * module (which should not happen) drops the instance and starts a fresh one in the background.
 */
export function engineCall<T>(op: string, args: object = {}): T | null {
  const ex = exports;
  if (!ex) return null;
  try {
    const req = encoder.encode(JSON.stringify({ op, ...args }));
    const at = ex.fc_reserve(req.length);
    new Uint8Array(ex.memory.buffer, at, req.length).set(req);
    const n = ex.fc_call(req.length);
    const res = JSON.parse(decoder.decode(new Uint8Array(ex.memory.buffer, ex.fc_ptr(), n))) as { ok?: T; err?: string };
    if (res.err !== undefined) {
      console.warn(`engine ${op}: ${res.err}`);
      return null;
    }
    return res.ok as T;
  } catch (e) {
    console.error(`engine ${op} trapped`, e);
    exports = null;
    if (module) void WebAssembly.instantiate(module, {}).then(attach).catch(() => undefined);
    return null;
  }
}

const caches: Map<string, unknown>[] = [];
/** A cache of results by request, cleared when the engine is reloaded. */
function cached<T>(limit = 2000) {
  const map = new Map<string, T>();
  caches.push(map as Map<string, unknown>);
  return (key: string, make: () => T | null): T | null => {
    const hit = map.get(key);
    if (hit !== undefined) return hit;
    const v = make();
    if (v === null) return null;
    if (map.size >= limit) map.clear();
    map.set(key, v);
    return v;
  };
}

// ── Shapes ────────────────────────────────────────────────────────────────────────────────────
export type ShapeCategory = 'lines' | 'rectangles' | 'basic' | 'arrows' | 'equation' | 'flowchart' | 'stars' | 'callouts' | 'actionButtons';
export interface ShapePreset { name: string; label: string; category: ShapeCategory; line: boolean; defaults: number[] }
export type FillMode = 'norm' | 'none' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess';
export interface ShapePath { d: string; fill: FillMode; stroke: boolean; evenOdd: boolean }
export interface ShapeGeometry {
  paths: ShapePath[];
  /** x, y, w, h of the text area. */
  textRect: [number, number, number, number];
  handles: { index: number; x: number; y: number }[];
  open: boolean;
  sites: [number, number][];
}

const once = cached<unknown>(50);
export const shapeCatalog = () => (once('shapes', () => engineCall<ShapePreset[]>('shapes.catalog')) as ShapePreset[] | null) ?? [];
const geomCache = cached<ShapeGeometry>(4000);
export function shapeGeometry(name: string, w: number, h: number, adj?: number[]): ShapeGeometry | null {
  const rw = Math.round(w * 10) / 10, rh = Math.round(h * 10) / 10;
  return geomCache(`${name}|${rw}|${rh}|${adj?.join(',') ?? ''}`, () => engineCall<ShapeGeometry>('shape.geometry', { name, w: rw, h: rh, adj: adj ?? [] }));
}
export const shapeAdjust = (name: string, w: number, h: number, adj: number[] | undefined, index: number, x: number, y: number) =>
  engineCall<number[]>('shape.adjust', { name, w, h, adj: adj ?? [], index, x, y });

export interface IconDef { name: string; label: string; category: string; stroke: number; d: string[] }
export const iconCatalog = () => (once('icons', () => engineCall<IconDef[]>('icons.catalog')) as IconDef[] | null) ?? [];

// ── Arrange and pointer geometry ──────────────────────────────────────────────────────────────
export interface EBox { id: string; x: number; y: number; w: number; h: number; rot?: number }
export interface Delta { id: string; dx: number; dy: number }
export interface Placed { id: string; x: number; y: number; rot: number }
export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type OrderHow = 'front' | 'forward' | 'backward' | 'back';
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const SLIDE = { slideW: 1440, slideH: 1080 };
export const alignBoxes = (boxes: EBox[], edge: AlignEdge, to: 'slide' | 'selection') => engineCall<Delta[]>('arrange.align', { boxes, edge, to, ...SLIDE }) ?? [];
export const distributeBoxes = (boxes: EBox[], dir: 'horizontal' | 'vertical', to: 'slide' | 'selection') => engineCall<Delta[]>('arrange.distribute', { boxes, dir, to, ...SLIDE }) ?? [];
export const orderIds = (ids: string[], sel: string[], how: OrderHow) => engineCall<string[]>('arrange.order', { ids, sel, how }) ?? ids;
export const flipBoxes = (boxes: EBox[], axis: 'horizontal' | 'vertical', asGroup: boolean) => engineCall<Placed[]>('arrange.flip', { boxes, axis, asGroup }) ?? [];
export const rotateBoxes = (boxes: EBox[], by: number, asGroup: boolean) => engineCall<Placed[]>('arrange.rotate', { boxes, by, asGroup }) ?? [];
export const boundsOf = (boxes: EBox[]) => engineCall<{ x: number; y: number; w: number; h: number } | null>('geom.bounds', { boxes });
export const hitBox = (boxes: EBox[], x: number, y: number, tol = 0) => engineCall<string | null>('geom.hit', { boxes, x, y, tol });
export const marqueeIds = (boxes: EBox[], rect: { x: number; y: number; w: number; h: number }) => engineCall<string[]>('geom.marquee', { boxes, ...rect }) ?? [];
export const resizeBox = (box: EBox, handle: Handle, dx: number, dy: number, keepAspect: boolean, fromCenter: boolean, min = 10) =>
  engineCall<{ x: number; y: number; w: number; h: number }>('geom.resize', { box, handle, dx, dy, keepAspect, fromCenter, min });
export const rotateTo = (box: EBox, x: number, y: number, snap: boolean) => engineCall<number>('geom.rotateTo', { box, x, y, snap });
export interface SnapResult { x: number; y: number; guides: { v: number[]; h: number[] } }
export const snapBox = (box: EBox, others: EBox[], opts: { grid?: number; guidesV?: number[]; guidesH?: number[]; smart?: boolean } = {}) =>
  engineCall<SnapResult>('geom.snap', { box, others, ...SLIDE, ...opts });

// ── Animations ────────────────────────────────────────────────────────────────────────────────
export type AnimClass = 'entrance' | 'emphasis' | 'exit' | 'path';
export interface AnimEffectInfo { id: string; label: string; class: AnimClass; durationMs: number; options: string[] }
export const animationCatalog = () => (once('anims', () => engineCall<AnimEffectInfo[]>('anim.catalog')) as AnimEffectInfo[] | null) ?? [];
export interface AnimSpec {
  anims: { elementId: string; effect: string; class: AnimClass; option?: string; start: 'click' | 'with' | 'after'; durationMs: number; delayMs: number; repeat?: number; path?: string }[];
  boxes: EBox[];
}
export interface PreparedTimeline {
  key: string;
  /** Click steps. */
  steps: number;
  /** Step starts by itself (no click). */
  auto: boolean[];
  /** Seconds each step plays. */
  durations: number[];
  total: number;
  effects: { index: number; elementId: string; step: number; start: number; duration: number; span: number; class: AnimClass }[];
}
export interface AnimState { visible: boolean; opacity: number; dx: number; dy: number; sx: number; sy: number; rotate: number; clip: [number, number, number, number] | null; tint: string | null }
export const prepareTimeline = (spec: AnimSpec) => engineCall<PreparedTimeline>('anim.prepare', { ...spec, ...SLIDE });
export const sampleTimeline = (spec: AnimSpec, step: number, t: number) => engineCall<Record<string, AnimState>>('anim.sample', { spec: { ...spec, ...SLIDE }, step, t });

// ── Transitions ───────────────────────────────────────────────────────────────────────────────
export interface TransitionInfo { id: string; label: string; category: string; durationMs: number; options: { id: string; label: string }[] }
export const transitionCatalog = () => (once('transitions', () => engineCall<TransitionInfo[]>('transition.catalog')) as TransitionInfo[] | null) ?? [];
export type LayerSource = 'Old' | 'New' | 'Black' | 'White' | 'OldBack' | 'NewBack' | 'OldContent' | 'NewContent';
export interface TransitionLayer {
  source: LayerSource;
  /** l, t, r, b of the part of the source shown (0..1). */
  src: [number, number, number, number];
  /** Where its corners go on the slide (0..1): tl, tr, br, bl. */
  quad: [[number, number], [number, number], [number, number], [number, number]];
  uv: [[number, number], [number, number], [number, number], [number, number]];
  alpha: number;
  fade: [number, number, number, number];
}
export const transitionFrame = (kind: string, option: string, t: number, aspect = 4 / 3) =>
  engineCall<{ layers: TransitionLayer[]; parts: boolean }>('transition.frame', { kind, option, t, aspect })?.layers ?? null;

// ── Tables ────────────────────────────────────────────────────────────────────────────────────
export interface CellBorder { color: string; width: number }
/** Sides drawn by Table Design › Borders; `null` = that side has no line. */
export interface CellBorders { t?: CellBorder | null; r?: CellBorder | null; b?: CellBorder | null; l?: CellBorder | null }
export interface TableCell { text: string; span?: number; rowSpan?: number; hMerge?: boolean; vMerge?: boolean; fill?: string; color?: string; bold?: boolean; align?: string; borders?: CellBorders }
export interface TableData {
  rows: TableCell[][];
  cols: number[];
  heights: number[];
  style: string;
  firstRow: boolean; firstCol: boolean; lastRow: boolean; lastCol: boolean; bandRow: boolean; bandCol: boolean;
  /** Cell margins in canvas pixels: left, top, right, bottom. */
  margins?: [number, number, number, number];
}
export interface TableCellBox { r: number; c: number; x: number; y: number; w: number; h: number; text: string; fill: string | null; color: string | null; bold: boolean; align: string | null; border: string | null; borderWidth: number }
export type TableAction = 'insertRowAbove' | 'insertRowBelow' | 'insertColLeft' | 'insertColRight' | 'deleteRow' | 'deleteCol' | 'merge' | 'split' | 'distributeRows' | 'distributeCols';
export const tableStyles = () => (once('tableStyles', () => engineCall<{ id: string; label: string }[]>('table.styles')) as { id: string; label: string }[] | null) ?? [];
export const newTable = (rows: number, cols: number) => engineCall<TableData>('table.edit', { table: {}, action: 'new', r: rows, c: cols });
export const editTable = (table: TableData, action: TableAction, r: number, c: number, r1 = r, c1 = c) => engineCall<TableData>('table.edit', { table, action, r, c, r1, c1 });
const tableCache = cached<TableCellBox[]>(500);
export const layoutTable = (table: TableData, w: number, h: number, scheme?: string) =>
  tableCache(`${JSON.stringify(table)}|${w}|${h}|${scheme ?? ''}`, () => engineCall<{ cells: TableCellBox[] }>('table.layout', { table, w, h, scheme })?.cells ?? null) ?? [];

// ── Charts ────────────────────────────────────────────────────────────────────────────────────
export type ChartKind = 'column' | 'columnStacked' | 'bar' | 'barStacked' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
export interface ChartData { kind: ChartKind; title?: string; categories: string[]; series: { name: string; values: number[]; color?: string }[]; legend?: boolean; dataLabels?: boolean; textColor?: string }
const chartCache = cached<string>(300);
export const chartSvg = (chart: ChartData, w: number, h: number, scheme?: string, fontFamily?: string) =>
  chartCache(`${JSON.stringify(chart)}|${w}|${h}|${scheme ?? ''}|${fontFamily ?? ''}`, () => engineCall<{ svg: string }>('chart.svg', { ...chart, w, h, scheme, fontFamily: fontFamily ?? '' })?.svg ?? null);

// ── Colours ───────────────────────────────────────────────────────────────────────────────────
export interface Palette { scheme: string; theme: { slot: string; hex: string; shades: { hex: string; label: string }[] }[]; standard: { hex: string; label: string }[] }
export const colorPalette = (scheme?: string) => once(`palette|${scheme ?? ''}`, () => engineCall<Palette>('color.palette', { scheme })) as Palette | null;
export const colorSchemes = () => (once('schemes', () => engineCall<{ name: string; colors: string[] }[]>('color.schemes')) as { name: string; colors: string[] }[] | null) ?? [];
export const contrastRatio = (fg: string, bg: string) => engineCall<{ ratio: number; aa: boolean; aaLarge: boolean }>('color.contrast', { fg, bg });
export interface ShapeQuickStyle { row: number; col: number; label: string; fill: string; stroke: string | null; text: string; gradient?: [string, string]; shadow: boolean }
export const shapeQuickStyles = (scheme?: string) => (once(`styles|${scheme ?? ''}`, () => engineCall<ShapeQuickStyle[]>('color.shapeStyles', { scheme })) as ShapeQuickStyle[] | null) ?? [];

// ── Find and replace ──────────────────────────────────────────────────────────────────────────
export interface TextItem { key: string; text: string }
export interface FindOptions { matchCase?: boolean; wholeWord?: boolean }
export const findText = (items: TextItem[], query: string, o: FindOptions = {}) => engineCall<{ key: string; start: number; end: number }[]>('find.search', { items, query, ...o }) ?? [];
export const replaceText = (items: TextItem[], query: string, replacement: string, o: FindOptions & { onlyKey?: string; onlyStart?: number } = {}) =>
  engineCall<{ count: number; items: TextItem[] }>('find.replace', { items, query, replacement, ...o }) ?? { count: 0, items: [] };

// ── Ink ───────────────────────────────────────────────────────────────────────────────────────
export const smoothInk = (points: [number, number][], tolerance = 1.5) => engineCall<{ d: string; x: number; y: number; w: number; h: number } | null>('ink.smooth', { points, tolerance });
export type InkShape = { kind: 'line'; x0: number; y0: number; x1: number; y1: number } | { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number } | { kind: 'triangle'; x: number; y: number; w: number; h: number; flipV: boolean };
export const recognizeInk = (points: [number, number][]) => engineCall<InkShape | null>('ink.recognize', { points });

// ── Merge Shapes, Edit Points, connectors ────────────────────────────────────────────────────
export interface PathShape { shape?: string; adj?: number[]; path?: string; pathW?: number; pathH?: number; x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }
export type MergeMode = 'union' | 'combine' | 'fragment' | 'intersect' | 'subtract';
export interface PathBox { x: number; y: number; w: number; h: number; path: string; pathW: number; pathH: number }
export const mergeShapes = (mode: MergeMode, shapes: PathShape[]) => engineCall<PathBox[]>('shape.merge', { mode, shapes }) ?? [];
export const shapeToPath = (shape: PathShape) => engineCall<{ path: string; pathW: number; pathH: number }>('shape.toPath', { shape });
export const connectShapes = (from: PathShape, to: PathShape, fromSite?: number, toSite?: number) =>
  engineCall<{ x0: number; y0: number; x1: number; y1: number; fromSite: number; toSite: number }>('shape.connect', { from, to, fromSite, toSite });
export const shapeSites = (shape: PathShape) => engineCall<[number, number][]>('shape.sites', { shape }) ?? [];

// ── SmartArt ──────────────────────────────────────────────────────────────────────────────────
export interface SmartArtCatalog { layouts: { id: string; label: string }[]; styles: { id: string; label: string }[]; colors: { id: string; label: string }[] }
export const smartArtCatalog = () => once('smartart', () => engineCall<SmartArtCatalog>('smartart.catalog')) as SmartArtCatalog | null;
export interface SmartArtNode { text: string; level: number }
export interface SmartArtShape {
  shape: string | null; adj: number[]; custom: { d: string; w: number; h: number } | null;
  x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean;
  fill: string | null; gradient: [string, string] | null; stroke: string | null; strokeWidth: number;
  text: string; color: string | null; fontSize: number | null; bold: boolean | null; align: string | null; shadow: boolean; nodes: number[];
}
export const layoutSmartArt = (kind: string, nodes: SmartArtNode[], box: { x: number; y: number; w: number; h: number }, style = 'flat', colors = 'colorful', scheme?: string) =>
  engineCall<{ shapes: SmartArtShape[] }>('smartart.layout', { kind, nodes, style, colors, ...box, scheme })?.shapes ?? null;
export const smartArtNodesFromLines = (lines: string[]) => engineCall<SmartArtNode[]>('smartart.fromLines', { lines }) ?? [];

// ── Picture Format (pixels through the image buffer) ──────────────────────────────────────────
export interface PictureSteps {
  removeBackground?: number; transparentColor?: string; transparentTolerance?: number;
  brightness?: number; contrast?: number; saturation?: number; temperature?: number; sharpness?: number;
  recolor?: string; artistic?: string; maxSide?: number;
}
export const pictureCatalog = () => once('picture', () => engineCall<{ artistic: string[]; recolor: string[] }>('picture.catalog')) as { artistic: string[]; recolor: string[] } | null;
/** Run the Picture Format pipeline on RGBA pixels: the processed pixels and their size, or null. */
export function processPicture(rgba: Uint8ClampedArray, w: number, h: number, steps: PictureSteps, scheme?: string): { data: Uint8ClampedArray; w: number; h: number; removed: number } | null {
  const ex = exports;
  if (!ex) return null;
  try {
    const at = ex.fc_img_reserve(rgba.length);
    new Uint8Array(ex.memory.buffer, at, rgba.length).set(rgba);
    const r = engineCall<{ w: number; h: number; removed: number }>('picture.process', { w, h, steps, scheme });
    if (!r || !exports) return null;
    const len = exports.fc_img_len();
    const out = new Uint8ClampedArray(len);
    out.set(new Uint8Array(exports.memory.buffer, exports.fc_img_ptr(), len));
    return { data: out, w: r.w, h: r.h, removed: r.removed };
  } catch (e) {
    console.error('engine picture.process failed', e);
    return null;
  }
}

// ── Review ────────────────────────────────────────────────────────────────────────────────────
export const thesaurus = (word: string) => engineCall<{ word: string; synonyms: string[] }[]>('review.thesaurus', { word }) ?? [];

// ── WordArt Transform (text warps) and Smooth Corners ─────────────────────────────────────────
export type WarpBand =
  | { kind: 'fill'; top: [number, number][]; bottom: [number, number][] }
  | { kind: 'follow'; path: [number, number][]; closed: boolean; anchor: 'first' | 'last' | 'middle' };
export const warpCatalog = () => (once('warpcat', () => engineCall<{ id: string; label: string; follow: boolean }[]>('text.warpCatalog')) ?? []) as { id: string; label: string; follow: boolean }[];
export const warpGuides = (preset: string, w: number, h: number, adj?: number[]) => engineCall<{ bands: WarpBand[] }>('text.warpGuides', { preset, w, h, adj: adj ?? [] })?.bands ?? null;
export const smoothCorners = (w: number, h: number, smoothing: number, radius?: number) => engineCall<{ path: string; pathW: number; pathH: number }>('shape.smoothCorners', { w, h, smoothing, radius });
