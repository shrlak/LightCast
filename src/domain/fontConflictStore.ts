// The faces the library lists with two different files (found by the last font sync round), kept in memory so the
// font manager can show them. No network, no browser.
import type { FontConflict } from './fontSync';

let current: FontConflict[] = [];
const listeners = new Set<() => void>();

export const getFontConflicts = (): FontConflict[] => current;
export function setFontConflicts(list: FontConflict[]): void {
  if (JSON.stringify(list) === JSON.stringify(current)) return;
  current = list;
  listeners.forEach((l) => { try { l(); } catch { /* one listener must not break the others */ } });
}
export function subscribeFontConflicts(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
