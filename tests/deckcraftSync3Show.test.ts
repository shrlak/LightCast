// DeckCraft sync 3 — slide show: a slide's animations wait for its transition (DeckCraft #2089).
import { describe, expect, it } from 'vitest';
import { buildStates, initialBuild, transitionHold } from '../src/domain/animations';
import { createSeedLibrary } from '../src/domain/defaults';
import { goLive } from '../src/domain/live';
import { createInitialState } from '../src/domain/reducer';
import type { Slide, SlideElement } from '../src/domain/types';

const box: SlideElement = { id: 'b', kind: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100 };
const first: Slide = { id: 's1', group: 'Slide', text: '' };
const second: Slide = {
  id: 's2', group: 'Slide', text: '', elements: [box],
  transition: { kind: 'fade', duration: 400 },
  animations: [{ id: 'a', elementId: 'b', effect: 'fade', class: 'entrance', start: 'with', durationMs: 500, delayMs: 0 }],
};

function show(slides: Slide[], more: { noTransitions?: boolean } = {}) {
  const lib = createSeedLibrary();
  lib.presentations = [{ id: 'deck', title: '발표', themeId: 'theme_classic', slides, ...(more.noTransitions ? { showSetup: { noTransitions: true } } : {}) } as (typeof lib.presentations)[number]];
  return createInitialState(lib);
}

describe('slide show: animations wait for the slide transition', () => {
  it('a With Previous entrance starts when the 0.4 s fade has finished', () => {
    let s = show([first, second]);
    s = goLive(s, { presentationId: 'deck', seq: 0 }, 0);
    s = goLive(s, { presentationId: 'deck', seq: 1 }, 10_000);
    const b = s.live.build!;
    expect(b.startedAt).toBe(10_400);
    const at = (now: number) => buildStates(second, second.elements!, b, now)!;
    expect(at(10_300).states.b.visible).toBe(false);
    expect(at(10_300).settled).toBe(false);
    const mid = at(10_600).states.b;
    expect(mid.visible && mid.opacity < 1).toBe(true);
    // The step is not cut short by the time the transition took.
    expect(at(10_800).settled).toBe(false);
    expect(at(11_000).states.b.opacity).toBe(1);
  });

  it('starts at once without a transition, with Show without transitions, and on the first slide shown', () => {
    const cut = { ...second, transition: { kind: 'cut' as const, duration: 1 } };
    let s = goLive(show([first, cut]), { presentationId: 'deck', seq: 0 }, 0);
    expect(goLive(s, { presentationId: 'deck', seq: 1 }, 10_000).live.build?.startedAt).toBe(10_000);
    s = goLive(show([first, second], { noTransitions: true }), { presentationId: 'deck', seq: 0 }, 0);
    expect(goLive(s, { presentationId: 'deck', seq: 1 }, 10_000).live.build?.startedAt).toBe(10_000);
    // Nothing was on screen before it: no transition plays.
    expect(goLive(show([second]), { presentationId: 'deck', seq: 0 }, 10_000).live.build?.startedAt).toBe(10_000);
  });

  it('transitionHold: only a transition that really plays holds the builds back', () => {
    expect(transitionHold(first, second, second.transition)).toBe(400);
    expect(transitionHold(null, second, second.transition)).toBe(0);
    expect(transitionHold(second, { ...second }, second.transition)).toBe(0);
    expect(transitionHold(first, second, undefined)).toBe(0);
    expect(transitionHold(first, second, { kind: 'fx:push', duration: 700 })).toBe(700);
    // An On Click first step still waits for its click.
    const click = { ...second, animations: [{ ...second.animations![0], start: 'click' as const }] };
    expect(initialBuild(click, 0, 400)).toEqual({ step: 0, startedAt: null });
  });
});
