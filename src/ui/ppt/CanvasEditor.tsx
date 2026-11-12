import { isFrontSlide } from '../../domain/frontLayout';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent as RClipboardEvent, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Background, BackgroundEffect, Slide, SlideElement, TextRun, Theme } from '../../domain/types';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { SlideCanvas, slideTheme } from '../SlideCanvas';
import { useWidth } from '../hooks';
import { useAutoTextBoxes } from '../textBoxLayout';
import { isPdfSlide } from '../../domain/importedSlides';
import { elementTextStyle } from '../../domain/textBoxLayout';
import { lineRuns, slideLineRuns, slideTextPatch, withRichLines } from '../../domain/richText';
import {
  boxOf, cloneElements, deleteSelection, duplicateSelection, expandSelection, groupSelection, inkToShape, makeInk, makeShape, nudgeSelection,
  orderSelection, pasteStyle, selectionUnits, ungroupSelection, type CopiedStyle,
  lineBox, makeFreeform, pathShapeOf, routeConnectors,
} from '../../domain/editOps';
import { layoutTable } from '../../engine';
import { drawLine, eraseLine } from '../../domain/tableBorders';
import { anchors, bounds as pathBounds, closePath, deletePoint, deleteSegment, insertPoint, moveAnchor, nearestOnPath, setHandle, openPath, parsePath, setPointType, setSegmentType, shiftPath, writePath, type Seg } from '../../domain/pathEdit';
import { boundsOf, hitBox, marqueeIds, resizeBox, rotateBoxes, rotateTo, shapeAdjust, shapeSites, snapBox, type EBox, type Handle } from '../../engine';
import { aspectLocked, clickBox, constrain45, cycleSelection, drawBox, duplicateOffset, FINE_NUDGE, freeformPath, lineEnds, moveLineEnd, movableIds, NUDGE, resizeFlip, scribbleCloses, selectAllIds, type LastDuplicate, type Pt } from '../../domain/shapeOps';
import { adjOf, geometryOf, isLinePreset, isLineShape, presetOf } from '../EngineElements';
import { RichTextEditor } from '../RichTextEditor';
import { Ruler } from './Ruler';
import { clipboardToElements, copyObjectsToClipboard, lastCopiedObjects, sourceOf } from './pasteObjects';
import { desktop } from '../../domain/desktop';
import { centreOf, drawnMotionPath, motionPathOverlays, pathArrow, startAtCentre, withCustomPath } from '../../domain/motionPath';

/** The slide's own text (lyrics, scripture…) drawn by the theme, selectable like an object. */
export const SLIDE_TEXT = '__slide-text';

type Box = { x: number; y: number; w: number; h: number };

/** What a pointer press on the slide does when a ribbon tool is on (Insert › Shapes, Draw). */
export type CanvasTool =
  /** `keep`: stays on after drawing (double-click in the Shapes gallery: lock drawing mode). */
  | { kind: 'shape'; name: string; keep?: boolean }
  | { kind: 'pen'; color: string; width: number; highlighter?: boolean; toShape?: boolean }
  | { kind: 'eraser' }
  /** 서식 복사: the next object clicked takes this look (kept on with a double-click in the ribbon). */
  | { kind: 'painter'; style: CopiedStyle; keep?: boolean }
  /** Insert › Shapes › Freeform: Shape (click points, close at the start) or Freeform: Scribble (drag). */
  | { kind: 'freeform'; scribble?: boolean; /** Curve: a smooth line through the clicked points. */ curve?: boolean }
  /** Picture Format › Crop: the handles cut the picture instead of scaling it. */
  | { kind: 'crop'; id: string }
  /** Shape Format › Edit Shape › Edit Points. */
  | { kind: 'points'; id: string }
  /** Table Design › Draw Table (drag to split a cell) / Eraser (click a line between cells). */
  | { kind: 'tableDraw'; id: string; erase?: boolean }
  /** Picture Format › Color › Set Transparent Color: the next click on the picture picks the colour. */
  | { kind: 'eyedrop'; id: string; onPick: (fx: number, fy: number) => void }
  /** Animations › Motion Paths › Custom Path for object `id`: drawn like Freeform: Shape (`add`: Add Animation). */
  | { kind: 'motionPath'; id: string; add: boolean };

export interface ViewOptions {
  /** 눈금선: draw the grid and snap to it. */
  grid?: boolean;
  /** 안내선: the slide's centre lines. */
  guides?: boolean;
  /** 눈금자: centimetre rulers along the top and left, with the selected box's indents and tabs. */
  ruler?: boolean;
}

