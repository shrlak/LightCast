// Insert › Photo Album (DeckCraft insert.photoAlbum / insert.photoAlbumEdit, crates/engine/src/cmd/insert/album.rs):
// pictures laid out to fit the slide, one, two or four to a slide (with or without a title), every picture
// optionally black & white, each with its own rotation, brightness and contrast, text-box slides between
// the pictures, captions under the pictures and a frame. The album's slides remember it, so Edit Photo
// Album rebuilds them.
import type { PictureAdjust, Slide, SlideElement } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { uid } from './lyrics';

export const ALBUM_MAX_ITEMS = 48;
export const ALBUM_MAX_TEXT = 400;
/** Names an album text-box slide's text object, so Edit Photo Album can find it again. */
export const ALBUM_TEXT_NAME = '앨범 텍스트';

export interface AlbumOptions {
  per: 1 | 2 | 4;
  /** 슬라이드에 맞춤: one picture per slide with the smallest margins. */
  fit?: boolean;
  frame: string;
  titles: boolean;
  captions: boolean;
  /** 모든 그림을 흑백으로. */
  gray?: boolean;
}

export interface AlbumPicture {
  mediaId: string;
  name: string;
  /** The picture's pixel size (its aspect decides the frame's size). */
  w?: number;
  h?: number;
  /** Rotation in degrees (0–359), brightness and contrast (−1…1) — set per picture. */
  rot?: number;
  brightness?: number;
  contrast?: number;
  /** The processed picture to show (black & white, brightness, contrast baked in), made when the album is built. */
  shown?: { mediaId: string; picture: PictureAdjust };
}
export interface AlbumText { text: string }
export type AlbumItem = AlbumPicture | AlbumText;
export const isAlbumText = (i: AlbumItem): i is AlbumText => !('mediaId' in i);

/** Does a picture need its pixels processed (black & white, brightness or contrast)? */
export const needsAdjust = (pic: AlbumPicture, o: Pick<AlbumOptions, 'gray'>): boolean => !!o.gray || Math.abs(pic.brightness ?? 0) > 1e-6 || Math.abs(pic.contrast ?? 0) > 1e-6;
/** The engine's picture steps for an album picture (Picture Format: Recolor › Grayscale, Corrections). */
export const albumAdjust = (pic: AlbumPicture, o: Pick<AlbumOptions, 'gray'>): Partial<PictureAdjust> => ({
  ...(o.gray ? { recolor: 'grayscale' } : {}),
  ...(pic.brightness ? { brightness: pic.brightness } : {}),
  ...(pic.contrast ? { contrast: pic.contrast } : {}),
});
export const clampUnit = (n: number): number => Math.max(-1, Math.min(1, Math.round(n * 10) / 10));
export const rotateBy = (rot: number | undefined, d: number): number => (((((rot ?? 0) + d) % 360) + 360) % 360);

export type AlbumPlan = { kind: 'text'; text: string } | { kind: 'pics'; pics: AlbumPicture[] };

/** Pictures grouped `per` to a slide in order; a text box always gets a slide of its own and ends the group before it. */
export function albumPlan(items: AlbumItem[], per: number): AlbumPlan[] {
  const out: AlbumPlan[] = [];
  let batch: AlbumPicture[] = [];
  for (const it of items) {
    if (isAlbumText(it)) {
      if (batch.length) { out.push({ kind: 'pics', pics: batch }); batch = []; }
      out.push({ kind: 'text', text: it.text });
    } else {
      batch.push(it);
      if (batch.length >= Math.max(1, per)) { out.push({ kind: 'pics', pics: batch }); batch = []; }
    }
  }
  if (batch.length) out.push({ kind: 'pics', pics: batch });
  return out;
}

type Rect = [number, number, number, number];
const GRID = { 1: [1, 1], 2: [2, 1], 4: [2, 2] } as const;

/** DeckCraft place_album, in canvas pixels (its points × 2): the title box and one cell per picture. */
export function placeAlbum(o: Pick<AlbumOptions, 'per' | 'fit' | 'titles' | 'captions'>, n: number): { title: Rect | null; cells: Rect[] } {
  const margin = o.fit ? 36 : 72, band = o.titles ? 96 : 0, gap = 24, capH = 44, capGap = 8;
  const top = margin + band;
  const gw = CANVAS_W - margin * 2, gh = CANVAS_H - margin - top;
  const [cols, rows] = GRID[o.per];
  const cw = (gw - gap * (cols - 1)) / cols, ch = (gh - gap * (rows - 1)) / rows;
  const ph = o.captions ? ch - capH - capGap : ch;
  const cells: Rect[] = [];
  for (let i = 0; i < n && Math.floor(i / cols) < rows; i++) cells.push([margin + (i % cols) * (cw + gap), top + Math.floor(i / cols) * (ch + gap), cw, ph]);
  return { title: o.titles ? [margin, 16, CANVAS_W - margin * 2, 64] : null, cells };
}

