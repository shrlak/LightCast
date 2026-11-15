// Several editor windows on the same library (View › New Window). Every window keeps the library in the browser's
// storage (persistence.ts), and the storage event tells the others; each one merges what it read with its own edits
// the way the cloud merge does (three-way, against the last copy it saw), so neither window overwrites the other.
// Pure logic; the window wiring is in src/ui/useWindowSync.ts.
import type { Library } from './types';
import { mergeLibrary, syncable } from './cloudMerge';

/** The URL hash a new window is opened with to show the same presentation. */
export const windowHash = (presentationId: string | null | undefined): string => (presentationId ? `#presentation=${encodeURIComponent(presentationId)}` : '');
export function presentationFromHash(hash: string): string | null {
  const m = /^#presentation=(.+)$/.exec(hash);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The library another window saved, merged into this window's. `base` is the last copy this window wrote to or read from
 * storage. Returns null when nothing in this window would change (so two windows settle instead of ping-ponging).
 */
export function absorbOtherWindow(base: Library | null, local: Library, stored: Library): Library | null {
  // Online songs are never stored, so they stay out of the comparison and come back after the merge.
  const own = syncable(local);
  if (same(own, stored)) return null;
  const merged = mergeLibrary(base && syncable(base), own, stored).library;
  if (same(merged, own)) return null;
  return { ...merged, presentations: [...merged.presentations, ...local.presentations.filter((p) => p.online)] };
}
