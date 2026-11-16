import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import { createInitialState, reducer } from '../src/domain/reducer';
import { deleteAllTargets, selectAllState, selectedVisible, toggleOne, toggleSelectAll, visibleTrash } from '../src/domain/trashSelection';
import type { Library, TrashEntry } from '../src/domain/types';

const NOW = 1_000_000;
const entry = (id: string, title: string, deletedAt: number, expiresAt = NOW + 1000): TrashEntry => ({
  id, kind: 'presentation', deletedAt, expiresAt, presentation: { ...createSeedLibrary().presentations[0], id: `p-${id}`, title },
});
const trash = [entry('a', '주님의 은혜', 10), entry('b', '은혜 아니면', 30), entry('c', '설교 PPT', 20), entry('old', '기간 지남', 40, NOW - 1)];

describe('휴지통 list', () => {
  it('shows what has not expired, newest deleted first, and filters by title', () => {
    expect(visibleTrash(trash, '', NOW).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(visibleTrash(trash, '은혜', NOW).map((e) => e.id)).toEqual(['b', 'a']);
    expect(visibleTrash(trash, '  설교 ', NOW).map((e) => e.id)).toEqual(['c']);
    expect(visibleTrash(undefined, '', NOW)).toEqual([]);
  });
});

describe('모두 선택', () => {
  const list = visibleTrash(trash, '', NOW);
  it('selects everything shown, and a second press clears it', () => {
    const all = toggleSelectAll(list, new Set());
    expect([...all].sort()).toEqual(['a', 'b', 'c']);
    expect(selectAllState(list, all)).toBe('all');
    expect(toggleSelectAll(list, all).size).toBe(0);
  });
  it('a part selection is "some", and pressing 모두 선택 then selects the rest', () => {
    const one = toggleOne(new Set(), 'b');
    expect(selectAllState(list, one)).toBe('some');
    expect([...toggleSelectAll(list, one)].sort()).toEqual(['a', 'b', 'c']);
    expect(selectAllState(list, toggleOne(one, 'b'))).toBe('none');
  });
  it('only selects what the search shows, and an entry that left the list is not selected any more', () => {
    const shown = visibleTrash(trash, '은혜', NOW);
    const all = toggleSelectAll(shown, new Set());
    expect([...all].sort()).toEqual(['a', 'b']);
    // the search changes to show only "c": the earlier selection does not count
    expect(selectedVisible(visibleTrash(trash, '설교', NOW), all)).toEqual([]);
    expect(selectAllState(visibleTrash(trash, '설교', NOW), all)).toBe('none');
    expect(selectAllState([], new Set())).toBe('none');
  });
  it('모두 삭제 acts on what is shown (all, or only the search matches), never on hidden entries', () => {
    expect(deleteAllTargets(visibleTrash(trash, '', NOW)).sort()).toEqual(['a', 'b', 'c']);
    expect(deleteAllTargets(visibleTrash(trash, '설교', NOW))).toEqual(['c']);
    expect(deleteAllTargets(visibleTrash(trash, '없는 제목', NOW))).toEqual([]);
  });
});

describe('deleting several at once', () => {
  const withTrash = (): Library => ({ ...createSeedLibrary(), trash: trash.map((e) => ({ ...e, expiresAt: Date.now() + 1e9 })) });
  it('trash/purge removes the given entries in one step and keeps the others', () => {
    const s = createInitialState(withTrash());
    const next = reducer(s, { type: 'trash/purge', ids: ['a', 'b'] });
    expect((next.library.trash ?? []).map((e) => e.id)).toEqual(['c', 'old']);
  });
  it('purging every entry empties the trash, and it is not an undo step (nothing to bring back by Ctrl+Z)', () => {
    const s = createInitialState(withTrash());
    const next = reducer(s, { type: 'trash/purge', ids: (s.library.trash ?? []).map((e) => e.id) });
    expect(next.library.trash ?? []).toEqual([]);
    expect(next.past).toEqual([]);
  });
  it('an id that is not in the trash changes nothing', () => {
    const s = createInitialState(withTrash());
    expect(reducer(s, { type: 'trash/purge', ids: ['nope'] }).library.trash).toEqual(s.library.trash);
  });
});
