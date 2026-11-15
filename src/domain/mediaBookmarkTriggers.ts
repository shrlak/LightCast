// Animations › Trigger › On Bookmark: an animation can start when a video / audio object's playback reaches one of its
// bookmarks (PowerPoint's "책갈피에서"). The engine only knows click triggers (an object id), so a bookmark trigger
// is stored as `trigger: <media object id>` plus `bookmark: <name>` and reaching the bookmark plays the next step of
// that object's triggered sequence, exactly like a click on it would. Pure logic.
import type { Slide } from './types';
import { clickTrigger, triggerObjects, type LiveBuild } from './animations';
import type { Bookmark } from './mediaMarks';

/** A jump longer than this between two time updates is a seek, not playback: bookmarks inside it do not fire. */
export const MAX_PLAY_STEP = 1.5;

/** The bookmarks passed while playing from `prev` to `t` (seconds): later than `prev`, not later than `t`. */
export function bookmarksReached(marks: Bookmark[] | undefined, prev: number, t: number): Bookmark[] {
  if (!marks?.length || !(t > prev) || t - prev > MAX_PLAY_STEP) return [];
  return marks.filter((b) => b.t > prev && b.t <= t).sort((a, b) => a.t - b.t);
}

/** Do any animations of the slide start at a bookmark of this media object? */
export const hasBookmarkTriggers = (slide: Slide, mediaId: string): boolean => (slide.animations ?? []).some((a) => a.trigger === mediaId && !!a.bookmark);

/** The names of the bookmarks of `mediaId` that start an animation. */
export const triggeringBookmarks = (slide: Slide, mediaId: string): Set<string> =>
  new Set((slide.animations ?? []).flatMap((a) => (a.trigger === mediaId && a.bookmark ? [a.bookmark] : [])));

/** Objects a click starts a sequence on: those whose triggered effects are not all bookmark-driven. */
export function clickTriggerObjects(slide: Slide): string[] {
  const anims = slide.animations ?? [];
  return triggerObjects(slide).filter((id) => {
    const mine = anims.filter((a) => a.trigger === id);
    return !mine.length || mine.some((a) => !a.bookmark);
  });
}

/**
 * Playback of media object `mediaId` went from `prev` to `t`: each bookmark passed that an animation waits for plays one
 * step of the object's triggered sequence. Null when nothing starts (the build stays as it is).
 */
export function fireBookmarkTriggers(slide: Slide, build: LiveBuild | undefined | null, mediaId: string, marks: Bookmark[] | undefined, prev: number, t: number, now: number): LiveBuild | null {
  const wanted = triggeringBookmarks(slide, mediaId);
  if (!wanted.size) return null;
  let cur: LiveBuild | null = null;
  for (const b of bookmarksReached(marks, prev, t)) {
    if (!wanted.has(b.name)) continue;
    cur = clickTrigger(slide, cur ?? build, mediaId, now) ?? cur;
  }
  return cur;
}
