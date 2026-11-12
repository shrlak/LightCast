// The same 주일예배 cleanup the app runs (5 pm Sunday), as a pure step the scheduled server job can run
// while no LightCast window is open: log in, read the church library, call this, write the result back.
import { createInitialState, reducer } from '../reducer';
import type { Library } from '../types';
import { finishedServices } from './cleanup';

export interface ServerCleanup {
  library: Library;
  /** Media ids the cleanup dropped from the library: delete these files from the server too. */
  removedMediaIds: string[];
  removedPlaylists: number;
  removedPresentations: number;
}

/** null when no service has ended (or nothing of it is left to remove). */
export function cleanupFinishedServices(lib: Library, now: Date): ServerCleanup | null {
  const done = finishedServices(lib, now);
  if (!done.playlistIds.length && !done.presentationIds.length) return null;
  const next = reducer(createInitialState(lib), { type: 'services/finish', ...done, occurredAt: now.getTime() }).library;
  const kept = new Set(next.media.map((m) => m.id));
  return {
    library: next,
    removedMediaIds: lib.media.filter((m) => !kept.has(m.id)).map((m) => m.id),
    removedPlaylists: done.playlistIds.length,
    removedPresentations: done.presentationIds.length,
  };
}
