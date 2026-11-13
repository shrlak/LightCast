// 버전 기록 / Review › Compare across a re-import: slides lined up by id, then import source (file name + page), then text.
import { describe, expect, it } from 'vitest';
import type { Library, Presentation, Slide } from '../src/domain/types';
import { basisSummary, findVersion, matchSlides, textSimilarity } from '../src/domain/slideMatch';
import { alignSlides, restoreSlide, summary } from '../src/domain/versionHistory';
import { compare } from '../src/domain/compare';

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, group: 'g', ...extra }) as Slide;
const src = (name: string, page: number) => ({ format: 'pptx' as const, name, page });
const pres = (id: string, slides: Slide[], title = 'T'): Presentation => ({ id, title, slides }) as Presentation;

describe('matching slides', () => {
  it('uses ids first, then import source, then text — each slide once', () => {
    const old = [slide('a', { text: 'x' }), slide('b', { importSource: src('Sermon.pptx', 2), text: 'old' }), slide('c', { title: '감사 찬양', text: '주님께 감사 드리며 찬양합니다' })];
    const cur = [slide('n1', { importSource: src('sermon.PPTX', 2), text: 'new' }), slide('a', { text: 'x' }), slide('n3', { title: '감사 찬양', text: '주님께 감사 드리며 찬양합니다 오늘' })];
    const ms = matchSlides(cur, old);
    expect(ms.map((m) => [m.cur, m.old, m.basis])).toEqual([[0, 1, 'source'], [1, 0, 'id'], [2, 2, 'text']]);
    expect(basisSummary(ms)).toBe('ID 1 · 파일·쪽 1 · 내용 유사 1');
  });
  it('does not take different slides, empty slides or a different page of the same file for the same slide', () => {
    expect(matchSlides([slide('x', { text: '완전히 다른 내용입니다' })], [slide('y', { text: 'hello world' })])).toEqual([]);
    expect(matchSlides([slide('x')], [slide('y')])).toEqual([]);
    expect(matchSlides([slide('x', { importSource: src('a.pptx', 1) })], [slide('y', { importSource: src('a.pptx', 2) })])).toEqual([]);
    expect(textSimilarity(slide('x'), slide('y'))).toBe(0);
  });
  it('pairs the closest slides when several look alike', () => {
    const old = [slide('o1', { text: 'amen amen' }), slide('o2', { text: 'amen amen' })];
    const cur = [slide('c1', { text: 'amen amen' }), slide('c2', { text: 'amen amen' })];
    expect(matchSlides(cur, old).map((m) => [m.cur, m.old])).toEqual([[0, 0], [1, 1]]);
  });
});

describe('version history of a re-imported presentation', () => {
  const old = pres('p-old', [slide('o1', { importSource: src('deck.pptx', 1), title: '인사', text: '환영합니다' }), slide('o2', { importSource: src('deck.pptx', 2), title: '말씀', text: '본문 말씀' }), slide('o3', { importSource: src('deck.pptx', 3), title: '광고', text: '이번 주 광고' })]);
  const cur = pres('p-new', [slide('n1', { importSource: src('deck.pptx', 1), title: '인사', text: '환영합니다' }), slide('n2', { importSource: src('deck.pptx', 2), title: '말씀', text: '본문 말씀 수정' })]);

  it('lines the slides up although no id is shared, and says how', () => {
    const rows = alignSlides(cur, old);
    expect(rows.map((r) => `${r.id}:${r.status}:${r.basis ?? '-'}`)).toEqual(['n1:same:source', 'n2:changed:source', 'o3:removed:-']);
    expect(summary(rows)).toBe('1장 변경 · 1장 현재에 없음');
  });
  it('ignores regenerated object ids when judging a slide unchanged', () => {
    const el = (id: string) => ({ id, kind: 'text', text: 'hi', x: 0, y: 0, w: 1, h: 1 }) as never;
    const a = pres('a', [slide('s1', { text: 'same words here', elements: [el('e1')] })]);
    const b = pres('b', [slide('s2', { text: 'same words here', elements: [el('e2')] })]);
    expect(alignSlides(b, a)[0]).toMatchObject({ status: 'same', basis: 'text' });
  });
  it('restores a slide into the current one that lines up with it (keeping its id), or puts a removed one back in place', () => {
    const one = restoreSlide(cur, old, 'o2', 'n2');
    expect(one.map((s) => s.id)).toEqual(['n1', 'n2']);
    expect(one[1].text).toBe('본문 말씀');
    expect(restoreSlide(cur, old, 'o3').map((s) => s.id)).toEqual(['n1', 'n2', 'o3']);
  });
  it('finds the old presentation in a snapshot by source or content when the id changed, and never matches an unrelated one', () => {
    const lib = { presentations: [pres('other', [slide('z', { text: 'nothing alike here' })], 'Other'), old] } as unknown as Library;
    expect(findVersion(lib, cur)).toMatchObject({ basis: 'source', pres: { id: 'p-old' } });
    const byText = pres('p-new2', [slide('q1', { title: '인사', text: '환영합니다' }), slide('q2', { title: '말씀', text: '본문 말씀' })]);
    expect(findVersion(lib, byText)).toMatchObject({ basis: 'content', pres: { id: 'p-old' } });
    expect(findVersion({ presentations: [pres('other', [slide('z', { text: 'nothing alike here' })])] } as unknown as Library, cur)).toBeNull();
    expect(findVersion(lib, old)).toMatchObject({ basis: 'id' });
  });
  it('lets Compare line the slides up the same way', () => {
    const revs = compare(cur, old);
    expect(revs.some((r) => r.kind === 'slideInsert' && r.slide.id === 'o3')).toBe(true);
    expect(revs.some((r) => r.kind === 'field' && r.slideId === 'n2' && r.field === 'text')).toBe(true);
    expect(revs.some((r) => r.kind === 'slideDelete')).toBe(false);
  });
});
