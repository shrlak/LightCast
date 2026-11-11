// Slide sections (Home › Section): a section is a run of consecutive slides with the same `group`.
import type { Slide } from './types';

/** [start, end) of the section holding slide `id`. */
export function sectionRange(slides: Slide[], id: string): [number, number] | null {
  const i = slides.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const g = slides[i].group;
  let a = i, b = i + 1;
  while (a > 0 && slides[a - 1].group === g) a--;
  while (b < slides.length && slides[b].group === g) b++;
  return [a, b];
}

export function renameSection(slides: Slide[], id: string, name: string): Slide[] {
  const r = sectionRange(slides, id);
  if (!r || !name.trim()) return slides;
  return slides.map((s, i) => (i >= r[0] && i < r[1] ? { ...s, group: name.trim(), label: undefined } : s));
}

/** Remove Section: its slides join the section before (or after, for the first one). */
export function removeSection(slides: Slide[], id: string): Slide[] {
  const r = sectionRange(slides, id);
  if (!r) return slides;
  const into = r[0] > 0 ? slides[r[0] - 1].group : slides[r[1]]?.group;
  if (!into) return slides;
  return slides.map((s, i) => (i >= r[0] && i < r[1] ? { ...s, group: into, label: undefined } : s));
}

/** Remove Section & Slides. */
export const removeSectionAndSlides = (slides: Slide[], id: string): Slide[] => {
  const r = sectionRange(slides, id);
  return r ? slides.filter((_, i) => i < r[0] || i >= r[1]) : slides;
};

/** Remove All Sections: every slide in one section, named after the first. */
export const removeAllSections = (slides: Slide[]): Slide[] => slides.map((s) => ({ ...s, group: slides[0]?.group ?? s.group, label: undefined }));

/** Move Section Up / Down: the section swaps places with the one before / after. */
export function moveSection(slides: Slide[], id: string, dir: -1 | 1): Slide[] {
  const r = sectionRange(slides, id);
  if (!r) return slides;
  const other = dir < 0 ? (r[0] > 0 ? sectionRange(slides, slides[r[0] - 1].id) : null) : (r[1] < slides.length ? sectionRange(slides, slides[r[1]].id) : null);
  if (!other) return slides;
  const [a, b] = dir < 0 ? [other, r] : [r, other];
  return [...slides.slice(0, a[0]), ...slides.slice(b[0], b[1]), ...slides.slice(a[0], a[1]), ...slides.slice(b[1])];
}

/** The sections in order: name, first slide index and slide count. */
export function sections(slides: Slide[]): { name: string; start: number; count: number }[] {
  const out: { name: string; start: number; count: number }[] = [];
  slides.forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && slides[i - 1]?.group === s.group) last.count++;
    else out.push({ name: s.group, start: i, count: 1 });
  });
  return out;
}
