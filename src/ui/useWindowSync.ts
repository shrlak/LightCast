// Keeps this editor window in step with other editor windows of the same app (View › New Window): when another window saves
// the library, its changes are merged in here (src/domain/windowSync.ts). A window opened with #presentation=<id> shows that deck.
import { useEffect, useRef, type Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { Library } from '../domain/types';
import { loadLibrary } from '../domain/persistence';
import { absorbOtherWindow, presentationFromHash } from '../domain/windowSync';

const LIBRARY_KEY = 'freecast.library.v1';

export function useWindowSync(library: Library, dispatch: Dispatch<Action>): void {
  const latest = useRef(library); latest.current = library;
  // The last copy this window wrote to or read from storage: the common ancestor of the merge.
  const base = useRef<Library | null>(null);
  useEffect(() => { base.current = library; }, [library]);
  useEffect(() => {
    const id = presentationFromHash(window.location.hash);
    if (id && latest.current.presentations.some((p) => p.id === id)) dispatch({ type: 'select', id });
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LIBRARY_KEY) return;
      const stored = loadLibrary();
      const merged = absorbOtherWindow(base.current, latest.current, stored);
      base.current = stored;
      if (merged) dispatch({ type: 'library/merge', library: merged });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
