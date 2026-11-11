import type { Library, LiveState, Playlist, Presentation, Slide, Theme } from './types';
import { sequence } from './arrangement';
import { resolveBackground } from './autoBackground';
import { songKey, stageSettingsFor } from './chordChart';
import { initialBuild } from './animations';

export interface Cursor {
  presentationId: string;
  /** Position in the presentation's play sequence (arrangement order). */
  seq: number;
  playlistIndex?: number | null;
}

export interface NavState {
  library: Library;
  activePlaylistId: string;
  playlistIndex: number | null;
  cursor: Cursor | null;
  live: LiveState;
}

export const findPres = (lib: Library, id: string) => lib.presentations.find((p) => p.id === id);
export const activePlaylist = (s: NavState): Playlist | undefined =>
  s.library.playlists.find((p) => p.id === s.activePlaylistId) ?? s.library.playlists[0];

export function themeFor(lib: Library, p: Presentation): Theme {
  return lib.themes.find((t) => t.id === p.themeId) ?? lib.themes[0];
}

function playable(p: Presentation, from: number, step: 1 | -1): number | null {
  const seq = sequence(p);
  for (let i = from; i >= 0 && i < seq.length; i += step) if (!seq[i].slide.disabled) return i;
  return null;
}

function itemPresentation(s: NavState, i: number): Presentation | undefined {
  const item = activePlaylist(s)?.items[i];
  return item && item.kind !== 'header' ? findPres(s.library, item.presentationId) : undefined;
}

/** Where a presentation sits in the playlist, so a show started on it carries on into the next items. */
export function playlistIndexFor(s: NavState, presentationId: string): number | null {
  const cur = s.playlistIndex;
  if (cur != null && itemPresentation(s, cur)?.id === presentationId) return cur;
  const i = (activePlaylist(s)?.items ?? []).findIndex((it) => it.kind !== 'header' && it.presentationId === presentationId);
  return i >= 0 ? i : cur;
}

/** Playlist position of the slide at `c`: its own, else where its presentation sits in the playlist. */
function positionOf(s: NavState, c: Cursor): number | null {
  const pi = c.playlistIndex ?? s.playlistIndex;
  return pi != null && itemPresentation(s, pi)?.id === c.presentationId ? pi : playlistIndexFor(s, c.presentationId);
}

/** The slide after `c`, continuing into the next playlist item when playing from the playlist. */
export function nextCursor(s: NavState, c: Cursor): Cursor | null {
  const p = findPres(s.library, c.presentationId);
  const here = p ? playable(p, c.seq + 1, 1) : null;
  if (here != null) return { ...c, seq: here };
  if (p?.loop) {
    const first = playable(p, 0, 1);
    return first != null ? { ...c, seq: first } : null;
  }
  const items = activePlaylist(s)?.items ?? [];
  const pi = positionOf(s, c);
  if (pi == null || itemPresentation(s, pi)?.id !== c.presentationId) return null;
  for (let i = pi + 1; i < items.length; i++) {
    const np = itemPresentation(s, i);
    const first = np ? playable(np, 0, 1) : null;
    if (np && first != null) return { presentationId: np.id, seq: first, playlistIndex: i };
  }
  return null;
}

/**
 * Every slide still to come, in the order the show plays them (across the playlist), starting
 * with the first slide of `selectedId` when nothing is live yet.
 */
export function upcomingCursors(s: NavState, selectedId: string | null, limit = 400): Cursor[] {
  const out: Cursor[] = [];
  let c = s.cursor;
  if (!c) {
    const p = selectedId ? findPres(s.library, selectedId) : undefined;
    const first = p ? playable(p, 0, 1) : null;
    if (!p || first == null) return out;
    c = { presentationId: p.id, seq: first, playlistIndex: playlistIndexFor(s, p.id) };
    out.push(c);
  }
  const seen = new Set<string>();
  for (let n = nextCursor(s, c); n && out.length < limit; n = nextCursor(s, n)) {
    const key = `${n.presentationId}:${n.seq}:${n.playlistIndex ?? ''}`;
    if (seen.has(key)) break;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function prevCursor(s: NavState, c: Cursor): Cursor | null {
  const p = findPres(s.library, c.presentationId);
  const here = p ? playable(p, c.seq - 1, -1) : null;
  if (here != null) return { ...c, seq: here };
  const pi = positionOf(s, c);
  if (pi == null || itemPresentation(s, pi)?.id !== c.presentationId) return null;
  for (let i = pi - 1; i >= 0; i--) {
    const np = itemPresentation(s, i);
    const last = np ? playable(np, sequence(np).length - 1, -1) : null;
    if (np && last != null) return { presentationId: np.id, seq: last, playlistIndex: i };
  }
  return null;
}

export function slideAt(lib: Library, c: Cursor): Slide | undefined {
  const p = findPres(lib, c.presentationId);
  return p ? sequence(p)[c.seq]?.slide : undefined;
}

function copyrightLine(p: Presentation): string | null {
  if (!p.showCopyright || !p.meta) return null;
  const { author, copyright, ccli } = p.meta;
  const parts = [author, copyright && `© ${copyright}`, ccli && `CCLI #${ccli}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Put the slide at `c` on screen. Returns the new state, or `s` unchanged if the slide does not exist. */
export function goLive<S extends NavState>(s: S, c: Cursor, now: number = Date.now()): S {
  const p = findPres(s.library, c.presentationId);
  const slide = p ? sequence(p)[c.seq]?.slide : undefined;
  if (!p || !slide) return s;
  const cursor: Cursor = { ...c, playlistIndex: c.playlistIndex ?? s.playlistIndex };
  const next = nextCursor(s, cursor);
  const nextSlide = next ? slideAt(s.library, next) : undefined;
  const crossed = cursor.playlistIndex != null && cursor.playlistIndex !== s.playlistIndex;
  const first = c.seq === 0 || s.cursor?.presentationId !== p.id;
  const entering = s.cursor?.presentationId !== p.id;
  return {
    ...s,
    cursor,
    playlistIndex: crossed ? cursor.playlistIndex ?? null : s.playlistIndex,
    live: {
      ...s.live,
      slide,
      title: p.title,
      nextText: nextSlide ? [nextSlide.title, nextSlide.text].filter(Boolean).join('\n') : null,
      theme: themeFor(s.library, p),
      transition: p.showSetup?.noTransitions ? { kind: 'cut', duration: 1 } : slide.transition ?? p.transition ?? s.live.transition,
      background: resolveBackground(slide, p),
      bgEffect: p.bgEffect ?? null,
      build: p.showSetup?.noAnimation ? undefined : initialBuild(slide, now),
      number: c.seq + 1,
      black: false,
      songKey: songKey(p),
      ...(entering ? songKeyOnStage(s, p) : {}),
      copyright: first || !next || next.presentationId !== p.id ? copyrightLine(p) : null,
    },
  };
}

/**
 * A song with its own play key / capo sets the stage chords when it comes on; the next song without one
 * starts from the written key again. A shift the operator typed in by hand is left alone for songs that have none.
 */
function songKeyOnStage(s: NavState, p: Presentation): Pick<LiveState, 'chordShift' | 'capo'> | null {
  const own = stageSettingsFor(p);
  if (own) return { chordShift: own.shift, capo: own.capo };
  const before = s.cursor ? findPres(s.library, s.cursor.presentationId) : undefined;
  return before && stageSettingsFor(before) ? { chordShift: 0, capo: 0 } : null;
}
