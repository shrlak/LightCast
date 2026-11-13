// Legacy .ppt → LightCast slides: the parsed PowerPoint records (pptBinary.ts) laid out on the 4:3
// canvas as text boxes and pictures, with the speaker notes. Pure apart from the `store` callback
// that keeps a picture's bytes in the media library.
import type { Slide, SlideElement } from '../types';
import { CANVAS_H, CANVAS_W } from '../canvas';
import { parsePpt, type PptDocument, type PptPicture, type PptShape } from './pptBinary';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/bmp': 'bmp', 'image/tiff': 'tiff' } as const;

/** Where a placeholder with no stored position goes (fractions of the slide). */
const DEFAULT_BOX = {
  title: { x: 0.07, y: 0.05, w: 0.86, h: 0.2 },
  subtitle: { x: 0.14, y: 0.45, w: 0.72, h: 0.3 },
  body: { x: 0.07, y: 0.28, w: 0.86, h: 0.64 },
};

const isTitle = (s: PptShape) => s.textType === 0 || s.textType === 6 || s.placeholder === 1 || s.placeholder === 3;
const isSubtitle = (s: PptShape) => s.placeholder === 4;

export interface PptImportOptions {
  group: string;
  newId: (prefix: string) => string;
  /** Keep a picture; resolves to its media id (null: could not be stored). */
  store: (picture: PptPicture, name: string) => Promise<string | null>;
}
export interface PptImportResult { slides: Slide[]; warnings: string[] }

/** The elements of one slide, for a canvas scale `k` and offset. */
export function shapesToElements(shapes: PptShape[], doc: Pick<PptDocument, 'width' | 'height'>, newId: (p: string) => string, mediaOf: (picture: number) => string | null): SlideElement[] {
  const k = Math.min(CANVAS_W / doc.width, CANVAS_H / doc.height);
  const ox = (CANVAS_W - doc.width * k) / 2, oy = (CANVAS_H - doc.height * k) / 2;
  const out: SlideElement[] = [];
  for (const s of shapes) {
    let box: { x: number; y: number; w: number; h: number };
    if (s.x !== undefined && s.y !== undefined && s.w && s.h) box = { x: ox + s.x * k, y: oy + s.y * k, w: s.w * k, h: s.h * k };
    else {
      const d = isTitle(s) ? DEFAULT_BOX.title : isSubtitle(s) ? DEFAULT_BOX.subtitle : DEFAULT_BOX.body;
      box = { x: d.x * CANVAS_W, y: d.y * CANVAS_H, w: d.w * CANVAS_W, h: d.h * CANVAS_H };
    }
    // Keep it on the canvas: a damaged anchor must not put an object out of reach.
    const x = Math.max(-CANVAS_W, Math.min(CANVAS_W, box.x)), y = Math.max(-CANVAS_H, Math.min(CANVAS_H, box.y));
    const w = Math.max(8, Math.min(CANVAS_W * 2, box.w)), h = Math.max(8, Math.min(CANVAS_H * 2, box.h));
    const rounded = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    if (s.kind === 'picture') {
      const mediaId = s.picture ? mediaOf(s.picture) : null;
      if (mediaId) out.push({ id: newId('e'), kind: 'image', ...rounded, mediaId, fit: 'fill' });
    } else if (s.text) {
      const title = isTitle(s);
      out.push({
        id: newId('e'), kind: 'text', ...rounded, text: s.text,
        // 1 pt = 2 canvas px (a 10 inch slide is 1440 px wide).
        fontSize: title ? 88 : isSubtitle(s) ? 56 : s.textType === 1 || s.placeholder === 2 ? 56 : 40,
        bold: title || undefined, color: '#111111',
        align: title || isSubtitle(s) ? 'center' : 'left', vAlign: title ? 'middle' : 'top', autoFit: 'shrink',
      });
    }
  }
  return out;
}

/** Slides from the bytes of a .ppt. Never throws; `slides` is empty (with a warning) when nothing could be read. */
export async function importPpt(bytes: Uint8Array, name: string, opts: PptImportOptions): Promise<PptImportResult> {
  const doc = parsePpt(bytes);
  const mediaIds = new Map<number, string | null>();
  const pictureIndexes = new Set(doc.slides.flatMap((s) => s.shapes.filter((x) => x.kind === 'picture' && x.picture).map((x) => x.picture!)));
  for (const i of pictureIndexes) {
    const pic = doc.pictures[i - 1];
    mediaIds.set(i, pic ? await opts.store(pic, `${name} 그림 ${i}.${EXT[pic.mime]}`).catch(() => null) : null);
  }
  const slides = doc.slides.map((s, i): Slide => ({
    id: opts.newId('s'),
    group: opts.group,
    text: '',
    background: { kind: 'color', value: '#ffffff' },
    elements: shapesToElements(s.shapes, doc, opts.newId, (n) => mediaIds.get(n) ?? null),
    notes: s.notes,
    importSource: { format: 'ppt', name, page: i + 1 },
  }));
  return { slides, warnings: doc.warnings };
}
