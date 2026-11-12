// Turns a slide read by the PPTX renderer (pptxRender.ts, from the shrlak/ppt program) into a
// LightCast slide where every part can be edited: the slide background (colour / background
// picture) becomes the slide's background image (bake.ts), and each picture (logos, photos), each
// filled box and each text box becomes its own object at the same place and size, in the same
// order — so all of it can be moved, resized, restyled or deleted in the slide editor.
//
// LightCast slides are 4:3 like the church decks, so those fill the canvas exactly; a deck of
// another shape (16:9 sermon slides) is centred with black bars.
import type { ElementParagraph, HAlign, Slide, SlideElement, VAlign } from '../types';
import { clearRunFormat } from '../richText';
import type { RenderedPictureShape, RenderedSlide, RenderedTextShape } from '../io/pptxRender';
import { uid } from '../lyrics';
import { CANVAS_H, CANVAS_W } from '../canvas';

const W = CANVAS_W;
const H = CANVAS_H;
const EMU_PER_POINT = 12700;
/** PowerPoint's default text-box insets: 0.1" left/right, 0.05" top/bottom. */
const INSET_X = 91440;
const INSET_Y = 45720;
const KO_FALLBACK = '"Apple SD Gothic Neo", "Malgun Gothic", "Nanum Gothic", sans-serif';

export interface Frame {
  /** Canvas pixels per EMU. */
  k: number;
  x: number;
  y: number;
}

/** Where a slide of this size sits on the 1440×1080 canvas (a 4:3 deck fills it; wider decks get bars above and below). */
export function frameFor(widthEmu: number, heightEmu: number): Frame {
  const k = Math.min(W / widthEmu, H / heightEmu);
  return { k, x: (W - widthEmu * k) / 2, y: (H - heightEmu * k) / 2 };
}

const ALIGN: Record<string, HAlign> = { l: 'left', ctr: 'center', r: 'right' };
const ANCHOR: Record<string, VAlign> = { t: 'top', ctr: 'middle', b: 'bottom' };

const fontStack = (family: string | undefined) => (family ? `"${family}", ${family === 'Arial' ? 'Arimo, ' : family === 'Calibri' ? 'Carlito, ' : ''}${KO_FALLBACK}` : undefined);

/** True when a text box holds no visible text. */
export const isBlankText = (shape: RenderedTextShape) => shape.paragraphs.every((p) => p.runs.every((r) => !r.text.trim()));

/** One text box → a text element (positions in canvas pixels, sizes in canvas pixels). */
export function textElement(shape: RenderedTextShape, f: Frame): SlideElement {
  const px = (pt: number | undefined) => Math.round((pt ?? 18) * EMU_PER_POINT * f.k * 10) / 10;
  const paragraphs: ElementParagraph[] = shape.paragraphs.map((p) => {
    const first = p.runs.find((r) => r.text.trim()) ?? p.runs[0];
    return {
      text: p.runs.map((r) => r.text).join(''),
      fontSize: px(first?.sizePt),
      bold: first?.bold || undefined,
      italic: first?.italic || undefined,
      color: first?.color,
      align: p.align ? ALIGN[p.align] : undefined,
    };
  });
  const firstRun = shape.paragraphs.flatMap((p) => p.runs).find((r) => r.text.trim());
  return {
    id: uid('e'),
    kind: 'text',
    x: Math.round(f.x + (shape.xEmu + INSET_X) * f.k),
    y: Math.round(f.y + (shape.yEmu + INSET_Y) * f.k),
    w: Math.round(Math.max(1, shape.wEmu - INSET_X * 2) * f.k),
    h: Math.round(Math.max(1, shape.hEmu - INSET_Y * 2) * f.k),
    text: paragraphs.map((p) => p.text).join('\n'),
    paragraphs,
    fontSize: paragraphs.find((p) => p.text.trim())?.fontSize ?? px(undefined),
    // A run with no typeface of its own uses the deck's theme font — Arial in the church decks.
    fontFamily: fontStack(firstRun?.fontFamily ?? 'Arial'),
    color: firstRun?.color ?? '#000000',
    align: paragraphs.find((p) => p.align)?.align ?? 'left',
    vAlign: shape.anchor ? ANCHOR[shape.anchor] : 'top',
    autoFit: true,
  };
}

/** Key of a picture as stored: the same image with the same crop is stored once. */
export const pictureKey = (p: RenderedPictureShape) => `${p.imageUrl}|${p.crop ? [p.crop.l, p.crop.t, p.crop.r, p.crop.b].join(',') : ''}`;

/**
 * A rendered slide → LightCast slide, given the media id of its baked background and of each
 * picture (by pictureKey). A picture without a media id is left out.
 */
