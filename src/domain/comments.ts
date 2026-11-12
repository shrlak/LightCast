// Review › Comments as DeckCraft's comment.* commands: threads in deck order, Previous / Next across
// slides (stopping at the ends), and Delete for one comment, a slide or the whole presentation.
import type { Slide, SlideComment } from './types';

export interface CommentRef { slide: number; index: number }

/** Every comment of the presentation, slide by slide, in order. */
export function commentThreads(slides: Slide[]): CommentRef[] {
  const out: CommentRef[] = [];
  slides.forEach((s, slide) => (s.comments ?? []).forEach((_, index) => out.push({ slide, index })));
  return out;
}

/**
 * The comment Previous / Next goes to (DeckCraft `neighbour`). From a comment (`index` given and
 * found) it moves one step and stops at the ends; without one, Next is the first comment on or after
 * `slide` and Previous the last one before it. null: none (no comments, or no more).
 */
export function neighbourComment(slides: Slide[], slide: number, index: number | null, forward: boolean): CommentRef | null {
  const all = commentThreads(slides);
  if (!all.length) return null;
  const pos = index == null ? -1 : all.findIndex((t) => t.slide === slide && t.index === index);
  if (pos >= 0) return all[forward ? pos + 1 : pos - 1] ?? null;
  return (forward ? all.find((t) => t.slide >= slide) : [...all].reverse().find((t) => t.slide < slide)) ?? null;
}

/** The author's initials, as DeckCraft saves them on a comment (first letter of each word). */
export const initialsOf = (author: string) => author.split(/\s+/).filter(Boolean).map((w) => [...w][0]).join('').slice(0, 3) || '?';

/** Delete one comment, every comment of a slide, or every comment of the presentation. */
export function deleteComments(slides: Slide[], what: { slideId: string; id?: string } | 'all'): Slide[] {
  return slides.map((s) => {
    if (what !== 'all' && s.id !== what.slideId) return s;
    if (!s.comments?.length) return s;
    const left: SlideComment[] = what === 'all' || !what.id ? [] : s.comments.filter((c) => c.id !== what.id);
    return { ...s, comments: left.length ? left : undefined };
  });
}

export const commentCount = (slides: Slide[]) => slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0);