/** The largest size of aspect w:h that fits a box (DeckCraft fit_in). */
export function fitIn(bw: number, bh: number, w?: number, h?: number): [number, number] {
  const aspect = w && h ? w / h : 4 / 3;
  return aspect >= bw / bh ? [bw, Math.max(1, bw / aspect)] : [Math.max(1, bh * aspect), bh];
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || '그림';

/** The album's slides. */
export function albumSlides(items: AlbumItem[], o: AlbumOptions, group: string, albumId = uid('al')): Slide[] {
  const mark = { id: albumId, per: o.per, frame: o.frame, titles: o.titles, captions: o.captions, ...(o.fit ? { fit: true } : {}), ...(o.gray ? { gray: true } : {}) };
  const slides: Slide[] = [];
  for (const step of albumPlan(items, o.per)) {
    const els: SlideElement[] = [];
    if (step.kind === 'text') {
      // DeckCraft: a text-box slide holds one text box (under the title band when the layout has titles).
      const box: Rect = o.titles ? [72, 36, CANVAS_W - 144, 96] : [72, 72, CANVAS_W - 144, CANVAS_H - 144];
      els.push({ id: uid('el'), kind: 'text', name: ALBUM_TEXT_NAME, text: step.text, x: box[0], y: box[1], w: box[2], h: box[3], fontSize: o.titles ? 56 : 64, color: '#ffffff', align: 'center', vAlign: 'middle' });
    } else {
      const { title, cells } = placeAlbum(o, step.pics.length);
      step.pics.forEach((pic, k) => {
        const [cx, cy, cw, ch] = cells[k];
        const [dw, dh] = fitIn(cw, ch, pic.w, pic.h);
        const box = { x: cx + (cw - dw) / 2, y: cy + (ch - dh) / 2, w: dw, h: dh };
        const label = stem(pic.name);
        const frame: Partial<SlideElement> = o.frame === 'rect' ? { stroke: '#1a1a1a', strokeWidth: 3 } : o.frame ? { pictureStyle: o.frame } : {};
        els.push({
          id: uid('el'), kind: 'image', mediaId: pic.shown?.mediaId ?? pic.mediaId, fit: pic.w && pic.h ? 'fill' : 'contain', ...box, name: pic.name, alt: label, ...frame,
          ...(pic.shown ? { picture: pic.shown.picture } : {}), ...(pic.rot ? { rotation: pic.rot } : {}),
        });
        if (o.captions) els.push({ id: uid('el'), kind: 'text', text: label, x: box.x, y: box.y + box.h + 8, w: Math.max(72, box.w), h: 44, fontSize: 28, color: '#ffffff', align: 'center' });
      });
      if (title) els.unshift({ id: uid('el'), kind: 'text', text: stem(step.pics[0].name), x: title[0], y: title[1], w: title[2], h: title[3], fontSize: 48, bold: true, color: '#ffffff', align: 'center' });
    }
    slides.push({ id: uid('s'), group, text: '', elements: els, background: { kind: 'color', value: '#000000' }, album: mark });
  }
  return slides;
}

/** An album already in the presentation: its options and items (pictures with their settings, text boxes) in order. */
export function readAlbum(slides: Slide[], albumId: string): { options: AlbumOptions; items: AlbumItem[]; pictures: AlbumPicture[]; at: number } | null {
  const mine = slides.filter((s) => s.album?.id === albumId);
  if (!mine.length) return null;
  const { id: _id, ...options } = mine[0].album!;
  const items: AlbumItem[] = [];
  for (const s of mine) {
    for (const e of s.elements ?? []) {
      if (e.kind === 'image' && e.mediaId) {
        // The original (unprocessed) picture and its settings: rebuilding starts again from it.
        const a = e.picture;
        items.push({ mediaId: a?.original ?? e.mediaId, name: e.name ?? '그림', w: e.w, h: e.h, ...(e.rotation ? { rot: e.rotation } : {}), ...(a?.brightness ? { brightness: a.brightness } : {}), ...(a?.contrast ? { contrast: a.contrast } : {}) });
      } else if (e.kind === 'text' && e.name === ALBUM_TEXT_NAME) items.push({ text: e.text ?? '' });
    }
  }
  return { options, items, pictures: items.filter((i): i is AlbumPicture => !isAlbumText(i)), at: slides.indexOf(mine[0]) };
}

/** The presentation's slides with an album rebuilt in place. */
export function replaceAlbum(slides: Slide[], albumId: string, items: AlbumItem[], o: AlbumOptions): Slide[] {
  const at = slides.findIndex((s) => s.album?.id === albumId);
  if (at < 0) return slides;
  const rest = slides.filter((s) => s.album?.id !== albumId);
  const out = [...rest];
  out.splice(Math.min(at, rest.length), 0, ...albumSlides(items, o, slides[at].group, albumId));
  return out;
}
