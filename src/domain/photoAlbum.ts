// Insert › Photo Album (DeckCraft insert.photoAlbum / insert.photoAlbumEdit): pictures laid out
// one, two or four to a slide. The album's slides remember it, so Edit Photo Album rebuilds them.
import type { Slide, SlideElement } from './types';
import { CANVAS_H, CANVAS_W } from './canvas';
import { uid } from './lyrics';

export interface AlbumOptions { per: 1 | 2 | 4; frame: string; titles: boolean; captions: boolean }
export interface AlbumPicture { mediaId: string; name: string }

const CELLS = { 1: [[0, 0, 1, 1]], 2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]], 4: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] } as const;

/** The album's slides. */
export function albumSlides(pics: AlbumPicture[], o: AlbumOptions, group: string, albumId = uid('al')): Slide[] {
  const slides: Slide[] = [];
  const top = o.titles ? 170 : 60, bottom = 60;
  const W = CANVAS_W - 120, H = CANVAS_H - top - bottom;
  for (let i = 0; i < pics.length; i += o.per) {
    const els: SlideElement[] = [];
    pics.slice(i, i + o.per).forEach((pic, k) => {
      const [cx, cy, cw, ch] = CELLS[o.per][k];
      const pad = 20, capH = o.captions ? 60 : 0;
      const box = { x: 60 + cx * W + pad, y: top + cy * H + pad, w: cw * W - pad * 2, h: ch * H - pad * 2 - capH };
      const label = pic.name.replace(/\.[^.]+$/, '');
      els.push({ id: uid('el'), kind: 'image', mediaId: pic.mediaId, fit: 'contain', ...box, name: pic.name, alt: label, ...(o.frame ? { pictureStyle: o.frame } : {}) });
      if (o.captions) els.push({ id: uid('el'), kind: 'text', text: label, x: box.x, y: box.y + box.h + 6, w: box.w, h: 50, fontSize: 28, color: '#ffffff', align: 'center' });
    });
    if (o.titles) els.unshift({ id: uid('el'), kind: 'text', text: '앨범 제목', x: 60, y: 40, w: CANVAS_W - 120, h: 110, fontSize: 64, bold: true, color: '#ffffff', align: 'center' });
    slides.push({ id: uid('s'), group, text: '', elements: els, background: { kind: 'color', value: '#000000' }, album: { id: albumId, ...o } });
  }
  return slides;
}

/** An album already in the presentation: its options and pictures in order. */
export function readAlbum(slides: Slide[], albumId: string): { options: AlbumOptions; pictures: AlbumPicture[]; at: number } | null {
  const mine = slides.filter((s) => s.album?.id === albumId);
  if (!mine.length) return null;
  const { id: _id, ...options } = mine[0].album!;
  const pictures = mine.flatMap((s) => (s.elements ?? []).filter((e) => e.kind === 'image' && e.mediaId).map((e) => ({ mediaId: e.mediaId!, name: e.name ?? '그림' })));
  return { options, pictures, at: slides.indexOf(mine[0]) };
}

/** The presentation's slides with an album rebuilt in place. */
export function replaceAlbum(slides: Slide[], albumId: string, pics: AlbumPicture[], o: AlbumOptions): Slide[] {
  const at = slides.findIndex((s) => s.album?.id === albumId);
  if (at < 0) return slides;
  const rest = slides.filter((s) => s.album?.id !== albumId);
  const out = [...rest];
  out.splice(Math.min(at, rest.length), 0, ...albumSlides(pics, o, slides[at].group, albumId));
  return out;
}
