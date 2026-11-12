// DeckCraft parity: Review, View, Find / Replace, File, rich clipboard, guides, Format Painter.
import { describe, expect, it } from 'vitest';
import type { Presentation, Slide, SlideElement } from '../src/domain/types';
import { findText } from '../src/engine';
import { findItems, parseFindKey, replaceMatches, spliceElement, spliceSlideText } from '../src/domain/findReplace';
import { changeWord, misspellings, repeatedWords } from '../src/domain/spelling';

const s = (id: string, more: Partial<Slide> = {}): Slide => ({ id, group: 'G', text: '', ...more });
const pres = (slides: Slide[]): Presentation => ({ id: 'p', title: 'P', themeId: 't', slides } as unknown as Presentation);
const box = (more: Partial<SlideElement>): SlideElement => ({ id: 'b', kind: 'text', x: 0, y: 0, w: 100, h: 50, ...more });

describe('Find / Replace (DeckCraft text.find / text.replace)', () => {
  const table = { rows: [[{ text: 'grace cell' }, { text: 'x' }]], cols: [50, 50], heights: [20], style: '', firstRow: true, firstCol: false, lastRow: false, lastCol: false, bandRow: true, bandCol: false };
  const p = pres([s('s1', { text: 'Amazing grace', notes: 'grace note', elements: [box({ text: 'Grace box' }), { ...box({ id: 't' }), kind: 'table', table }] })]);

  it('searches slide text, objects, table cells and notes', () => {
    const hits = findText(findItems(p), 'grace', {});
    expect(hits.map((h) => parseFindKey(h.key).field)).toEqual(['text', 'el', 'cell', 'notes']);
    expect(parseFindKey(hits[2].key).cell).toEqual([0, 0]);
    expect(findText(findItems(p), 'grace', { matchCase: true }).length).toBe(3);
  });

  it('replaces in table cells', () => {
    const hits = findText(findItems(p), 'grace', {});
    const out = replaceMatches(p.slides, hits, 'love');
    expect(out[0].text).toBe('Amazing love');
    expect(out[0].notes).toBe('love note');
    expect(out[0].elements![0].text).toBe('love box');
    expect(out[0].elements![1].table!.rows[0][0].text).toBe('love cell');
  });

  it('keeps the formatting: the new text takes the first replaced run’s format', () => {
    const el = box({ text: 'Hello world', runs: [[{ text: 'Hel', bold: true }, { text: 'lo world' }]] });
    const out = spliceElement(el, 1, 5, 'ola');
    expect(out.text).toBe('Hola world');
    expect(out.runs).toEqual([[{ text: 'Hola', bold: true }, { text: ' world' }]]);
    // A plain box stays plain.
    expect(spliceElement(box({ text: 'abc' }), 0, 1, 'X')).toMatchObject({ text: 'Xbc', runs: undefined });
    // Per-line paragraphs keep their styles.
    const para = box({ text: 'one\ntwo', paragraphs: [{ text: 'one', fontSize: 40 }, { text: 'two', fontSize: 20, runs: [{ text: 'tw', color: '#ff0000' }, { text: 'o' }] }] });
    const p2 = spliceElement(para, 4, 6, 'TW');
    expect(p2.paragraphs).toEqual([{ text: 'one', fontSize: 40 }, { text: 'TWo', fontSize: 20, runs: [{ text: 'TW', color: '#ff0000' }, { text: 'o' }] }]);
  });

  it('keeps the slide text’s runs', () => {
    const sl = s('a', { text: 'ab\ncd', textRuns: [[{ text: 'ab', italic: true }], [{ text: 'cd' }]] });
    expect(spliceSlideText(sl, 3, 5, 'xyz')).toEqual({ text: 'ab\nxyz', textRuns: [[{ text: 'ab', italic: true }], [{ text: 'xyz' }]] });
  });

  it('replaces several matches of one text from the end', () => {
    const q = pres([s('s1', { text: 'a a a' })]);
    expect(replaceMatches(q.slides, findText(findItems(q), 'a', {}), 'bb')[0].text).toBe('bb bb bb');
  });
});

