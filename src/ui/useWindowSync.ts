// Keeps this editor window in step with other editor windows of the same app (View › New Window): when another window saves
// the library, its changes are merged in here (src/domain/windowSync.ts). A window opened with #presentation=<id> shows that deck.
import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { Library } from '../domain/types';
import { libraryChangedElsewhere } from '../domain/persistence';
import { absorbOtherWindow, presentationFromHash } from '../domain/windowSync';

const LIBRARY_KEY = 'freecast.library.v1';

/**
 * Returns `beforeSave`: call it right before this window saves its library. When another window saved meanwhile it
 * merges that save in (and returns true: save after the merge, not now), so no window writes over another's work.
 */
export function useWindowSync(library: Library, dispatch: Dispatch<Action>): () => boolean {
  const latest = useRef(library); latest.current = library;
  // The last copy this window read from storage (at start, and at every other window's save): the common ancestor of
  // the merge. Not this window's own saves — when both windows save before hearing of each other, the other's save
  // must still look like a change to merge, not like this window's edits being taken back.
  const base = useRef<Library | null>(library);
  useEffect(() => {
    const id = presentationFromHash(window.location.hash);
    if (id && latest.current.presentations.some((p) => p.id === id)) dispatch({ type: 'select', id });
    const onStorage = (e: StorageEvent) => { if (e.key === LIBRARY_KEY) reconcile(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Merge another window's save, if there was one since this window last read or wrote. True when it dispatched a merge. */
  const reconcile = useCallback((): boolean => {
    const stored = libraryChangedElsewhere();
    if (!stored) return false;
    const from = latest.current;
    const merged = absorbOtherWindow(base.current, from, stored);
    base.current = stored;
    if (!merged) return false;
    dispatch({ type: 'library/merge', library: merged, from });
    return true;
  }, [dispatch]);
  return reconcile;
}
