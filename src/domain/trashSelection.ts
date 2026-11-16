// 휴지통 select all / delete all: which entries the list shows, which of them are selected, and what each button
// acts on. Kept apart from the screen so the rules can be tested.
import type { TrashEntry } from './types';

/** The entries the list shows: not expired, matching the search, newest first. */
export function visibleTrash(trash: readonly TrashEntry[] | undefined, query: string, now: number): TrashEntry[] {
  const q = query.trim().toLowerCase();
  return [...(trash ?? [])]
    .filter((e) => e.expiresAt > now && (!q || e.presentation.title.toLowerCase().includes(q)))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

/** The selected ids that are still in the list (an entry that left the list, by search or deletion, is no longer selected). */
export function selectedVisible(visible: readonly TrashEntry[], selected: ReadonlySet<string>): string[] {
  return visible.filter((e) => selected.has(e.id)).map((e) => e.id);
}

export type SelectAllState = 'none' | 'some' | 'all';
export function selectAllState(visible: readonly TrashEntry[], selected: ReadonlySet<string>): SelectAllState {
  const n = selectedVisible(visible, selected).length;
  return !visible.length || n === 0 ? 'none' : n === visible.length ? 'all' : 'some';
}

/** The 모두 선택 box: everything shown when not all of it is selected, otherwise nothing. */
export function toggleSelectAll(visible: readonly TrashEntry[], selected: ReadonlySet<string>): Set<string> {
  return selectAllState(visible, selected) === 'all' ? new Set() : new Set(visible.map((e) => e.id));
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * 모두 삭제: everything shown. With a search active that is only the matches (the label says so), never entries the
 * list does not show.
 */
export const deleteAllTargets = (visible: readonly TrashEntry[]): string[] => visible.map((e) => e.id);
