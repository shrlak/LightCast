// Animations › Effect Options › 순서: 하나의 개체로 / 단락별로 — a by-paragraph build plays each
// first-level paragraph as its own step (DeckCraft's TextBuild::ByParagraph in the engine).
import { describe, expect, it } from 'vitest';
import type { Slide, SlideAnimation, SlideElement } from '../src/domain/types';
import { advanceBuild, animSpec, animationBadges, animationClicks, buildStates, canBuildByParagraph, initialBuild, paragraphLevels, rewindBuild, slideTimeline, type LiveBuild } from '../src/domain/animations';
import { paragraphStyle } from '../src/ui/ShowEffects';

const box = (text: string, extra: Partial<SlideElement> = {}): SlideElement => ({ id: 't', kind: 'text', x: 100, y: 100, w: 600, h: 300, text, ...extra });
const fade = (extra: Partial<SlideAnimation> = {}): SlideAnimation => ({ id: 'a1', elementId: 't', effect: 'fade', class: 'entrance', start: 'click', durationMs: 500, delayMs: 0, sequence: 'paragraph', ...extra });
const slideOf = (el: SlideElement, anims: SlideAnimation[]): Slide => ({ id: 's', group: '', text: '', elements: [el], animations: anims });

/** States once `clicks` clicks have been made and every effect has finished. */
function afterClicks(slide: Slide, clicks: number) {
  let b: LiveBuild | undefined = initialBuild(slide, 0);
  for (let i = 0; i < clicks; i++) b = advanceBuild(slide, b, 1_000_000 * (i + 1)) ?? undefined;
  return buildStates(slide, slide.elements!, b!, 1_000_000 * (clicks + 2))!.states;
}

