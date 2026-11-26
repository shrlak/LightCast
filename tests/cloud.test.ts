import { describe, expect, it } from 'vitest';
import { mergeById, mergeLibrary, syncable } from '../src/domain/cloudMerge';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Library, Presentation } from '../src/domain/types';

const pres = (id: string, title: string): Presentation => ({ id, title, slides: [{ id: `${id}s`, group: 'V', text: title }], themeId: 'theme_classic' });
const lib = (presentations: Presentation[]): Library => ({ ...createSeedLibrary(), presentations });

describe('mergeById', () => {
  const b = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }];
  it('takes whichever side changed and honours deletions of untouched items', () => {
    const local = [{ id: 'a', v: 2 }, { id: 'b', v: 1 }, { id: 'n', v: 1 }]; // a edited, c deleted, n added
    const remote = [{ id: 'a', v: 1 }, { id: 'b', v: 3 }, { id: 'c', v: 1 }, { id: 'm', v: 1 }]; // b edited, m added
    // This side kept the base order, so the cloud's order is used and this side's new item follows it.
    expect(mergeById(b, local, remote)).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 3 }, { id: 'm', v: 1 }, { id: 'n', v: 1 }]);
  });
  it('keeps an item edited on one side even if the other side deleted it', () => {
    expect(mergeById(b, [{ id: 'a', v: 9 }], [])).toEqual([{ id: 'a', v: 9 }]);
  });
});

describe('mergeLibrary', () => {
  it('takes the later edit (server time) when two devices edited the same presentation, never a copy', () => {
    const base = lib([pres('p1', '원본')]);
    const here = { ...pres('p1', '이 기기'), updatedAt: 5000 }, there = { ...pres('p1', '저 기기'), updatedAt: 9000 };
    expect(mergeLibrary(base, lib([here]), lib([there])).library.presentations.map((p) => p.title)).toEqual(['저 기기']);
    expect(mergeLibrary(base, lib([there]), lib([here])).library.presentations.map((p) => p.title)).toEqual(['저 기기']);
  });
  it('on a first sync the cloud wins for shared items and local-only items are added', () => {
    const { library } = mergeLibrary(null, lib([pres('p1', '로컬'), pres('p2', '로컬만')]), lib([pres('p1', '클라우드')]));
    expect(library.presentations.map((p) => p.title)).toEqual(['클라우드', '로컬만']);
  });
  it('never syncs online songs', () => {
    const l = lib([pres('p1', 'mine'), { ...pres('online:x', 'online'), online: true }]);
    expect(syncable(l).presentations.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('transitions reset', () => {
  it('a copy from an older app does not bring its transitions back through a merge', () => {
    const old = lib([{ ...pres('p1', '곡'), transition: { kind: 'fade', duration: 400 } }]);
    delete (old as { transitionsReset?: true }).transitionsReset;
    const { library } = mergeLibrary(null, lib([pres('p1', '곡')]), old);
    expect(library.presentations[0].transition).toBeUndefined();
    expect(library.transitionsReset).toBe(true);
  });
});
