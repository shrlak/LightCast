// Which song is sung after the sermon, from shrlak/ppt src/lib/utils/announcement.ts — the part
// that applies without a pasted 카톡 공지 (LightCast reads the 콘티 alone here).
import type { ContiSongEntry } from '../utils/types';
import { normalizeTitle } from '../storage/library';
import { isTitleSlip, titleSimilarity } from '../utils/contiAlignment';

/** Same song: the same title, or the same title with a letter or two slipped. */
function sameTitle(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b) || isTitleSlip(a, b);
}

export function isSameSong(a: string, b: string): boolean {
  return sameTitle(a, b) || titleSimilarity(a, b) >= 0.9;
}

/**
 * Which song is sung after the sermon this week, and which conti entry it takes the place of:
 * the conti's — the song it lists right after the 공동체 고백송 — else the default from 관리자
 * 설정 (`영접송`). A conti entry of the same song lends its 악보 page and leaves the opening set.
 */
export function settlePostSermonEntry(
  entries: ContiSongEntry[],
  contiPostSermon: ContiSongEntry | undefined,
  defaultTitle: string,
): { entry: ContiSongEntry; replaces?: ContiSongEntry } | undefined {
  if (contiPostSermon) return { entry: contiPostSermon, replaces: contiPostSermon };
  const title = defaultTitle.trim();
  if (!title) return undefined;
  const found = entries.find((entry) => isSameSong(entry.title, title));
  return found ? { entry: found, replaces: found } : { entry: { title } };
}
