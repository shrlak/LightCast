// Ids for slides and objects that LightCast makes by itself on every computer (a song brought into
// the church template, the Front with this Sunday's date, the Back with this season's 고백송, a QR
// code from an older version). Random ids would make the same automatic change look different on
// each computer, and cloud sync would keep both copies as a conflict ("(다른 기기)"). Derived from
// the presentation (or slide) id and the position, every computer makes exactly the same result.
import type { Slide, SlideElement } from './types';

export function withStableIds(prefix: string, slides: Slide[]): Slide[] {
  return slides.map((s, i) => {
    const id = `${prefix}-s${i}`;
    return { ...s, id, ...(s.elements ? { elements: stableElementIds(id, s.elements) } : {}) };
  });
}

export const stableElementIds = (slideId: string, elements: SlideElement[]): SlideElement[] =>
  elements.map((e, j) => ({ ...e, id: `${slideId}-e${j}` }));
