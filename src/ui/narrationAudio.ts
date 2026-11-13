// The browser part of 녹음된 내레이션 포함: decode the narration clips and mix them into one track aligned to the slides
// (domain/narrationMix), and encode that track with WebCodecs' AudioEncoder for the fast video export.
import { getMedia } from '../domain/media';
import { mixNarration, narrationSegments, pickAudioCodec, type FastAudioCodec, type Pcm } from '../domain/narrationMix';
import type { AudioTrack, EncodedAudio } from '../domain/videoMux';
import type { Presentation, Slide } from '../domain/types';

export const RATE = 48000;

export interface NarrationMix { sampleRate: number; channels: Float32Array[] }

/** Decodes the clips the slides use and mixes them for a video where slide i is shown secs[i] seconds; null when there is nothing to hear (or no clip can be decoded). */
export async function buildNarrationMix(p: Presentation, slides: Slide[], secs: number[]): Promise<NarrationMix | null> {
  const segs = narrationSegments(p, slides, secs);
  if (!segs.length || typeof OfflineAudioContext === 'undefined') return null;
  const decoded = new Map<string, Pcm | null>();
  for (const id of new Set(segs.map((s) => s.mediaId))) {
    try {
      const blob = await getMedia(id);
      if (!blob) { decoded.set(id, null); continue; }
      // An offline context at the target rate resamples while decoding.
      const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await blob.arrayBuffer());
      decoded.set(id, { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) });
    } catch { decoded.set(id, null); }
  }
  if (![...decoded.values()].some(Boolean)) return null;
  const total = secs.reduce((a, b) => a + b, 0);
  const stereo = [...decoded.values()].some((d) => d && d.channels.length > 1);
  return { sampleRate: RATE, channels: mixNarration(segs, (id) => decoded.get(id), RATE, total, stereo ? 2 : 1) };
}

/** The audio codec the fast way can write into this container here, or null (no AudioEncoder: the caller records in real time). */
export async function fastAudioCodec(container: 'mp4' | 'webm'): Promise<FastAudioCodec | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  return pickAudioCodec(container, async (c) => !!(await AudioEncoder.isConfigSupported({ ...c, bitrate: 96_000 })).supported);
}

/** Encodes the mixed track. Throws when the encoder fails (the caller then falls back to recording in real time). */
export async function encodeNarration(mix: NarrationMix, codec: FastAudioCodec, isCancelled: () => boolean): Promise<AudioTrack | null> {
  const channels = mix.channels.length;
  const frames: EncodedAudio[] = [];
  let description: Uint8Array | undefined;
  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const d = meta?.decoderConfig?.description;
      if (d && !description && codec.id === 'aac') description = new Uint8Array(d instanceof ArrayBuffer ? d.slice(0) : (d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
      frames.push({ data, timestampUs: chunk.timestamp, durationUs: chunk.duration ?? Math.round((codec.frameSamples / mix.sampleRate) * 1e6) });
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  try {
    encoder.configure({ codec: codec.codec, sampleRate: mix.sampleRate, numberOfChannels: channels, bitrate: 96_000, ...(codec.id === 'aac' ? { aac: { format: 'aac' as const } } : {}) });
    const total = mix.channels[0].length;
    const step = codec.frameSamples * 8;
    for (let at = 0; at < total; at += step) {
      if (isCancelled()) return null;
      if (failure) throw failure;
      const n = Math.min(step, total - at);
      // One planar buffer: channel 0's samples, then channel 1's.
      const planar = new Float32Array(n * channels);
      mix.channels.forEach((ch, c) => planar.set(ch.subarray(at, at + n), c * n));
      const data = new AudioData({ format: 'f32-planar', sampleRate: mix.sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((at / mix.sampleRate) * 1e6), data: planar });
      encoder.encode(data);
      data.close();
      while (encoder.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 2));
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
  }
  if (!frames.length) throw new Error('오디오 인코더가 소리를 만들지 못했습니다.');
  frames.sort((a, b) => a.timestampUs - b.timestampUs);
  return { codec: codec.id, sampleRate: mix.sampleRate, channels, description, frames };
}
