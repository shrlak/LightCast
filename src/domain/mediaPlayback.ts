// Playback (재생) of audio and video objects, after DeckCraft's media.options and Trim Media
// dialog (crates/engine/src/cmd/shape/picture.rs, crates/ui-egui/src/dialogs/trim.rs): the trimmed
// span, fades and what happens at the end.
import type { MediaPlayback } from './types';

/** Where playback starts (the trimmed start). */
export const playStart = (pb: MediaPlayback | undefined) => Math.max(0, pb?.start ?? 0);

/** Where playback stops: the trimmed end, else the clip's end. */
export const playEnd = (pb: MediaPlayback | undefined, duration: number) => (pb?.end && pb.end > playStart(pb) ? Math.min(pb.end, duration || pb.end) : duration);

/** 0–1 loudness (and, for video, opacity) at time `t` seconds from the fades in and out. */
export function fadeGain(t: number, pb: MediaPlayback | undefined, duration: number): number {
  if (!pb) return 1;
  const from = playStart(pb), to = playEnd(pb, duration);
  let g = 1;
  if (pb.fadeIn && pb.fadeIn > 0) g = Math.min(g, (t - from) / pb.fadeIn);
  if (pb.fadeOut && pb.fadeOut > 0 && Number.isFinite(to) && to > 0) g = Math.min(g, (to - t) / pb.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/** The volume to set: the object's volume (낮게 / 중간 / 높게 / 음소거) times the fade. */
export const playVolume = (pb: MediaPlayback | undefined, t: number, duration: number, master = 1) =>
  pb?.muted ? 0 : Math.max(0, Math.min(1, master * (pb?.volume ?? 1) * fadeGain(t, pb, duration)));

/** What to do at time `t`: keep going, loop back to the start, or stop (rewinding when asked). */
export function atEnd(t: number, pb: MediaPlayback | undefined, duration: number): 'play' | 'loop' | 'stop' | 'rewind' {
  const to = playEnd(pb, duration);
  if (!(to > 0) || t < to - 0.05) return 'play';
  if (pb?.loop) return 'loop';
  return pb?.rewind ? 'rewind' : 'stop';
}

/** The Volume menu (DeckCraft: 낮게 25 %, 중간 50 %, 높게 100 %, 음소거). */
export const VOLUME_STEPS: [label: string, patch: Partial<MediaPlayback>][] = [
  ['낮게', { volume: 0.25, muted: undefined }], ['중간', { volume: 0.5, muted: undefined }], ['높게', { volume: undefined, muted: undefined }], ['음소거', { muted: true }],
];

/** Seconds for a Trim / Fade field, three decimals with trailing zeros dropped (DeckCraft ms_as_seconds). */
export function secondsText(s: number | undefined): string {
  const t = (Math.round((s ?? 0) * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return t || '0';
}

/** A Trim / Fade field back to seconds: blank, junk and negatives are 0, rounded to the millisecond. */
export function parseSeconds(text: string): number {
  const v = Number(text.trim());
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : 0;
}

/** Playback settings without the defaults, so an object with none stores none. */
export function cleanPlayback(pb: MediaPlayback): MediaPlayback | undefined {
  const out = Object.fromEntries(Object.entries(pb).filter(([k, v]) => v !== undefined && v !== false && (v !== 0 || k === 'volume'))) as MediaPlayback;
  return Object.keys(out).length ? out : undefined;
}