describe('by-paragraph builds', () => {
  const three = slideOf(box('첫째 줄\n둘째 줄\n셋째 줄'), [fade()]);

  it('sends the paragraphs and the sequence to the engine only for a by-paragraph effect', () => {
    const spec = animSpec(three)!;
    expect(spec.anims[0].sequence).toBe('paragraph');
    expect(spec.boxes[0].paras).toEqual([{ level: 0, filled: true }, { level: 0, filled: true }, { level: 0, filled: true }]);
    const one = animSpec(slideOf(box('a\nb'), [fade({ sequence: 'one' })]))!;
    expect(one.anims[0].sequence).toBeUndefined();
    expect(one.boxes[0].paras).toBeUndefined();
    // A motion path moves the whole object.
    expect(animSpec(slideOf(box('a\nb'), [fade({ effect: 'lines', class: 'path' })]))!.anims[0].sequence).toBeUndefined();
  });

  it('reads outline levels from leading tabs; blank lines show no text', () => {
    expect(paragraphLevels(box('A\n\tA1\n\t\tA1a\n\nB'))).toEqual([
      { level: 0, filled: true }, { level: 1, filled: true }, { level: 2, filled: true }, { level: 0, filled: false }, { level: 0, filled: true },
    ]);
    expect(canBuildByParagraph(box('a'))).toBe(true);
    expect(canBuildByParagraph(box(''))).toBe(false);
    expect(canBuildByParagraph(box('a', { kind: 'image' }))).toBe(false);
    expect(canBuildByParagraph(box('a', { kind: 'shape', shape: 'rect' }))).toBe(true);
    expect(canBuildByParagraph(box('a', { warp: 'archUp' }))).toBe(false);
  });

  it('takes one click per paragraph, and the slide show counts every one', () => {
    expect(slideTimeline(three)!.steps).toBe(3);
    expect(slideTimeline(slideOf(box('a\nb\nc'), [fade({ sequence: undefined })]))!.steps).toBe(1);
    let b = initialBuild(three, 0);
    expect(b).toEqual({ step: 0, startedAt: null });
    const seen: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const n = advanceBuild(three, b, i * 10_000);
      if (!n) break;
      seen.push(n.step);
      b = n;
    }
    expect(seen).toEqual([0, 1, 2]);
    expect(advanceBuild(three, b, 50_000)).toBeNull();
    expect(rewindBuild(three, b, 60_000)).toEqual({ step: 0, startedAt: null });
  });

  it('shows 1, 2, 3 lines after 1, 2, 3 clicks while the box itself stays put', () => {
    const vis = (s: Record<string, { visible: boolean }>) => [0, 1, 2].map((p) => s[`t#${p}`].visible);
    const s0 = afterClicks(three, 0);
    expect(s0.t.visible).toBe(true);
    expect(vis(s0)).toEqual([false, false, false]);
    expect(vis(afterClicks(three, 1))).toEqual([true, false, false]);
    expect(vis(afterClicks(three, 2))).toEqual([true, true, false]);
    const s3 = afterClicks(three, 3);
    expect(vis(s3)).toEqual([true, true, true]);
    expect(s3['t#2'].opacity).toBeCloseTo(1);
    // As one object: no paragraph states.
    expect(Object.keys(afterClicks(slideOf(box('a\nb'), [fade({ sequence: 'one' })]), 1))).toEqual(['t']);
  });

  it('half way through the second click only the second line is fading in', () => {
    let b = initialBuild(three, 0);
    b = advanceBuild(three, b, 1000)!;
    b = advanceBuild(three, b, 10_000)!;
    const s = buildStates(three, three.elements!, b, 10_250)!.states;
    expect(s['t#0'].opacity).toBeCloseTo(1);
    expect(s['t#1'].opacity).toBeGreaterThan(0.05);
    expect(s['t#1'].opacity).toBeLessThan(0.95);
    expect(s['t#2'].visible).toBe(false);
  });

  it('deeper paragraphs and blank lines go with the paragraph above them', () => {
    const slide = slideOf(box('A\n\tA1\n\nB'), [fade()]);
    expect(slideTimeline(slide)!.steps).toBe(2);
    const s1 = afterClicks(slide, 1);
    expect([s1['t#0'].visible, s1['t#1'].visible, s1['t#3'].visible]).toEqual([true, true, false]);
  });

  it('with / after previous: the paragraphs play one after another in one step', () => {
    const slide = slideOf(box('a\nb\nc'), [fade({ start: 'after' })]);
    const tl = slideTimeline(slide)!;
    expect(tl.steps).toBe(1);
    expect(tl.auto[0]).toBe(true);
    const starts = tl.effects.map((e) => e.start);
    expect(starts[0]).toBeLessThan(starts[1]);
    expect(starts[1]).toBeLessThan(starts[2]);
  });

  it('exit and emphasis effects build by paragraph too; a shape with text works like a text box', () => {
    const exit = slideOf(box('a\nb', { kind: 'shape', shape: 'rect' }), [fade({ effect: 'fadeOut', class: 'exit' })]);
    expect(slideTimeline(exit)!.steps).toBe(2);
    const s1 = afterClicks(exit, 1);
    expect([s1['t#0'].visible, s1['t#1'].visible]).toEqual([false, true]);
    const pulse = slideOf(box('a\nb\nc'), [fade({ effect: 'pulse', class: 'emphasis' })]);
    expect(slideTimeline(pulse)!.steps).toBe(3);
  });

  it('numbers each paragraph step on the object and in the Animation Pane', () => {
    const slide: Slide = { ...three, elements: [...three.elements!, { ...box('x'), id: 'u' }], animations: [fade(), fade({ id: 'a2', elementId: 'u', sequence: undefined })] };
    expect(animationBadges(slide)).toEqual({ t: [1, 2, 3], u: [4] });
    expect(animationClicks(slide)).toEqual({ a1: { clicks: [1, 2, 3], paragraphs: [0, 1, 2] }, a2: { clicks: [4], paragraphs: [null] } });
  });

  it('draws a paragraph from its state, the clip in the paragraph’s own box', () => {
    const st = { visible: true, opacity: 0.5, dx: 10, dy: -20, sx: 1, sy: 1, rotate: 0, clip: [0, 0, 0.5, 1] as [number, number, number, number], tint: null };
    const css = paragraphStyle(st);
    expect(css).toMatchObject({ visibility: 'visible', opacity: '0.5', transform: 'translate(10px, -20px) rotate(0deg) scale(1, 1)', clipPath: 'inset(0% 50% 0% 0%)' });
    expect(paragraphStyle(undefined)).toEqual({ visibility: '', opacity: '', transform: '', clipPath: '' });
    expect(paragraphStyle({ ...st, visible: false }).visibility).toBe('hidden');
  });
});
