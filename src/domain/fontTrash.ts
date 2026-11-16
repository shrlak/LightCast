// A font removed from the church cloud is not deleted at once: its list entry moves to the library's font trash
// (`Library.fontTrash`) and the file stays on the server for the same number of days as the media trash
// (TRASH_DAYS in trash.ts). Restoring puts the entry back (every computer then downloads the font again); after
// the period any computer's sync deletes the file for good. Pure logic.
import type { CloudFont } from './fontSync';

/** Same as TRASH_DAYS in trash.ts (a test keeps them equal; this file stays free of other imports). */
export const FONT_TRASH_DAYS = 30;

export interface CloudFontTrash { id: string; entry: CloudFont; deletedAt: number; expiresAt: number }

/** The entry as it goes to the trash (its id is the cloud file id, so one trashed font is one row). */
export function trashFontEntry(entry: CloudFont, now: number): CloudFontTrash {
  return { id: entry.id, entry, deletedAt: now, expiresAt: now + FONT_TRASH_DAYS * 86400000 };
}

/** Add entries to the trash (a font already there keeps its first deletion time). */
export function addToFontTrash(trash: CloudFontTrash[], entries: CloudFont[], now: number): CloudFontTrash[] {
  const have = new Set(trash.map((t) => t.id));
  return [...trash, ...entries.filter((e) => !have.has(e.id)).map((e) => trashFontEntry(e, now))];
}

/** Put a trashed font back in the list. Nothing changes for an unknown or expired id. */
export function restoreFontEntry(manifest: CloudFont[], trash: CloudFontTrash[], id: string, now: number): { manifest: CloudFont[]; trash: CloudFontTrash[] } {
  const t = trash.find((x) => x.id === id && x.expiresAt > now);
  if (!t) return { manifest, trash };
  return { manifest: manifest.some((e) => e.id === id) ? manifest : [...manifest, t.entry], trash: trash.filter((x) => x.id !== id) };
}

/** Files whose trash period is over and that no list entry uses again. */
export function expiredFontFiles(trash: CloudFontTrash[], manifest: CloudFont[], now: number): string[] {
  const live = new Set(manifest.map((e) => e.id));
  return trash.filter((t) => t.expiresAt <= now && !live.has(t.id)).map((t) => t.id);
}

/** The trash after a sync round: expired ones and ones that came back to the list leave it. */
export function pruneFontTrash(trash: CloudFontTrash[], manifest: CloudFont[], now: number): CloudFontTrash[] {
  const live = new Set(manifest.map((e) => e.id));
  return trash.filter((t) => t.expiresAt > now && !live.has(t.id));
}

export const daysLeft = (t: CloudFontTrash, now: number): number => Math.max(0, Math.ceil((t.expiresAt - now) / 86400000));
