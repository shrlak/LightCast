// The "1. <제목>" line of a 광고 slide. A title too long for one line wraps onto a second line (at a
// space where it can, the two lines balanced — elementTextStyle draws role 'announcementTitle' with
// word-break: keep-all and text-wrap: balance), its box grows by that line, and the text box under it
// moves down by as much and gets shorter, so its bottom stays where it was and the two never overlap.
// A title that two lines still cannot hold is drawn smaller, down to ANNOUNCEMENT_TITLE_MIN_SCALE of
// its size (the church template's 28 pt → 22.4 pt); past that it takes the lines it needs. A short
// title leaves the slide exactly as the template has it.
//
// The title is measured as the canvas draws it: with a DOM, laid out by the same text style as the
// renderer (textBoxLayout's measurement node: font, size, weight, letter spacing, line spacing, the
// box's width); without one (node, tests) with per-character width tables.
import type { Slide, SlideElement } from './types';
import { measureTextBox } from './textBoxLayout';
import { uniformTextBoxFont } from './textBoxFonts';
import { tableWidthEm } from './metafile/metrics';

/** The smallest a long title is drawn, as a share of its own size. */
export const ANNOUNCEMENT_TITLE_MIN_SCALE = 0.8;
/** At most this many lines before the title is drawn smaller. */
export const ANNOUNCEMENT_TITLE_LINES = 2;
/** The width given up when measuring, so a font that finishes loading later still fits in the lines counted. */
const WIDTH_SLACK = 0.98;

/** "1. <제목>", as fill.ts writes it into the template's title box. */
const NUMBERED_TITLE = /^\s*\d+\s*\.\s*</;
const HEADING = /^\s*광고\s*\n\s*announcements?\b/i;

/** How many lines the box's text takes at its width. */
export type LineCounter = (el: SlideElement) => number;

const sizeOf = (el: SlideElement) => el.paragraphs?.find((p) => p.text.trim())?.fontSize ?? el.fontSize ?? 64;
const lineHeightOf = (el: SlideElement, size: number) =>
  el.lineExact?.mode === 'exact' ? el.lineExact.px : Math.max(el.lineExact?.px ?? 0, size * (el.lineHeight ?? (el.paragraphs ? 1.2 : 1.25)));
const innerWidth = (el: SlideElement) => Math.max(1, el.w - (el.margins ? el.margins[0] + el.margins[2] : 0) - (el.indent ?? 0) * 40) * WIDTH_SLACK;

/**
 * Lines of `text` in `width` px at `size` px, broken as the canvas breaks a 광고 title (word-break:
 * keep-all — at spaces, Korean words kept whole; a word wider than the line breaks anywhere).
 */
export function tableLines(text: string, width: number, size: number, family: string, bold: boolean, letterSpacing = 0): number {
  const w = (s: string) => tableWidthEm(s, family, bold) * size + [...s].length * letterSpacing;
  let lines = 0;
  for (const para of text.split(/\n|\u000b/)) {
    let used = 0;
    lines++;
    for (const word of para.split(/(?<= )/)) {
      const ww = w(word.trimEnd());
      if (used > 0 && used + ww > width) { lines++; used = 0; }
      if (used === 0 && ww > width) {
        // Broken anywhere: character by character.
        for (const ch of word.trimEnd()) {
          const cw = w(ch);
          if (used > 0 && used + cw > width) { lines++; used = 0; }
          used += cw;
        }
        used += w(word.slice(word.trimEnd().length));
        continue;
      }
      used += w(word);
    }
  }
  return lines;
}

/** The text with one line of the same style, to measure the height of a single line. */
const oneLine = (el: SlideElement): SlideElement => ({
  ...el, text: 'Ag가', runs: undefined,
  paragraphs: el.paragraphs?.slice(0, 1).map((p) => ({ ...p, text: 'Ag가', runs: undefined })),
});

/** Lines as the canvas lays the box out (the DOM), or from the width tables without one. */
export const countLines: LineCounter = (el) => {
  const text = el.paragraphs ? el.paragraphs.map((p) => p.text).join('\n') : el.text ?? '';
  if (typeof document !== 'undefined' && document.body) {
    const narrow = { ...el, w: el.w * WIDTH_SLACK };
    const all = measureTextBox(narrow).h, one = measureTextBox(oneLine(narrow)).h;
    if (one > 0) return Math.max(1, Math.round(all / one));
  }
  const bold = !!(el.paragraphs?.find((p) => p.text.trim())?.bold ?? el.bold);
  return tableLines(text, innerWidth(el), sizeOf(el), el.fontFamily ?? 'Arial', bold, el.letterSpacing ?? 0);
};

