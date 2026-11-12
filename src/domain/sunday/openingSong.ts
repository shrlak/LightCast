// 기도회 찬양: the one song sung every week before the 기도회 (ahead of the Front / 기도제목 slides).
// The operator types its title; LightCast searches "<제목> ppt" on the internet (server/songPpt.mjs),
// downloads the best-matching PowerPoint, and keeps only its sheet music — the pictures of the score
// and lyrics — drawn on a plain white slide. The PPT's background, decorations, logos and buttons
// are left out.
import type { Presentation, Slide, SlideElement } from '../types';
import type { RenderedPictureShape, RenderedSlide } from '../io/pptxRender';
import { CANVAS_H, CANVAS_W } from '../canvas';
import { uid } from '../lyrics';

export const OPENING_SECTION = '기도회 찬양';
/** Library folder of the downloaded sheet-music decks (kept so the same song is not fetched again). */
export const OPENING_FOLDER = '기도회 찬양 악보';
export const WHITE = { kind: 'color', value: '#ffffff' } as const;

export interface SongPptCandidate {
  name: string;
  url: string;
  page: string;
  format: 'pptx' | 'ppt';
  /** 0–1: how well the file name matches the title. */
  score: number;
}

/** A candidate this sure is taken without asking. */
export const AUTO_PICK = 0.6;

type Crop = { l: number; t: number; r: number; b: number };
interface Box { x: number; y: number; w: number; h: number }

export interface ScorePicture {
  imageUrl: string;
  /** PowerPoint's crop plus whatever of the picture lies outside the slide. */
  crop?: Crop;
  /** The visible part, in slide EMU. */
  box: Box;
}

export interface ScorePage {
  index: number;
  pictures: ScorePicture[];
}

const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);

