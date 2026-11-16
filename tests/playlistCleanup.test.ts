import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import { createInitialState, reducer, type AppState } from '../src/domain/reducer';
import { EMPTY_PLAYLIST_GRACE_MS, isEmptyPlaylist, playlistsToAutoDelete, removableEmptyPlaylists } from '../src/domain/playlistCleanup';
import type { Library, Playlist } from '../src/domain/types';

const deck = (id: string, folder?: string) => ({ ...createSeedLibrary().presentations[0], id, title: id, folder });
const list = (id: string, items: Playlist['items'] = [], name = id): Playlist => ({ id, name, items });
const withDeck = (id: string): Playlist['items'][number] => ({ id: `i-${id}`, presentationId: id });
const header = (title = '찬양'): Playlist['items'][number] => ({ id: `h-${title}`, kind: 'header', title });
const lib = (playlists: Playlist[], presentations = [deck('p1')]): Library => ({ ...createSeedLibrary(), playlists, presentations });
const state = (l: Library, active: string | null): AppState => ({ ...createInitialState(l), activePlaylistId: active as string, playlistIndex: null });

describe('what an empty playlist is', () => {
  it('has no items, only headers, or only decks that no longer exist', () => {
    const l = lib([list('a'), list('b', [header(), header('설교')]), list('c', [withDeck('gone')]), list('d', [withDeck('p1')]), list('e', [header(), withDeck('p1')])]);
    const empty = (id: string) => isEmptyPlaylist(l, l.playlists.find((p) => p.id === id)!);
    expect([empty('a'), empty('b'), empty('c')]).toEqual([true, true, true]);
    expect([empty('d'), empty('e')]).toEqual([false, false]);
  });
  it('is not empty while it still owns decks through its folder (a 주일예배 keeps them there)', () => {
    const l = lib([list('s', [header()], '2026-11-22 주일예배')], [deck('front', '2026-11-22 주일예배')]);
    expect(isEmptyPlaylist(l, l.playlists[0])).toBe(false);
  });
});

describe('which empty playlists may go', () => {
  it('never the active one, and at least one playlist always stays', () => {
    const l = lib([list('a'), list('b', [withDeck('p1')]), list('c')]);
    expect(removableEmptyPlaylists(l, 'a').map((p) => p.id)).toEqual(['c']);
    expect(removableEmptyPlaylists(l, null).map((p) => p.id)).toEqual(['a', 'c']);
    const allEmpty = lib([list('a'), list('b'), list('c')]);
    expect(removableEmptyPlaylists(allEmpty, 'b').map((p) => p.id)).toEqual(['a', 'c']);
    expect(removableEmptyPlaylists(allEmpty, null).map((p) => p.id)).toEqual(['b', 'c']);
    expect(removableEmptyPlaylists(lib([list('only')]), null)).toEqual([]);
  });
  it('removes empty lists at start-up at once, but later only after they stayed empty for the grace time', () => {
    const l = lib([list('a', [withDeck('p1')]), list('x'), list('y')]);
    const since = new Map<string, number>();
    expect(playlistsToAutoDelete(l, 'a', since, 1000, true).map((p) => p.id)).toEqual(['x', 'y']);
    const later = new Map<string, number>();
    expect(playlistsToAutoDelete(l, 'a', later, 1000).map((p) => p.id)).toEqual([]);
    expect(playlistsToAutoDelete(l, 'a', later, 1000 + EMPTY_PLAYLIST_GRACE_MS - 1).map((p) => p.id)).toEqual([]);
    expect(playlistsToAutoDelete(l, 'a', later, 1000 + EMPTY_PLAYLIST_GRACE_MS).map((p) => p.id)).toEqual(['x', 'y']);
  });
  it('forgets a list that was filled or became active, so its time starts again', () => {
    const since = new Map<string, number>();
    const empty = lib([list('a', [withDeck('p1')]), list('x')]);
    playlistsToAutoDelete(empty, 'a', since, 0);
    expect(since.has('x')).toBe(true);
    playlistsToAutoDelete(lib([list('a', [withDeck('p1')]), list('x', [withDeck('p1')])]), 'a', since, 100);
    expect(since.has('x')).toBe(false);
    playlistsToAutoDelete(empty, 'x', since, 200);
    expect(since.has('x')).toBe(false);
    expect(playlistsToAutoDelete(empty, 'a', since, 300 + EMPTY_PLAYLIST_GRACE_MS - 1)).toEqual([]);
  });
});

describe('playlist/autoDelete', () => {
  it('deletes an empty list that is not active, and it is not an undo step', () => {
    const s = state(lib([list('a', [withDeck('p1')]), list('x')]), 'a');
    const next = reducer(s, { type: 'playlist/autoDelete', id: 'x' });
    expect(next.library.playlists.map((p) => p.id)).toEqual(['a']);
    expect(next.past).toEqual(s.past);
    expect(next.activePlaylistId).toBe('a');
  });
  it('does nothing for the active list, a list with decks, or the last list', () => {
    const s = state(lib([list('a', [withDeck('p1')]), list('x'), list('y', [withDeck('p1')])]), 'x');
    expect(reducer(s, { type: 'playlist/autoDelete', id: 'x' })).toBe(s);
    expect(reducer(s, { type: 'playlist/autoDelete', id: 'y' })).toBe(s);
    const one = state(lib([list('only')]), null);
    expect(reducer(one, { type: 'playlist/autoDelete', id: 'only' })).toBe(one);
  });
  it('does not undo your own last action: an earlier edit is still the top of the undo stack', () => {
    let s = state(lib([list('a', [withDeck('p1')]), list('x')]), 'a');
    s = reducer(s, { type: 'playlist/rename', id: 'a', name: '이름 바꿈' });
    const afterRename = s.past.length;
    s = reducer(s, { type: 'playlist/autoDelete', id: 'x' });
    expect(s.past.length).toBe(afterRename);
    // One Ctrl+Z reverts the rename (the automatic delete is no step of its own). Undo restores the library as it
    // was before that edit, which still had the empty list; the clean-up removes it again.
    s = reducer(s, { type: 'undo' });
    expect(s.library.playlists.find((p) => p.id === 'a')?.name).toBe('a');
  });
  it('a service playlist that owns decks through its folder is kept', () => {
    const l = lib([list('a', [withDeck('p1')]), list('svc', [header()], '2026-11-22 주일예배')], [deck('p1'), deck('front', '2026-11-22 주일예배')]);
    const s = state(l, 'a');
    expect(reducer(s, { type: 'playlist/autoDelete', id: 'svc' })).toBe(s);
  });
});
