// Which slide of one version is the same slide in another. By id first; when a presentation was re-imported from the
// same file every id is new, so the fallbacks are: the import source (file name + page), then the title and text
// (word overlap). Used by 버전 기록 and Review › Compare. Pure logic.
import type { Library, Presentation, Slide } from './types';

export type MatchBasis = 'id' | 'source' | 'text';
export interface SlideMatch { cur: number; old: number; basis: MatchBasis; /** 0–1, how sure (1 for id and source). */ score: number }

export const MATCH_BASIS_LABEL: Record<MatchBasis, string> = { id: '슬라이드 ID가 같음', source: '가져온 파일 이름·쪽 번호가 같음', text: '제목·내용이 비슷함' };
export const MATCH_BASIS_SHORT: Record<MatchBasis, string> = { id: 'ID', source: '파일·쪽', text: '내용 유사' };

const sourceKey = (s: Slide): string | null => {
  const src = s.importSource;
  if (!src || !src.name || !Number.isFinite(src.page)) return null;
  // The same file may come back as .ppt or .pptx, and the name's case or extension may differ.
  return `${src.name.trim().toLowerCase().replace(/\.(pptx?|pps[xm]?|pot[xm]?|odp|pdf)$/i, '')}#${src.page}`;
};

const words = (t: string | undefined): Set<string> => new Set((t ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0));
const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
};
const bodyOf = (s: Slide): string => [s.text, s.subtext, ...(s.elements ?? []).filter((e) => !e.master).map((e) => e.text)].filter(Boolean).join(' ');

/** How alike two slides read, 0–1: the title and the text weighed together. Slides with no words at all are never alike. */
export function textSimilarity(a: Slide, b: Slide): number {
  const ta = words(a.title), tb = words(b.title), ba = words(bodyOf(a)), bb = words(bodyOf(b));
  const title = ta.size && tb.size ? jaccard(ta, tb) : null;
  const body = ba.size && bb.size ? jaccard(ba, bb) : null;
  if (title === null && body === null) return 0;
  if (title === null) return body!;
  if (body === null) return title;
  return title * 0.4 + body * 0.6;
}

/** Below this the slides are not taken to be the same. */
export const TEXT_MATCH_MIN = 0.6;

/**
 * One-to-one matches between the slides of `cur` and of `old`: ids first, then import source (file name + page), then
 * text similarity for what is still left (best pairs first). Returns them in the order of `cur`.
 */
export function matchSlides(cur: Slide[], old: Slide[], opts: { sources?: boolean; text?: boolean } = {}): SlideMatch[] {
  const out: SlideMatch[] = [];
  const curTaken = new Set<number>(), oldTaken = new Set<number>();
  const take = (c: number, o: number, basis: MatchBasis, score: number) => { out.push({ cur: c, old: o, basis, score }); curTaken.add(c); oldTaken.add(o); };

  const oldById = new Map<string, number>();
  old.forEach((s, i) => { if (!oldById.has(s.id)) oldById.set(s.id, i); });
  cur.forEach((s, c) => { const o = oldById.get(s.id); if (o !== undefined && !oldTaken.has(o)) take(c, o, 'id', 1); });

  if (opts.sources !== false) {
    const oldBySource = new Map<string, number[]>();
    old.forEach((s, i) => { const k = oldTaken.has(i) ? null : sourceKey(s); if (k) oldBySource.set(k, [...(oldBySource.get(k) ?? []), i]); });
    cur.forEach((s, c) => {
      if (curTaken.has(c)) return;
      const k = sourceKey(s);
      const list = k ? oldBySource.get(k) : undefined;
      const o = list?.find((i) => !oldTaken.has(i));
      if (o !== undefined) take(c, o, 'source', 1);
    });
  }

  if (opts.text !== false) {
    const cand: { c: number; o: number; score: number }[] = [];
    cur.forEach((s, c) => {
      if (curTaken.has(c)) return;
      old.forEach((t, o) => {
        if (oldTaken.has(o)) return;
        const score = textSimilarity(s, t);
        if (score >= TEXT_MATCH_MIN) cand.push({ c, o, score });
      });
    });
    // Best first; among equals the pair whose positions are closer.
    cand.sort((x, y) => y.score - x.score || Math.abs(x.c - x.o) - Math.abs(y.c - y.o) || x.c - y.c);
    for (const k of cand) if (!curTaken.has(k.c) && !oldTaken.has(k.o)) take(k.c, k.o, 'text', Math.round(k.score * 100) / 100);
  }
  return out.sort((a, b) => a.cur - b.cur);
}

export type VersionBasis = 'id' | 'source' | 'content';
export interface VersionLink { pres: Presentation; basis: VersionBasis }

/**
 * The presentation of this snapshot that is the current one: by id, else — when the current presentation was
 * re-imported from the same file — the one whose slides line up best by import source (file name + page), then by
 * title and text. At least half of the smaller side's slides must line up; a presentation never matches itself.
 */
export function findVersion(lib: Library | null | undefined, current: Presentation): VersionLink | null {
  const all = lib?.presentations ?? [];
  const byId = all.find((p) => p.id === current.id);
  if (byId) return { pres: byId, basis: 'id' };
  let best: { pres: Presentation; n: number; basis: VersionBasis; sameTitle: boolean } | null = null;
  for (const p of all) {
    const ms = matchSlides(current.slides, p.slides);
    const n = ms.length;
    if (!n || n < Math.ceil(Math.min(current.slides.length, p.slides.length) / 2)) continue;
    const basis: VersionBasis = ms.some((m) => m.basis === 'source') && ms.filter((m) => m.basis === 'source').length >= n / 2 ? 'source' : 'content';
    const sameTitle = p.title.trim().toLowerCase() === current.title.trim().toLowerCase();
    if (!best || n > best.n || (n === best.n && sameTitle && !best.sameTitle)) best = { pres: p, n, basis, sameTitle };
  }
  return best ? { pres: best.pres, basis: best.basis } : null;
}

export const VERSION_BASIS_LABEL: Record<VersionBasis, string> = {
  id: '',
  source: '다시 가져온 파일로 보여 가져온 파일 이름·쪽 번호로 연결했습니다',
  content: '다시 가져온 파일로 보여 제목·내용이 비슷한 슬라이드로 연결했습니다',
};

/** How many slides were lined up each way, e.g. "ID 12 · 파일·쪽 3 · 내용 유사 2". */
export function basisSummary(ms: Pick<SlideMatch, 'basis'>[]): string {
  return (['id', 'source', 'text'] as const).map((b) => [b, ms.filter((m) => m.basis === b).length] as const).filter(([, n]) => n).map(([b, n]) => `${MATCH_BASIS_SHORT[b]} ${n}`).join(' · ');
}
