import { describe, expect, it } from 'vitest';
import { applyRecording, clearRecording, clock, enterSlide, finishRecording, narrationToPlay, slideTimings, startRecording } from '../src/domain/narration';
import { laserFromMessage, laserMessage, laserPoint, laserShown } from '../src/domain/laserPointer';
import type { Slide } from '../src/domain/types';

const slides = (): Slide[] => [
  { id: 'a', text: '1', group: 'V' },
  { id: 'b', text: '2', group: 'V', autoAdvance: 9 },
  { id: 'c', text: '3', group: 'V' },
];

describe('record slide show', () => {
  it('times each slide; the last visit wins and short stays count 1 second', () => {
    let r = startRecording();
    r = enterSlide(r, 'a', 0);
    r = enterSlide(r, 'b', 4000);
    r = enterSlide(r, 'a', 10000);
    r = enterSlide(r, 'a', 10500); // same slide: no new visit
    r = finishRecording(r, 12000);
    expect(slideTimings(r)).toEqual({ a: 2, b: 6 });
    expect(slideTimings(enterSlide(finishRecording(enterSlide(startRecording(), 'c', 0), 100), 'x', 100))).toEqual({ c: 1 });
  });

  it('stores timings in autoAdvance and clips in narration, leaving other slides alone', () => {
    const out = applyRecording(slides(), { a: 5, c: 3 }, { a: 'm1' });
    expect(out[0]).toMatchObject({ autoAdvance: 5, narration: 'm1' });
    expect(out[1].autoAdvance).toBe(9);
    expect(out[2]).toMatchObject({ autoAdvance: 3 });
    expect(out[2].narration).toBeUndefined();
  });

  it('clears one slide or all, reporting clips nothing uses any more', () => {
    const rec = applyRecording(slides(), { a: 5, b: 2 }, { a: 'm1', b: 'm2' });
    const one = clearRecording(rec, { slideId: 'a' });
    expect(one.slides[0].narration).toBeUndefined();
    expect(one.slides[1].narration).toBe('m2');
    expect(one.orphaned).toEqual(['m1']);
    const all = clearRecording(rec, 'all');
    expect(all.orphaned.sort()).toEqual(['m1', 'm2']);
    expect(all.slides.every((s) => !s.autoAdvance && !s.narration)).toBe(true);
  });

  it('plays a narration unless 쇼 설정 turns it off', () => {
    const s: Slide = { id: 'a', text: '', group: 'V', narration: 'm1' };
    expect(narrationToPlay(s, {})).toBe('m1');
    expect(narrationToPlay(s, { showSetup: { noNarration: true } })).toBeNull();
    expect(narrationToPlay({ ...s, narration: undefined }, {})).toBeNull();
  });

  it('formats the clock', () => expect(clock(75)).toBe('1:15'));
});

describe('laser pointer', () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };
  it('maps the cursor to 0–1 across the slide and hides outside it', () => {
    expect(laserPoint(rect, 300, 200)).toEqual({ x: 0.5, y: 0.5 });
    expect(laserPoint(rect, 99, 200)).toBeNull();
    expect(laserPoint(rect, 300, 351)).toBeNull();
    expect(laserPoint({ ...rect, width: 0 }, 300, 200)).toBeNull();
  });
  it('shows with Ctrl held or when switched on from the menu', () => {
    expect(laserShown(true, false)).toBe(true);
    expect(laserShown(false, true)).toBe(true);
    expect(laserShown(false, false)).toBe(false);
  });
  it('round-trips through its message, off included', () => {
    expect(laserFromMessage(laserMessage({ x: 0.2, y: 0.8 }))).toEqual({ x: 0.2, y: 0.8 });
    expect(laserFromMessage(laserMessage(null))).toBeNull();
  });
});
