// 서식 복사 (Format Painter), after DeckCraft's format/painter.rs: picking up an object takes its
// fill, line and effects and the text formatting of its text; picking up selected characters takes
// the character formatting there and the paragraph formatting of its paragraph. Applying it replaces
// the target's formatting outright — what the source does not have is cleared on the target — and
// clears the formatting on parts of the target's text that would otherwise disagree with it.
import type { SlideElement, TextRun } from './types';
import { clearRunFormat, elementLines, normalizeRuns, type RunFormat, withRichLines } from './richText';

/** The look of the object itself: fill, line and effects. */
export const OBJECT_KEYS = [
  'fill', 'stroke', 'strokeWidth', 'dash', 'gradient', 'gradientAngle', 'gradientType', 'fillImage', 'pattern', 'opacity',
  'dropShadow', 'glow', 'glowSize', 'softEdge', 'shadowKind', 'reflection', 'rotate3d', 'bevel', 'arrowStart', 'arrowEnd',
  // Format Shape: line cap / join / compound, fill transparency, multi-stop gradients, 3-D format.
  'cap', 'join', 'compound', 'fillTransparency', 'gradientStops', 'format3d',
] as const;
/** Character formatting of the whole box (runs of their own override it). */
export const TEXT_KEYS = [
  'fontFamily', 'fontSize', 'color', 'bold', 'italic', 'underline', 'strike', 'shadow', 'letterSpacing', 'highlight',
  'caps', 'textOutline', 'textTransparency', 'warp',
] as const;
/** Paragraph formatting. */
export const PARA_KEYS = [
  'align', 'vAlign', 'lineHeight', 'lineExact', 'list', 'indent', 'spaceBefore', 'spaceAfter', 'firstIndent', 'rtl', 'tabStops', 'defaultTab',
] as const;

type Keys<K extends readonly (keyof SlideElement)[]> = Partial<Pick<SlideElement, K[number]>>;
export type ParaFormat = Keys<typeof PARA_KEYS>;
export type TextFormat = Keys<typeof TEXT_KEYS>;
/** What the painter holds: either of the object look / text look, as picked up. */
export interface Painted {
  /** Fill, line and effects (picked from an object, not from selected characters). */
  object?: Keys<typeof OBJECT_KEYS>;
  /** Character formatting: the box's, with its first characters' own on top. */
  text?: TextFormat;
  /** The first run's own formatting that is not a box key (superscript). */
  baseline?: TextRun['baseline'];
  para?: ParaFormat;
}
/** Kept under its old name for the ribbon / canvas tool. */
export type CopiedStyle = Painted;

const pick = <K extends readonly (keyof SlideElement)[]>(el: Partial<SlideElement>, keys: K): Keys<K> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (el[k] !== undefined) out[k] = el[k];
  return out as Keys<K>;
};
const hasText = (el: SlideElement) => el.kind === 'text' || (el.kind === 'shape' && !!el.text);

/** Pick up an object: its look, its text formatting and the paragraph formatting of its first paragraph. */
export function copyFormat(el: SlideElement): Painted {
  const out: Painted = {};
  if (el.kind !== 'text') out.object = pick(el, OBJECT_KEYS);
  if (hasText(el)) {
    const text: TextFormat = pick(el, TEXT_KEYS);
    // The first characters' own formatting is what you see at the start of the text.
    const first = elementLines(el).flat().find((r) => r.text);
    if (first) {
      if (first.fontSize !== undefined) text.fontSize = first.fontSize;
      if (first.bold !== undefined) text.bold = first.bold;
      if (first.italic !== undefined) text.italic = first.italic;
      if (first.underline !== undefined) text.underline = first.underline;
      if (first.strike !== undefined) text.strike = first.strike;
      if (first.color !== undefined) text.color = first.color;
      if (first.fontFamily !== undefined) text.fontFamily = first.fontFamily;
      if (first.highlight !== undefined) text.highlight = first.highlight;
      out.baseline = first.baseline;
    }
    const p0 = el.paragraphs?.[0];
    if (p0) {
      if (p0.fontSize !== undefined) text.fontSize = p0.fontSize;
      if (p0.bold !== undefined) text.bold = p0.bold;
      if (p0.italic !== undefined) text.italic = p0.italic;
      if (p0.color !== undefined) text.color = p0.color;
    }
    out.text = text;
    out.para = { ...pick(el, PARA_KEYS), ...(p0?.align ? { align: p0.align } : {}) };
  }
  return out;
}

