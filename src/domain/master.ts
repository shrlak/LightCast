// View › Slide Master: objects placed on the master appear on every slide (behind the slide's own
// objects), as copies marked `master` that the slide cannot select. Format Background › Hide
// Background Graphics (`hideMaster`) leaves them off one slide.
import type { Slide, SlideElement } from './types';

export const masterCopyId = (id: string) => `master:${id}`;

/** One slide with the master's objects (re)applied. */
export function withMaster(slide: Slide, master: SlideElement[]): Slide {
  const own = (slide.elements ?? []).filter((e) => !e.master);
  const copies = slide.hideMaster ? [] : master.map((e) => ({ ...e, id: masterCopyId(e.id), master: true }));
  const elements = [...copies, ...own];
  return { ...slide, elements: elements.length ? elements : undefined };
}

export const syncMaster = (slides: Slide[], master: SlideElement[]): Slide[] => slides.map((s) => withMaster(s, master));
