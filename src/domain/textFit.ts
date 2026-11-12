// Format Shape › 텍스트 상자 › 자동 맞춤, as PowerPoint and DeckCraft (format.autofit, fit_text_box,
// the shrink-on-overflow search in deckcraft-text's layout):
//   자동 맞춤 안 함 (false)               — the box stays as it is; text past its edge shows.
//   넘치면 텍스트 크기 조정 ('shrink')     — the box stays; the text is drawn smaller (fontScale, with
//                                           less line spacing) until it fits.
//   도형을 텍스트 크기에 맞춤 ('resize')   — the box's height follows the text (it grows and shrinks,
//                                           its top-left stays); without wrapping its width does too.
// `true` / unset is LightCast's own fit for the worship templates' boxes (grow inside the slide around
// the alignment, shrink the font only at the slide's edges); it is drawn by textBoxLayout as before.
import type { SlideElement, TextRun } from './types';

export type AutoFitMode = 'none' | 'shrink' | 'resize' | 'legacy';

export const autoFitMode = (el: Pick<SlideElement, 'autoFit'>): AutoFitMode =>
  el.autoFit === false ? 'none' : el.autoFit === 'shrink' ? 'shrink' : el.autoFit === 'resize' ? 'resize' : 'legacy';

/** The stored value for a mode chosen in the Format pane / Paragraph dialog. */
export const autoFitValue = (m: Exclude<AutoFitMode, 'legacy'>): SlideElement['autoFit'] => (m === 'none' ? false : m);

/** Smallest box Resize shape to fit text leaves (DeckCraft: 8 pt high, 20 pt wide without wrapping), canvas px. */
export const MIN_FIT_H = 16;
export const MIN_FIT_W = 40;

/** Line spacing reduction that goes with a font scale (DeckCraft: 80 % of the shrink, at most 20 %). */
export const lineReduction = (scale: number) => Math.min(0.2, Math.max(0, (1 - scale) * 0.8));

/**
 * The box as drawn at `scale` (PowerPoint's fontScale): every size and the character spacing times
 * the scale, the line spacing less by `lineReduction`. The stored sizes do not change.
 */
export function scaledText(el: SlideElement, scale: number): SlideElement {
  if (!(scale > 0) || scale >= 1) return el;
  const k = (n: number) => Math.round(n * scale * 100) / 100;
  const runs = (line: TextRun[]) => line.map((r) => (r.fontSize === undefined ? r : { ...r, fontSize: k(r.fontSize) }));
  const lh = el.lineHeight ?? (el.paragraphs ? 1.2 : 1.25);
  return {
    ...el,
    fontSize: k(el.fontSize ?? 64),
    lineHeight: Math.round(lh * (1 - lineReduction(scale)) * 1000) / 1000,
    ...(el.letterSpacing ? { letterSpacing: k(el.letterSpacing) } : {}),
    ...(el.paragraphs ? { paragraphs: el.paragraphs.map((p) => ({ ...p, ...(p.fontSize !== undefined ? { fontSize: k(p.fontSize) } : {}), ...(p.runs ? { runs: runs(p.runs) } : {}) })) } : {}),
    ...(el.runs ? { runs: el.runs.map(runs) } : {}),
  };
}

/** What the canvas draws for a box: shrunk by its fontScale when it shrinks on overflow. */
export const drawnText = (el: SlideElement): SlideElement => (el.autoFit === 'shrink' && el.fontScale && el.fontScale < 1 ? scaledText(el, el.fontScale) : el);

/**
 * DeckCraft's search for Shrink text on overflow: 100 % when the text fits; the smallest scale (10 %,
 * 20 % less line spacing) when even that overflows; otherwise a binary search (12 halvings) for the
 * largest scale that fits. `fits(scale)` lays the text out at that scale.
 */
export function shrinkScale(fits: (scale: number) => boolean): number {
  if (fits(1)) return 1;
  if (!fits(0.1)) return 0.1;
  let lo = 0.1, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 1000) / 1000;
}

/**
 * Resize shape to fit text: the height the text needs (insets included), the top-left kept; a box that
 * does not wrap takes the text's width too.
 */
export function resizeToText(el: Pick<SlideElement, 'x' | 'y' | 'w' | 'h' | 'wrap'>, need: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  // DeckCraft's fit_width adds 1 pt so the last glyph never wraps or clips.
  const w = el.wrap === false ? Math.max(MIN_FIT_W, Math.ceil(need.w) + 2) : el.w;
  return { x: el.x, y: el.y, w, h: Math.max(MIN_FIT_H, Math.ceil(need.h)) };
}

/**
 * Insert › 텍스트 상자, as PowerPoint and DeckCraft's insert.textBox: a click makes a box at that
 * point that grows sideways with the text and does not wrap; a drag makes a box of that width whose
 * text wraps. Either way the height follows the text, the box starts empty with the caret in it,
 * and its text is left-aligned from the top.
 */
export function newTextBox(id: string, at: { x: number; y: number }, drag?: { w: number; h: number }): SlideElement {
  const fontSize = 64;
  const h = Math.round(fontSize * 1.25);
  return {
    id, kind: 'text', text: '', x: Math.round(at.x), y: Math.round(at.y), w: drag ? Math.max(MIN_FIT_W, Math.round(drag.w)) : MIN_FIT_W, h: drag ? Math.max(h, Math.round(drag.h)) : h,
    fontSize, color: '#ffffff', align: 'left', vAlign: 'top', bold: false, autoFit: 'resize', ...(drag ? {} : { wrap: false }),
  };
}

/**
 * A text box sized with its handles. PowerPoint keeps the autofit mode (a 'resize' box's height then
 * follows its text at the new width) and turns wrapping on when the width changed; fonts never scale.
 * LightCast's own fitted boxes keep the size they were given ("Do not autofit"), as before.
 */
export function resizedTextBox(el: SlideElement, box: { x: number; y: number; w: number; h: number }): Partial<SlideElement> {
  if (autoFitMode(el) === 'legacy') return { ...box, autoFit: false };
  const widthChanged = Math.abs(box.w - el.w) > 0.5;
  return { ...box, ...(widthChanged && el.wrap === false ? { wrap: undefined } : {}) };
}
