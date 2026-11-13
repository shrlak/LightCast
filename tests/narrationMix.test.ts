// 동영상 만들기 › 녹음된 내레이션 포함: where each clip sits in the video, the mix-down, and the audio codec choice.
import { describe, expect, it } from 'vitest';
import { hasNarrationAudio, mixNarration, narrationSegments, pickAudioCodec, type Pcm } from '../src/domain/narrationMix';
import type { Presentation, Slide } from '../src/domain/types';

const slide = (id: string, extra: Partial<Slide> = {}) => ({ id, ...extra }) as Slide;
const deck = (slides: Slide[], audioMediaId: string | null = null) => ({ slides, timeline: audioMediaId ? { audioMediaId, cues: [] } : undefined }) as unknown as Presentation;

describe('narration segments', () => {
  it("puts a continuous recording's part at each slide start, as long as the slide is shown", () => {
    const slides = [slide('a', { narration: 'rec', narrationCue: { startSec: 0, endSec: 4 } }), slide('b', { narration: 'rec', narrationCue: { startSec: 4, endSec: 12 } }), slide('c')];
    const segs = narrationSegments(deck(slides), slides, [4, 6, 3]);
    expect(segs).toEqual([
      { mediaId: 'rec', srcStartSec: 0, srcEndSec: 4, atSec: 0, maxSec: 4 },
      { mediaId: 'rec', srcStartSec: 4, srcEndSec: 12, atSec: 4, maxSec: 6 }, // the slide is shown 6 s: cut to stay in step
    ]);
  });
  it('lets an older per-slide clip run until the next narrated slide starts', () => {
    const slides = [slide('a', { narration: 'x' }), slide('b'), slide('c', { narration: 'y' })];
    const segs = narrationSegments(deck(slides), slides, [2, 3, 4]);
    expect(segs.map((s) => [s.mediaId, s.atSec, s.maxSec])).toEqual([['x', 0, 5], ['y', 5, 4]]);
  });
  it('falls back to the timeline audio track from the start when no slide has narration', () => {
    const slides = [slide('a'), slide('b')];
    expect(narrationSegments(deck(slides, 'tl'), slides, [2, 2])).toEqual([{ mediaId: 'tl', srcStartSec: 0, srcEndSec: null, atSec: 0, maxSec: 4 }]);
    expect(narrationSegments(deck(slides), slides, [2, 2])).toEqual([]);
  });
  it('knows whether a deck has any narration', () => {
    expect(hasNarrationAudio(deck([slide('a')]))).toBe(false);
    expect(hasNarrationAudio(deck([slide('a', { narration: 'x' })]))).toBe(true);
    expect(hasNarrationAudio(deck([slide('a')], 'tl'))).toBe(true);
    expect(hasNarrationAudio(null)).toBe(false);
  });
});

describe('mixing', () => {
  const rate = 1000;
  const tone = (len: number, v: number): Pcm => ({ sampleRate: rate, channels: [new Float32Array(len).fill(v)] });
  const at = (a: Float32Array, i: number) => Math.round(a[i] * 100) / 100;

  it('places each part at its slide start, with silence between and the full length of the video', () => {
    const out = mixNarration([
      { mediaId: 'a', srcStartSec: 1, srcEndSec: 3, atSec: 0.5, maxSec: 10 },
      { mediaId: 'a', srcStartSec: 0, srcEndSec: null, atSec: 3, maxSec: 1 },
    ], () => tone(4000, 0.5), rate, 5, 1);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(5000);
    expect([at(out[0], 100), at(out[0], 1000), at(out[0], 2400)]).toEqual([0, 0.5, 0.5]);
    expect(at(out[0], 2600)).toBe(0); // the 2 s part ran 0.5 to 2.5 s
    expect(at(out[0], 3500)).toBe(0.5);
    expect(at(out[0], 4200)).toBe(0); // maxSec cut it at 4 s
  });
  it('fades piece edges, resamples, doubles mono into stereo, and limits overlaps', () => {
    const out = mixNarration([{ mediaId: 'a', srcStartSec: 0, srcEndSec: null, atSec: 0, maxSec: 1 }], () => ({ sampleRate: 500, channels: [new Float32Array(500).fill(1)] }), rate, 1, 2);
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBe(0);
    expect(out[0][500]).toBeCloseTo(1, 2);
    expect(Array.from(out[0])).toEqual(Array.from(out[1]));
    const loud = mixNarration([{ mediaId: 'a', srcStartSec: 0, srcEndSec: null, atSec: 0, maxSec: 1 }, { mediaId: 'a', srcStartSec: 0, srcEndSec: null, atSec: 0, maxSec: 1 }], () => tone(1000, 0.9), rate, 1, 1);
    expect(Math.max(...loud[0])).toBe(1);
  });
  it('skips clips that could not be decoded', () => {
    const out = mixNarration([{ mediaId: 'gone', srcStartSec: 0, srcEndSec: null, atSec: 0, maxSec: 1 }], () => null, rate, 1, 1);
    expect(Math.max(...out[0].map(Math.abs))).toBe(0);
  });
});

describe('audio codec choice', () => {
  it('uses AAC for MP4 and Opus for WebM when the encoder accepts it, else null', async () => {
    expect((await pickAudioCodec('mp4', async (c) => c.codec === 'mp4a.40.2'))?.id).toBe('aac');
    expect((await pickAudioCodec('webm', async (c) => c.codec === 'opus'))?.id).toBe('opus');
    expect(await pickAudioCodec('mp4', async () => false)).toBeNull();
    expect(await pickAudioCodec('webm', async () => { throw new Error('no'); })).toBeNull();
  });
});
