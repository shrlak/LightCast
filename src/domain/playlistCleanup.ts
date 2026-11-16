// 비어 있는 재생목록 자동 삭제: a playlist with nothing to play (no decks, only section headers or decks that no
// longer exist) is removed on its own, so empty lists do not pile up.
//
// Safe by design:
//  - the playlist being worked in (the active one) is never removed, and at least one playlist always stays;
//  - when the app starts, empty lists are removed at once (nothing is being built then);
//  - while the app runs, a list is removed only after it has stayed empty and not been the active one for a while,
//    so a list that is being created or filled in steps (the 주일예배 wizard, 새 재생목록) is not taken away.
import type { Library, Playlist } from './types';

/** How long a list has to stay empty (and not active) while the app is running before it is removed. */
export const EMPTY_PLAYLIST_GRACE_MS = 5 * 60_000;

/** A playlist with no deck left to play: no items, only section headers, or decks that are gone from the library. */
export function isEmptyPlaylist(lib: Pick<Library, 'presentations'>, pl: Playlist): boolean {
  const ids = new Set(lib.presentations.map((p) => p.id));
  if (pl.items.some((i) => i.kind !== 'header' && 'presentationId' in i && ids.has(i.presentationId))) return false;
  // A 주일예배 keeps its decks in a folder named like the playlist: deleting the playlist would delete them too,
  // so a playlist that still owns decks that way is not empty.
  return !lib.presentations.some((p) => !!p.folder && p.folder === pl.name);
}

/** The empty playlists that may go now: not the active one, and never all of them (one playlist always stays). */
export function removableEmptyPlaylists(lib: Pick<Library, 'playlists' | 'presentations'>, activeId: string | null | undefined): Playlist[] {
  const empty = lib.playlists.filter((pl) => pl.id !== activeId && isEmptyPlaylist(lib, pl));
  // Everything is empty and nothing is active: keep the first one.
  if (empty.length >= lib.playlists.length) return empty.slice(1);
  return empty;
}

/**
 * Which playlists to remove in this pass. `since` remembers when each list was first seen empty (kept by the caller
 * between passes; lists that are no longer removable are dropped from it). `startup` removes at once.
 */
export function playlistsToAutoDelete(
  lib: Pick<Library, 'playlists' | 'presentations'>,
  activeId: string | null | undefined,
  since: Map<string, number>,
  now: number,
  startup = false,
  graceMs = EMPTY_PLAYLIST_GRACE_MS,
): Playlist[] {
  const removable = removableEmptyPlaylists(lib, activeId);
  const ids = new Set(removable.map((p) => p.id));
  for (const id of [...since.keys()]) if (!ids.has(id)) since.delete(id);
  const out: Playlist[] = [];
  for (const pl of removable) {
    if (!since.has(pl.id)) since.set(pl.id, now);
    if (startup || now - since.get(pl.id)! >= graceMs) out.push(pl);
  }
  return out;
}
