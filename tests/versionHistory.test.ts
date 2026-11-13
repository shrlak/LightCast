import { describe, expect, it } from 'vitest';
import type { Presentation, Slide } from '../src/domain/types';
import { alignSlides, changedCount, differences, removeAdded, restoreSlide, restoreVersion, summary } from '../src/domain/versionHistory';

const slide = (id: string, text = id): Slide => ({ id, group: 'g', text });
const pres = (slides: Slide[], extra: Partial<Presentation> = {}): Presentation => ({ id: 'p1', title: 'T', slides, ...extra } as Presentation);

describe('version history', () => {
  const old = pres([slide('a'), slide('b'), slide('c')]);
  const cur = pres([slide('a'), slide('b', 'edited'), slide('d')]);

  it('lines slides up by id with a status', () => {
    const rows = alignSlides(cur, old);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['a:same', 'b:changed', 'c:removed', 'd:added']);
    expect(changedCount(rows)).toBe(3);
    expect(summary(rows)).toBe('1장 변경 · 1장 현재에 없음 · 1장 새로 생김');
    expect(summary(alignSlides(old, old))).toBe('현재와 같음');
  });

  it('reuses compare for the differences', () => {
    expect(differences(cur, old).length).toBeGreaterThan(0);
  });

  it('restores one changed slide', () => {
    expect(restoreSlide(cur, old, 'b').find((s) => s.id === 'b')?.text).toBe('b');
  });

  it('puts a deleted slide back where it was', () => {
    expect(restoreSlide(cur, old, 'c').map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(restoreSlide(pres([slide('z')]), pres([slide('a'), slide('z')]), 'a').map((s) => s.id)).toEqual(['a', 'z']);
  });

  it('ignores an unknown slide and keeps the last slide when removing', () => {
    expect(restoreSlide(cur, old, 'nope')).toBe(cur.slides);
    expect(removeAdded(cur, 'd').map((s) => s.id)).toEqual(['a', 'b']);
    expect(removeAdded(pres([slide('x')]), 'x')).toHaveLength(1);
  });

  it('restores a whole version under the current identity', () => {
    const r = restoreVersion(pres([slide('q')], { id: 'live', online: true }), old);
    expect(r.id).toBe('live');
    expect(r.online).toBe(true);
    expect(r.slides.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
