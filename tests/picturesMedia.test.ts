// Media playback and slide show actions (area: pictures-insert).
import { describe, expect, it } from 'vitest';
import { atEnd, cleanPlayback, fadeGain, parseSeconds, playEnd, playVolume, secondsText } from '../src/domain/mediaPlayback';
import { hoverAt, lastViewed } from '../src/domain/showActions';
import { createInitialState, reducer } from '../src/domain/reducer';
import { createSeedLibrary } from '../src/domain/defaults';

describe('Media playback (DeckCraft media.options / Trim)', () => {
  it('fades in and out over the trimmed span', () => {
    const pb = { start: 2, end: 12, fadeIn: 2, fadeOut: 4 };
    expect(fadeGain(2, pb, 30)).toBe(0);
    expect(fadeGain(3, pb, 30)).toBeCloseTo(0.5);
    expect(fadeGain(6, pb, 30)).toBe(1);
    expect(fadeGain(10, pb, 30)).toBeCloseTo(0.5);
    expect(fadeGain(5, undefined, 30)).toBe(1);
    expect(playEnd({}, 30)).toBe(30);
    expect(playEnd({ end: 50 }, 30)).toBe(30);
  });
  it('applies volume steps and mute', () => {
    expect(playVolume({ volume: 0.5 }, 1, 10)).toBe(0.5);
    expect(playVolume({ muted: true }, 1, 10)).toBe(0);
    expect(playVolume(undefined, 1, 10, 0.8)).toBeCloseTo(0.8);
  });
  it('loops, stops or rewinds at the end', () => {
    expect(atEnd(5, { end: 10 }, 30)).toBe('play');
    expect(atEnd(10, { end: 10, loop: true }, 30)).toBe('loop');
    expect(atEnd(10, { end: 10 }, 30)).toBe('stop');
    expect(atEnd(30, { rewind: true }, 30)).toBe('rewind');
  });
  it('round-trips trim seconds like DeckCraft', () => {
    for (const s of [0, 0.001, 0.25, 0.333, 1, 1.5, 60]) expect(parseSeconds(secondsText(s))).toBe(s);
    expect(parseSeconds('')).toBe(0);
    expect(parseSeconds('nope')).toBe(0);
    expect(parseSeconds('-2')).toBe(0);
    expect(secondsText(1.5)).toBe('1.5');
    expect(cleanPlayback({ loop: false, start: 0, volume: 0 })).toEqual({ volume: 0 });
    expect(cleanPlayback({ loop: false })).toBeUndefined();
  });
  it('the audio player state carries the object playback and clears on stop', () => {
    const s0 = reducer(createInitialState(createSeedLibrary()), { type: 'audio/play', mediaId: 'm1', playback: { start: 3 }, slideId: 's1' });
    expect(s0.audio.playback).toEqual({ start: 3 });
    expect(s0.audio.slideId).toBe('s1');
    const off = reducer(s0, { type: 'audio/play', mediaId: null });
    expect(off.audio.playback).toBeUndefined();
  });
});

describe('Slide show actions', () => {
  const slide = { id: 's', group: '', text: '', elements: [
    { id: 'a', kind: 'shape' as const, x: 0, y: 0, w: 100, h: 100, hoverAction: { kind: 'next' as const } },
    { id: 'b', kind: 'shape' as const, x: 200, y: 0, w: 100, h: 100, tooltip: '도움말' },
  ] };
  it('finds what reacts to the pointer', () => {
    expect(hoverAt(slide, 50, 50)?.id).toBe('a');
    expect(hoverAt(slide, 250, 50)?.id).toBe('b');
    expect(hoverAt(slide, 150, 50)).toBeNull();
  });
  it('goes back to the last other slide viewed', () => {
    expect(lastViewed([0, 3, 5, 5], 5)).toBe(3);
    expect(lastViewed([], 2)).toBeNull();
  });
});