const wipe = (el: SlideElement, keys: readonly (keyof SlideElement)[], from: Partial<SlideElement>): SlideElement => {
  const next: Record<string, unknown> = { ...el };
  for (const k of keys) {
    if (from[k] === undefined) delete next[k]; else next[k] = from[k];
  }
  return next as unknown as SlideElement;
};

/** The character formatting the painter sets on selected characters. */
export const runFormatOf = (p: Painted): RunFormat => ({
  fontSize: p.text?.fontSize, bold: p.text?.bold, italic: p.text?.italic, underline: p.text?.underline, strike: p.text?.strike, color: p.text?.color,
  fontFamily: p.text?.fontFamily, highlight: p.text?.highlight, baseline: p.baseline,
});

/** Give an object what was picked up: its look replaced, and its text formatting replaced down to the characters. */
export function applyFormat(el: SlideElement, p: Painted): SlideElement {
  let next = el;
  // A text box keeps its transparent frame: only a picked-up object's look goes onto other objects.
  if (p.object && el.kind !== 'text') next = wipe(next, OBJECT_KEYS, p.object);
  if (p.text && hasText(next)) {
    next = wipe(next, TEXT_KEYS, p.text);
    // Parts of the text with formatting of their own take the painted one (links stay).
    next = clearRunFormat(next, ['fontSize', 'bold', 'italic', 'underline', 'color', 'strike', 'baseline', 'fontFamily', 'highlight']);
    if (p.baseline) next = { ...next, ...formatEvery(next, { baseline: p.baseline }) };
    if (next.paragraphs) next = { ...next, paragraphs: next.paragraphs.map((q) => ({ text: q.text, ...(q.runs ? { runs: q.runs } : {}) })) };
  }
  if (p.para && hasText(next)) next = wipe(next, PARA_KEYS, p.para);
  return next;
}

/** Every character of the box given `patch` (a run formatting) — what the painter does when only a run key has no box key. */
function formatEvery(el: SlideElement, patch: RunFormat): Partial<SlideElement> {
  const lines = elementLines(el).map((l) => normalizeRuns(l.map((r) => ({ ...r, ...patch }))));
  return withRichLines(el, lines);
}

/** The runs of a selection with the painted character formatting: every formatting key replaced (cleared where the source has none), links kept. */
export function paintRuns(r: TextRun, fmt: RunFormat): TextRun {
  const out: TextRun = { text: r.text, ...(r.link ? { link: r.link } : {}) };
  for (const k of Object.keys(fmt) as (keyof RunFormat)[]) if (fmt[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = fmt[k];
  return out;
}

/** Apply to the selected objects (Ctrl+Shift+V with objects selected, or a click with the painter). */
export function paintElements(els: SlideElement[], ids: string[], p: Painted): SlideElement[] {
  return els.map((e) => (ids.includes(e.id) ? applyFormat(e, p) : e));
}

// ── What the painter holds ─────────────────────────────────────────────────────────────────────
// Ctrl+Shift+C picks up, Ctrl+Shift+V puts down; the ribbon button arms the painter for the next
// click or text selection (and for as long as it stays on, when double-clicked).
let held: Painted | null = null;
export const heldFormat = (): Painted | null => held;
export const holdFormat = (p: Painted | null) => { held = p; };

let armed: { sticky: boolean; disarm: () => void } | null = null;
export const armedPainter = () => armed;
export const armPainter = (sticky: boolean, disarm: () => void) => { armed = { sticky, disarm }; };
/** The painter has done its job (or was cancelled): off unless it was left on. */
export function finishPainter(force = false) {
  if (!armed) return;
  if (force || !armed.sticky) { const a = armed; armed = null; a.disarm(); }
}

/** The text part of a picked-up format, for characters inside a box (not the object look). */
export const textPart = (p: Painted): Painted => ({ text: p.text, baseline: p.baseline, para: p.para });