type Drag =
  | { mode: 'move'; ids: string[]; startX: number; startY: number; orig: Map<string, Box>; moved: boolean; copy: boolean; clickedText: string | null }
  | { mode: 'resize'; ids: string[]; handle: Handle; startX: number; startY: number; unit: EBox; orig: Map<string, Box & { rot: number }>; moved: boolean }
  | { mode: 'rotate'; id: string; ids: string[]; unit: EBox; moved: boolean }
  | { mode: 'lineEnd'; id: string; end: 0 | 1; moved: boolean; glue?: { id: string; site: number } | null }
  | { mode: 'adjust'; id: string; index: number; moved: boolean }
  | { mode: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { mode: 'draw'; x0: number; y0: number; x1: number; y1: number; square?: boolean; fromCenter?: boolean }
  | { mode: 'ink'; points: [number, number][] }
  | { mode: 'point'; id: string; seg: number; startX: number; startY: number; moved: boolean; base?: string }
  | { mode: 'ctrl'; id: string; seg: number; which: 0 | 1; startX: number; startY: number; moved: boolean }
  | { mode: 'tdraw'; id: string; r: number; c: number; cx: number; cy: number; cw: number; ch: number; x0: number; y0: number };

interface Props {
  slide: Slide;
  theme: Theme;
  background: Background | null;
  bgEffect?: BackgroundEffect;
  /** Objects selected on the canvas (ids; SLIDE_TEXT for the slide's own text). */
  selected: string[];
  onSelect: (ids: string[]) => void;
  /** Apply a change to the slide (objects moved, resized, retyped, deleted). */
  onChange: (patch: Partial<Slide>) => void;
  /** Called instead of deleting when 🔒 is on and this slide is on screen. */
  onLockedDelete?: () => void;
  /** A picture a paste brought in (to list in the presentation's media). */
  onAddMedia?: (m: import('../../domain/types').MediaMeta) => void;
  readOnly?: boolean;
  tool?: CanvasTool | null;
  onToolDone?: () => void;
  view?: ViewOptions;
  /** Animations tab: the click numbers shown beside animated objects. */
  badges?: Record<string, number[]>;
  /** The look new shapes take (Set as Default Shape). */
  defaultShape?: Partial<SlideElement>;
  /** Guides the user placed (View › Guides), drawn and snapped to. */
  customGuides?: { v: number[]; h: number[] };
  /** A picture placeholder was double-clicked: pick a picture (its media id, or null). */
  pickPicture?: () => Promise<string | null>;
  /** Show the objects as the slide show would at the start (hidden objects stay hidden). */
  zoom?: number;
  /** Animations tab / Animation pane: draw the selected objects' motion paths. */
  motionPaths?: boolean;
}

/** Home › Clipboard › Copy: the objects go on the system clipboard with every property (see pasteObjects). */
export function copyObjects(els: SlideElement[]) { copyObjectsToClipboard(els); }
export const objectClipboard = () => lastCopiedObjects();

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

/** A point in an object's own (unrotated, unflipped) coordinates. */
function toLocal(el: SlideElement, x: number, y: number): [number, number] {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const a = (-(el.rotation ?? 0) * Math.PI) / 180;
  let lx = (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
  let ly = (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
  if (el.flipH) lx = -lx;
  if (el.flipV) ly = -ly;
  return [lx + el.w / 2, ly + el.h / 2];
}
function toSlide(el: SlideElement, lx: number, ly: number): [number, number] {
  let x = lx - el.w / 2, y = ly - el.h / 2;
  if (el.flipH) x = -x;
  if (el.flipV) y = -y;
  const a = ((el.rotation ?? 0) * Math.PI) / 180;
  return [el.x + el.w / 2 + x * Math.cos(a) - y * Math.sin(a), el.y + el.h / 2 + x * Math.sin(a) + y * Math.cos(a)];
}

/**
 * The slide, edited in place like PowerPoint: click an object to select it (Shift/Ctrl+click adds,
 * drag on empty space draws a selection box), drag to move (Ctrl+drag copies, Shift keeps to one
 * axis, Alt turns snapping off), the eight white handles size it (Shift keeps the proportions, Ctrl
 * sizes from the centre), the round handle above turns it (Shift: 15° steps), the yellow handles
 * reshape it. Click into text to type; select part of it to give that part its own size, bold,
 * italic, underline or colour. Every geometric answer — hits, sizes, angles, snapping — comes from
 * the Rust engine. Changes apply as you go, so a slide that is live updates on screen.
 */
export function CanvasEditor({ slide, theme: baseTheme, background, bgEffect, selected, onSelect, onChange, onLockedDelete, onAddMedia, readOnly, tool, onToolDone, view, badges, defaultShape, customGuides, pickPicture, motionPaths }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const k = width / CANVAS_W || 1;
  const [session, setSession] = useState<{ slideId: string; id: string } | null>(null);
  const identity = slide.sourceSlideId ?? slide.id;
  const [preview, setPreview] = useState<Map<string, Box & { rot?: number; adj?: number[]; flipH?: boolean; flipV?: boolean }> | null>(null);
  /** Connection sites shown while drawing a line or dragging its end, and the one it would glue to. */
  const [sites, setSites] = useState<{ pts: Pt[]; glue: Pt | null } | null>(null);
  /** Where the pointer is while a freeform / curve is being clicked out (the rubber band). */
  const [hoverPt, setHoverPt] = useState<Pt | null>(null);
  /** The copies the last Duplicate made: duplicating them again repeats how far they were moved. */
  const lastDup = useRef<LastDuplicate | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [band, setBand] = useState<Box | null>(null);
  const [inkPath, setInkPath] = useState<[number, number][] | null>(null);
  const drag = useRef<Drag | null>(null);
  const commitTimer = useRef<number | undefined>(undefined);
  const pendingText = useRef<(() => void) | null>(null);
  const flushText = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    const save = pendingText.current;
    pendingText.current = null;
    save?.();
  }, []);
  const theme = slideTheme(baseTheme, slide);
  const elements = useAutoTextBoxes(slide.elements ?? [], readOnly || isPdfSlide(slide) ? undefined : (elements) => onChange({ elements }), isFrontSlide(slide));
  const visible = useMemo(() => elements.filter((e) => !e.hidden), [elements]);
  /** What a click can pick: not the slide master's. A locked object is picked (to format it) but does not move. */
  const pickable = useMemo(() => visible.filter((e) => !e.master), [visible]);
  const [freePts, setFreePts] = useState<[number, number][] | null>(null);
  /** Custom Path being drawn (starts at the object's centre). */
  const [pathPts, setPathPts] = useState<[number, number][] | null>(null);
  const [pointPreview, setPointPreview] = useState<{ id: string; path: string } | null>(null);
  /** Edit Points: the anchor picked (its Bézier handles show) and the right-click menu. */
  const [ptSel, setPtSel] = useState<number | null>(null);
  const [tablePreview, setTablePreview] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [ptMenu, setPtMenu] = useState<{ x: number; y: number; seg: number; onSegment: boolean } | null>(null);
  const editing = session?.slideId === identity && (session.id === SLIDE_TEXT || elements.some((el) => el.id === session.id)) ? session.id : null;
  const defaultTextBox: Box = { x: theme.padding, y: theme.padding, w: CANVAS_W - theme.padding * 2, h: CANVAS_H - theme.padding * 2 };
  const [bodyBox, setBodyBox] = useState<{ identity: string; box: Box } | null>(null);
  const latestBody = useRef({ slide, onChange }); latestBody.current = { slide, onChange };
  const textBox = bodyBox?.identity === identity ? bodyBox.box : defaultTextBox;
  useLayoutEffect(() => {
    if (editing === SLIDE_TEXT || readOnly || isPdfSlide(slide) || !ref.current) return;
    let node: HTMLElement | null = null;
    const update = () => {
      if (!node) return;
      const fitted = node.querySelector<HTMLElement>('[data-fitted-font-size]');
      const size = Number(fitted?.dataset.fittedFontSize), preferred = Number(fitted?.dataset.preferredFontSize);
      const latest = latestBody.current;
      if (!isFrontSlide(latest.slide) && Number.isFinite(size) && size > 0 && size !== (latest.slide.style?.fontSize ?? theme.fontSize) && document.fonts?.status !== 'loading') latest.onChange({ maximizeFont: false, preferredFontSize: preferred, style: { ...latest.slide.style, fontSize: size } });
      const box = { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
      setBodyBox((old) => old?.identity === identity && Object.keys(box).every((k) => old.box[k as keyof Box] === box[k as keyof Box]) ? old : { identity, box });
    };
    const observer = new ResizeObserver(update);
    const bind = () => {
      const current = ref.current?.querySelector<HTMLElement>('.canvas .text-layer') ?? null;
      if (current !== node) { observer.disconnect(); node = current; if (node) observer.observe(node); }
      update();
    };
    // Background decoding can replace the previous slide after this editor has already mounted.
    const mutations = new MutationObserver(bind); mutations.observe(ref.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-fitted-font-size'] }); bind();
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [identity, editing, theme.padding, theme.fontSize, theme.align, theme.vAlign, width, readOnly]);

  // A different slide: stop typing.
  useEffect(() => { setSession(null); setPreview(null); }, [identity]);
  // The last keystroke belongs to the old slide, even if it is switched or closed immediately.
  useEffect(() => flushText, [identity, flushText]);

  const hasSlideText = !!(slide.text.trim() || slide.title || slide.subtext);
  const sel = expandSelection(elements, selected.filter((id) => id !== SLIDE_TEXT));
  const units = selectionUnits(elements, sel);
  const elOf = (id: string) => elements.find((e) => e.id === id);
  const shownEl = (el: SlideElement): SlideElement => {
    const p = preview?.get(el.id);
    return p ? { ...el, x: p.x, y: p.y, w: p.w, h: p.h, ...(p.rot !== undefined ? { rotation: p.rot } : {}), ...(p.adj ? { adj: p.adj } : {}), ...('flipH' in p ? { flipH: p.flipH, flipV: p.flipV } : {}) } : el;
  };
  const setElements = (next: SlideElement[]) => onChange({ elements: next.length ? routeConnectors(next) : undefined });
  // Motion paths follow their objects while they are dragged (preset ones are traced by the engine, so only when something changed).
  const selKey = sel.join();
  const pathOverlays = useMemo(() => (motionPaths ? motionPathOverlays(slide, elements.map(shownEl), sel) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motionPaths, slide.animations, elements, preview, selKey]);

  // What the canvas shows: objects being dragged where they are going, the text being typed
  // hidden underneath the typing box.
  const shown: Slide = {
    ...slide,
    text: editing === SLIDE_TEXT ? '' : slide.text,
    title: editing === SLIDE_TEXT ? undefined : slide.title,
    subtext: editing === SLIDE_TEXT ? undefined : slide.subtext,
    elements: elements.map((e) => {
      const m = pointPreview?.id === e.id ? { ...shownEl(e), path: pointPreview.path } : shownEl(e);
      return editing === e.id ? { ...m, text: '', paragraphs: undefined, runs: undefined } : m;
    }),
  };

  // ── Typing ──────────────────────────────────────────────────────────────────────────────────
  const startEditing = (id: string) => {
    const el = elOf(id);
    if (id !== SLIDE_TEXT && el?.kind !== 'text' && el?.kind !== 'shape') return;
    if (el?.kind === 'shape' && /line|Connector/i.test(el.shape ?? '')) return;
    setSession({ slideId: identity, id });
    onSelect([id]);
  };
  const stopEditing = () => {
    flushText();
    setSession(null);
  };
  // Picking a drawing tool (text box, shape, pen…) ends typing, as in PowerPoint.
  const toolKind = tool?.kind;
  useEffect(() => {
    if (toolKind && toolKind !== 'eyedrop') { flushText(); setSession(null); }
    if (toolKind !== 'motionPath') setPathPts(null);
  }, [toolKind, flushText]);
  const typed = (id: string, lines: TextRun[][]) => {
    window.clearTimeout(commitTimer.current);
    pendingText.current = () => {
      if (id === SLIDE_TEXT) {
        latestBody.current.onChange(slideTextPatch(lines));
        return;
      }
      const el = latestEls.current.find((e) => e.id === id);
      if (el) latestBody.current.onChange({ elements: latestEls.current.map((e) => (e.id === id ? { ...e, ...withRichLines(e, lines) } : e)) });
    };
    commitTimer.current = window.setTimeout(flushText, 250);
  };
  const latestEls = useRef(elements); latestEls.current = elements;

  // ── Pointer ─────────────────────────────────────────────────────────────────────────────────
  const pointer = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  };
  const focusRoot = () => ref.current?.focus({ preventScroll: true });

  /**
   * The connection sites of the shape near (x, y) (not `exclude`, not a line) and the site within
   * glue range, which a line end drawn or dragged there snaps and glues to.
   */
  const siteInfo = (x: number, y: number, exclude?: string): { pts: Pt[]; glue: { id: string; site: number; pt: Pt } | null } | null => {
    for (const o of [...pickable].reverse()) {
      if (o.id === exclude || (o.kind !== 'shape' && o.kind !== 'text' && o.kind !== 'image') || isLineShape(o)) continue;
      const pts = shapeSites(pathShapeOf(o)) as Pt[];
      const i = pts.findIndex((pt) => Math.hypot(pt[0] - x, pt[1] - y) < 24);
      if (i >= 0) return { pts, glue: { id: o.id, site: i, pt: pts[i] } };
      if (hitBox([boxOf(o)], x, y, 24)) return { pts, glue: null };
    }
    return null;
  };

  const onRootDown = (e: RPointerEvent) => {
    // Edit Points takes the right button too (its point / segment menu).
    if (e.button !== 0 && !(e.button === 2 && tool?.kind === 'points')) return;
    if (editing) stopEditing();
    focusRoot();
    const [x, y] = pointer(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (tool?.kind === 'shape') { drag.current = { mode: 'draw', x0: x, y0: y, x1: x, y1: y }; return; }
    if (tool?.kind === 'freeform') {
      if (tool.scribble) { drag.current = { mode: 'ink', points: [[x, y]] }; setInkPath([[x, y]]); return; }
      const pts = freePts ?? [];
      // Clicking near the first point closes the outline.
      if (pts.length > 2 && Math.hypot(pts[0][0] - x, pts[0][1] - y) < 14 / k) { finishFreeform(pts, true); return; }
      setFreePts([...pts, [x, y]]);
      drag.current = { mode: 'ink', points: [[x, y]] };
      return;
    }
    if (tool?.kind === 'motionPath') {
      const el = elOf(tool.id);
      if (!el) { onToolDone?.(); return; }
      const pts = pathPts ?? [centreOf(el)];
      // Clicking near the start (the object's centre) closes the path.
      if (pts.length > 2 && Math.hypot(pts[0][0] - x, pts[0][1] - y) < 14 / k) { finishMotionPath(pts, true); return; }
      setPathPts(pathPts ? [...pts, [x, y]] : startAtCentre([[x, y]], pts[0]));
      drag.current = { mode: 'ink', points: [[x, y]] };
      return;
    }
    if (tool?.kind === 'eyedrop') {
      const el = elOf(tool.id);
      if (el) {
        const [lx, ly] = toLocal(el, x, y);
        if (lx >= 0 && ly >= 0 && lx <= el.w && ly <= el.h) {
          const c = el.crop ?? [0, 0, 0, 0];
          tool.onPick(c[0] + (lx / el.w) * (1 - c[0] - c[2]), c[1] + (ly / el.h) * (1 - c[1] - c[3]));
        }
      }
      onToolDone?.();
      return;
    }
    if (tool?.kind === 'points') {
      const el = elOf(tool.id);
      setPtMenu(null);
      if (el?.path) {
        const segs = parsePath(el.path);
        const right = e.button === 2;
        // A Bézier handle of the picked anchor.
        const handle = ptSel == null ? null : handlesOf(segs, ptSel).find((h) => { const [px, py] = pathToSlide(el, h.p); return Math.hypot(px - x, py - y) < 9 / k; });
        if (handle && !right) { drag.current = { mode: 'ctrl', id: el.id, seg: handle.seg, which: handle.which, startX: x, startY: y, moved: false }; return; }
        const hitPt = anchors(segs).find((a) => { const [px, py] = pathToSlide(el, a.p); return Math.hypot(px - x, py - y) < 10 / k; });
        if (hitPt) {
          if (right) { setPtSel(hitPt.seg); setPtMenu({ x, y, seg: hitPt.seg, onSegment: false }); return; }
          // Ctrl+click deletes a point, as in PowerPoint.
          if (e.ctrlKey || e.metaKey) { applyPoints(el, deletePoint(segs, hitPt.seg)); setPtSel(null); return; }
          setPtSel(hitPt.seg);
          drag.current = { mode: 'point', id: el.id, seg: hitPt.seg, startX: x, startY: y, moved: false };
          return;
        }
        const near = nearestOnPath(segs, [x, y], (q) => pathToSlide(el, q));
        if (near && near.dist < 8 / k) {
          if (right) { setPtMenu({ x, y, seg: near.seg, onSegment: true }); return; }
          // A click on the outline adds a point there, ready to drag.
          const added = insertPoint(segs, near.seg, near.t);
          const path = writePath(added);
          setElements(elements.map((x2) => (x2.id === el.id ? { ...x2, path } : x2)));
          setPtSel(near.seg);
          // The slide has not re-rendered yet: the drag works from the outline with the new point.
          drag.current = { mode: 'point', id: el.id, seg: near.seg, startX: x, startY: y, moved: false, base: path };
          return;
        }
      }
      setPtSel(null);
      onToolDone?.();
    }
    if (tool?.kind === 'tableDraw') {
      const el = elOf(tool.id);
      if (!el?.table) { onToolDone?.(); return; }
      const lx = x - el.x, ly = y - el.y;
      const cells = layoutTable(el.table, el.w, el.h);
      const cell = cells.find((c) => lx >= c.x - 6 && lx <= c.x + c.w + 6 && ly >= c.y - 6 && ly <= c.y + c.h + 6);
      if (!cell) { onToolDone?.(); return; }
      if (tool.erase) {
        // The line nearest the click: the cell's right or bottom edge (or the neighbour's).
        const tol = 10 / k;
        const near = cells.flatMap((c) => [
          { c, side: 'r' as const, d: Math.abs(lx - (c.x + c.w)) + (ly < c.y || ly > c.y + c.h ? 1e9 : 0) },
          { c, side: 'b' as const, d: Math.abs(ly - (c.y + c.h)) + (lx < c.x || lx > c.x + c.w ? 1e9 : 0) },
        ]).filter((h) => h.d < tol).sort((a, b) => a.d - b.d)[0];
        const next = near && eraseLine(el.table, near.c.r, near.c.c, near.side);
        if (next) setElements(elements.map((e) => (e.id === el.id ? { ...e, table: next } : e)));
        return;
      }
      drag.current = { mode: 'tdraw', id: el.id, r: cell.r, c: cell.c, cx: cell.x, cy: cell.y, cw: cell.w, ch: cell.h, x0: lx, y0: ly };
      setTablePreview({ x0: x, y0: y, x1: x, y1: y });
      return;
    }
    if (tool?.kind === 'pen') { drag.current = { mode: 'ink', points: [[x, y]] }; setInkPath([[x, y]]); return; }
    if (tool?.kind === 'painter') {
      const hit = hitBox(visible.map(boxOf), x, y, 3);
      if (hit) { setElements(pasteStyle(elements, [hit], tool.style)); onSelect([hit]); }
      if (!tool.keep) onToolDone?.();
      return;
    }
    if (tool?.kind === 'eraser') {
      const hit = hitBox(visible.filter((el) => el.kind === 'ink').map(boxOf), x, y, 6);
      if (hit) setElements(elements.filter((el) => el.id !== hit));
      return;
    }
    // Front-most object under the pointer (rotated boxes, in drawing order).
    const hit = hitBox(pickable.map((el) => boxOf(shownEl(el))), x, y, 3);
    if (!hit) {
      if (hasSlideText && x >= textBox.x && x <= textBox.x + textBox.w && y >= textBox.y && y <= textBox.y + textBox.h) {
        // The browser would move focus to the canvas after this and end the typing straight away.
        e.preventDefault();
        startEditing(SLIDE_TEXT);
        return;
      }
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!add) onSelect([]);
      drag.current = { mode: 'marquee', x0: x, y0: y, x1: x, y1: y, add };
      return;
    }
    let next = selected.filter((id) => id !== SLIDE_TEXT);
    const already = sel.includes(hit);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const group = expandSelection(elements, [hit]);
      next = already ? next.filter((id) => !group.includes(id)) : [...next, hit];
      onSelect(next);
      if (already) return;
    } else if (!already) {
      next = [hit];
      onSelect(next);
    }
    const all = expandSelection(elements, next.length ? next : [hit]);
    // A locked object is selected but stays where it is.
    const ids = movableIds(elements, all);
    const el = elOf(hit);
    drag.current = {
      mode: 'move', ids, startX: x, startY: y, moved: false, copy: false,
      orig: new Map(ids.map((id) => { const o = elOf(id)!; return [id, { x: o.x, y: o.y, w: o.w, h: o.h }]; })),
      clickedText: already && all.length === 1 && (el?.kind === 'text' || (el?.kind === 'shape' && !!el.text)) ? hit : el?.kind === 'text' && all.length === 1 && !el.groupId ? hit : null,
    };
  };

  const startHandle = (e: RPointerEvent, handle: Handle) => {
    e.stopPropagation();
    if (e.button !== 0 || units.length !== 1 || movableIds(elements, units[0].members).length !== units[0].members.length) return;
    focusRoot();
    const [x, y] = pointer(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const u = units[0];
    cropDraft.current = null;
    drag.current = {
      mode: 'resize', ids: u.members, handle, startX: x, startY: y, unit: u.box, moved: false,
      orig: new Map(u.members.map((id) => { const o = elOf(id)!; return [id, { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rotation ?? 0 }]; })),
    };
  };
  const startRotate = (e: RPointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || units.length !== 1 || movableIds(elements, units[0].members).length !== units[0].members.length) return;
    focusRoot();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // A group turns as one, about its centre.
    drag.current = { mode: 'rotate', id: units[0].members[0], ids: units[0].members, unit: units[0].box, moved: false };
  };
  /** A line's end handle: drag it to move that end (Shift: 45° steps; it glues to a connection site). */
  const startLineEnd = (e: RPointerEvent, id: string, end: 0 | 1) => {
    e.stopPropagation();
    if (e.button !== 0 || elOf(id)?.locked) return;
    focusRoot();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'lineEnd', id, end, moved: false };
  };
  const startAdjust = (e: RPointerEvent, id: string, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'adjust', id, index, moved: false };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    const lineTool = tool?.kind === 'shape' && isLinePreset(tool.name);
    if (!d) {
      // Hovering with a line tool shows the sites a line can glue to; a freeform shows its rubber band.
      if (lineTool) { const [x, y] = pointer(e); const i = siteInfo(x, y); setSites(i ? { pts: i.pts, glue: i.glue?.pt ?? null } : null); }
      if (tool?.kind === 'freeform' && freePts) setHoverPt(pointer(e));
      return;
    }
    const [x, y] = pointer(e);
    if (d.mode === 'draw' && lineTool) {
      // A line: Shift keeps it to 45° steps; an end near a connection site snaps onto it.
      let q: Pt = e.shiftKey ? constrain45([d.x0, d.y0], [x, y]) : [x, y];
      const i = siteInfo(q[0], q[1]);
      if (i?.glue) q = i.glue.pt;
      setSites(i ? { pts: i.pts, glue: i.glue?.pt ?? null } : null);
      d.x1 = q[0]; d.y1 = q[1];
      setBand({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
      return;
    }
    if (d.mode === 'marquee' || d.mode === 'draw') {
      d.x1 = x; d.y1 = y;
      if (d.mode === 'draw') {
        // Shift: square / circle; Ctrl: out from where the drag started.
        d.square = e.shiftKey; d.fromCenter = e.ctrlKey || e.metaKey;
        setBand(drawBox(d.x0, d.y0, x, y, { square: d.square, fromCenter: d.fromCenter }));
        return;
      }
      setBand({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
      return;
    }
    if (d.mode === 'lineEnd') {
      const el = elOf(d.id);
      if (!el) return;
      const [p0, p1] = lineEnds({ ...el, rot: el.rotation });
      let q: Pt = e.shiftKey ? constrain45(d.end === 0 ? p1 : p0, [x, y]) : [x, y];
      const i = siteInfo(q[0], q[1], el.id);
      if (i?.glue) q = i.glue.pt;
      setSites(i ? { pts: i.pts, glue: i.glue?.pt ?? null } : null);
      d.moved = true;
      d.glue = i?.glue ? { id: i.glue.id, site: i.glue.site } : null;
      const b = moveLineEnd(el, d.end, q);
      setPreview(new Map([[el.id, { x: b.x, y: b.y, w: b.w, h: b.h, rot: 0, flipH: b.flipH, flipV: b.flipV }]]));
      return;
    }
    if (d.mode === 'ink') {
      // Curve takes clicked points only; Freeform: Shape scribbles while the button is down.
      if (tool?.kind === 'freeform' && tool.curve) { setHoverPt([x, y]); return; }
      d.points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      if (tool?.kind === 'freeform' && !tool.scribble) { if (d.points.length > 2) setFreePts((pts) => [...(pts ?? []), [x, y]]); return; }
      // Custom Path: a drag draws freehand, like Scribble.
      if (tool?.kind === 'motionPath') { if (d.points.length > 2) setPathPts((pts) => [...(pts ?? []), [x, y]]); return; }
      setInkPath([...d.points]);
      return;
    }
    if (d.mode === 'tdraw') {
      setTablePreview((p) => (p ? { ...p, x1: x, y1: y } : p));
      return;
    }
    if (d.mode === 'ctrl') {
      const el = elOf(d.id);
      if (!el?.path) return;
      d.moved = true;
      const sx = (el.pathW ?? el.w) / Math.max(1, el.w), sy = (el.pathH ?? el.h) / Math.max(1, el.h);
      const segs = parsePath(el.path);
      const from = segs[d.seg]?.pts[d.which];
      if (!from) return;
      // which 1: the incoming handle of the point ending this segment; 0: the outgoing one of the point before.
      const anchor = d.which === 1 ? d.seg : d.seg - 1;
      // Shift, Ctrl or Alt held makes the point smooth, straight or corner (as in PowerPoint); else it keeps its type.
      const kind = e.shiftKey ? 'smooth' : e.ctrlKey || e.metaKey ? 'straight' : e.altKey ? 'corner' : undefined;
      setPointPreview({ id: el.id, path: writePath(setHandle(segs, anchor, d.which === 0, [from[0] + (x - d.startX) * sx, from[1] + (y - d.startY) * sy], kind)) });
      return;
    }
    if (d.mode === 'point') {
      const el = elOf(d.id);
      if (!el?.path) return;
      d.moved = true;
      const sx = (el.pathW ?? el.w) / Math.max(1, el.w), sy = (el.pathH ?? el.h) / Math.max(1, el.h);
      setPointPreview({ id: el.id, path: writePath(moveAnchor(parsePath(d.base ?? el.path), d.seg, (x - d.startX) * sx, (y - d.startY) * sy)) });
      return;
    }
    if (d.mode === 'move') {
      let dx = x - d.startX, dy = y - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      d.copy = e.ctrlKey || e.metaKey;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const boxes = d.ids.map((id) => { const o = d.orig.get(id)!; const el = elOf(id)!; return { id, x: o.x + dx, y: o.y + dy, w: o.w, h: o.h, rot: el.rotation ?? 0 }; });
      const united = boundsOf(boxes);
      let sx = 0, sy = 0;
      if (united && !e.altKey) {
        const others = visible.filter((el) => !d.ids.includes(el.id)).map(boxOf);
        const s = snapBox({ id: 'm', ...united, rot: 0 }, others, { grid: view?.grid ? 30 : 0, smart: true, guidesV: customGuides?.v, guidesH: customGuides?.h });
        if (s) { sx = s.x - united.x; sy = s.y - united.y; setGuides(s.guides); }
      } else setGuides({ v: [], h: [] });
      setPreview(new Map(boxes.map((b) => [b.id, { x: Math.round(b.x + sx), y: Math.round(b.y + sy), w: b.w, h: b.h }])));
      return;
    }
    if (d.mode === 'resize') {
      const dx = x - d.startX, dy = y - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      d.moved = true;
      const one = d.ids.length === 1 ? elOf(d.ids[0]) : null;
      const corner = d.handle.length === 2;
      const keep = e.shiftKey !== (corner && !!one && aspectLocked(one));
      const unit = one ? { ...d.unit, rot: one.rotation ?? 0 } : d.unit;
      const cropping = !!one && tool?.kind === 'crop' && tool.id === one.id;
      if (one && !cropping) {
        // Dragging past the opposite edge flips the object (DeckCraft's resize_box).
        const f = resizeFlip({ ...unit, flipH: one.flipH, flipV: one.flipV }, d.handle, dx, dy, keep, e.ctrlKey || e.metaKey, 4);
        setPreview(new Map([[one.id, { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h), flipH: f.flipH, flipV: f.flipV }]]));
        return;
      }
      const r = resizeBox(unit, d.handle, dx, dy, keep, e.ctrlKey || e.metaKey, 4);
      if (!r) return;
      if (one) {
        setPreview(new Map([[one.id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }]]));
        if (cropping) cropDraft.current = cropFor(one, r);
      } else {
        // A group scales its members with it.
        const sxk = r.w / Math.max(1, d.unit.w), syk = r.h / Math.max(1, d.unit.h);
        setPreview(new Map(d.ids.map((id) => {
          const o = d.orig.get(id)!;
          return [id, { x: Math.round(r.x + (o.x - d.unit.x) * sxk), y: Math.round(r.y + (o.y - d.unit.y) * syk), w: Math.max(1, Math.round(o.w * sxk)), h: Math.max(1, Math.round(o.h * syk)) }];
        })));
      }
      return;
    }
    if (d.mode === 'rotate' && d.ids.length > 1) {
      const a = rotateTo({ ...d.unit, rot: 0 }, x, y, e.shiftKey);
      if (a === null) return;
      d.moved = true;
      const placed = rotateBoxes(d.ids.map((id) => boxOf(elOf(id)!)), a, true);
      setPreview(new Map(placed.map((p) => { const o = elOf(p.id)!; return [p.id, { x: Math.round(p.x), y: Math.round(p.y), w: o.w, h: o.h, rot: p.rot }]; })));
      return;
    }
    if (d.mode === 'rotate') {
      const el = elOf(d.id)!;
      const a = rotateTo(boxOf(el), x, y, e.shiftKey);
      if (a === null) return;
      d.moved = true;
      setPreview(new Map([[el.id, { x: el.x, y: el.y, w: el.w, h: el.h, rot: a }]]));
      return;
    }
    if (d.mode === 'adjust') {
      const el = elOf(d.id)!;
      const [lx, ly] = toLocal(el, x, y);
      const adj = shapeAdjust(presetOf(el), el.w, el.h, adjOf(el), d.index, lx, ly);
      if (!adj) return;
      d.moved = true;
      setPreview(new Map([[el.id, { x: el.x, y: el.y, w: el.w, h: el.h, adj }]]));
    }
  };

  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGuides({ v: [], h: [] });
    setBand(null);
    if (!d) return;
    if (d.mode !== 'ink') setSites(null);
    if (d.mode === 'lineEnd') {
      const p = preview?.get(d.id);
      setPreview(null);
      const el = elOf(d.id);
      if (!p || !el || !d.moved) return;
      // The dragged end glues to the site it was dropped on (or comes unglued).
      const key = d.end === 0 ? 'from' : 'to';
      const connect = { ...el.connect, [key]: d.glue ?? undefined };
      const next: SlideElement = { ...el, x: p.x, y: p.y, w: p.w, h: p.h, flipH: p.flipH, flipV: p.flipV, rotation: undefined, connect: connect.from || connect.to ? connect : undefined };
      setElements(elements.map((x2) => (x2.id === el.id ? next : x2)));
      return;
    }
    if (d.mode === 'marquee') {
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      if (r.w < 3 && r.h < 3) return;
      // Wholly inside the box, not hidden and not locked (DeckCraft).
      const ids = expandSelection(elements, marqueeIds(pickable.filter((el) => !el.locked).map(boxOf), r));
      onSelect(d.add ? [...new Set([...selected.filter((s) => s !== SLIDE_TEXT), ...ids])] : ids);
      return;
    }
    if (d.mode === 'tdraw') {
      setTablePreview(null);
      const el = elOf(d.id);
      if (!el?.table) return;
      const [x, y] = pointer(e);
      const lx = x - el.x, ly = y - el.y;
      const dx = Math.abs(lx - d.x0), dy = Math.abs(ly - d.y0);
      if (Math.max(dx, dy) < 12) return;
      // A mostly vertical stroke splits the cell into columns where it was drawn, a horizontal one into rows.
      const next = dy > dx
        ? drawLine(el.table, d.r, d.c, 'v', ((d.x0 + lx) / 2 - d.cx) / d.cw)
        : drawLine(el.table, d.r, d.c, 'h', ((d.y0 + ly) / 2 - d.cy) / d.ch);
      if (next) setElements(elements.map((e) => (e.id === el.id ? { ...e, table: next } : e)));
      return;
    }
    if (d.mode === 'point' || d.mode === 'ctrl') {
      const p = pointPreview;
      setPointPreview(null);
      const el = elOf(d.id);
      if (!p || !el || !d.moved) return;
      setElements(elements.map((e) => (e.id === el.id ? refitPath(e, p.path) : e)));
      return;
    }
    if (d.mode === 'ink' && tool?.kind === 'motionPath') return;
    if (d.mode === 'ink' && tool?.kind === 'freeform') {
      setInkPath(null);
      if (tool.scribble) {
        // A scribble that ends where it began closes into a filled shape.
        const closed = scribbleCloses(d.points);
        const made = closed ? makeFreeform(d.points, true, defaultShape) : makeInk(d.points, defaultShape?.stroke ?? '#ffffff', defaultShape?.strokeWidth ?? 6, false);
        if (made) { const el: SlideElement = closed ? made : { ...made, kind: 'shape', fill: 'transparent', name: '자유형: 자유 곡선' }; setElements([...elements, el]); onSelect([el.id]); }
        onToolDone?.();
      }
      return;
    }
    if (d.mode === 'draw' && tool?.kind === 'shape' && isLinePreset(tool.name) && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 6) {
      // Lines and connectors run from where the drag started to where it ended; an end on another
      // shape's connection site is glued to it.
      const near = (x: number, y: number) => {
        for (const o of [...pickable].reverse()) {
          if (o.kind !== 'shape' && o.kind !== 'text' && o.kind !== 'image') continue;
          const sites = shapeSites(pathShapeOf(o));
          const i = sites.findIndex((pt) => Math.hypot(pt[0] - x, pt[1] - y) < 24);
          if (i >= 0) return { id: o.id, site: i };
        }
        return undefined;
      };
      const base = makeShape(tool.name);
      const from = near(d.x0, d.y0), to = near(d.x1, d.y1);
      // A start on a connection site begins exactly there.
      const s0 = from ? (siteInfo(d.x0, d.y0)?.glue?.pt ?? [d.x0, d.y0]) : [d.x0, d.y0];
      const el: SlideElement = { ...(defaultShape ? { ...base, ...lineLook(defaultShape) } : base), ...lineBox(s0[0], s0[1], d.x1, d.y1), ...(from || to ? { connect: { from, to } } : {}) };
      setElements([...elements, el]);
      onSelect([el.id]);
      if (!tool.keep) onToolDone?.();
      return;
    }
    if (d.mode === 'draw' && tool?.kind === 'shape') {
      const r = drawBox(d.x0, d.y0, d.x1, d.y1, { square: d.square, fromCenter: d.fromCenter });
      const click = Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 6;
      const line = isLinePreset(tool.name);
      // A click without a drag puts a 72 pt shape at the click (a text box: its usual size, centred there).
      const el = click
        ? tool.name === 'textBox' ? (() => { const m = makeShape(tool.name); return { ...m, x: Math.round(d.x0 - m.w / 2), y: Math.round(d.y0 - m.h / 2) }; })() : makeShape(tool.name, clickBox(d.x0, d.y0, line))
        : makeShape(tool.name, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      const styled = el.kind === 'shape' && defaultShape ? { ...el, ...(line ? lineLook(defaultShape) : defaultShape) } : el;
      setElements([...elements, styled]);
      onSelect([styled.id]);
      if (!tool.keep) onToolDone?.();
      if (styled.kind === 'text') setSession({ slideId: identity, id: styled.id });
      return;
    }
    if (d.mode === 'ink' && tool?.kind === 'pen') {
      setInkPath(null);
      const made = (tool.toShape && inkToShape(d.points, tool.color, tool.width)) || makeInk(d.points, tool.color, tool.width, !!tool.highlighter);
      if (made && (made.w > 2 || made.h > 2)) setElements([...elements, made]);
      return;
    }
    if (d.mode === 'move') {
      if (!d.moved) {
        // A click on text (no drag) puts the cursor in it, as in PowerPoint.
        if (d.clickedText && !(e.shiftKey || e.ctrlKey || e.metaKey)) startEditing(d.clickedText);
        return;
      }
      const p = preview;
      setPreview(null);
      if (!p) return;
      if (d.copy) {
        const copies = cloneElements(elements.filter((el) => d.ids.includes(el.id))).map((c, i) => { const b = p.get(d.ids[i]); return b ? { ...c, x: b.x, y: b.y } : c; });
        setElements([...elements, ...copies]);
        onSelect(copies.map((c) => c.id));
      } else {
        // A connector moved away from objects that stay put comes unglued at those ends (DeckCraft).
        const unglue = (c: SlideElement['connect']) => {
          if (!c) return c;
          const n = { from: c.from && p.has(c.from.id) ? c.from : undefined, to: c.to && p.has(c.to.id) ? c.to : undefined };
          return n.from || n.to ? n : undefined;
        };
        setElements(elements.map((el) => { const b = p.get(el.id); return b ? { ...el, x: b.x, y: b.y, ...(el.connect ? { connect: unglue(el.connect) } : {}) } : el; }));
      }
      return;
    }
    const p = preview;
    setPreview(null);
    if (!p || !('moved' in d) || !d.moved) return;
    setElements(elements.map((el) => {
      const b = p.get(el.id);
      if (!b) return el;
      const cropped = tool?.kind === 'crop' && tool.id === el.id && cropDraft.current ? { crop: cropDraft.current, fit: 'fill' as const } : {};
      const next = { ...el, x: b.x, y: b.y, w: b.w, h: b.h, ...(b.rot !== undefined ? { rotation: b.rot || undefined } : {}), ...(b.adj ? { adj: b.adj } : {}), ...('flipH' in b ? { flipH: b.flipH, flipV: b.flipV } : {}), ...cropped };
      // A text box sized by hand keeps that size, as PowerPoint's "Do not autofit".
      return d.mode === 'resize' && el.kind === 'text' ? { ...next, autoFit: false } : next;
    }));
  };

  const cropDraft = useRef<[number, number, number, number] | null>(null);
  /** The crop that keeps the picture where it is when its box becomes `r`. */
  const cropFor = (el: SlideElement, r: Box): [number, number, number, number] => {
    const [l, t, rr, b] = el.crop ?? [0, 0, 0, 0];
    const W = el.w / Math.max(0.01, 1 - l - rr), H = el.h / Math.max(0.01, 1 - t - b);
    const X0 = el.x - l * W, Y0 = el.y - t * H;
    const c = (v: number) => Math.max(0, Math.min(0.95, v));
    return [c((r.x - X0) / W), c((r.y - Y0) / H), c((X0 + W - r.x - r.w) / W), c((Y0 + H - r.y - r.h) / H)];
  };
  const finishFreeform = (pts: [number, number][], closed: boolean) => {
    setFreePts(null);
    setHoverPt(null);
    const el = makeFreeform(pts, closed, defaultShape, tool?.kind === 'freeform' && !!tool.curve);
    if (el) { setElements([...elements, el]); onSelect([el.id]); }
    onToolDone?.();
  };
  /** Custom Path drawn: the object gets (or adds) the 2 s on-click motion along it. */
  const finishMotionPath = (pts: [number, number][], closed: boolean) => {
    setPathPts(null);
    const el = tool?.kind === 'motionPath' ? elOf(tool.id) : undefined;
    const path = el && drawnMotionPath(pts, centreOf(el), closed);
    if (el && path && tool?.kind === 'motionPath') { onChange({ animations: withCustomPath(slide, el.id, path, tool.add) }); onSelect([el.id]); }
    onToolDone?.();
  };
  /** A point of an outline (path units) on the slide. */
  const pathToSlide = (el: SlideElement, p: [number, number]): [number, number] =>
    toSlide(el, (p[0] * el.w) / Math.max(0.01, el.pathW ?? el.w), (p[1] * el.h) / Math.max(0.01, el.pathH ?? el.h));
  /** The Bézier handles around the anchor ending segment `seg`. */
  const handlesOf = (segs: Seg[], seg: number): { seg: number; which: 0 | 1; p: [number, number]; anchor: [number, number] }[] => {
    const s = segs[seg];
    if (!s || s.cmd === 'Z') return [];
    const anchor = s.pts[s.pts.length - 1];
    const out: { seg: number; which: 0 | 1; p: [number, number]; anchor: [number, number] }[] = [];
    if (s.cmd === 'C') out.push({ seg, which: 1, p: s.pts[1], anchor });
    const n = segs[seg + 1];
    if (n?.cmd === 'C') out.push({ seg: seg + 1, which: 0, p: n.pts[0], anchor });
    return out;
  };
  const applyPoints = (el: SlideElement, segs: Seg[]) => setElements(elements.map((e) => (e.id === el.id ? refitPath(e, writePath(segs)) : e)));
  /** An edited outline re-fitted to its box (points dragged past the edge grow the box). */
  const refitPath = (el: SlideElement, path: string): SlideElement => {
    const segs = parsePath(path);
    const b = pathBounds(segs);
    const sx = el.w / Math.max(0.01, el.pathW ?? el.w), sy = el.h / Math.max(0.01, el.pathH ?? el.h);
    return { ...el, path: writePath(shiftPath(segs, -b.x, -b.y)), pathW: b.w, pathH: b.h, x: Math.round(el.x + b.x * sx), y: Math.round(el.y + b.y * sy), w: Math.max(1, Math.round(b.w * sx)), h: Math.max(1, Math.round(b.h * sy)) };
  };

  // ── Keyboard and clipboard ──────────────────────────────────────────────────────────────────
  const onKeyDown = (e: RKeyboardEvent) => {
    if (editing) return;
    // Esc during a point or handle drag in Edit Points puts it back as it was.
    const dr = drag.current;
    if (e.key === 'Escape' && (dr?.mode === 'point' || dr?.mode === 'ctrl')) { drag.current = null; setPointPreview(null); e.preventDefault(); e.stopPropagation(); return; }
    // Enter or Esc ends a freeform or curve (open), as a double-click does.
    if ((e.key === 'Escape' || e.key === 'Enter') && tool?.kind === 'freeform' && freePts) { finishFreeform(freePts, false); e.preventDefault(); e.stopPropagation(); return; }
    if (tool?.kind === 'motionPath' && (e.key === 'Enter' || e.key === 'Escape')) {
      // Enter ends the path, Esc drops it.
      if (e.key === 'Enter' && pathPts) finishMotionPath(pathPts, false);
      else { setPathPts(null); onToolDone?.(); }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if ((e.key === 'Enter' || e.key === 'Escape') && (tool?.kind === 'crop' || tool?.kind === 'points')) { onToolDone?.(); e.preventDefault(); e.stopPropagation(); return; }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    // Select All leaves hidden and locked objects out (DeckCraft's edit.selectAll).
    if (mod && key === 'a' && !e.shiftKey) { onSelect(selectAllIds(elements)); return handled(); }
    // Tab / Shift+Tab: the next / previous object, a group once; from nothing, the first / last.
    if (key === 'tab' && !mod) { const next = cycleSelection(elements, sel, !e.shiftKey); if (next) onSelect([next]); return handled(); }
    if (!sel.length) {
      if (key === 'escape' && tool) { onToolDone?.(); return handled(); }
      return;
    }
    if (mod && key === 'g' && !e.shiftKey) { setElements(groupSelection(elements, sel)); return handled(); }
    if (mod && key === 'g' && e.shiftKey) { setElements(ungroupSelection(elements, sel)); return handled(); }
    if (mod && key === 'd') {
      // Duplicating the last copies again repeats how far they were moved (DeckCraft #966).
      const r = duplicateSelection(elements, sel, duplicateOffset(elements, sel, lastDup.current));
      lastDup.current = { pairs: r.pairs };
      setElements(r.elements); onSelect(r.ids); return handled();
    }
    if (mod && e.shiftKey && (e.key === '}' || e.key === ']')) { setElements(orderSelection(elements, sel, 'front')); return handled(); }
    if (mod && e.shiftKey && (e.key === '{' || e.key === '[')) { setElements(orderSelection(elements, sel, 'back')); return handled(); }
    if (mod && !e.shiftKey && e.key === ']') { setElements(orderSelection(elements, sel, 'forward')); return handled(); }
    if (mod && !e.shiftKey && e.key === '[') { setElements(orderSelection(elements, sel, 'backward')); return handled(); }
    // Arrows: 6 pt; Ctrl or Alt: 1 pt; Shift: a big step. Locked objects stay.
    const step = mod || e.altKey ? FINE_NUDGE : e.shiftKey ? 30 : NUDGE;
    const nudge = ({ arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] } as Record<string, number[]>)[key];
    if (nudge) { setElements(nudgeSelection(elements, sel, nudge[0], nudge[1])); return handled(); }
    if (key === 'delete' || key === 'backspace') {
      if (onLockedDelete) onLockedDelete();
      else { onChange(deleteSelection(slide, sel)); onSelect([]); }
      return handled();
    }
    if (key === 'enter' || key === 'f2') { if (sel.length === 1) startEditing(sel[0]); return handled(); }
    if (key === 'escape') { onSelect([]); return handled(); }
  };
  const onCopy = (e: RClipboardEvent, cut = false) => {
    if (editing || !sel.length) return;
    const chosen = elements.filter((el) => sel.includes(el.id));
    copyObjectsToClipboard(chosen, e.clipboardData);
    e.preventDefault();
    e.stopPropagation();
    if (cut) { if (onLockedDelete) onLockedDelete(); else { onChange(deleteSelection(slide, sel)); onSelect([]); } }
  };
  // The objects on the slide when an (asynchronous) paste finishes.
  const elsRef = useRef(elements);
  elsRef.current = elements;
  const onPaste = (e: RClipboardEvent) => {
    if (editing || readOnly) return;
    const src = sourceOf(e.clipboardData);
    if (!src.custom && !src.html && !src.text && !src.images.length && !desktop?.readOfficeClipboard) return;
    e.preventDefault();
    e.stopPropagation();
    void clipboardToElements(src, elements).then((r) => {
      if (!r) return;
      r.media.forEach((m) => onAddMedia?.(m));
      setElements([...elsRef.current, ...r.elements]);
      onSelect(r.elements.map((c) => c.id));
    }).catch(() => undefined);
  };

  // ── Drawing the editor chrome ───────────────────────────────────────────────────────────────
  const at = (b: Box, rot = 0): CSSProperties => ({ left: b.x * k, top: b.y * k, width: b.w * k, height: b.h * k, transform: rot ? `rotate(${rot}deg)` : undefined });
  if (readOnly || isPdfSlide(slide)) return <div className="ce-root" ref={ref} tabIndex={0} aria-label={readOnly ? '보호된 자료 미리보기' : 'PDF 읽기 전용 미리보기'}>
    <SlideCanvas slide={slide} theme={baseTheme} background={background} bgEffect={bgEffect} />
  </div>;

  const single = units.length === 1 ? units[0] : null;
  const singleEl = single && single.members.length === 1 ? shownEl(elOf(single.members[0])!) : null;
  const frame: { box: Box; rot: number } | null = singleEl
    ? { box: { x: singleEl.x, y: singleEl.y, w: singleEl.w, h: singleEl.h }, rot: singleEl.rotation ?? 0 }
    : single ? (() => { const b = boundsOf(single.members.map((id) => boxOf(shownEl(elOf(id)!)))); return b ? { box: b, rot: 0 } : null; })() : null;
  /** A locked object (or a group holding one) shows its frame but no handles. */
  const frameLocked = !!single && movableIds(elements, single.members).length !== single.members.length;
  /** A line shows its two end handles instead of a frame. */
  const lineEl = singleEl && isLineShape(singleEl) ? singleEl : null;
  const adjustHandles = singleEl && singleEl.kind === 'shape' && !editing && !frameLocked && !lineEl ? geometryOf(singleEl)?.handles ?? [] : [];
  const editEl = editing && editing !== SLIDE_TEXT ? elOf(editing) : null;

  const editor = (() => {
    if (!editing) return null;
    if (editing === SLIDE_TEXT) {
      const own = slideLineRuns(slide);
      const lines: TextRun[][] = slide.text.split('\n').map((t, i) => own[i] ?? (t ? [{ text: t }] : []));
      return (
        <div className="ce-edit-layer" style={{ transform: `scale(${k})` }}>
          <div className="ce-edit-box" style={{ left: textBox.x, top: textBox.y, width: textBox.w, minHeight: textBox.h, justifyContent: theme.vAlign === 'top' ? 'flex-start' : theme.vAlign === 'bottom' ? 'flex-end' : 'center' }}>
            <RichTextEditor key={`${identity}:slide`} lines={lines} lang={slide.lang} noProof={slide.noProof} base={{ fontSize: theme.fontSize, bold: theme.fontWeight >= 700, italic: !!theme.italic, color: theme.color, fontFamily: theme.fontFamily }}
              style={{ fontFamily: theme.fontFamily, fontSize: theme.fontSize, fontWeight: theme.fontWeight, color: theme.color, textAlign: theme.align, lineHeight: theme.lineHeight }}
              onChange={(l) => typed(SLIDE_TEXT, l)} onDone={stopEditing} />
          </div>
        </div>
      );
    }
    if (!editEl) return null;
    const runs = lineRuns(editEl);
    const texts = editEl.paragraphs ? editEl.paragraphs.map((p) => p.text) : (editEl.text ?? '').split('\n');
    const lines: TextRun[][] = texts.map((t, i) => runs[i] ?? (t ? [{ text: t, ...(editEl.paragraphs?.[i] ? { fontSize: editEl.paragraphs[i].fontSize, bold: editEl.paragraphs[i].bold, italic: editEl.paragraphs[i].italic, color: editEl.paragraphs[i].color } : {}) }] : []));
    const base = { fontSize: editEl.fontSize ?? (editEl.kind === 'shape' ? 40 : 64), bold: !!editEl.bold, italic: !!editEl.italic, color: editEl.color ?? '#ffffff', fontFamily: editEl.fontFamily, underline: editEl.underline || undefined, strike: editEl.strike || undefined, highlight: editEl.highlight };
    let area: Box = { x: editEl.x, y: editEl.y, w: editEl.w, h: editEl.h };
    if (editEl.kind === 'shape') {
      const tr = geometryOf(editEl)?.textRect;
      if (tr) area = { x: editEl.x + tr[0], y: editEl.y + tr[1], w: tr[2], h: tr[3] };
    }
    const textStyle = editEl.kind === 'text' ? elementTextStyle(editEl) : { fontSize: base.fontSize, fontFamily: editEl.fontFamily, lineHeight: editEl.lineHeight ?? 1.2, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const };
    const { display: _d, flexDirection: _f, ...rest } = textStyle;
    return (
      <div className="ce-edit-layer" style={{ transform: `scale(${k})` }}>
        <div className="ce-edit-box" style={{
          left: area.x, top: area.y, width: area.w, minHeight: area.h,
          transform: editEl.rotation ? `rotate(${editEl.rotation}deg)` : undefined, transformOrigin: `${editEl.x + editEl.w / 2 - area.x}px ${editEl.y + editEl.h / 2 - area.y}px`,
          justifyContent: editEl.vAlign === 'top' ? 'flex-start' : editEl.vAlign === 'bottom' ? 'flex-end' : 'center',
        }}>
          <RichTextEditor key={`${identity}:${editEl.id}`} lines={lines} base={base} lang={editEl.lang} noProof={editEl.noProof}
            style={{ ...rest, tabSize: `${editEl.defaultTab ?? 144}px`, color: base.color, fontWeight: base.bold ? 800 : editEl.paragraphs ? 400 : 500, fontStyle: base.italic ? 'italic' : undefined, textAlign: editEl.align ?? 'center', textDecoration: editEl.underline ? 'underline' : undefined, textShadow: editEl.shadow ? '0 3px 12px rgba(0,0,0,.8)' : undefined }}
            onChange={(l) => typed(editEl.id, l)} onDone={stopEditing} />
        </div>
      </div>
    );
  })();

  return (
    <div className={`ce-root ${tool ? `tool-${tool.kind}` : ''}`} ref={ref} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onRootDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenuCapture={(e) => { if (tool?.kind === 'points') { e.preventDefault(); e.stopPropagation(); } }}
      onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={onPaste} onDoubleClick={(e) => {
        const [x, y] = pointer(e);
        if (tool?.kind === 'freeform' && freePts) { finishFreeform(freePts, false); return; }
        if (tool?.kind === 'motionPath') { if (pathPts) finishMotionPath(pathPts, false); return; }
        const hit = hitBox(pickable.map(boxOf), x, y, 3);
        const ph = hit ? elOf(hit) : undefined;
        if (ph?.placeholder === 'picture' && pickPicture) {
          // A layout's picture placeholder becomes the chosen picture, in its place.
          void pickPicture().then((mediaId) => {
            if (!mediaId) return;
            setElements(latestEls.current.map((x2) => (x2.id === ph.id ? { id: x2.id, kind: 'image', mediaId, fit: 'cover', x: x2.x, y: x2.y, w: x2.w, h: x2.h, name: '그림' } : x2)));
          });
          return;
        }
        if (hit) startEditing(hit);
      }}>
      <SlideCanvas slide={shown} theme={baseTheme} background={background} bgEffect={bgEffect} />
      <div className="ce-overlay">
        {view?.grid && <div className="ce-grid" style={{ backgroundSize: `${30 * k}px ${30 * k}px` }} />}
        {view?.guides && <><div className="ce-guide ce-guide-v ce-fixed" style={{ left: (CANVAS_W / 2) * k }} /><div className="ce-guide ce-guide-h ce-fixed" style={{ top: (CANVAS_H / 2) * k }} /></>}
        {hasSlideText && !editing && <div className={`ce-box slide-text ${selected.includes(SLIDE_TEXT) ? 'on' : ''}`} style={at(textBox)} />}
        {visible.map((raw) => {
          const el = shownEl(raw);
          const on = sel.includes(el.id);
          return <div key={el.id} className={`ce-outline ${on ? 'on' : ''} ${on && units.length > 1 ? 'multi' : ''} ${editing === el.id ? 'editing' : ''}`} style={at(el, el.rotation)}>
            {badges?.[el.id] && <span className="ce-badge">{badges[el.id].join(',')}</span>}
          </div>;
        })}
        {frame && !editing && tool?.kind !== 'points' && !lineEl && (
          <div className={`ce-frame ${single && single.members.length > 1 ? 'group' : ''} ${tool?.kind === 'crop' && singleEl?.id === tool.id ? 'crop' : ''} ${frameLocked ? 'locked' : ''}`} style={at(frame.box, frame.rot)} title={frameLocked ? '잠긴 개체 (선택 창에서 잠금 해제)' : undefined}>
            {!frameLocked && HANDLES.map((h) => (
              <span key={h} className={`ce-h ce-h-${h}`} style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: CURSOR[h] }} onPointerDown={(e) => startHandle(e, h)} />
            ))}
            {!frameLocked && <span className="ce-rot" title="회전 (Shift: 15°씩)" onPointerDown={startRotate} />}
          </div>
        )}
        {lineEl && !editing && !frameLocked && lineEnds({ ...lineEl, rot: lineEl.rotation }).map((p, i) => (
          <span key={i} className="ce-h ce-line-end" title="끝점 끌기 (Shift: 45°씩, 연결점에 붙음)" style={{ left: p[0] * k, top: p[1] * k }} onPointerDown={(e) => startLineEnd(e, lineEl.id, i as 0 | 1)} />
        ))}
        {sites && sites.pts.map((p, i) => <span key={`site${i}`} className={`ce-site ${sites.glue && sites.glue[0] === p[0] && sites.glue[1] === p[1] ? 'on' : ''}`} style={{ left: p[0] * k, top: p[1] * k }} />)}
        {singleEl && adjustHandles.map((h) => {
          const [sx, sy] = toSlide(singleEl, h.x, h.y);
          return <span key={h.index} className="ce-adj" title="모양 조정" style={{ left: sx * k, top: sy * k }} onPointerDown={(e) => startAdjust(e, singleEl.id, h.index)} />;
        })}
        {guides.v.map((x) => <div key={`v${x}`} className="ce-guide ce-guide-v" style={{ left: x * k }} />)}
        {guides.h.map((y) => <div key={`h${y}`} className="ce-guide ce-guide-h" style={{ top: y * k }} />)}
        {band && <div className={`ce-band ${tool?.kind === 'shape' ? 'draw' : ''}`} style={at(band)} />}
        {freePts && tool?.kind === 'freeform' && (() => {
          // The points so far and a rubber band to the pointer; a curve is drawn smooth through them.
          const pts: Pt[] = hoverPt ? [...freePts, hoverPt] : freePts;
          return (
            <svg className="ce-ink" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
              {tool.curve && pts.length > 1
                ? <path d={freeformPath(pts, false, true)} fill="none" stroke="#0078d4" strokeWidth={3} strokeDasharray="8 5" />
                : <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#0078d4" strokeWidth={3} strokeDasharray="8 5" />}
            </svg>
          );
        })()}
        {!pathPts && pathOverlays.map((o) => <MotionPathMarks key={o.id} points={o.points} closed={o.closed} k={k} />)}
        {pathPts && tool?.kind === 'motionPath' && <MotionPathMarks points={pathPts} closed={false} k={k} drawing />}
        {inkPath && tool?.kind === 'freeform' && tool.scribble && (
          <svg className="ce-ink" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
            <polyline points={inkPath.map((p) => p.join(',')).join(' ')} fill="none" stroke="#0078d4" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {tool?.kind === 'points' && (() => {
          const el = elOf(tool.id);
          if (!el?.path) return null;
          const shownPath = pointPreview?.id === el.id ? pointPreview.path : el.path;
          const live = { ...el, path: shownPath };
          const segs = parsePath(shownPath);
          const hs = ptSel == null ? [] : handlesOf(segs, ptSel);
          return (
            <>
              {hs.length > 0 && (
                <svg className="ce-handles-svg" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
                  {hs.map((h) => { const [ax, ay] = pathToSlide(live, h.anchor), [hx, hy] = pathToSlide(live, h.p); return <line key={`${h.seg}-${h.which}`} x1={ax} y1={ay} x2={hx} y2={hy} stroke="#0078d4" strokeWidth={1.5 / k} />; })}
                </svg>
              )}
              {hs.map((h) => { const [hx, hy] = pathToSlide(live, h.p); return <span key={`h${h.seg}-${h.which}`} className="ce-point ctrl" style={{ left: hx * k, top: hy * k }} />; })}
              {anchors(segs).map((a) => { const [px, py] = pathToSlide(live, a.p); return <span key={a.seg} className={`ce-point ${ptSel === a.seg ? 'on' : ''}`} style={{ left: px * k, top: py * k }} />; })}
              {ptMenu && (
                <div className="ce-point-menu" style={{ left: ptMenu.x * k, top: ptMenu.y * k }} onPointerDown={(ev) => ev.stopPropagation()}>
                  {(ptMenu.onSegment
                    ? [['점 추가', () => insertPoint(segs, ptMenu.seg, 0.5)], ['세그먼트 삭제', () => deleteSegment(segs, ptMenu.seg)], ['직선 세그먼트', () => setSegmentType(segs, ptMenu.seg, 'line')], ['곡선 세그먼트', () => setSegmentType(segs, ptMenu.seg, 'curve')], ['경로 열기', () => openPath(segs, ptMenu.seg)], ['경로 닫기', () => closePath(segs, ptMenu.seg)]]
                    : [['점 삭제', () => deletePoint(segs, ptMenu.seg)], ['부드러운 점', () => setPointType(segs, ptMenu.seg, 'smooth')], ['직선 점', () => setPointType(segs, ptMenu.seg, 'straight')], ['꼭짓점', () => setPointType(segs, ptMenu.seg, 'corner')], ['경로 열기', () => openPath(segs, ptMenu.seg)], ['경로 닫기', () => closePath(segs, ptMenu.seg)]]
                  ).map(([label, fn]) => (
                    <button key={label as string} type="button" onClick={() => { applyPoints(el, (fn as () => Seg[])()); setPtMenu(null); }}>{label as string}</button>
                  ))}
                  <button type="button" onClick={() => { setPtMenu(null); onToolDone?.(); }}>점 편집 끝내기</button>
                </div>
              )}
            </>
          );
        })()}
        {view?.ruler && (() => {
          const box = sel.length === 1 ? elOf(sel[0]) : undefined;
          const textBox = box && (box.kind === 'text' || box.kind === 'shape') ? box : null;
          return <Ruler k={k} el={textBox} onPatch={(patch) => textBox && setElements(elements.map((e) => (e.id === textBox.id ? { ...e, ...patch } : e)))} />;
        })()}
        {tablePreview && (
          <svg className="ce-handles-svg" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
            <line x1={tablePreview.x0} y1={tablePreview.y0} x2={tablePreview.x1} y2={tablePreview.y1} stroke="#0078d4" strokeWidth={2 / k} strokeDasharray={`${6 / k} ${4 / k}`} />
          </svg>
        )}
        {customGuides?.v.map((x, i) => <div key={`cgv${i}`} className="ce-guide ce-guide-v ce-user" style={{ left: x * k }} />)}
        {customGuides?.h.map((y, i) => <div key={`cgh${i}`} className="ce-guide ce-guide-h ce-user" style={{ top: y * k }} />)}
        {inkPath && tool?.kind === 'pen' && (
          <svg className="ce-ink" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
            <polyline points={inkPath.map((p) => p.join(',')).join(' ')} fill="none" stroke={tool.color} strokeWidth={tool.width} strokeOpacity={tool.highlighter ? 0.45 : 1} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {editor}
      </div>
    </div>
  );
}

/** What a new line takes from Set as Default Shape: its outline, not the fill. */
function lineLook(d: Partial<SlideElement>): Partial<SlideElement> {
  const out: Partial<SlideElement> = {};
  for (const k of ['stroke', 'strokeWidth', 'dash', 'arrowStart', 'arrowEnd', 'arrowStartKind', 'arrowEndKind', 'arrowSize', 'dropShadow', 'shadowKind', 'shadowOpts', 'glow', 'glowSize', 'glowAlpha', 'opacity'] as const) {
    if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k];
  }
  return out;
}

/** A motion path on the editing canvas, as PowerPoint draws it: dashed, a green arrowhead where it starts and a red one where it ends. */
function MotionPathMarks({ points, closed, k, drawing }: { points: [number, number][]; closed: boolean; k: number; drawing?: boolean }) {
  const px = 1 / Math.max(0.05, k);
  const tri = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');
  return (
    <svg className="ce-handles-svg ce-motion-path" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
      {closed ? <polygon points={tri(points)} fill="none" stroke="#fff" strokeWidth={3.5 * px} /> : <polyline points={tri(points)} fill="none" stroke="#fff" strokeWidth={3.5 * px} />}
      {closed
        ? <polygon points={tri(points)} fill="none" stroke="#333" strokeWidth={1.5 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
        : <polyline points={tri(points)} fill="none" stroke="#333" strokeWidth={1.5 * px} strokeDasharray={`${6 * px} ${4 * px}`} />}
      <polygon points={tri(pathArrow(points, false, 12 * px))} fill="#2e9e66" stroke="#fff" strokeWidth={px} />
      {!drawing && points.length > 1 && <polygon points={tri(pathArrow(points, true, 12 * px))} fill="#d13438" stroke="#fff" strokeWidth={px} />}
    </svg>
  );
}