describe('Spelling (DeckCraft review.spelling / spellingChange)', () => {
  it('finds repeated words with only spaces between, per line', () => {
    expect(repeatedWords('the the cat')).toEqual([{ word: ' the', start: 3, shown: 'the' }]);
    expect(repeatedWords('The the')).toHaveLength(1);
    expect(repeatedWords('well-well')).toEqual([]);
    expect(repeatedWords('은혜 은혜\n은혜')).toEqual([{ word: ' 은혜', start: 2, shown: '은혜' }]);
  });

  it('reports a repeated word once, as repeated, and deletes it with its space', () => {
    const p = pres([s('s1', { text: 'Amazing grace grace' })]);
    const hits = misspellings(p, () => false);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'repeat', shown: 'grace', word: ' grace', start: 13 });
    expect(changeWord(p.slides, hits[0], '')[0].text).toBe('Amazing grace');
    expect(misspellings(p, () => false, new Set(), { repeated: false })).toEqual([]);
    // Ignored as "grace grace".
    expect(misspellings(p, () => false, new Set(['grace grace']))).toEqual([]);
  });

  it('Change keeps the box’s character formatting', () => {
    const p = pres([s('s1', { elements: [box({ text: 'I recieve', runs: [[{ text: 'I ', bold: true }, { text: 'recieve', color: '#00ff00' }]] })] })]);
    const hit = { slideId: 's1', field: 'el' as const, elementId: 'b', word: 'recieve', start: 2 };
    const out = changeWord(p.slides, hit, 'receive');
    expect(out[0].elements![0].runs).toEqual([[{ text: 'I ', bold: true }, { text: 'receive', color: '#00ff00' }]]);
    const all = changeWord(p.slides, hit, 'receive', true);
    expect(all[0].elements![0].runs).toEqual([[{ text: 'I ', bold: true }, { text: 'receive', color: '#00ff00' }]]);
  });
});

import { commentThreads, deleteComments, initialsOf, neighbourComment } from '../src/domain/comments';
import { acceptAll, compare } from '../src/domain/compare';

describe('Comments (DeckCraft comment.next / prev / delete)', () => {
  const c = (id: string) => ({ id, author: 'Kim Min', text: id, at: 0 });
  const slides = [s('a', { comments: [c('1')] }), s('b'), s('c', { comments: [c('2'), c('3')] }), s('d')];

  it('lists threads in deck order', () => {
    expect(commentThreads(slides)).toEqual([{ slide: 0, index: 0 }, { slide: 2, index: 0 }, { slide: 2, index: 1 }]);
  });
  it('steps from a comment and stops at the ends', () => {
    expect(neighbourComment(slides, 2, 0, true)).toEqual({ slide: 2, index: 1 });
    expect(neighbourComment(slides, 2, 1, true)).toBeNull();
    expect(neighbourComment(slides, 0, 0, false)).toBeNull();
    expect(neighbourComment(slides, 2, 0, false)).toEqual({ slide: 0, index: 0 });
  });
  it('without a comment: next is on or after the slide, previous strictly before it', () => {
    expect(neighbourComment(slides, 1, null, true)).toEqual({ slide: 2, index: 0 });
    expect(neighbourComment(slides, 2, null, false)).toEqual({ slide: 0, index: 0 });
    expect(neighbourComment(slides, 3, null, true)).toBeNull();
    expect(neighbourComment([s('x')], 0, null, true)).toBeNull();
  });
  it('deletes one, a slide’s or all comments', () => {
    expect(deleteComments(slides, { slideId: 'c', id: '2' })[2].comments).toEqual([c('3')]);
    expect(deleteComments(slides, { slideId: 'c' })[2].comments).toBeUndefined();
    expect(deleteComments(slides, { slideId: 'c' })[0].comments).toHaveLength(1);
    expect(deleteComments(slides, 'all').every((x) => !x.comments)).toBe(true);
  });
  it('initials', () => {
    expect(initialsOf('Kim Min')).toBe('KM');
    expect(initialsOf('김민수')).toBe('김');
    expect(initialsOf('')).toBe('?');
  });
});

describe('Compare › Accept All (DeckCraft review.accept {all})', () => {
  it('keeps the deck’s last remaining slide', () => {
    const mine = pres([s('a', { text: 'x' })]);
    const other = pres([]);
    const revs = compare(mine, other);
    expect(revs.map((r) => r.kind)).toEqual(['slideDelete']);
    expect(acceptAll(mine.slides, revs)).toHaveLength(1);
  });
  it('deletes slides while others remain', () => {
    const mine = pres([s('a'), s('b')]);
    const other = pres([s('b', { text: 'new' })]);
    const out = acceptAll(mine.slides, compare(mine, other));
    expect(out.map((x) => [x.id, x.text])).toEqual([['b', 'new']]);
  });
});
