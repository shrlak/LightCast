import type { Library, Presentation, TrashEntry } from './types';
import { sequence } from './arrangement';
import { insertSlideAt } from './slideEditing';
import { uid } from './lyrics';
import { titleKey } from './sunday/songs';
import { exclusivePresentationMedia } from './mediaCleanup';

export const TRASH_DAYS = 30;
const lifetime = TRASH_DAYS * 86400000;
export function trashPresentation(lib: Library, p: Presentation, now: number): TrashEntry {
  return { id: uid('trash'), kind: 'presentation', deletedAt: now, expiresAt: now + lifetime, presentation: p,
    placements: lib.playlists.flatMap((pl) => pl.items.flatMap((item, index) => item.kind !== 'header' && item.presentationId === p.id ? [{ playlistId: pl.id, index, item }] : [])) };
}
export function trashSlides(before: Presentation, after: Presentation, seqs: number[], now: number): TrashEntry | null {
  const old = sequence(before), next = sequence(after);
  const deleted = new Set(seqs.filter((i) => Number.isInteger(i) && !!old[i]));
  if (!deleted.size || old.length === next.length) return null;
  const remaining = old.flatMap((_, i) => deleted.has(i) ? [] : [i]);
  const anchor = (i: number) => i < 0 || !next[i] ? undefined : { id: next[i].slide.id, occurrence: next.slice(0, i).filter((x) => x.slide.id === next[i].slide.id).length };
  return { id: uid('trash'), kind: 'slides', presentation: before, deletedAt: now, expiresAt: now + lifetime,
    slides: [...deleted].sort((a, b) => a - b).map((seq) => {
      const following = remaining.findIndex((i) => i > seq);
      const index = following < 0 ? next.length : following;
      return { slide: old[seq].slide, seq, previous: anchor(index - 1), next: anchor(index) };
    }) };
}
function restoredTitle(lib: Library, title: string): string {
  const taken = new Set(lib.presentations.map((p) => titleKey(p.title)));
  let next = title, n = 1;
  while (taken.has(titleKey(next))) { next = `${title} 복원본${n === 1 ? '' : ` ${n}`}`; n++; }
  return next;
}
const restoredFolder = (p: Presentation) => /^\d{4} 주일예배$/.test(p.folder ?? '') ? '복원한 자료' : p.online ? 'Songs' : p.folder;

export function restoreTrash(lib: Library, id: string, now: number, seq?: number): Library {
  const entry = lib.trash?.find((e) => e.id === id && e.expiresAt > now);
  if (!entry) return lib;
  if (entry.kind === 'slides' && seq == null) {
    let next = lib;
    for (const page of entry.slides ?? []) next = restoreTrash(next, id, now, page.seq);
    return next;
  }
  let p = lib.presentations.find((p) => p.id === entry.presentation.id);
  let playlists = lib.playlists;
  if (entry.kind === 'presentation') {
    p = { ...entry.presentation, id: p ? uid('p') : entry.presentation.id, title: restoredTitle(lib, entry.presentation.title), online: undefined, updatedAt: now,
      folder: restoredFolder(entry.presentation) };
    const restored = p;
    playlists = lib.playlists.map((pl) => {
      const items = [...pl.items];
      for (const place of entry.placements ?? []) if (place.playlistId === pl.id) {
        if (place.item.kind !== 'header') items.splice(Math.min(place.index, items.length), 0, { ...place.item, id: uid('item'), presentationId: restored.id });
      }
      return { ...pl, items };
    });
    return { ...lib, playlists, presentations: [...lib.presentations, restored], trash: lib.trash!.filter((e) => e.id !== id) };
  }
  p ??= { ...entry.presentation, title: restoredTitle(lib, entry.presentation.title), slides: [], arrangements: entry.presentation.arrangements?.map((a) => ({ ...a, groups: [] })), songSource: { sections: [], order: [] }, online: undefined, folder: restoredFolder(entry.presentation) };
  const item = (entry.slides ?? []).find((s) => seq == null || s.seq === seq);
  if (!item) return lib;
  const pages = sequence(p);
  const locate = (a: typeof item.next) => a ? pages.flatMap((x, i) => x.slide.id === a.id ? [i] : [])[a.occurrence] : undefined;
  const at = Math.min(pages.length, locate(item.next) ?? ((locate(item.previous) ?? item.seq - 1) + 1));
  p = { ...insertSlideAt(p, item.slide, at), updatedAt: now };
  const restored = p, result = sequence(p);
  const anchor = (i: number) => ({ id: result[i].slide.id, occurrence: result.slice(0, i).filter((x) => x.slide.id === result[i].slide.id).length });
  const remap = (a: typeof item.next) => { const pos = locate(a); return pos == null ? a : anchor(pos >= at ? pos + 1 : pos); };
  const trash = lib.trash!.flatMap((e) => {
    if (e.kind !== 'slides' || e.presentation.id !== restored.id) return [e];
    const remaining = e.slides?.filter((s) => e.id !== id || s.seq !== item.seq).map((s) => {
      let previous = remap(s.previous), next = remap(s.next);
      // The restored page becomes the nearest neighbor of other pages in this deletion.
      if (e.id === id && s.seq < item.seq && (locate(s.next) ?? Infinity) >= at) next = anchor(at);
      if (e.id === id && s.seq > item.seq && (locate(s.previous) ?? -1) < at) previous = anchor(at);
      return { ...s, previous, next };
    });
    return remaining?.length ? [{ ...e, slides: remaining }] : [];
  });
  return { ...lib, presentations: lib.presentations.some((x) => x.id === restored.id) ? lib.presentations.map((x) => x.id === restored.id ? restored : x) : [...lib.presentations, restored], trash };
}
export function purgeTrash(lib: Library, ids: string[]): Library {
  const removed = (lib.trash ?? []).filter((e) => ids.includes(e.id));
  if (!removed.length) return lib;
  const trash = (lib.trash ?? []).filter((e) => !ids.includes(e.id));
  const virtual = removed.map((e) => ({ ...e.presentation, id: `trash-media:${e.id}` }));
  const exclusive = new Set(exclusivePresentationMedia({ ...lib, trash, presentations: [...lib.presentations, ...virtual] }, virtual.map((p) => p.id)));
  return { ...lib, trash, media: lib.media.filter((m) => !exclusive.has(m.id)) };
}

/** The media files that leave the library when these 휴지통 entries are deleted for good (the ones nothing else uses). */
export function mediaFreedByPurge(lib: Library, ids: string[]): string[] {
  const after = new Set(purgeTrash(lib, ids).media.map((m) => m.id));
  return lib.media.filter((m) => !after.has(m.id)).map((m) => m.id);
}
