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
import { uid } from '../../domain/lyrics';
import {
  boxOf, cloneElements, deleteSelection, duplicateSelection, expandSelection, groupSelection, inkToShape, makeInk, makeShape, nudgeSelection,
  orderSelection, pasteStyle, selectionUnits, ungroupSelection, type CopiedStyle,
  lineBox, makeFreeform, pathShapeOf, routeConnectors,
} from '../../domain/editOps';
import { anchors, bounds as pathBounds, moveAnchor, parsePath, shiftPath, writePath } from '../../domain/pathEdit';
import { boundsOf, hitBox, marqueeIds, resizeBox, rotateTo, shapeAdjust, shapeSites, snapBox, type EBox, type Handle } from '../../engine';
import { adjOf, geometryOf, isLinePreset, presetOf } from '../EngineElements';
import { RichTextEditor } from '../RichTextEditor';

/** The slide's own text (lyrics, scripture…) drawn by the theme, selectable like an object. */
export const SLIDE_TEXT = '__slide-text';

type Box = { x: number; y: number; w: number; h: number };

/** What a pointer press on the slide does when a ribbon tool is on (Insert › Shapes, Draw). */
export type CanvasTool =
  | { kind: 'shape'; name: string }
  | { kind: 'pen'; color: string; width: number; highlighter?: boolean; toShape?: boolean }
  | { kind: 'eraser' }
  /** 서식 복사: the next object clicked takes this look (kept on with a double-click in the ribbon). */
  | { kind: 'painter'; style: CopiedStyle; keep?: boolean }
  /** Insert › Shapes › Freeform: Shape (click points, close at the start) or Freeform: Scribble (drag). */
  | { kind: 'freeform'; scribble?: boolean }
  /** Picture Format › Crop: the handles cut the picture instead of scaling it. */
  | { kind: 'crop'; id: string }
  /** Shape Format › Edit Shape › Edit Points. */
  | { kind: 'points'; id: string }
  /** Picture Format › Color › Set Transparent Color: the next click on the picture picks the colour. */
  | { kind: 'eyedrop'; id: string; onPick: (fx: number, fy: number) => void };

export interface ViewOptions {
  /** 눈금선: draw the grid and snap to it. */
  grid?: boolean;
  /** 안내선: the slide's centre lines. */
  guides?: boolean;
}

type Drag =
  | { mode: 'move'; ids: string[]; startX: number; startY: number; orig: Map<string, Box>; moved: boolean; copy: boolean; clickedText: string | null }
  | { mode: 'resize'; ids: string[]; handle: Handle; startX: number; startY: number; unit: EBox; orig: Map<string, Box & { rot: number }>; moved: boolean }
  | { mode: 'rotate'; id: string; unit: EBox; moved: boolean }
  | { mode: 'adjust'; id: string; index: number; moved: boolean }
  | { mode: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { mode: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'ink'; points: [number, number][] }
  | { mode: 'point'; id: string; seg: number; startX: number; startY: number; moved: boolean };

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
  /** Show the objects as the slide show would at the start (hidden objects stay hidden). */
  zoom?: number;
}

