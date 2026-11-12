// DeckCraft parity for design, slides, transitions, animations, tables and SmartArt.
import { describe, expect, it } from 'vitest';
import type { Slide, SlideAnimation, SlideElement } from '../src/domain/types';
import { REPEAT_UNTIL_CLICK, advanceBuild, animSpec, animationBadges, buildStates, clickTrigger, initialBuild, paintAnimations, triggerObjects } from '../src/domain/animations';
import { BUILTIN_SOUNDS, soundSamples, wavBytes } from '../src/domain/transitionSounds';
import { applyBorders, editCells, penDash, setTrackSize } from '../src/domain/tableBorders';
import { newTable } from '../src/engine';
import { addNode, demoteNode, editSmartArt, moveNode, promoteNode, smartArtElements } from '../src/domain/smartArt';

const box = (id: string, more: Partial<SlideElement> = {}): SlideElement => ({ id, kind: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100, ...more } as SlideElement);
const anim = (elementId: string, more: Partial<SlideAnimation> = {}): SlideAnimation => ({ id: `a-${elementId}-${Math.random()}`, elementId, effect: 'fade', class: 'entrance', start: 'click', durationMs: 500, delayMs: 0, ...more });

describe('Animations › Trigger, Repeat and Rewind', () => {
  const slide: Slide = {
    id: 's', group: 'G', text: '',
    elements: [box('pic'), box('btn', { y: 800 }), box('main', { x: 800 })],
    animations: [anim('main'), anim('pic', { trigger: 'btn' })],
  };

  it('a triggered effect is not one of the slide clicks and plays on a click on its object', () => {
    expect(triggerObjects(slide)).toEqual(['btn']);
    expect(animationBadges(slide)).toEqual({ main: [1] });
    const b0 = initialBuild(slide, 0)!;
    // After the slide's own click the triggered object is still hidden.
    const b1 = advanceBuild(slide, b0, 0)!;
    expect(buildStates(slide, slide.elements!, b1, 5000)!.states.pic.visible).toBe(false);
    const t = clickTrigger(slide, b1, 'btn', 5000)!;
    expect(t.triggers?.btn).toEqual({ done: 0, startedAt: 5000 });
    const done = buildStates(slide, slide.elements!, t, 6000)!;
    expect(done.states.pic.visible).toBe(true);
    expect(done.settled).toBe(true);
    // Mid-way the sequence is still playing.
    expect(buildStates(slide, slide.elements!, t, 5200)!.settled).toBe(false);
    // The slide's clicks are over: the next click goes to the next slide, keeping nothing.
    expect(advanceBuild(slide, t, 7000)).toBeNull();
    expect(clickTrigger(slide, t, 'main', 7000)).toBeNull();
  });

  it('a click while the step plays finishes it; after the last step the sequence starts over', () => {
    const b = clickTrigger(slide, undefined, 'btn', 0)!;
    const finished = clickTrigger(slide, b, 'btn', 100)!;
    expect(finished.triggers?.btn).toEqual({ done: 1, startedAt: null });
    expect(clickTrigger(slide, finished, 'btn', 200)!.triggers?.btn).toEqual({ done: 0, startedAt: 200 });
  });

  it('a slide with only triggered effects starts with its objects hidden', () => {
    const only: Slide = { ...slide, animations: [anim('pic', { trigger: 'btn' })] };
    const b = initialBuild(only, 0)!;
    expect(b).toEqual({ step: 0, startedAt: null });
    expect(buildStates(only, only.elements!, b, 0)!.states.pic.visible).toBe(false);
    expect(advanceBuild(only, b, 0)).toBeNull();
  });

  it('passes rewind, repeat until next click and a trigger only when its object is shown', () => {
    const s2: Slide = { ...slide, elements: [box('pic'), box('btn', { hidden: true })], animations: [anim('pic', { trigger: 'btn', rewind: true, repeat: REPEAT_UNTIL_CLICK })] };
    const a = animSpec(s2)!.anims[0];
    expect(a.rewind).toBe(true);
    expect(a.repeat).toBe(REPEAT_UNTIL_CLICK);
    expect(a.trigger).toBeUndefined();
  });
});

describe('Animation Painter and transition sounds', () => {
  it('paints every animation of the source onto the targets, replacing theirs', () => {
    const list = [anim('a', { effect: 'fly' }), anim('a', { effect: 'spin', class: 'emphasis', trigger: 'b' }), anim('b'), anim('c')];
    let n = 0;
    const out = paintAnimations(list, list.slice(0, 2), ['b'], () => `n${++n}`);
    expect(out.filter((x) => x.elementId === 'b').map((x) => x.effect)).toEqual(['fly', 'spin']);
    // A trigger on the target itself would never fire: it goes.
    expect(out.find((x) => x.id === 'n2')!.trigger).toBeUndefined();
    expect(out.filter((x) => x.elementId === 'a')).toHaveLength(2);
    expect(paintAnimations(list, [], ['b'], () => 'x')).toBe(list);
  });

  it('synthesises every built-in sound as a short PCM WAV', () => {
    for (const [id] of BUILTIN_SOUNDS) {
      const s = soundSamples(id)!;
      expect(s.length / 22050).toBeGreaterThan(0.01);
      expect(s.length / 22050).toBeLessThan(2);
      const w = wavBytes(s);
      expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
      expect(w.length).toBe(44 + s.length * 2);
    }
    expect(soundSamples('nope')).toBeNull();
  });
});

