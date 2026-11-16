import type { Presentation, Slide, SlideElement } from './types';
import { CANVAS_W } from './canvas';
import { correctMixedTextSizes, uniformTextBoxFont } from './textBoxFonts';
import { isFrontPresentation, isFrontSlide, keepFrontLayout, withoutPrayerCornerLogo } from './frontLayout';
import { withQrElements } from './qrElements';
import { layoutAnnouncementTitle } from './announcementTitle';

/** Earlier versions kept text boxes out of a 300 px strip for the QR codes on the right. */
const OLD_QR_EDGE = CANVAS_W - 300;
/** Where the church's 광고 template puts its text: 77 px in from the left, 1287 px wide. */
const TEMPLATE_X = 77;
const TEMPLATE_W = 1287;

/**
 * A box pushed flat against the left edge by that strip (and saved so by the editor) goes back to
 * the template's place; the QR codes now sit on top of it.
 */
function unpushedFromQr(s: Slide, e: SlideElement): SlideElement {
  if (!s.qr?.length || e.kind !== 'text' || e.x > 0.5 || Math.abs(e.x + e.w - OLD_QR_EDGE) > 0.5) return e;
  return { ...e, x: TEMPLATE_X, w: TEMPLATE_W };
}

/** 광고 slides keep their text this far from the left edge, and the "광고 / Announcements" heading this far from the top. */
export const ANNOUNCEMENT_LEFT = 120;
export const ANNOUNCEMENT_TOP = 100;
const HEADING = /^\s*광고\s*\n\s*announcements?\b/i;
/** Where the template (and earlier versions) left a box: tight against the left edge. */
const inCorner = (e: SlideElement) => e.kind === 'text' && e.x >= 50 && e.x < ANNOUNCEMENT_LEFT;

/** The right edge of the template's 광고 boxes. */
const TEMPLATE_RIGHT = TEMPLATE_X + TEMPLATE_W;

/**
 * The "광고 / Announcements" heading as a fixed box at ANNOUNCEMENT_LEFT / ANNOUNCEMENT_TOP. The
 * template's heading box ends in three empty paragraphs (20-25 pt): left to grow, the box took them
 * for overflow, filled the space above the title and so went back up into the corner (and across
 * the whole slide). Without them, and fixed in place, it stays where it is put.
 */
function placedHeading(original: SlideElement): SlideElement {
  // A size the growing box shrank the heading to goes back to the one it asked for.
  const e = original.preferredFontSize ? uniformTextBoxFont(original, original.preferredFontSize) : original;
  let paragraphs = e.paragraphs;
  while (paragraphs && paragraphs.length > 1 && !paragraphs[paragraphs.length - 1].text.trim()) paragraphs = paragraphs.slice(0, -1);
  const text = (paragraphs ? paragraphs.map((p) => p.text).join('\n') : e.text ?? '').replace(/\s+$/, '');
  const lineHeight = e.lineHeight ?? 1.2;
  const sizes = paragraphs?.map((p) => p.fontSize ?? e.fontSize ?? 40) ?? text.split('\n').map(() => e.fontSize ?? 40);
  const h = Math.ceil(sizes.reduce((sum, size) => sum + size * lineHeight, 0)) + 8;
  const next: SlideElement = { ...e, text, ...(paragraphs ? { paragraphs } : {}), x: ANNOUNCEMENT_LEFT, y: ANNOUNCEMENT_TOP,
    w: TEMPLATE_RIGHT - ANNOUNCEMENT_LEFT, h, autoFit: false, preferredFontSize: undefined };
  const same = e === original && (['text', 'x', 'y', 'w', 'h', 'autoFit'] as const).every((k) => next[k] === e[k]) && next.paragraphs === e.paragraphs && e.preferredFontSize === undefined;
  return same ? original : next;
}

/**
 * The church template's 광고 slide has its "광고 / Announcements" heading tucked into the top-left
 * corner. The heading moves in from the corner as a fixed box (see placedHeading), and the boxes
 * under it that start at the template's left edge ("1. <제목>", the text) move in with it so
 * everything stays lined up; their right edges stay put. A heading placed elsewhere by hand (away
 * from the top-left) and boxes placed elsewhere are left alone.
 */
function outOfCorner(elements: SlideElement[]): SlideElement[] {
  const heading = elements.find((e) => e.kind === 'text' && e.x < 200 && e.y < 200 && HEADING.test(e.text ?? ''));
  if (!heading) return elements;
  return elements.map((e) => {
    if (e === heading) return placedHeading(e);
    if (!inCorner(e)) return e;
    const dx = ANNOUNCEMENT_LEFT - e.x;
    return { ...e, x: ANNOUNCEMENT_LEFT, w: Math.max(1, e.w - dx) };
  });
}

/**
 * Discard old automatic enlargement requests without changing the saved font or geometry; corner
 * QR codes become objects on the slide.
 */
export function prepareAnnouncementSlide(s: Slide): Slide {
  const placed = s.elements && outOfCorner(s.elements.map((e) => unpushedFromQr(s, e)));
  const elements = placed?.map((e) => e.maximizeFont ? { ...e, maximizeFont: false } : e);
  const ready = s.maximizeFont || elements?.some((e, i) => e !== s.elements![i])
    ? { ...s, maximizeFont: false, ...(elements ? { elements } : {}) } : s;
  // A long "1. <제목>" wraps onto two lines and the text under it moves down (announcementTitle.ts).
  return withQrElements(layoutAnnouncementTitle(ready));
}

/**
 * After an edit: the 광고 slides that changed get their title laid out again (a title typed longer
 * wraps and pushes the text down; shortened, it goes back to one line).
 */
export function relayoutEditedAnnouncements(before: Presentation, after: Presentation): Presentation {
  if (after.protected || after.slides === before.slides) return after;
  const old = new Map(before.slides.map((s) => [s.id, s]));
  const slides = after.slides.map((s) => (old.get(s.id) === s || !s.elements ? s : layoutAnnouncementTitle(s)));
  return slides.some((s, i) => s !== after.slides[i]) ? { ...after, slides } : after;
}

/** Preserve original sizes for ads and imported material; actual overflow is resolved at layout time. */
export function prepareAnnouncementSizing(p: Presentation): Presentation {
  if (p.protected) return p;
  const fixed = p.slides.map((s) => isFrontPresentation(p) || isFrontSlide(s) ? keepFrontLayout(s) : withoutPrayerCornerLogo(s));
  if (fixed.some((s, i) => s !== p.slides[i])) p = { ...p, slides: fixed };
  p = correctMixedTextSizes(p);
  const slides = p.slides.map(prepareAnnouncementSlide);
  return slides.some((s, i) => s !== p.slides[i]) ? { ...p, slides } : p;
}