const isText = (e: SlideElement) => e.kind === 'text';
const overlapX = (a: SlideElement, b: SlideElement) => a.x < b.x + b.w && a.x + a.w > b.x;

/** The 광고 title box of a slide (marked by an earlier layout, or "1. <…>" under the 광고 heading) and the text box under it. */
export function announcementTitleParts(elements: SlideElement[]): { title: SlideElement; body?: SlideElement } | null {
  let title = elements.find((e) => isText(e) && e.role === 'announcementTitle');
  if (!title) {
    const heading = elements.find((e) => isText(e) && HEADING.test(e.text ?? ''));
    if (!heading) return null;
    title = elements.find((e) => isText(e) && e !== heading && e.y > heading.y && NUMBERED_TITLE.test(e.text ?? '') && !(e.text ?? '').trim().includes('\n'));
  }
  if (!title || title.vertical || title.rotation) return null;
  const t = title;
  const body = elements.filter((e) => isText(e) && e !== t && e.y > t.y && overlapX(e, t)).sort((a, b) => a.y - b.y)[0];
  return { title: t, body };
}

/**
 * Lays out the 광고 title box (see above) and the text box under it. Idempotent; returns the slide
 * itself when nothing changes. A title given its own size or no-autofit in the Format pane, or boxes
 * moved apart by hand, are left as they are.
 */
export function layoutAnnouncementTitle(s: Slide, lines: LineCounter = countLines): Slide {
  const els = s.elements;
  const parts = els && announcementTitleParts(els);
  if (!parts) return s;
  const { title, body } = parts;
  // PowerPoint's own autofit, a lock, or (once laid out) a size of its own set in the Format pane — which
  // turns autofit off — leave the title to the user. A deck read from a file with autofit off is laid
  // out the first time, with LightCast's fit from then on, like the template's boxes.
  if (title.autoFit === 'shrink' || title.autoFit === 'resize' || title.locked || (title.autoFit === false && title.announceBase)) return s;
  // The one-line layout: remembered the first time, from the template's boxes.
  let base = title.announceBase;
  if (!base) {
    const size = title.preferredFontSize ?? sizeOf(title);
    const one = lineHeightOf(title, size);
    // An earlier version's fit may have shrunk the title (keeping the size it asked for) and grown
    // the box for the second line it then took.
    const h = title.preferredFontSize && title.h > one * 1.5 ? Math.ceil(one + 8) : title.h;
    base = { fontSize: size, h, bodyY: body?.y ?? title.y + h };
  } else if (body && body.y !== base.bodyY + (title.h - base.h)) return s;
  if (body && body.y <= title.y) return s;

  const normal = base.fontSize, min = Math.round(normal * ANNOUNCEMENT_TITLE_MIN_SCALE * 2) / 2;
  const at = (size: number): SlideElement => {
    const { preferredFontSize: _p, fontScale: _f, ...rest } = uniformTextBoxFont(title, size);
    return { ...rest, role: 'announcementTitle' };
  };
  let size = normal, count = lines(at(normal));
  if (count > ANNOUNCEMENT_TITLE_LINES) {
    // The largest size (half-pixel steps) at which two lines hold it, not below the minimum.
    let lo = min, hi = normal;
    if (lines(at(min)) > ANNOUNCEMENT_TITLE_LINES) { size = min; count = lines(at(min)); }
    else {
      while (hi - lo > 0.5) {
        const mid = Math.round(((lo + hi) / 2) * 2) / 2;
        if (lines(at(mid)) <= ANNOUNCEMENT_TITLE_LINES) lo = mid; else hi = mid;
      }
      size = lo;
      count = Math.min(ANNOUNCEMENT_TITLE_LINES, lines(at(lo)));
    }
  }
  const extra = count * lineHeightOf(title, size) - lineHeightOf(title, normal);
  const h = Math.max(base.h, Math.ceil(base.h + extra - 0.01));
  const dy = h - base.h;
  const sized = at(size);
  const nextTitle: SlideElement = { ...sized, h, announceBase: base, ...(title.autoFit === false ? { autoFit: true } : {}) };
  const bottom = body ? body.y + body.h : 0;
  const nextBody = body && { ...body, y: base.bodyY + dy, h: Math.max(Math.min(body.h, 120), bottom - (base.bodyY + dy)) };

  const same = (a: SlideElement, b: SlideElement) => JSON.stringify(a) === JSON.stringify(b);
  const titleSame = same(nextTitle, title), bodySame = !body || same(nextBody!, body);
  if (titleSame && bodySame) return s;
  return { ...s, elements: els!.map((e) => (e === title ? (titleSame ? e : nextTitle) : e === body ? (bodySame ? e : nextBody!) : e)) };
}
