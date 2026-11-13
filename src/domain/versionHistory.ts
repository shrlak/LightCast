// Review › 버전 기록: a saved restore point of one presentation, set side by side with the current
// one (slide by slide), restoring a single slide or the whole version. Pure logic; the panel is in
// src/ui/ppt/VersionHistory.tsx and the snapshots come from restorePoints.ts.
import type { Library, Presentation, Slide } from './types';
import { compare, type Revision } from './compare';
import { matchSlides, type MatchBasis } from './slideMatch';

export type RowStatus = 'same' | 'changed' | 'removed' | 'added';
/**
 * One line of the side-by-side list: the slide as it was (old) and as it is now (cur). `basis` says how the two were
 * lined up (by id; or, for a presentation re-imported from the same file, by import source or by text); `id` is the
 * current slide's id (the old one's for a removed slide).
 */
export interface VersionRow { id: string; status: RowStatus; old?: Slide; cur?: Slide; /** 1-based positions. */ oldNo?: number; curNo?: number; basis?: MatchBasis }

/** The presentation of this id in a snapshot's library. */
export function presentationIn(lib: Library | null | undefined, current: Pick<Presentation, 'id'>): Presentation | undefined {
  return (lib?.presentations ?? []).find((p) => p.id === current.id);
}

const same = (a: Slide, b: Slide) => JSON.stringify(a) === JSON.stringify(b);
// A re-import makes new ids for the slide and its objects: only what is on the slide counts.
const sameContent = (a: Slide, b: Slide) => {
  const strip = (k: string, v: unknown) => (k === 'id' || k === 'sourceSlideId' ? undefined : v);
  return JSON.stringify(a, strip) === JSON.stringify(b, strip);
};

/** Slides of both versions lined up (by id; else import source; else text): current order, removed slides placed after their old neighbour. */
export function alignSlides(current: Presentation, old: Presentation): VersionRow[] {
  const ms = matchSlides(current.slides, old.slides);
  const byCur = new Map(ms.map((m) => [m.cur, m]));
  const byOld = new Map(ms.map((m) => [m.old, m]));
  const rows: VersionRow[] = [];
  const removedAfter = new Map<string | null, { s: Slide; i: number }[]>();
  let prev: string | null = null;
  old.slides.forEach((s, i) => {
    const m = byOld.get(i);
    if (m) prev = current.slides[m.cur].id;
    else removedAfter.set(prev, [...(removedAfter.get(prev) ?? []), { s, i }]);
  });
  const pushRemoved = (key: string | null) => {
    for (const { s, i } of removedAfter.get(key) ?? []) rows.push({ id: s.id, status: 'removed', old: s, oldNo: i + 1 });
  };
  pushRemoved(null);
  current.slides.forEach((s, i) => {
    const m = byCur.get(i);
    if (!m) rows.push({ id: s.id, status: 'added', cur: s, curNo: i + 1 });
    else {
      const o = old.slides[m.old];
      rows.push({ id: s.id, status: (m.basis === 'id' ? same(o, s) : sameContent(o, s)) ? 'same' : 'changed', old: o, cur: s, oldNo: m.old + 1, curNo: i + 1, basis: m.basis });
    }
    pushRemoved(s.id);
  });
  return rows;
}

/** The differences, reusing Review › Compare: what the old version has that the current one lacks or does differently. */
export const differences = (current: Presentation, old: Presentation): Revision[] => compare(current, old);

export const changedCount = (rows: VersionRow[]) => rows.filter((r) => r.status !== 'same').length;

/**
 * The current slides with one slide put back as it was (re-inserted where it used to be if it was deleted). `curId` is
 * the current slide it lines up with when that has another id (a re-imported presentation): it is replaced, keeping its id.
 */
export function restoreSlide(current: Presentation, old: Presentation, slideId: string, curId?: string): Slide[] {
  const o = old.slides.find((s) => s.id === slideId);
  if (!o) return current.slides;
  const target = curId ?? slideId;
  if (current.slides.some((s) => s.id === target)) return current.slides.map((s) => (s.id === target ? (target === o.id ? o : { ...o, id: target }) : s));
  // After the nearest earlier slide of the old version that still exists (or lines up with one of the current ones).
  const toCur = new Map(matchSlides(current.slides, old.slides).map((m) => [m.old, m.cur]));
  let index = 0;
  for (let i = old.slides.indexOf(o) - 1; i >= 0; i--) {
    const found = toCur.get(i);
    if (found !== undefined) { index = found + 1; break; }
  }
  const out = [...current.slides];
  out.splice(index, 0, o);
  return out;
}

/** A slide that exists only now, taken out. Keeps at least one slide. */
export function removeAdded(current: Presentation, slideId: string): Slide[] {
  return current.slides.length > 1 ? current.slides.filter((s) => s.id !== slideId) : current.slides;
}

/** The whole version back: the old content under the current presentation's identity. */
export function restoreVersion(current: Presentation, old: Presentation): Presentation {
  return { ...old, id: current.id, online: current.online, protected: current.protected };
}

/** The library with `next` replacing the presentation of the same id. */
export const withPresentation = (lib: Library, next: Presentation): Library => ({ ...lib, presentations: lib.presentations.map((p) => (p.id === next.id ? next : p)) });

/** A one-line summary for the list, e.g. "3장 변경 · 1장 현재에 없음". */
export function summary(rows: VersionRow[]): string {
  const n = (st: RowStatus) => rows.filter((r) => r.status === st).length;
  const parts = [n('changed') && `${n('changed')}장 변경`, n('removed') && `${n('removed')}장 현재에 없음`, n('added') && `${n('added')}장 새로 생김`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '현재와 같음';
}