export function slideFromRendered(rs: RenderedSlide, backgroundMediaId: string, group: string, pictures: Map<string, string> = new Map()): Slide {
  const f = frameFor(rs.widthEmu, rs.heightEmu);
  const box = (s: { xEmu: number; yEmu: number; wEmu: number; hEmu: number }) => ({
    x: Math.round(f.x + s.xEmu * f.k), y: Math.round(f.y + s.yEmu * f.k), w: Math.round(s.wEmu * f.k), h: Math.round(s.hEmu * f.k),
  });
  const elements: SlideElement[] = [];
  for (const s of rs.shapes) {
    if (s.kind === 'picture') {
      const mediaId = pictures.get(pictureKey(s));
      if (mediaId) elements.push({ id: uid('e'), kind: 'image', ...box(s), mediaId, fit: 'fill' });
      continue;
    }
    if (s.fill || s.outline) elements.push({ id: uid('e'), kind: 'shape', ...box(s), fill: s.fill ?? 'transparent', stroke: s.outline?.color });
    if (!isBlankText(s)) elements.push(textElement(s, f));
  }
  return {
    id: uid('s'),
    group,
    text: '',
    background: { kind: 'media', mediaId: backgroundMediaId, mediaType: 'image', fit: 'cover' },
    elements,
  };
}

/**
 * New text for an element, keeping each line's formatting: line n takes paragraph n's style,
 * extra lines take the last paragraph's.
 */
export function withElementText(el: SlideElement, text: string): SlideElement {
  if (!el.paragraphs?.length) return { ...el, text };
  const styles = el.paragraphs;
  const paragraphs = text.split('\n').map((line, i) => ({ ...styles[Math.min(i, styles.length - 1)], text: line }));
  return { ...el, text, paragraphs };
}

/** A copy of a template slide (fresh ids) with its texts rewritten by `edit`; null text drops the element. */
export function fillSlide(tpl: Slide, edit: (text: string, el: SlideElement) => string | null, patch: Partial<Slide> = {}): Slide {
  const elements: SlideElement[] = [];
  for (const el of tpl.elements ?? []) {
    if (el.kind !== 'text') {
      elements.push({ ...el, id: uid('e') });
      continue;
    }
    const next = edit(el.text ?? '', el);
    if (next !== null) elements.push({ ...withElementText(el, next), id: uid('e') });
  }
  return { ...tpl, ...patch, id: uid('s'), elements };
}

/** Replace {{TOKEN}}s; a line left empty by a missing value is dropped. */
export function fillTokens(text: string, values: Record<string, string | undefined>): string {
  if (!text.includes('{{')) return text;
  return text
    .split('\n')
    .map((line) => {
      let missing = false;
      const out = line.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
        const v = values[k];
        if (v == null || v === '') missing = true;
        return v ?? '';
      });
      return missing && !out.replace(/[\s:장절]/g, '') ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join('\n');
}

/**
 * Apply an edit from the slide designer to an element that may carry per-line formatting:
 * new text keeps each line's style, a new size applies equally to every line, and a colour / weight /
 * alignment set on the whole box replaces the per-line ones.
 */
export function patchElement(el: SlideElement, patch: Partial<SlideElement>): SlideElement {
  let next: SlideElement = { ...el, ...patch };
  if (patch.fontSize !== undefined) { next.maximizeFont = false; next.preferredFontSize = undefined; }
  // A new text size leaves the box as it is (like PowerPoint's "Do not autofit"): it neither scales
  // with the font nor grows to fit it afterwards. Text bigger than the box shows past its edge.
  const was = el.fontSize ?? el.paragraphs?.find((p) => p.text.trim())?.fontSize;
  // PowerPoint's own autofit modes ('shrink', 'resize') keep fitting the new size.
  if (el.kind === 'text' && (el.autoFit === undefined || el.autoFit === true) && patch.fontSize !== undefined && patch.fontSize !== was && patch.autoFit === undefined) next.autoFit = false;
  // Formatting chosen for the whole box replaces the same formatting on parts of its text.
  const runKeys = (['fontSize', 'bold', 'italic', 'underline', 'color'] as const).filter((k) => k in patch);
  if (runKeys.length) next = clearRunFormat(next, runKeys);
  if (!el.paragraphs) return next;
  if (patch.text !== undefined && patch.paragraphs === undefined) next = withElementText(next, patch.text);
  const whole = (['color', 'bold', 'italic', 'align'] as const).filter((k) => k in patch);
  if (patch.fontSize !== undefined || whole.length) {
    next.paragraphs = next.paragraphs!.map((p) => {
      const q = { ...p, fontSize: patch.fontSize !== undefined ? patch.fontSize : p.fontSize };
      for (const k of whole) delete q[k];
      return q;
    });
  }
  return next;
}
