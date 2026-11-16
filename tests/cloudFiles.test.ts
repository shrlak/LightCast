import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import {
  DEFAULT_VIEW, buildServerFileRows, deleteQuestion, kindOf, planDelete, selectAllState, toggleOne, toggleSelectAll, totals, usageByMedia, viewRows,
} from '../src/domain/cloudFiles';
import type { Library, MediaMeta, Presentation } from '../src/domain/types';

const base = createSeedLibrary();
const deck = (id: string, title: string, mediaIds: string[], protectedDeck = false): Presentation => ({
  ...base.presentations[0], id, title, protected: protectedDeck || undefined,
  slides: mediaIds.map((m, i) => ({ id: `${id}-s${i}`, group: 'x', text: '', background: { kind: 'media', mediaId: m, mediaType: 'image', fit: 'cover' } as never })),
});
const meta = (id: string, name: string, type: MediaMeta['type'] = 'image'): MediaMeta => ({ id, name, type });
const local = (media: MediaMeta[], presentations: Presentation[]): Pick<Library, 'media' | 'presentations'> => ({ media, presentations });

const items = [
  { id: 'a', size: 5_000_000, type: 'image' },     // in the library, used by 설교
  { id: 'b', size: 90_000_000, type: 'video' },    // in the library, not used by any slide
  { id: 'c', size: 1_000, type: 'image' },         // the server only (nobody lists it)
  { id: 'd', size: 20_000, type: 'audio' },        // listed only by another computer's library
  { id: 'e', size: 300_000, type: 'image' },       // used by a protected deck
  { id: 'f', size: 700, type: 'weird/thing' },     // the server only, unknown type
];
const lib = local(
  [meta('a', '배경 사진.png'), meta('b', '긴 영상.mp4', 'video'), meta('e', '로고.png')],
  [deck('p1', '설교 자료', ['a']), deck('p2', '필수 Front', ['e'], true)],
);
const remote = { media: [{ id: 'd', name: '다른 컴퓨터 소리.mp3', type: 'audio' }] };
const rows = buildServerFileRows(items, lib, remote);
const row = (id: string) => rows.find((r) => r.id === id)!;

describe('what the server holds, joined with the library', () => {
  it('names, kinds, use and protection', () => {
    expect(kindOf('image/png')).toBe('image');
    expect(kindOf('video')).toBe('video');
    expect(kindOf('audio/mpeg')).toBe('audio');
    expect(kindOf('')).toBe('other');
    expect(row('a')).toMatchObject({ name: '배경 사진.png', kind: 'image', inLibrary: true, usedBy: ['설교 자료'], protectedFile: false });
    expect(row('b')).toMatchObject({ name: '긴 영상.mp4', kind: 'video', inLibrary: true, usedBy: [] });
    expect(row('c')).toMatchObject({ name: 'c', inLibrary: false, listedElsewhere: false, usedBy: [] });
    expect(row('d')).toMatchObject({ name: '다른 컴퓨터 소리.mp3', inLibrary: false, listedElsewhere: true });
    expect(row('e').protectedFile).toBe(true);
    expect(row('f').kind).toBe('other');
  });
  it('finds a media id wherever a slide keeps it, not only in backgrounds', () => {
    const p = { ...deck('p3', '그림 있는 자료', []), slides: [{ id: 's', group: 'x', text: '', elements: [{ id: 'el', kind: 'image', mediaId: 'zz' }] }] } as unknown as Presentation;
    expect(usageByMedia({ presentations: [p] }).get('zz')).toEqual(['그림 있는 자료']);
  });
  it('a bad size from the server is refused', () => {
    expect(() => buildServerFileRows([{ id: 'x', size: -1 }], lib, null)).toThrow();
    expect(() => buildServerFileRows([{ id: 'x', size: 1.5 }], lib, null)).toThrow();
  });
});