describe('Table Design / Layout', () => {
  it('draws diagonal borders with a pen style and toggles them off with the same pen', () => {
    const t = newTable(2, 2)!;
    const pen = { color: '#ff0000', width: 2, dash: 'dash' as const };
    const one = applyBorders(t, { r: 0, c: 0, r1: 1, c1: 0 }, 'diagDown', pen);
    expect(one.rows[1][0].borders?.dd).toEqual(pen);
    expect(one.rows[0][1].borders?.dd).toBeUndefined();
    expect(applyBorders(one, { r: 0, c: 0, r1: 0, c1: 0 }, 'diagDown', pen).rows[0][0].borders?.dd).toBeUndefined();
    expect(applyBorders(one, { r: 1, c: 0, r1: 1, c1: 0 }, 'none', pen).rows[1][0].borders?.dd).toBeUndefined();
    expect(penDash(pen)).toBe('8 6');
    expect(penDash({ color: '#000', width: 1 })).toBeUndefined();
  });

  it('sets a row height or a column width, growing the table or keeping its width', () => {
    const t = newTable(2, 2)!;
    const r = setTrackSize(t, 'row', 0, 300, 400);
    expect(r.total).toBe(500);
    expect(r.table.heights[0] / (r.table.heights[0] + r.table.heights[1])).toBeCloseTo(0.6, 4);
    const c = setTrackSize(t, 'col', 0, 500, 800, true);
    expect(c.total).toBe(800);
    expect(c.table.cols[0]).toBeCloseTo(500 / 800, 4);
    expect(setTrackSize(t, 'col', 5, 100, 800).table).toBe(t);
  });

  it('cell alignment and text direction stay with the cell through engine edits', async () => {
    const { editTable } = await import('../src/engine');
    const t = editCells(newTable(2, 2)!, { r: 1, c: 1, r1: 1, c1: 1 }, (c) => ({ ...c, anchor: 'bottom', dir: 'vert270' }));
    const ins = editTable(t, 'insertRowAbove', 0, 0)!;
    expect(ins.rows[2][1].anchor).toBe('bottom');
    expect(ins.rows[2][1].dir).toBe('vert270');
  });
});

describe('SmartArt outline edits', () => {
  const n = (...levels: number[]) => levels.map((level, i) => ({ text: `n${i}`, level }));
  const lv = (nodes: { level: number }[]) => nodes.map((x) => x.level).join('');

  it('adds shapes after, before, below, above and as assistant (DeckCraft rules)', () => {
    const base = n(0, 1, 0);
    expect(addNode(base, 0, 'after').index).toBe(2);
    expect(lv(addNode(base, 0, 'after').nodes)).toBe('0100');
    expect(addNode(base, 0, 'before').index).toBe(0);
    expect(lv(addNode(base, 0, 'below').nodes)).toBe('0110');
    expect(lv(addNode(base, 0, 'above').nodes)).toBe('0120');
    expect(lv(addNode(base, 2, 'assistant').nodes)).toBe('0101');
    expect(addNode(base, null, 'after').index).toBe(3);
  });

  it('promotes and demotes with sub-points and refuses what cannot move', () => {
    const base = n(0, 0, 1);
    expect(lv(demoteNode(base, 1)!)).toBe('012');
    expect(demoteNode(base, 0)).toBeNull();
    expect(demoteNode(n(0, 1), 1)).toBeNull();
    expect(lv(promoteNode(base, 2)!)).toBe('000');
    expect(promoteNode(base, 0)).toBeNull();
  });

  it('moves a node with its sub-points among its siblings', () => {
    const base = n(0, 1, 0, 1, 1);
    const down = moveNode(base, 0, 1)!;
    expect(down.nodes.map((x) => x.text)).toEqual(['n2', 'n3', 'n4', 'n0', 'n1']);
    expect(down.index).toBe(3);
    const up = moveNode(base, 2, -1)!;
    expect(up.nodes.map((x) => x.text)).toEqual(['n2', 'n3', 'n4', 'n0', 'n1']);
    expect(up.index).toBe(0);
    expect(moveNode(base, 0, -1)).toBeNull();
    expect(moveNode(base, 2, 1)).toBeNull();
  });

  it('lays a graphic out again with the new outline, mirrored for Right to Left', () => {
    const spec = { kind: 'process', style: 'flat', colors: 'colorful', nodes: n(0, 0, 0), box: { x: 100, y: 200, w: 1000, h: 400 } };
    const els = smartArtElements(spec)!;
    const owner = els.find((e) => e.smartArt)!;
    const added = editSmartArt(els, owner, undefined, { kind: 'add', position: 'after' })!;
    expect(added.elements.find((e) => e.smartArt)!.smartArt!.nodes).toHaveLength(4);
    const rtl = editSmartArt(els, owner, undefined, { kind: 'rtl' })!;
    const first = (list: typeof els) => list.filter((e) => e.text).sort((a, b) => a.x - b.x)[0].text;
    expect(first(els)).toBe('n0');
    expect(first(rtl.elements)).toBe('n2');
    expect(editSmartArt(els, owner, undefined, { kind: 'promote' })).toBeNull();
  });
});
