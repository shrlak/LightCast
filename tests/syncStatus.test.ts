import { describe, expect, it } from 'vitest';
import { describePending, forgetOldConflicts, isOfflineError, pendingChanges, pollDelay, POLL, retryDelay } from '../src/domain/syncStatus';
import { mergeLibrary } from '../src/domain/cloudMerge';
import { createInitialState, reducer, type Action, type AppState } from '../src/domain/reducer';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Library, Presentation } from '../src/domain/types';

const pres = (id: string, title: string, text = title): Presentation => ({ id, title, slides: [{ id: `${id}s`, group: 'V', text }], themeId: 'theme_classic' });
const lib = (presentations: Presentation[]): Library => ({ ...createSeedLibrary(), presentations });
const run = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s);

describe('retry timing', () => {
  it('retries after 5 s, then slows down after each failure, up to three minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 180_000, 180_000]);
    expect(retryDelay(-3)).toBe(2_500);
  });
  it('asks every second while someone edits, every two seconds on screen, and rarely when hidden', () => {
    const at = { failures: 0, hidden: false, focused: true, now: 1_000_000 };
    expect(pollDelay({ ...at, activeAt: at.now - 10_000 })).toBe(POLL.live);
    expect(pollDelay({ ...at, activeAt: at.now - 5 * 60_000 })).toBe(POLL.visible);
    expect(pollDelay({ ...at, focused: false, activeAt: at.now - 5 * 60_000 })).toBe(POLL.background);
    expect(pollDelay({ ...at, activeAt: 0 })).toBe(POLL.idle);
    expect(pollDelay({ ...at, hidden: true, activeAt: at.now })).toBe(POLL.hidden);
    expect(pollDelay({ ...at, failures: 2, activeAt: at.now })).toBe(retryDelay(2));
  });
  it('tells a missing connection from a refusal', () => {
    expect(isOfflineError(Object.assign(new Error('x'), { network: true }))).toBe(true);
    expect(isOfflineError(Object.assign(new Error('x'), { status: 502 }))).toBe(true);
    expect(isOfflineError(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(isOfflineError(new Error('x'))).toBe(false);
    expect(isOfflineError(null)).toBe(false);
  });
});

describe('edits waiting to be sent', () => {
  it('counts nothing when the library is the one the server has', () => {
    const base = lib([pres('a', '가'), pres('b', '나')]);
    expect(pendingChanges(base, structuredClone(base))).toEqual({ presentations: 0, playlists: 0, other: 0, total: 0 });
    expect(describePending(pendingChanges(base, base))).toBe('보낼 변경 없음');
  });
  it('counts changed, new and deleted items, and other settings', () => {
    const base = lib([pres('a', '가'), pres('b', '나'), pres('c', '다')]);
    const now: Library = { ...structuredClone(base), presentations: [pres('a', '가 수정'), pres('b', '나'), pres('d', '새것')] };
    now.themes = [...now.themes, { ...now.themes[0], id: 'theme_new', name: 'new' }];
    now.playlists = [{ ...now.playlists[0], name: '바뀐 이름' }];
    const p = pendingChanges(base, now);
    expect(p).toMatchObject({ presentations: 3, playlists: 1, other: 1 });
    expect(p.total).toBe(5);
    expect(describePending(p)).toBe('프레젠테이션 3 · 재생목록 1 · 기타 1');
  });
  it('ignores online songs and sees a changed 수련회 setting', () => {
    const base = lib([pres('a', '가')]);
    const now = { ...structuredClone(base), presentations: [...base.presentations, { ...pres('o', 'online'), online: true }] };
    expect(pendingChanges(base, now).total).toBe(0);
    now.retreat = { theme: '빛', enabled: true, auto: true, style: 'rays', colors: ['#000000', '#111111', '#222222'], speed: 1, dim: 0.25 };
    expect(pendingChanges(base, now)).toMatchObject({ other: 1, total: 1 });
  });
  it('counts everything as waiting before the first sync', () => {
    expect(pendingChanges(null, lib([pres('a', '가')])).presentations).toBe(1);
  });
});

describe('two computers changed the same presentation', () => {
  it('keeps one presentation: the later edit, with nothing to choose', () => {
    const base = lib([pres('p1', '원본', '원본 본문')]);
    const here = { ...pres('p1', '이 기기', '내 본문'), updatedAt: 2000 };
    const there = { ...pres('p1', '저 기기', '저쪽 본문'), updatedAt: 1000 };
    const { library } = mergeLibrary(base, lib([here]), lib([there]));
    expect(library.presentations.map((p) => p.id)).toEqual(['p1']);
    expect(library.presentations[0]).toMatchObject({ title: '이 기기', updatedAt: 2000 });
    expect(library.presentations[0].slides[0].text).toBe('내 본문');
    void createInitialState; void run;
  });
  it('forgets the questions older versions saved', () => {
    const store = new Map<string, string>([['freecast.sync.conflicts', '[{"id":"x"}]']]);
    forgetOldConflicts({ removeItem: (k: string) => { store.delete(k); } });
    expect(store.has('freecast.sync.conflicts')).toBe(false);
  });
});
