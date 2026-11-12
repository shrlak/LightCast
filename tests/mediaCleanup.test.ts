import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import { createInitialState, reducer } from '../src/domain/reducer';
import { deletedServices, finishedServices, nextServiceCleanup } from '../src/domain/sunday/cleanup';
import type { Library, Presentation } from '../src/domain/types';

function fixture(): Library {
  const deck = (id: string, folder: string, media: string[]): Presentation => ({ id, title: id, folder, themeId: 'theme_classic', slides: [{ id: id + 's', group: 'x', text: '', elements: media.map((mediaId) => ({ id: mediaId, kind: 'image', mediaId, x: 0, y: 0, w: 10, h: 10 })) }] });
  return { ...createSeedLibrary(),
    presentations: [deck('service', '1025 주일예배', ['only', 'shared', 'logo']), deck('song', 'Songs', ['shared']), deck('online', '☁ 찬양 라이브러리', ['shared'])],
    media: ['only', 'shared', 'logo', 'standalone'].map((id) => ({ id, name: id, type: 'image' })), logoMediaId: 'logo',
    playlists: [{ id: 'service-list', name: '1025 주일예배', items: [{ id: 'i', presentationId: 'service' }, { id: 's', presentationId: 'song' }] }, { id: 'songs', name: '찬양 목록', items: [{ id: 'song-item', presentationId: 'song' }] }],
  };
}
describe('service media lifecycle', () => {
  it('service deletion removes its decks and files for good, and keeps song lists, songs, shared media and logo', () => {
    const lib = fixture();
    expect(deletedServices(lib, ['service-list'])).toEqual({ playlistIds: ['service-list'], presentationIds: ['service'], mediaIds: ['only'] });
    const next = reducer(createInitialState(lib), { type: 'playlist/delete', id: 'service-list' });
    expect(next.library.playlists).toEqual([lib.playlists[1]]);
    expect(next.library.presentations).toEqual(lib.presentations.slice(1));
    // Removed for good the same day: nothing waits in the 30-day trash, and the files only this service used go too.
    expect(next.library.trash ?? []).toEqual([]);
    expect(next.library.media.map((m) => m.id)).toEqual(['shared', 'logo', 'standalone']);
  });
  it('single deck deletion retains exclusive media until the trash expires', () => {
    const next = reducer(createInitialState(fixture()), { type: 'presentation/delete', id: 'service' });
    expect(next.library.media.map((m) => m.id)).toContain('only');
    const expired = reducer(next, { type: 'trash/expire', now: next.library.trash![0].expiresAt });
    expect(expired.library.media.map((m) => m.id)).not.toContain('only');
    expect(next.library.presentations.map((p) => p.id)).toEqual(['song', 'online']);
  });
  it('automatic expiry uses the same ownership rules and leaves song libraries alone', () => {
    const lib = fixture();
    expect(finishedServices(lib, new Date(2026, 9, 25, 18))).toEqual(deletedServices(lib, ['service-list']));
    expect(deletedServices(lib, ['songs']).presentationIds).toEqual([]);
  });
  it('deleting an ordinary song playlist leaves all presentations and media intact', () => {
    const lib = fixture();
    const next = reducer(createInitialState(lib), { type: 'playlist/delete', id: 'songs' });
    expect(next.library.presentations).toEqual(lib.presentations);
    expect(next.library.media).toEqual(lib.media);
  });
  it('allows deletion of the last service playlist and creates an empty replacement', () => {
    const lib = fixture(); lib.playlists = lib.playlists.slice(0, 1);
    const next = reducer(createInitialState(lib), { type: 'playlist/delete', id: 'service-list' });
    expect(next.library.playlists).toHaveLength(1);
    expect(next.library.playlists[0].items).toEqual([]);
    expect(next.library.presentations.some((p) => p.id === 'song')).toBe(true);
  });
});

describe('one-cycle service retention', () => {
  it('survives repeated cleanup ticks until next Sunday, then expires', () => {
    const lib = fixture();
    lib.playlists[0].autoDeleteAfter = nextServiceCleanup('1025 주일예배', new Date(2026, 9, 22));
    expect(new Date(lib.playlists[0].autoDeleteAfter)).toEqual(new Date(2026, 10, 1, 17));
    for (const now of [new Date(2026, 9, 25, 17), new Date(2026, 9, 26, 18), new Date(2026, 10, 1, 16, 59)]) expect(finishedServices(lib, now).playlistIds).toEqual([]);
    expect(finishedServices(lib, new Date(2026, 10, 1, 17)).playlistIds).toEqual(['service-list']);
  });
  it('retention changes are saved on the playlist and can be turned off', () => {
    const s = createInitialState(fixture());
    const until = nextServiceCleanup('1025 주일예배', new Date(2026, 9, 26));
    const held = reducer(s, { type: 'playlist/retention', id: 'service-list', until });
    expect(finishedServices(held.library, new Date(2026, 9, 26)).playlistIds).toEqual([]);
    const normal = reducer(held, { type: 'playlist/retention', id: 'service-list' });
    expect(finishedServices(normal.library, new Date(2026, 9, 26)).playlistIds).toEqual(['service-list']);
  });
});

describe('a finished 주일예배 leaves nothing behind but the songs', () => {
  const deck = (id: string, folder: string, extra: Partial<Presentation> = {}): Presentation => ({ id, title: id, folder, themeId: 'theme_classic', slides: [], ...extra });
  const base = (): Library => ({ ...createSeedLibrary(),
    presentations: [deck('sermon', '1025 주일예배'), deck('ads', '1025 주일예배'), deck('song', 'Songs')],
    playlists: [{ id: 'svc', name: '1025 주일예배', items: [{ id: 'a', presentationId: 'sermon' }, { id: 'b', presentationId: 'ads' }, { id: 'c', presentationId: 'song' }] }],
    sunday: { ...createSeedLibrary().sunday, prayerText: '1. 나라와 민족' },
  });
  it('clears 기도제목 and the earlier trash copies of that week, keeps the library songs', () => {
    const lib = base();
    const trashed = reducer(createInitialState(lib), { type: 'presentation/delete', id: 'ads' }).library;
    expect(trashed.trash?.length).toBe(1);
    const next = reducer(createInitialState(trashed), { type: 'playlist/delete', id: 'svc' }).library;
    expect(next.presentations.map((p) => p.id)).toEqual(['song']);
    expect(next.trash ?? []).toEqual([]);
    expect(next.sunday.prayerText).toBeUndefined();
  });
  it('keeps 기도제목 when next week\'s service already exists', () => {
    const lib = base();
    lib.playlists.push({ id: 'next', name: '1101 주일예배', items: [] });
    const next = reducer(createInitialState(lib), { type: 'playlist/delete', id: 'svc' }).library;
    expect(next.sunday.prayerText).toBe('1. 나라와 민족');
  });
});