/** The part of a picture inside the slide, with the crop that shows exactly that part. */
export function visiblePart(p: Pick<RenderedPictureShape, 'imageUrl' | 'crop' | 'xEmu' | 'yEmu' | 'wEmu' | 'hEmu'>, slideW: number, slideH: number): ScorePicture | null {
  if (p.wEmu <= 0 || p.hEmu <= 0) return null;
  const x0 = Math.max(0, p.xEmu), y0 = Math.max(0, p.yEmu);
  const x1 = Math.min(slideW, p.xEmu + p.wEmu), y1 = Math.min(slideH, p.yEmu + p.hEmu);
  if (x1 <= x0 || y1 <= y0) return null;
  const c = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const sx = 1 - c.l - c.r, sy = 1 - c.t - c.b;
  const crop = {
    l: c.l + ((x0 - p.xEmu) / p.wEmu) * sx,
    r: c.r + ((p.xEmu + p.wEmu - x1) / p.wEmu) * sx,
    t: c.t + ((y0 - p.yEmu) / p.hEmu) * sy,
    b: c.b + ((p.yEmu + p.hEmu - y1) / p.hEmu) * sy,
  };
  const none = Object.values(crop).every((v) => Math.abs(v) < 1e-6);
  return { imageUrl: p.imageUrl, crop: none ? undefined : crop, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/**
 * The sheet-music pictures of each slide. Left out: the slide background, a picture repeated on
 * most slides (a background or decoration placed as a picture), a full-slide picture lying under
 * other pictures, and small pictures (logos, arrows, menu buttons). Text boxes are never kept.
 * Slides with nothing left (a text-only title slide) are skipped.
 */
export function scorePages(slides: RenderedSlide[]): ScorePage[] {
  const uses = new Map<string, number>();
  for (const s of slides) {
    for (const url of new Set(s.shapes.flatMap((x) => (x.kind === 'picture' ? [x.imageUrl] : [])))) uses.set(url, (uses.get(url) ?? 0) + 1);
  }
  const repeatedOn = Math.max(2, Math.ceil(slides.length * 0.5));
  const pages: ScorePage[] = [];
  for (const s of slides) {
    const slideArea = s.widthEmu * s.heightEmu;
    const shown = s.shapes
      .filter((x): x is RenderedPictureShape => x.kind === 'picture')
      .filter((x) => x.imageUrl !== s.backgroundImage && (slides.length < 3 || (uses.get(x.imageUrl) ?? 0) < repeatedOn))
      .map((x) => visiblePart(x, s.widthEmu, s.heightEmu))
      .filter((x): x is ScorePicture => !!x && area(x.box) >= slideArea * 0.03);
    // A picture filling the slide with others on top of it is the background.
    const pictures = shown.filter((x, i) => !(i === 0 && shown.length > 1 && area(x.box) >= slideArea * 0.9));
    if (pictures.length) pages.push({ index: s.index, pictures });
  }
  return pages;
}

/** Canvas boxes for a page's pictures: their layout kept, the whole made as large as the 4:3 slide allows. */
export function fitToCanvas(boxes: Box[], margin = 24): Box[] {
  if (!boxes.length) return [];
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const k = Math.min((CANVAS_W - margin * 2) / (x1 - x0), (CANVAS_H - margin * 2) / (y1 - y0));
  const ox = (CANVAS_W - (x1 - x0) * k) / 2, oy = (CANVAS_H - (y1 - y0) * k) / 2;
  return boxes.map((b) => ({ x: Math.round(ox + (b.x - x0) * k), y: Math.round(oy + (b.y - y0) * k), w: Math.round(b.w * k), h: Math.round(b.h * k) }));
}

export type InkFix = 'none' | 'darken' | 'invert';

/**
 * How a picture must change to read on white: light ink on a transparent picture (made for a dark
 * background) is darkened; a grey-scale score printed light-on-dark is inverted. Anything else
 * (black notes, a coloured title, a photo) stays as it is. `px` is RGBA.
 */
export function inkFix(px: Uint8ClampedArray): InkFix {
  const step = Math.max(1, Math.floor(px.length / 4 / 40000)) * 4;
  let n = 0, clear = 0, seen = 0, light = 0, sat = 0;
  for (let i = 0; i < px.length; i += step) {
    n++;
    if (px[i + 3] < 32) {
      clear++;
      continue;
    }
    if (px[i + 3] < 128) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    seen++;
    light += 0.299 * r + 0.587 * g + 0.114 * b;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  if (!seen) return 'none';
  const luma = light / seen, chroma = sat / seen;
  if (clear / n > 0.2) return luma > 200 ? 'darken' : 'none';
  return luma < 70 && chroma < 30 ? 'invert' : 'none';
}

/** Apply an ink fix in place. */
export function applyInkFix(px: Uint8ClampedArray, fix: InkFix): void {
  if (fix === 'none') return;
  for (let i = 0; i < px.length; i += 4) {
    if (fix === 'invert') {
      px[i] = 255 - px[i];
      px[i + 1] = 255 - px[i + 1];
      px[i + 2] = 255 - px[i + 2];
    } else {
      const v = 255 - Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
}

/** The library's sheet-music deck for this title, from an earlier week. */
export function findOpeningDeck(presentations: readonly Presentation[], title: string): Presentation | undefined {
  const key = (s: string) => s.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const want = key(title);
  return want ? presentations.find((p) => p.scoreSheet && key(p.scoreSheet.title) === want && p.slides.length > 0) : undefined;
}

/** One slide per sheet-music page: white, with the pictures (stored as media) placed by fitToCanvas. */
export function scoreSlides(pages: { index: number; mediaIds: string[]; boxes: Box[] }[], group: string, file: { name: string; format: 'pptx' | 'ppt' }): Slide[] {
  return pages.map((p) => {
    const boxes = fitToCanvas(p.boxes);
    const elements: SlideElement[] = p.mediaIds.map((mediaId, i) => ({ id: uid('e'), kind: 'image', ...boxes[i], mediaId, fit: 'fill' }));
    return { id: uid('s'), group, text: '', background: WHITE, elements, importSource: { format: file.format, name: file.name, page: p.index + 1 } };
  });
}

export function openingDeck(title: string, slides: Slide[], file: SongPptCandidate): Presentation {
  return {
    id: uid('p'),
    title: title.trim(),
    slides,
    themeId: 'theme_classic',
    folder: OPENING_FOLDER,
    background: WHITE,
    scoreSheet: { title: title.trim(), file: file.name, page: file.page },
  };
}
