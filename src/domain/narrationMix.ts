// 동영상 만들기 › 녹음된 내레이션 포함: the pure part. Where each narration clip (the continuous recording with a cue per
// slide, older per-slide clips, or the timeline's one audio track) sits in the video, and the mix-down of the decoded
// clips into one track the audio encoder can take. No browser APIs here, so tests can run it.
import type { Presentation, Slide } from './types';

export interface NarrationSegment {
  mediaId: string;
  /** Part of the clip to use, in seconds from its start (`srcEndSec` null: to its end). */
  srcStartSec: number;
  srcEndSec: number | null;
  /** Where it starts in the video, in seconds. */
  atSec: number;
  /** The most of it that may play (so it never runs into the next slide's narration, or past the end). */
  maxSec: number;
}

/** Whether the deck has any narration to put in a video: a slide's own, or the timeline's recorded track. */
export const hasNarrationAudio = (p: Presentation | null | undefined): boolean => !!p && (!!p.timeline?.audioMediaId || p.slides.some((s) => !!s.narration));

/**
 * The narration segments for `slides` shown `secs` each, in order. A slide with a narration clip starts it at the
 * slide's start: with a cue, only the cue's part (and no longer than the slide is shown, to stay in step); without one,
 * the whole clip, until the next narrated slide begins. A deck with no slide narration but a timeline audio track
 * plays that track from the start of the video.
 */
export function narrationSegments(p: Presentation, slides: Slide[], secs: number[]): NarrationSegment[] {
  const total = secs.reduce((a, b) => a + b, 0);
  const segs: NarrationSegment[] = [];
  let t = 0;
  slides.forEach((s, i) => {
    const dur = secs[i] ?? 0;
    if (s.narration) {
      const c = s.narrationCue;
      if (c && Number.isFinite(c.startSec) && Number.isFinite(c.endSec) && c.endSec > c.startSec) {
        segs.push({ mediaId: s.narration, srcStartSec: Math.max(0, c.startSec), srcEndSec: c.endSec, atSec: t, maxSec: Math.min(dur, c.endSec - c.startSec) });
      } else {
        segs.push({ mediaId: s.narration, srcStartSec: 0, srcEndSec: null, atSec: t, maxSec: total - t });
      }
    }
    t += dur;
  });
  // A clip of its own may not run over the next narration.
  for (let i = 0; i + 1 < segs.length; i++) segs[i].maxSec = Math.max(0, Math.min(segs[i].maxSec, segs[i + 1].atSec - segs[i].atSec));
  if (segs.length) return segs;
  const track = p.timeline?.audioMediaId;
  return track ? [{ mediaId: track, srcStartSec: 0, srcEndSec: null, atSec: 0, maxSec: total }] : [];
}

/** Decoded audio: one Float32Array per channel. */
export interface Pcm { sampleRate: number; channels: Float32Array[] }

const FADE_SEC = 0.005;

/**
 * Mixes the segments into one track of `totalSec` seconds at `sampleRate` (`channels` 1 or 2). Clips decoded at another
 * rate are resampled (linear); a mono clip is put on both sides of a stereo mix; overlaps add and are limited to ±1;
 * the ends of each piece fade over 5 ms so a cut makes no click.
 */
export function mixNarration(segments: NarrationSegment[], pcm: (mediaId: string) => Pcm | null | undefined, sampleRate: number, totalSec: number, channels: 1 | 2): Float32Array[] {
  const n = Math.max(0, Math.ceil(totalSec * sampleRate));
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  const fade = Math.max(1, Math.round(FADE_SEC * sampleRate));
  for (const seg of segments) {
    const src = pcm(seg.mediaId);
    if (!src || !src.channels.length || !src.channels[0].length) continue;
    const srcLen = src.channels[0].length;
    const from = Math.max(0, Math.floor(seg.srcStartSec * src.sampleRate));
    const to = Math.min(srcLen, seg.srcEndSec === null ? srcLen : Math.ceil(seg.srcEndSec * src.sampleRate));
    const ratio = src.sampleRate / sampleRate;
    const start = Math.round(seg.atSec * sampleRate);
    const len = Math.min(Math.floor((to - from) / ratio), Math.floor(seg.maxSec * sampleRate), n - start);
    if (len <= 0 || start >= n) continue;
    for (let c = 0; c < channels; c++) {
      const ch = src.channels[Math.min(c, src.channels.length - 1)];
      const dst = out[c];
      for (let k = 0; k < len; k++) {
        const pos = from + k * ratio;
        const i0 = Math.floor(pos);
        const f = pos - i0;
        const a = ch[i0] ?? 0, b = ch[i0 + 1] ?? a;
        let v = a + (b - a) * f;
        const edge = Math.min(k, len - 1 - k);
        if (edge < fade) v *= edge / fade;
        const at = start + k;
        dst[at] = Math.max(-1, Math.min(1, dst[at] + v));
      }
    }
  }
  return out;
}

// ── Which audio codec ───────────────────────────────────────────────────────────────────────────
export interface FastAudioCodec {
  id: 'opus' | 'aac';
  /** The WebCodecs codec string. */
  codec: string;
  /** Samples per encoded frame (one AudioData handed to the encoder is a multiple of it). */
  frameSamples: number;
  sampleRate: number;
}
const AUDIO_CODECS: Record<'mp4' | 'webm', FastAudioCodec> = {
  mp4: { id: 'aac', codec: 'mp4a.40.2', frameSamples: 1024, sampleRate: 48000 },
  webm: { id: 'opus', codec: 'opus', frameSamples: 960, sampleRate: 48000 },
};

/** The audio codec that goes with a container (AAC in MP4, Opus in WebM) when `isSupported` (AudioEncoder.isConfigSupported) accepts it; null when the fast way cannot carry narration here. */
export async function pickAudioCodec(container: 'mp4' | 'webm', isSupported: (c: { codec: string; sampleRate: number; numberOfChannels: number }) => Promise<boolean>): Promise<FastAudioCodec | null> {
  const c = AUDIO_CODECS[container];
  try { if (await isSupported({ codec: c.codec, sampleRate: c.sampleRate, numberOfChannels: 2 })) return c; } catch { /* cannot be asked: not supported */ }
  return null;
}
