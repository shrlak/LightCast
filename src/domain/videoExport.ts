// File › Export › 동영상 만들기 / 애니메이션 GIF: the pure part. How long each slide is shown (its saved timing,
// else the chosen default), the 4:3 frame sizes for 720p / 1080p, and which video file type the browser can write.
import type { Presentation, Slide } from './types';
import { sequence } from './arrangement';

export const VIDEO_SIZES: { id: 'hd720' | 'hd1080'; label: string; width: number; height: number }[] = [
  { id: 'hd720', label: '720p (960 × 720)', width: 960, height: 720 },
  { id: 'hd1080', label: '1080p (1440 × 1080)', width: 1440, height: 1080 },
];

export const GIF_SIZES: { id: string; label: string; width: number }[] = [
  { id: 'small', label: '작게 (480 × 360)', width: 480 },
  { id: 'medium', label: '보통 (640 × 480)', width: 640 },
  { id: 'large', label: '크게 (800 × 600)', width: 800 },
];

export const DEFAULT_SECONDS = 5;
export const clampSeconds = (s: number): number => (Number.isFinite(s) ? Math.min(600, Math.max(0.1, s)) : DEFAULT_SECONDS);

/**
 * Seconds each slide of `slides` (in show order) is shown: the slide's 자동 넘김 time, else the recorded
 * timing (the timeline's cue to the next slide), else `defaultSeconds`. With `useSaved` false every slide gets the default.
 */
export function slideDurations(p: Presentation, slides: Slide[], defaultSeconds: number, useSaved: boolean): number[] {
  const def = clampSeconds(defaultSeconds);
  if (!useSaved) return slides.map(() => def);
  const seq = sequence(p);
  const cues = [...(p.timeline?.cues ?? [])].sort((a, b) => a.t - b.t);
  return slides.map((s) => {
    if (s.autoAdvance && s.autoAdvance > 0) return clampSeconds(s.autoAdvance);
    const pos = seq.findIndex((x) => x.slide.id === s.id);
    const i = cues.findIndex((c) => c.seq === pos);
    if (i >= 0 && i + 1 < cues.length && cues[i + 1].t > cues[i].t) return clampSeconds(cues[i + 1].t - cues[i].t);
    return def;
  });
}

/** GIF frame delay in hundredths of a second for a time in seconds (browsers play < 2 cs too fast). */
export const gifDelayCs = (seconds: number): number => Math.max(2, Math.round(seconds * 100));

export interface VideoType { mime: string; ext: 'webm' | 'mp4'; label: string }
/** The best video type `isSupported` (MediaRecorder.isTypeSupported) accepts: MP4 when the browser can write it, else WebM. */
export function pickVideoType(isSupported: (mime: string) => boolean): VideoType | null {
  const candidates: VideoType[] = [
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4', label: 'MP4' },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM' },
  ];
  return candidates.find((c) => isSupported(c.mime)) ?? null;
}
