// Video / audio bookmarks and the poster frame (DeckCraft media.posterFrame, clip bookmarks (name, ms) and
// media.info). Times are seconds on the clip's own timeline.
import type { MediaPlayback } from './types';

export type Bookmark = NonNullable<MediaPlayback['bookmarks']>[number];

/** 0:07 / 1:02:03 — the time as a player shows it. */
export function formatClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** A bookmark at `t` (rounded to a tenth of a second), kept in time order; a second bookmark at the same moment is not added. */
export function addBookmark(list: Bookmark[] | undefined, t: number, name?: string): Bookmark[] {
  const at = Math.max(0, Math.round(t * 10) / 10);
  const cur = list ?? [];
  if (cur.some((b) => Math.abs(b.t - at) < 0.05)) return cur;
  return [...cur, { name: name?.trim() || `책갈피 ${cur.length + 1}`, t: at }].sort((a, b) => a.t - b.t);
}

export const removeBookmark = (list: Bookmark[] | undefined, i: number): Bookmark[] => (list ?? []).filter((_, k) => k !== i);

/** The bookmark to jump to from `t`: the next one later than now (`dir` 1) or the previous one earlier than now (-1); null at the ends. */
export function stepBookmark(list: Bookmark[] | undefined, t: number, dir: 1 | -1): Bookmark | null {
  const sorted = [...(list ?? [])].sort((a, b) => a.t - b.t);
  return (dir === 1 ? sorted.find((b) => b.t > t + 0.05) : [...sorted].reverse().find((b) => b.t < t - 0.05)) ?? null;
}

/** What a browser can learn about a clip by loading its metadata (DeckCraft media.info's duration and picture size). */
export interface MediaProbe { duration: number; width: number; height: number; bytes: number }

/** Reads a clip's duration and picture size from its bytes with a detached media element; null when the browser cannot play it. */
export function probeMedia(url: string, kind: 'audio' | 'video', bytes: number): Promise<MediaProbe | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const done = (r: MediaProbe | null) => { el.removeAttribute('src'); el.load(); resolve(r); };
    const t = setTimeout(() => done(null), 8000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => { clearTimeout(t); done({ duration: Number.isFinite(el.duration) ? el.duration : 0, width: (el as HTMLVideoElement).videoWidth || 0, height: (el as HTMLVideoElement).videoHeight || 0, bytes }); };
    el.onerror = () => { clearTimeout(t); done(null); };
    el.src = url;
  });
}
