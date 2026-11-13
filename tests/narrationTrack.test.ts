// Slide Show recording as one continuous clip with per-slide cue offsets (and older per-slide clips still readable).
import { describe, expect, it } from 'vitest';
import { applyRecording, clearRecording, cuesFromRecording, enterSlide, finishRecording, narrationClip, planNarration, startRecording } from '../src/domain/narration';
import type { Slide } from '../src/domain/types';

const slides = (): Slide[] => [
  { id: 'a', text: '1', group: 'V' },
  { id: 'b', text: '2', group: 'V' },
  { id: 'c', text: '3', group: 'V' },
];

const run = () => {
  let r = startRecording();
  r = enterSlide(r, 'a', 1000);
  r = enterSlide(r, 'b', 5000);
  r = enterSlide(r, 'c', 9000);
  return finishRecording(r, 12000);
};

describe('continuous narration recording', () => {
  it('turns visits into offsets from the start of the clip', () => {
    // The recorder began 500 ms after the show did.
    expect(cuesFromRecording(run(), 1500)).toEqual({
      a: { startSec: 0, endSec: 3.5 },
      b: { startSec: 3.5, endSec: 7.5 },
      c: { startSec: 7.5, endSec: 10.5 },
    });
  });

  it('leaves out a slide that was left before the recorder began, and uses the last visit', () => {
    let r = startRecording();
    r = enterSlide(r, 'a', 0);
    r = enterSlide(r, 'b', 800);
    r = enterSlide(r, 'a', 3000);
    r = finishRecording(r, 4000);
    expect(cuesFromRecording(r, 1000)).toEqual({ b: { startSec: 0, endSec: 2 }, a: { startSec: 2, endSec: 3 } });
    expect(cuesFromRecording(r, 900).b).toEqual({ startSec: 0, endSec: 2.1 });
    expect(cuesFromRecording(r, 5000)).toEqual({});
  });

  it('stores the one clip on every slide with its cue, and timings next to it', () => {
    const cues = cuesFromRecording(run(), 1000);
    const out = applyRecording(slides(), { a: 4, b: 4, c: 3 }, {}, { mediaId: 'track', cues });
    expect(out.map((s) => s.narration)).toEqual(['track', 'track', 'track']);
    expect(out[1].narrationCue).toEqual({ startSec: 4, endSec: 8 });
    expect(out[0].autoAdvance).toBe(4);
  });

  it('a new continuous take replaces an older per-slide clip, and a per-slide clip replaces a cue', () => {
    const old = applyRecording(slides(), { a: 4 }, { a: 'oldclip' });
    expect(old[0]).toMatchObject({ narration: 'oldclip' });
    expect(old[0].narrationCue).toBeUndefined();
    const fresh = applyRecording(old, {}, {}, { mediaId: 'track', cues: { a: { startSec: 0, endSec: 2 } } });
    expect(fresh[0]).toMatchObject({ narration: 'track', narrationCue: { startSec: 0, endSec: 2 } });
    const back = applyRecording(fresh, {}, { a: 'again' });
    expect(back[0].narration).toBe('again');
    expect(back[0].narrationCue).toBeUndefined();
  });

  it('clearing removes the cue too, and reports the shared clip once, only when no slide still uses it', () => {
    const rec = applyRecording(slides(), { a: 1, b: 1, c: 1 }, {}, { mediaId: 'track', cues: { a: { startSec: 0, endSec: 1 }, b: { startSec: 1, endSec: 2 }, c: { startSec: 2, endSec: 3 } } });
    const one = clearRecording(rec, { slideId: 'a' });
    expect(one.slides[0].narrationCue).toBeUndefined();
    expect(one.slides[1].narrationCue).toBeDefined();
    expect(one.orphaned).toEqual([]);
    const all = clearRecording(rec, 'all');
    expect(all.orphaned).toEqual(['track']);
    expect(all.slides.every((s) => !s.narration && !s.narrationCue)).toBe(true);
  });
});

describe('narration playback', () => {
  it('older data: a clip with no cue is the whole clip of its slide, played from its start', () => {
    const s: Slide = { id: 'a', text: '', group: 'V', narration: 'm1' };
    expect(narrationClip(s, {})).toEqual({ mediaId: 'm1' });
    expect(planNarration(null, { mediaId: 'm1' })).toEqual({ kind: 'start', mediaId: 'm1', offset: 0, stopAt: null });
    // The same old clip twice in a row (slide shown again) restarts; it is not a continuous track.
    expect(planNarration({ mediaId: 'm1', position: 3 }, { mediaId: 'm1' })).toEqual({ kind: 'start', mediaId: 'm1', offset: 0, stopAt: null });
  });

  it('a cue is passed on, a broken one is ignored, and 쇼 설정 can turn narration off', () => {
    const s: Slide = { id: 'a', text: '', group: 'V', narration: 'm1', narrationCue: { startSec: 2, endSec: 5 } };
    expect(narrationClip(s, {})).toEqual({ mediaId: 'm1', cue: { startSec: 2, endSec: 5 } });
    expect(narrationClip({ ...s, narrationCue: { startSec: 5, endSec: 2 } }, {})).toEqual({ mediaId: 'm1' });
    expect(narrationClip(s, { showSetup: { noNarration: true } })).toBeNull();
    expect(narrationClip({ ...s, narration: undefined }, {})).toBeNull();
  });

  it('keeps playing across a slide change that follows on (no gap), else jumps to the slide part', () => {
    const next = { mediaId: 'track', cue: { startSec: 4, endSec: 8 } };
    expect(planNarration({ mediaId: 'track', position: 4.2 }, next)).toEqual({ kind: 'keep', stopAt: 8 });
    expect(planNarration({ mediaId: 'track', position: 3.5 }, next)).toEqual({ kind: 'keep', stopAt: 8 });
    // Moved on early / late by more than the tolerance, or another recording: start the slide's part.
    expect(planNarration({ mediaId: 'track', position: 9 }, next)).toEqual({ kind: 'start', mediaId: 'track', offset: 4, stopAt: 8 });
    expect(planNarration({ mediaId: 'other', position: 4 }, next)).toEqual({ kind: 'start', mediaId: 'track', offset: 4, stopAt: 8 });
    expect(planNarration(null, next)).toEqual({ kind: 'start', mediaId: 'track', offset: 4, stopAt: 8 });
    expect(planNarration({ mediaId: 'track', position: 4 }, null)).toEqual({ kind: 'stop' });
  });
});
