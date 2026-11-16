import type { Library, Presentation, Slide } from './types';

export interface ReadinessItem { label: string; detail: string; ok: boolean }
export function serviceDecks(lib: Library, playlistId: string | null): Presentation[] {
  const pl = lib.playlists.find((p) => p.id === playlistId);
  const ids = new Set(pl?.items.filter((i) => i.kind !== 'header').map((i) => i.presentationId));
  return lib.presentations.filter((p) => ids.has(p.id));
}
export function emptySlide(s: Slide): boolean {
  return ![s.title, s.text, s.subtext].some((t) => t?.trim()) && (!s.background || s.background.kind === 'color' || s.background.kind === 'gradient') && !s.elements?.length;
}
/** Preserve presentation identity/settings and every playlist reference when replacing a file. */
export function replaceDeckSlides(p: Presentation, slides: Slide[]): Presentation {
  if (!slides.length) throw new Error('슬라이드를 읽지 못했습니다. 기존 PPT는 유지됩니다.');
  return { ...p, slides };
}
/**
 * 설교 슬라이드 올리기: the slides already in the deck (the sermon title slide, 성경 말씀 chunks, earlier files) stay,
 * and the new file's slides are pasted after them, in the order given. A file that gave no slides changes nothing.
 */
export function appendDeckSlides(p: Presentation, slides: Slide[]): Presentation {
  if (!slides.length) throw new Error('슬라이드를 읽지 못했습니다. 기존 PPT는 유지됩니다.');
  // A slide already in the deck (same id) is not added twice.
  const have = new Set(p.slides.map((x) => x.id));
  return { ...p, slides: [...p.slides, ...slides.filter((x) => !have.has(x.id))] };
}
export function referencedAssets(decks: unknown): { media: string[]; images: string[] } {
  const media = new Set<string>(), images = new Set<string>();
  const scan = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(scan); return; }
    const obj = v as Record<string, unknown>;
    if (typeof obj.mediaId === 'string') media.add(obj.mediaId);
    if (obj.kind === 'image' && typeof obj.url === 'string') images.add(obj.url);
    Object.values(obj).forEach(scan);
  };
  scan(decks);
  return { media: [...media], images: [...images] };
}
