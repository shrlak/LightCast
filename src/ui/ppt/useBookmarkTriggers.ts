// Slide show: when a video / audio object's playback reaches a bookmark that an animation waits for (Animations › Trigger ›
// On Bookmark), play that animation. The video object reports its time with the `lightcast-mediatime` window event.
import { useEffect, useRef } from 'react';
import type { Slide } from '../../domain/types';
import type { LiveBuild } from '../../domain/animations';
import { fireBookmarkTriggers, hasBookmarkTriggers } from '../../domain/mediaBookmarkTriggers';

export function useBookmarkTriggers(slide: Slide | undefined, enabled: boolean, setBuild: (f: (b: LiveBuild | null) => LiveBuild | null) => void): void {
  const last = useRef(new Map<string, number>());
  useEffect(() => {
    last.current.clear();
    if (!slide || !enabled) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; t: number; marks: { name: string; t: number }[] }>).detail;
      if (!d || !hasBookmarkTriggers(slide, d.id)) return;
      const prev = last.current.get(d.id) ?? d.t;
      last.current.set(d.id, d.t);
      setBuild((b) => fireBookmarkTriggers(slide, b, d.id, d.marks, prev, d.t, Date.now()) ?? b);
    };
    window.addEventListener('lightcast-mediatime', on);
    return () => window.removeEventListener('lightcast-mediatime', on);
  }, [slide, enabled, setBuild]);
}