/** Copied objects, shared by every slide (the PowerPoint clipboard within FreeCast). */
const CLIP_TYPE = 'application/x-freecast-objects';
let clipboard: SlideElement[] = [];
/** Home › Clipboard: copy objects (also as text for other programs). */
export function copyObjects(els: SlideElement[]) {
  clipboard = els.map((e) => ({ ...e }));
  const text = els.map((e) => e.text ?? '').filter(Boolean).join('\n');
  if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
}
export const objectClipboard = () => clipboard;

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const KEEP_ASPECT = new Set(['image', 'icon', 'qr', 'camera', 'video']);

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
export function CanvasEditor({ slide, theme: baseTheme, background, bgEffect, selected, onSelect, onChange, onLockedDelete, readOnly, tool, onToolDone, view, badges, defaultShape, customGuides }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const k = width / CANVAS_W || 1;
  const [session, setSession] = useState<{ slideId: string; id: string } | null>(null);
  const identity = slide.sourceSlideId ?? slide.id;
  const [preview, setPreview] = useState<Map<string, Box & { rot?: number; adj?: number[] }> | null>(null);
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
  /** What a click can pick: not locked (Selection pane) and not the slide master's. */
  const pickable = useMemo(() => visible.filter((e) => !e.locked && !e.master), [visible]);
  const [freePts, setFreePts] = useState<[number, number][] | null>(null);
  const [pointPreview, setPointPreview] = useState<{ id: string; path: string } | null>(null);
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
    return p ? { ...el, x: p.x, y: p.y, w: p.w, h: p.h, ...(p.rot !== undefined ? { rotation: p.rot } : {}), ...(p.adj ? { adj: p.adj } : {}) } : el;
  };
  const setElements = (next: SlideElement[]) => onChange({ elements: next.length ? routeConnectors(next) : undefined });

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

  const onRootDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
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
      const hitPt = el?.path ? anchors(parsePath(el.path)).find((a) => { const [px, py] = pathToSlide(el, a.p); return Math.hypot(px - x, py - y) < 10 / k; }) : undefined;
      if (el && hitPt) { drag.current = { mode: 'point', id: el.id, seg: hitPt.seg, startX: x, startY: y, moved: false }; return; }
      onToolDone?.();
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
    const ids = expandSelection(elements, next.length ? next : [hit]);
    const el = elOf(hit);
    drag.current = {
      mode: 'move', ids, startX: x, startY: y, moved: false, copy: false,
      orig: new Map(ids.map((id) => { const o = elOf(id)!; return [id, { x: o.x, y: o.y, w: o.w, h: o.h }]; })),
      clickedText: already && ids.length === 1 && (el?.kind === 'text' || (el?.kind === 'shape' && !!el.text)) ? hit : el?.kind === 'text' && ids.length === 1 && !el.groupId ? hit : null,
    };
  };

  const startHandle = (e: RPointerEvent, handle: Handle) => {
    e.stopPropagation();
    if (e.button !== 0 || units.length !== 1) return;
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
    if (e.button !== 0 || units.length !== 1 || units[0].members.length !== 1) return;
    focusRoot();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'rotate', id: units[0].members[0], unit: units[0].box, moved: false };
  };
  const startAdjust = (e: RPointerEvent, id: string, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'adjust', id, index, moved: false };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = pointer(e);
    if (d.mode === 'marquee' || d.mode === 'draw') {
      d.x1 = x; d.y1 = y;
      if (d.mode === 'draw' && e.shiftKey) {
        const s = Math.max(Math.abs(x - d.x0), Math.abs(y - d.y0));
        d.x1 = d.x0 + Math.sign(x - d.x0 || 1) * s; d.y1 = d.y0 + Math.sign(y - d.y0 || 1) * s;
      }
      setBand({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
      return;
    }
    if (d.mode === 'ink') {
      d.points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      if (tool?.kind === 'freeform' && !tool.scribble) { if (d.points.length > 2) setFreePts((pts) => [...(pts ?? []), [x, y]]); return; }
      setInkPath([...d.points]);
      return;
    }
    if (d.mode === 'point') {
      const el = elOf(d.id);
      if (!el?.path) return;
      d.moved = true;
      const sx = (el.pathW ?? el.w) / Math.max(1, el.w), sy = (el.pathH ?? el.h) / Math.max(1, el.h);
      setPointPreview({ id: el.id, path: writePath(moveAnchor(parsePath(el.path), d.seg, (x - d.startX) * sx, (y - d.startY) * sy)) });
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
      const keep = e.shiftKey !== (corner && !!one && KEEP_ASPECT.has(one.kind));
      const unit = one ? { ...d.unit, rot: one.rotation ?? 0 } : d.unit;
      const r = resizeBox(unit, d.handle, dx, dy, keep, e.ctrlKey || e.metaKey, 4);
      if (!r) return;
      if (one) {
        setPreview(new Map([[one.id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }]]));
        if (tool?.kind === 'crop' && tool.id === one.id) cropDraft.current = cropFor(one, r);
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
    if (d.mode === 'marquee') {
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      if (r.w < 3 && r.h < 3) return;
      const ids = expandSelection(elements, marqueeIds(pickable.map(boxOf), r));
      onSelect(d.add ? [...new Set([...selected.filter((s) => s !== SLIDE_TEXT), ...ids])] : ids);
      return;
    }
    if (d.mode === 'point') {
      const p = pointPreview;
      setPointPreview(null);
      const el = elOf(d.id);
      if (!p || !el || !d.moved) return;
      setElements(elements.map((e) => (e.id === el.id ? refitPath(e, p.path) : e)));
      return;
    }
    if (d.mode === 'ink' && tool?.kind === 'freeform') {
      setInkPath(null);
      if (tool.scribble) {
        const made = makeInk(d.points, defaultShape?.stroke ?? '#ffffff', defaultShape?.strokeWidth ?? 6, false);
        if (made) { const el: SlideElement = { ...made, kind: 'shape', fill: 'transparent', name: '자유형: 자유 곡선' }; setElements([...elements, el]); onSelect([el.id]); }
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
      const el: SlideElement = { ...base, ...lineBox(d.x0, d.y0, d.x1, d.y1), ...(from || to ? { connect: { from, to } } : {}) };
      setElements([...elements, el]);
      onSelect([el.id]);
      onToolDone?.();
      return;
    }
    if (d.mode === 'draw' && tool?.kind === 'shape') {
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      // A click without a drag puts a default-sized shape there.
      const el = r.w < 6 && r.h < 6 ? (() => { const m = makeShape(tool.name); return { ...m, x: Math.round(d.x0 - m.w / 2), y: Math.round(d.y0 - m.h / 2) }; })() : makeShape(tool.name, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      const styled = el.kind === 'shape' && defaultShape ? { ...el, ...defaultShape } : el;
      setElements([...elements, styled]);
      onSelect([styled.id]);
      onToolDone?.();
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
      } else setElements(elements.map((el) => { const b = p.get(el.id); return b ? { ...el, x: b.x, y: b.y } : el; }));
      return;
    }
    const p = preview;
    setPreview(null);
    if (!p || !('moved' in d) || !d.moved) return;
    setElements(elements.map((el) => {
      const b = p.get(el.id);
      if (!b) return el;
      const cropped = tool?.kind === 'crop' && tool.id === el.id && cropDraft.current ? { crop: cropDraft.current, fit: 'fill' as const } : {};
      const next = { ...el, x: b.x, y: b.y, w: b.w, h: b.h, ...(b.rot !== undefined ? { rotation: b.rot || undefined } : {}), ...(b.adj ? { adj: b.adj } : {}), ...cropped };
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
    const el = makeFreeform(pts, closed, defaultShape);
    if (el) { setElements([...elements, el]); onSelect([el.id]); }
    onToolDone?.();
  };
  /** A point of an outline (path units) on the slide. */
  const pathToSlide = (el: SlideElement, p: [number, number]): [number, number] =>
    toSlide(el, (p[0] * el.w) / Math.max(0.01, el.pathW ?? el.w), (p[1] * el.h) / Math.max(0.01, el.pathH ?? el.h));
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
    if (e.key === 'Escape' && tool?.kind === 'freeform' && freePts) { finishFreeform(freePts, false); e.preventDefault(); e.stopPropagation(); return; }
    if ((e.key === 'Enter' || e.key === 'Escape') && (tool?.kind === 'crop' || tool?.kind === 'points')) { onToolDone?.(); e.preventDefault(); e.stopPropagation(); return; }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (mod && key === 'a' && !e.shiftKey) { onSelect(visible.map((el) => el.id)); return handled(); }
    if (!sel.length) {
      if (key === 'escape' && tool) { onToolDone?.(); return handled(); }
      return;
    }
    if (mod && key === 'g' && !e.shiftKey) { setElements(groupSelection(elements, sel)); return handled(); }
    if (mod && key === 'g' && e.shiftKey) { setElements(ungroupSelection(elements, sel)); return handled(); }
    if (mod && key === 'd') { const r = duplicateSelection(elements, sel); setElements(r.elements); onSelect(r.ids); return handled(); }
    if (mod && e.shiftKey && (e.key === '}' || e.key === ']')) { setElements(orderSelection(elements, sel, 'front')); return handled(); }
    if (mod && e.shiftKey && (e.key === '{' || e.key === '[')) { setElements(orderSelection(elements, sel, 'back')); return handled(); }
    const step = mod ? 1 : e.shiftKey ? 30 : 10;
    const nudge = ({ arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] } as Record<string, number[]>)[key];
    if (nudge) { setElements(nudgeSelection(elements, sel, nudge[0], nudge[1])); return handled(); }
    if (key === 'delete' || key === 'backspace') {
      if (onLockedDelete) onLockedDelete();
      else { onChange(deleteSelection(slide, sel)); onSelect([]); }
      return handled();
    }
    if (key === 'tab') {
      const order = visible.map((el) => el.id);
      const at = order.indexOf(sel[sel.length - 1]);
      const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length];
      if (next) onSelect([next]);
      return handled();
    }
    if (key === 'enter' || key === 'f2') { if (sel.length === 1) startEditing(sel[0]); return handled(); }
    if (key === 'escape') { onSelect([]); return handled(); }
  };
  const onCopy = (e: RClipboardEvent, cut = false) => {
    if (editing || !sel.length) return;
    const chosen = elements.filter((el) => sel.includes(el.id));
    copyObjects(chosen);
    e.clipboardData.setData(CLIP_TYPE, JSON.stringify(chosen));
    e.clipboardData.setData('text/plain', chosen.map((el) => el.text ?? '').filter(Boolean).join('\n'));
    e.preventDefault();
    e.stopPropagation();
    if (cut) { if (onLockedDelete) onLockedDelete(); else { onChange(deleteSelection(slide, sel)); onSelect([]); } }
  };
  const onPaste = (e: RClipboardEvent) => {
    if (editing || readOnly) return;
    const raw = e.clipboardData.getData(CLIP_TYPE);
    let source: SlideElement[] = [];
    try { source = raw ? (JSON.parse(raw) as SlideElement[]) : []; } catch { source = []; }
    if (!source.length && !e.clipboardData.files.length && clipboard.length && !e.clipboardData.getData('text/plain')) source = clipboard;
    if (source.length) {
      // Pasted on the slide they came from, copies are set off a little; elsewhere they keep their place.
      const same = source.some((s) => elements.some((el) => el.id === s.id || (el.x === s.x && el.y === s.y && el.kind === s.kind)));
      const copies = cloneElements(source, same ? 30 : 0);
      setElements([...elements, ...copies]);
      onSelect(copies.map((c) => c.id));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text && !e.clipboardData.files.length) {
      const el: SlideElement = { id: uid('el'), kind: 'text', text, x: 220, y: 340, w: 1000, h: 400, fontSize: 56, color: '#ffffff', align: 'center' };
      setElements([...elements, el]);
      onSelect([el.id]);
      e.preventDefault();
      e.stopPropagation();
    }
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
  const adjustHandles = singleEl && singleEl.kind === 'shape' && !editing ? geometryOf(singleEl)?.handles ?? [] : [];
  const editEl = editing && editing !== SLIDE_TEXT ? elOf(editing) : null;

  const editor = (() => {
    if (!editing) return null;
    if (editing === SLIDE_TEXT) {
      const own = slideLineRuns(slide);
      const lines: TextRun[][] = slide.text.split('\n').map((t, i) => own[i] ?? (t ? [{ text: t }] : []));
      return (
        <div className="ce-edit-layer" style={{ transform: `scale(${k})` }}>
          <div className="ce-edit-box" style={{ left: textBox.x, top: textBox.y, width: textBox.w, minHeight: textBox.h, justifyContent: theme.vAlign === 'top' ? 'flex-start' : theme.vAlign === 'bottom' ? 'flex-end' : 'center' }}>
            <RichTextEditor key={`${identity}:slide`} lines={lines} base={{ fontSize: theme.fontSize, bold: theme.fontWeight >= 700, italic: !!theme.italic, color: theme.color }}
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
    const base = { fontSize: editEl.fontSize ?? (editEl.kind === 'shape' ? 40 : 64), bold: !!editEl.bold, italic: !!editEl.italic, color: editEl.color ?? '#ffffff' };
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
          <RichTextEditor key={`${identity}:${editEl.id}`} lines={lines} base={base}
            style={{ ...rest, color: base.color, fontWeight: base.bold ? 800 : editEl.paragraphs ? 400 : 500, fontStyle: base.italic ? 'italic' : undefined, textAlign: editEl.align ?? 'center', textDecoration: editEl.underline ? 'underline' : undefined, textShadow: editEl.shadow ? '0 3px 12px rgba(0,0,0,.8)' : undefined }}
            onChange={(l) => typed(editEl.id, l)} onDone={stopEditing} />
        </div>
      </div>
    );
  })();

  return (
    <div className={`ce-root ${tool ? `tool-${tool.kind}` : ''}`} ref={ref} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onRootDown} onPointerMove={onMove} onPointerUp={onUp}
      onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={onPaste} onDoubleClick={(e) => {
        const [x, y] = pointer(e);
        if (tool?.kind === 'freeform' && freePts) { finishFreeform(freePts, false); return; }
        const hit = hitBox(pickable.map(boxOf), x, y, 3);
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
        {frame && !editing && (
          <div className={`ce-frame ${single && single.members.length > 1 ? 'group' : ''} ${tool?.kind === 'crop' && singleEl?.id === tool.id ? 'crop' : ''}`} style={at(frame.box, frame.rot)}>
            {HANDLES.map((h) => (
              <span key={h} className={`ce-h ce-h-${h}`} style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: CURSOR[h] }} onPointerDown={(e) => startHandle(e, h)} />
            ))}
            {singleEl && <span className="ce-rot" title="회전 (Shift: 15°씩)" onPointerDown={startRotate} />}
          </div>
        )}
        {singleEl && adjustHandles.map((h) => {
          const [sx, sy] = toSlide(singleEl, h.x, h.y);
          return <span key={h.index} className="ce-adj" title="모양 조정" style={{ left: sx * k, top: sy * k }} onPointerDown={(e) => startAdjust(e, singleEl.id, h.index)} />;
        })}
        {guides.v.map((x) => <div key={`v${x}`} className="ce-guide ce-guide-v" style={{ left: x * k }} />)}
        {guides.h.map((y) => <div key={`h${y}`} className="ce-guide ce-guide-h" style={{ top: y * k }} />)}
        {band && <div className={`ce-band ${tool?.kind === 'shape' ? 'draw' : ''}`} style={at(band)} />}
        {freePts && tool?.kind === 'freeform' && (
          <svg className="ce-ink" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
            <polyline points={freePts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#0078d4" strokeWidth={3} strokeDasharray="8 5" />
          </svg>
        )}
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
          return anchors(parsePath(shownPath)).map((a) => { const [px, py] = pathToSlide(live, a.p); return <span key={a.seg} className="ce-point" style={{ left: px * k, top: py * k }} />; });
        })()}
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
