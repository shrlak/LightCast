import type { CSSProperties } from 'react';
import type { SlideElement } from './types';
import { textElementBounds, type TextBounds } from './textBox';
import { INDENT_PX, isVerticalText, elementMarkers, lineHeightCss, softToNewline, writingCss } from './textFormat';
import { fitTextNode } from './boundedTextLayout';
import { uniformTextBoxFont } from './textBoxFonts';
import { lineRuns } from './richText';
import { autoFitMode, resizeToText, scaledText, shrinkScale } from './textFit';

const cache = new Map<string, SlideElement>();
export const clearTextBoxLayoutCache = () => cache.clear();

/** Shared by measurement and drawing, so line wrapping uses the actual loaded font and spacing. */
export function elementTextStyle(el: SlideElement): CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', boxSizing: 'border-box',
    fontSize: el.fontSize ?? 64, fontFamily: el.fontFamily, fontWeight: el.bold ? 800 : el.paragraphs ? 400 : 500,
    fontStyle: el.italic ? 'italic' : undefined, lineHeight: lineHeightCss(el, el.fontSize ?? 64, el.paragraphs ? 1.2 : 1.25),
    letterSpacing: el.letterSpacing || undefined, paddingLeft: el.indent ? el.indent * INDENT_PX : undefined,
    ...(el.columns && el.columns > 1 ? { columnCount: el.columns, columnGap: '1.2em', display: 'block' } : {}),
    ...writingCss(el),
    // Font dialog / WordArt / Format Shape › Text Box.
    ...(el.caps === 'all' ? { textTransform: 'uppercase' } : el.caps === 'small' ? { fontVariant: 'small-caps' } : {}),
    ...(el.textOutline ? { WebkitTextStroke: `${el.textOutline.width}px ${el.textOutline.color}`, paintOrder: 'stroke fill' } : {}),
    ...(el.margins ? { padding: `${el.margins[1]}px ${el.margins[2]}px ${el.margins[3]}px ${el.margins[0]}px` } : {}),
    ...(el.wrap === false ? { whiteSpace: 'pre' } : {}),
    ...(el.firstIndent ? { textIndent: el.firstIndent } : {}),
    ...(el.rtl ? { direction: 'rtl' } : {}),
  };
}
const px = new Set(['fontSize', 'letterSpacing', 'paddingLeft', 'marginTop', 'marginBottom']);
function applyStyle(node: HTMLElement, styles: CSSProperties) {
  for (const [key, value] of Object.entries(styles)) if (value != null) (node.style as unknown as Record<string, string>)[key] = typeof value === 'number' && px.has(key) ? `${value}px` : String(value);
}

function measurementNode(el: SlideElement): HTMLDivElement {
  const node = document.createElement('div');
  applyStyle(node, elementTextStyle(el));
  Object.assign(node.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
    width: isVerticalText(el) ? 'max-content' : `${Math.max(1, el.w)}px`, height: isVerticalText(el) ? `${Math.max(1, el.h)}px` : 'max-content', margin: '0' });
  const lines = el.paragraphs?.map((p) => p.text) ?? (el.text ?? '').split('\n');
  const { markers, levels } = elementMarkers(el), runs = lineRuns(el);
  lines.forEach((text, i) => {
    const line = document.createElement('div'), p = el.paragraphs?.[i];
    if (p) applyStyle(line, { fontSize: p.fontSize ?? el.fontSize ?? 64, fontWeight: p.bold ? 700 : undefined, fontStyle: p.italic ? 'italic' : undefined, minHeight: '1.2em', paddingLeft: levels[i] ? levels[i] * INDENT_PX : undefined, marginTop: p.spaceBefore, marginBottom: p.spaceAfter, lineHeight: p.lineHeight });
    line.style.flexShrink = '0';
    if (markers[i]) { const marker = document.createElement('span'); marker.className = el.list === 'picture' ? 'list-marker list-picture' : 'list-marker'; if (el.list !== 'picture') marker.textContent = markers[i]; line.append(marker); }
    // Runs with their own size or weight take the room they will be drawn in.
    if (runs[i]) for (const r of runs[i]!) {
      const span = document.createElement('span');
      applyStyle(span, { fontSize: r.fontSize, fontWeight: r.bold === undefined ? undefined : r.bold ? 800 : 400, fontStyle: r.italic ? 'italic' : undefined });
      span.textContent = softToNewline(r.text); line.append(span);
    }
    else line.append(document.createTextNode(softToNewline(text) || '\u00a0'));
    node.append(line);
  });
  document.body.append(node);
  return node;
}

/** The size a box's text takes laid out at `width` (null: as wide as its longest line). */
function measureText(el: SlideElement, width: number | null): { w: number; h: number } {
  const node = measurementNode(el);
  try {
    if (width === null) node.style.width = 'max-content';
    return { w: node.offsetWidth, h: Math.max(node.offsetHeight, node.scrollHeight) };
  } finally { node.remove(); }
}

/** PowerPoint's autofit modes (domain/textFit): the box after Resize shape to fit text, or the fontScale of Shrink text on overflow. */
function fitPowerPoint(el: SlideElement): SlideElement {
  if (el.vertical) return el;
  if (autoFitMode(el) === 'resize') {
    const need = el.wrap === false ? measureText(el, null) : measureText(el, el.w);
    const box = resizeToText(el, need);
    return box.w === el.w && box.h === el.h ? el : { ...el, ...box };
  }
  const base: SlideElement = { ...el, fontScale: undefined };
  const scale = shrinkScale((k) => measureText(scaledText(base, k), el.w).h <= el.h + 0.5);
  const next = scale >= 1 ? undefined : scale;
  return Math.abs((next ?? 1) - (el.fontScale ?? 1)) < 0.002 ? el : { ...el, fontScale: next };
}

/** Keep the requested font and grow inside the slide; shrink only when no more space remains. */
export function fitTextElement(el: SlideElement, bounds: TextBounds = textElementBounds(el)): SlideElement {
  if (el.kind !== 'text' || el.autoFit === false || typeof document === 'undefined' || !document.body) return el;
  const key = JSON.stringify([el, bounds]);
  const cached = cache.get(key);
  if (cached) return cached;
  if (autoFitMode(el) !== 'legacy') {
    const fitted = fitPowerPoint(el);
    if (cache.size >= 1000) cache.clear();
    cache.set(key, fitted);
    return fitted;
  }
  const preferred = el.preferredFontSize ?? el.fontSize ?? 64;
  const source = el.preferredFontSize === undefined ? el : uniformTextBoxFont(el, preferred);
  const node = measurementNode(source);
  let next = el;
  try {
    const { box, fontSize } = fitTextNode(node, el, bounds, el.align, el.vAlign);
    const fontChanged = fontSize !== (el.fontSize ?? 64);
    if (fontChanged || el.maximizeFont || Object.entries(box).some(([k, v]) => el[k as 'x' | 'y' | 'w' | 'h'] !== v)) {
      next = { ...(fontChanged ? uniformTextBoxFont(el, fontSize) : el), ...box, maximizeFont: false,
        ...(fontSize < preferred ? { preferredFontSize: preferred } : {}) };
    }
  } finally { node.remove(); }
  if (cache.size >= 1000) cache.clear();
  cache.set(key, next);
  return next;
}