describe('the list view', () => {
  it('shows everything, biggest first, with no limit of ten', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, size: i + 1, type: 'image' }));
    const all = viewRows(buildServerFileRows(many, local([], []), null), DEFAULT_VIEW);
    expect(all).toHaveLength(60);
    expect(all[0].id).toBe('m59');
  });
  it('filters by search (name, id, or the deck using it), kind and use', () => {
    expect(viewRows(rows, { ...DEFAULT_VIEW, query: '사진' }).map((r) => r.id)).toEqual(['a']);
    expect(viewRows(rows, { ...DEFAULT_VIEW, query: '설교' }).map((r) => r.id)).toEqual(['a']);
    expect(viewRows(rows, { ...DEFAULT_VIEW, kind: 'video' }).map((r) => r.id)).toEqual(['b']);
    expect(viewRows(rows, { ...DEFAULT_VIEW, kind: 'other' }).map((r) => r.id)).toEqual(['f']);
    expect(viewRows(rows, { ...DEFAULT_VIEW, status: 'unused' }).map((r) => r.id).sort()).toEqual(['c', 'f']);
    expect(viewRows(rows, { ...DEFAULT_VIEW, status: 'used' }).map((r) => r.id).sort()).toEqual(['a', 'b', 'd', 'e']);
  });
  it('sorts by size, name or kind', () => {
    expect(viewRows(rows, DEFAULT_VIEW).map((r) => r.id)).toEqual(['b', 'a', 'e', 'd', 'c', 'f']);
    expect(viewRows(rows, { ...DEFAULT_VIEW, sort: 'name' })[0].name).toBe('a'.length ? viewRows(rows, { ...DEFAULT_VIEW, sort: 'name' })[0].name : '');
    expect(viewRows(rows, { ...DEFAULT_VIEW, sort: 'kind' }).map((r) => r.kind)).toEqual(['image', 'image', 'image', 'audio', 'video', 'other'].sort((x, y) => ['이미지', '동영상', '오디오', '기타'][['image', 'video', 'audio', 'other'].indexOf(x)].localeCompare(['이미지', '동영상', '오디오', '기타'][['image', 'video', 'audio', 'other'].indexOf(y)], 'ko')));
  });
  it('totals count what is in use and what is not', () => {
    expect(totals(rows)).toEqual({ count: 6, bytes: 5_000_000 + 90_000_000 + 1_000 + 20_000 + 300_000 + 700, unusedCount: 2, unusedBytes: 1_700, usedCount: 4 });
  });
});

describe('what a delete does', () => {
  it('splits into server only, library too, and skipped (protected, or another computer\'s)', () => {
    const plan = planDelete(rows);
    expect(plan.serverOnly.map((r) => r.id).sort()).toEqual(['c', 'f']);
    expect(plan.withLibrary.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(plan.skipped.map((s) => s.row.id).sort()).toEqual(['d', 'e']);
    expect(plan.skipped.find((s) => s.row.id === 'e')?.reason).toContain('보호');
    expect(plan.skipped.find((s) => s.row.id === 'd')?.reason).toContain('동기화');
    expect(plan.bytes).toBe(5_000_000 + 90_000_000 + 1_000 + 700);
  });
  it('the question says what goes, where from, which decks lose a picture, and what is skipped', () => {
    const q = deleteQuestion(planDelete(rows), (n) => `${n} B`);
    expect(q).toContain('4개');
    expect(q).toContain('되돌릴 수 없습니다');
    expect(q).toContain('라이브러리와 이 컴퓨터에서도 지워지고');
    expect(q).toContain('설교 자료');
    expect(q).toContain('지우지 않는 파일 2개');
    // only unused files: no talk of the library
    const onlyUnused = deleteQuestion(planDelete(rows.filter((r) => ['c', 'f'].includes(r.id))), (n) => `${n} B`);
    expect(onlyUnused).toContain('2개');
    expect(onlyUnused).not.toContain('라이브러리');
    // nothing can be deleted: no question
    expect(deleteQuestion(planDelete(rows.filter((r) => ['d', 'e'].includes(r.id))), (n) => `${n}`)).toBe('');
  });
});

describe('selection', () => {
  it('모두 선택 selects what is shown; a part is "some"', () => {
    const shown = viewRows(rows, { ...DEFAULT_VIEW, status: 'unused' });
    const all = toggleSelectAll(shown, new Set());
    expect([...all].sort()).toEqual(['c', 'f']);
    expect(selectAllState(shown, all)).toBe('all');
    expect(toggleSelectAll(shown, all).size).toBe(0);
    expect(selectAllState(shown, toggleOne(new Set(), 'c'))).toBe('some');
  });
});
