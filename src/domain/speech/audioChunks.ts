// Pure helpers for the cloud provider: when to cut an audio chunk, and cleaning what comes back.

/** Loudness (0..1 RMS) above which a moment counts as speech. */
export const SPEECH_LEVEL = 0.015;
export const isLoud = (rms: number): boolean => rms >= SPEECH_LEVEL;

export interface ChunkTiming { minMs: number; maxMs: number; pauseMs: number }
/** A chunk is at most ~3 s; it is cut early at a pause (after at least 1.5 s) so words are not split. */
export const CHUNK_TIMING: ChunkTiming = { minMs: 1500, maxMs: 3000, pauseMs: 400 };

export interface ChunkProgress { elapsedMs: number; silentMs: number; heardSpeech: boolean }

/** Should the recording window end now? */
export function shouldCutChunk(p: ChunkProgress, t: ChunkTiming = CHUNK_TIMING): boolean {
  if (p.elapsedMs >= t.maxMs) return true;
  return p.heardSpeech && p.elapsedMs >= t.minMs && p.silentMs >= t.pauseMs;
}

/** Tracks one chunk while level samples come in. */
export class ChunkMeter {
  elapsedMs = 0;
  silentMs = 0;
  heardSpeech = false;
  constructor(private timing: ChunkTiming = CHUNK_TIMING) {}
  /** Add one sample; returns true when the chunk should be cut. */
  sample(rms: number, dtMs: number): boolean {
    this.elapsedMs += dtMs;
    if (isLoud(rms)) { this.heardSpeech = true; this.silentMs = 0; } else this.silentMs += dtMs;
    return shouldCutChunk(this, this.timing);
  }
}

/** Phrases speech models make up from silence or noise; never worth showing as captions. */
const PHANTOMS = [
  /^(시청해 주셔서 )?감사합니다[.!]?$/, /^구독과 좋아요/, /^자막 제공/, /^thanks for watching[.!]?$/i, /^thank you[.!]?$/i, /^you[.!]?$/i, /^\.+$/, /^bye[.!]?$/i,
];
export const isPhantom = (text: string): boolean => { const t = text.trim(); return !t || PHANTOMS.some((r) => r.test(t)); };

/**
 * Chunks are cut mid-sentence, and models sometimes repeat the last words of the previous chunk.
 * Drop a start of `text` that equals the end of `prev` (at least 2 words, or one word of 4+ letters).
 */
export function dedupeOverlap(prev: string, text: string): string {
  const p = prev.trim().split(/\s+/).filter(Boolean);
  const t = text.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(p.length, t.length, 8); n >= 1; n--) {
    const a = p.slice(-n).join(' ');
    const b = t.slice(0, n).join(' ');
    if (a === b && (n >= 2 || b.length >= 4)) return t.slice(n).join(' ');
  }
  return t.join(' ');
}
