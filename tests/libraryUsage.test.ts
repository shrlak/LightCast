import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import { libraryBreakdown, jsonBytes } from '../src/domain/libraryUsage';
import { reducer, createInitialState } from '../src/domain/reducer';

describe('library usage', () => {
  it('splits the library into parts that add up, biggest deck first', () => {
    const lib = createSeedLibrary();
    const big = { ...lib.presentations[0], id: 'big', title: '큰 자료', slides: [...lib.presentations[0].slides, ...lib.presentations[0].slides, ...lib.presentations[0].slides] };
    const l = { ...lib, presentations: [lib.presentations[0], big], trash: [{ id: 't1', kind: 'presentation' as const, deletedAt: 1, expiresAt: 2, presentation: lib.presentations[0] }] };
    const b = libraryBreakdown(l);
    expect(b.total).toBe(jsonBytes(l));
    expect(b.presentations[0].id).toBe('big');
    expect(b.trashCount).toBe(1);
    expect(b.trashIds).toEqual(['t1']);
    expect(b.otherBytes).toBeGreaterThanOrEqual(0);
    expect(b.presentationsBytes + b.trashBytes + b.usageBytes + b.activityBytes + b.otherBytes).toBe(b.total);
  });
});

describe('media/rename', () => {
  it('renames, ignores blank names and unknown files', () => {
    const s = createInitialState(createSeedLibrary());
    const withMedia = reducer(s, { type: 'media/add', media: { id: 'm1', name: '옛 이름', type: 'image' } });
    expect(reducer(withMedia, { type: 'media/rename', id: 'm1', name: '  새 이름 ' }).library.media[0].name).toBe('새 이름');
    expect(reducer(withMedia, { type: 'media/rename', id: 'm1', name: '   ' })).toBe(withMedia);
    expect(reducer(withMedia, { type: 'media/rename', id: 'zz', name: 'x' })).toBe(withMedia);
  });
});
