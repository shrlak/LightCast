import type { HAlign, VAlign } from './types';
import { growTextBox, type TextBounds, type TextBox } from './textBox';
import { maximumFontFromNode } from './maximizeFont';

export interface TextLayout { box: TextBox; fontSize: number; wrap: boolean }

/** Preserve the font, grow vertically then horizontally, and shrink only at the slide limits. */
export function fitTextNode(node: HTMLElement, initial: TextBox, bounds: TextBounds, align: HAlign = 'center', vAlign: VAlign = 'middle', noWrap = false): TextLayout {
  const original = getComputedStyle(node), size = parseFloat(original.fontSize) || 64;
  const clone = node.cloneNode(true) as HTMLElement;
  const base = growTextBox(initial, initial, align, vAlign, bounds);
  Object.assign(clone.style, { fontSize: original.fontSize, fontFamily: original.fontFamily, fontWeight: original.fontWeight,
    fontStyle: original.fontStyle, lineHeight: original.lineHeight, letterSpacing: original.letterSpacing, textTransform: original.textTransform,
    position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none', margin: '0',
    width: `${base.w}px`, height: 'max-content', minHeight: '0', maxHeight: 'none', overflow: 'visible', whiteSpace: noWrap ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere' });
  document.body.append(clone);
  try {
    if (/^(vertical|sideways)/.test(original.writingMode)) {
      clone.style.width = 'max-content'; clone.style.height = `${base.h}px`;
      if (clone.scrollWidth > bounds.w) clone.style.height = `${bounds.h}px`;
      const box = growTextBox(base, { w: clone.scrollWidth, h: clone.clientHeight }, align, vAlign, bounds);
      if (clone.scrollWidth <= box.w && clone.scrollHeight <= box.h) return { box, fontSize: size, wrap: false };
      const full = growTextBox(base, bounds, align, vAlign, bounds);
      return { box: full, fontSize: Math.min(size, maximumFontFromNode(clone, full.w, full.h, size)), wrap: false };
    }
    let w = base.w, wrap = false;
    if (clone.scrollWidth > w) { w = Math.min(bounds.w, clone.scrollWidth); clone.style.width = `${w}px`; }
    if (noWrap && clone.scrollWidth > w) { wrap = true; clone.style.whiteSpace = 'pre-wrap'; }
    // Try the original font in all available height before using additional width.
    if (clone.scrollHeight > bounds.h) { w = bounds.w; clone.style.width = `${w}px`; }
    let box = growTextBox(base, { w, h: clone.scrollHeight }, align, vAlign, bounds);
    if (clone.scrollHeight <= box.h && clone.scrollWidth <= box.w) return { box, fontSize: size, wrap };
    if (noWrap && !wrap) { wrap = true; clone.style.whiteSpace = 'pre-wrap'; }
    box = growTextBox(base, { w: bounds.w, h: bounds.h }, align, vAlign, bounds);
    clone.style.width = `${box.w}px`;
    return { box, fontSize: Math.min(size, maximumFontFromNode(clone, box.w, box.h, size)), wrap };
  } finally { clone.remove(); }
}
