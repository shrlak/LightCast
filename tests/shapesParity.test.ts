import { describe, expect, it } from 'vitest';
import type { SlideElement } from '../src/domain/types';
import {
  applySize, aspectLocked, clickBox, constrain45, cycleSelection, drawBox, duplicateOffset, freeformPath, lineEnds, moveInOrder, moveLineEnd,
  movableIds, resizeFlip, sizeUnit, revealOnPick, scribbleCloses, selectAllIds, DUPLICATE_OFFSET,
} from '../src/domain/shapeOps';
import { parsePath, pointKind, setHandle, writePath } from '../src/domain/pathEdit';
import { bevelCss, dashPattern, effectFilter, reflectCss, shadowOf, transformOf } from '../src/domain/shapeEffects';

const el = (id: string, extra: Partial<SlideElement> = {}): SlideElement => ({ id, kind: 'shape', x: 0, y: 0, w: 100, h: 50, ...extra } as SlideElement);

describe('drawing a new shape (DeckCraft drag_create)', () => {
  it('click puts a 72 pt shape at the click, a line 72 pt across', () => {
    expect(clickBox(100, 200, false)).toEqual({ x: 100, y: 200, w: 144, h: 144 });
    expect(clickBox(100, 200, true)).toEqual({ x: 100, y: 200, w: 144, h: 0 });
  });
  it('Shift squares, Ctrl draws from the centre, both combine', () => {
    expect(drawBox(100, 100, 160, 130)).toEqual({ x: 100, y: 100, w: 60, h: 30 });
    expect(drawBox(100, 100, 160, 130, { square: true })).toEqual({ x: 100, y: 100, w: 60, h: 60 });
    expect(drawBox(100, 100, 40, 130, { square: true })).toEqual({ x: 40, y: 100, w: 60, h: 60 });
    expect(drawBox(100, 100, 160, 130, { fromCenter: true })).toEqual({ x: 40, y: 70, w: 120, h: 60 });
    expect(drawBox(100, 100, 160, 130, { fromCenter: true, square: true })).toEqual({ x: 40, y: 40, w: 120, h: 120 });
  });
  it('Shift on a line snaps it to 45° steps', () => {
    expect(constrain45([0, 0], [100, 8])).toEqual([100.32, 0]);
    const d = constrain45([0, 0], [100, 90]);
    expect(d[0]).toBeCloseTo(d[1], 1);
    expect(constrain45([0, 0], [-3, -100])).toEqual([0, -100.04]);
  });
  it('a curve goes through its points as cubics; a polygon is straight', () => {
    expect(freeformPath([[0, 0], [10, 0], [10, 10]], false, false)).toBe('M0 0 L10 0 L10 10');
    const c = freeformPath([[0, 0], [10, 0], [10, 10]], true, true);
    expect(c.match(/C/g)).toHaveLength(3);
    expect(c.endsWith('Z')).toBe(true);
    expect(parsePath(c)[3].pts[2]).toEqual([0, 0]);
  });
  it('a scribble ending at its start closes', () => {
    expect(scribbleCloses([[0, 0], [50, 0], [50, 50], [5, 5]])).toBe(true);
    expect(scribbleCloses([[0, 0], [50, 0], [50, 50], [40, 40]])).toBe(false);
  });
});

describe('sizing handles (resize_box)', () => {
  const o = { x: 100, y: 100, w: 100, h: 50 };
  it('corner and edge drags keep the opposite side', () => {
    expect(resizeFlip(o, 'se', 20, 10, false, false)).toEqual({ x: 100, y: 100, w: 120, h: 60 });
    expect(resizeFlip(o, 'nw', 10, 10, false, false)).toEqual({ x: 110, y: 110, w: 90, h: 40 });
  });
  it('dragging past the opposite edge flips', () => {
    const r = resizeFlip(o, 'e', -150, 0, false, false);
    expect(r).toMatchObject({ x: 50, w: 50, flipH: true });
    const v = resizeFlip({ ...o, flipV: true }, 's', 0, -80, false, false);
    expect(v.flipV).toBeUndefined();
    expect(v).toMatchObject({ y: 70, h: 30 });
  });
  it('Shift keeps the aspect, Ctrl sizes from the centre', () => {
    const k = resizeFlip(o, 'se', 100, 0, true, false);
    expect(k.w / k.h).toBeCloseTo(2);
    expect(resizeFlip(o, 'e', 10, 0, false, true)).toEqual({ x: 90, y: 100, w: 120, h: 50 });
  });
  it('a turned box keeps its opposite corner where it was', () => {
    const t = { ...o, rot: 90 };
    const r = resizeFlip(t, 'se', -10, 30, false, false);
    // Opposite (nw) corner of a box turned 90° sits at (centre + rot(-w/2, -h/2)).
    const before = [150 + 25, 125 - 50];
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    expect(cx + r.h / 2).toBeCloseTo(before[0]);
    expect(cy - r.w / 2).toBeCloseTo(before[1]);
  });
  it('pictures keep their proportions unless their lock is off', () => {
    expect(aspectLocked(el('p', { kind: 'image' }))).toBe(true);
    expect(aspectLocked(el('p', { kind: 'image', lockAspect: false }))).toBe(false);
    expect(aspectLocked(el('s'))).toBe(false);
    expect(aspectLocked(el('s', { lockAspect: true }))).toBe(true);
  });
});

describe('line ends', () => {
  it('reads the ends from the flips and moves one, Shift in 45° steps', () => {
    const line = el('l', { x: 10, y: 10, w: 100, h: 50, flipV: true });
    expect(lineEnds(line)).toEqual([[10, 60], [110, 10]]);
    expect(moveLineEnd(line, 1, [200, 80])).toMatchObject({ x: 10, y: 60, w: 190, h: 20, flipV: undefined });
    expect(moveLineEnd(line, 1, [0, 70])).toMatchObject({ x: 0, y: 60, w: 10, h: 10, flipH: true });
    expect(moveLineEnd(line, 1, [200, 64], true)).toMatchObject({ y: 60, h: 0 });
  });
});

describe('Size and Position (shape.sizePosition)', () => {
  const b = { x: 10, y: 20, w: 200, h: 100 };
  it('scale and size, the width wins with the aspect locked', () => {
    expect(applySize(b, { scaleW: 50 })).toMatchObject({ w: 100, h: 100 });
    expect(applySize(b, { scaleW: 50, lockAspect: true })).toMatchObject({ w: 100, h: 50 });
    expect(applySize(b, { h: 50, lockAspect: true })).toMatchObject({ w: 100, h: 50 });
    expect(applySize(b, { w: 400, h: 10, lockAspect: true })).toMatchObject({ w: 400, h: 200 });
    expect(applySize(b, { x: 5, y: 6, rot: -30 })).toEqual({ x: 5, y: 6, w: 200, h: 100, rot: 330 });
  });
});

describe('selection', () => {
  const els = [el('a'), el('b', { groupId: 'g' }), el('c', { groupId: 'g' }), el('d', { hidden: true }), el('e', { locked: true })];
  it('Tab cycles objects, a group once; with nothing selected the first or last', () => {
    expect(cycleSelection(els, [], true)).toBe('a');
    expect(cycleSelection(els, [], false)).toBe('e');
    expect(cycleSelection(els, ['a'], true)).toBe('b');
    expect(cycleSelection(els, ['b'], true)).toBe('e');
    expect(cycleSelection(els, ['c'], false)).toBe('a');
    expect(cycleSelection(els, ['e'], true)).toBe('a');
  });
  it('Select All skips hidden and locked objects', () => {
    expect(selectAllIds(els)).toEqual(['a', 'b', 'c']);
  });
  it('a locked object (or its group) does not move', () => {
    expect(movableIds(els, ['a', 'e'])).toEqual(['a']);
    expect(movableIds([...els, el('f', { groupId: 'g', locked: true })], ['b', 'c'])).toEqual([]);
  });
  it('the selection pane shows a hidden object picked in it', () => {
    expect(revealOnPick(els, 'd').find((e) => e.id === 'd')?.hidden).toBeUndefined();
    expect(revealOnPick(els, 'a')).toBe(els);
  });
  it('dragging in the selection pane reorders, a group moving whole', () => {
    const ids = (l: SlideElement[]) => l.map((e) => e.id).join('');
    expect(ids(moveInOrder(els, 'a', 'e', true))).toBe('bcdea');
    expect(ids(moveInOrder(els, 'e', 'a', false))).toBe('eabcd');
    expect(ids(moveInOrder(els, 'b', 'e', true))).toBe('adebc');
    expect(ids(moveInOrder(els, 'e', 'c', false))).toBe('aebcd');
    expect(moveInOrder(els, 'b', 'c', true)).toBe(els);
  });
});

describe('duplicate (edit.duplicate)', () => {
  it('sets copies off 12 pt, then repeats how far the last copies were moved', () => {
    const els = [el('a', { x: 0, y: 0 }), el('a2', { x: 50, y: 10 })];
    expect(duplicateOffset(els, ['a'], null)).toEqual([DUPLICATE_OFFSET, DUPLICATE_OFFSET]);
    expect(duplicateOffset(els, ['a2'], { pairs: [['a', 'a2']] })).toEqual([50, 10]);
    expect(duplicateOffset(els, ['a'], { pairs: [['a', 'a2']] })).toEqual([24, 24]);
  });
});

describe('Edit Points handles (points.rs set_handle)', () => {
  const d = 'M0 0 C10 -10 20 -10 30 0 C40 10 50 10 60 0';
  it('reads a point type from its handles', () => {
    expect(pointKind(parsePath(d), 1)).toBe('smooth');
    expect(pointKind(parsePath('M0 0 C10 -10 20 -10 30 0 C50 20 50 10 60 0'), 1)).toBe('straight');
    expect(pointKind(parsePath('M0 0 C10 -10 20 0 30 0 C40 10 50 10 60 0'), 1)).toBe('corner');
    expect(pointKind(parsePath('M0 0 L30 0'), 1)).toBe('corner');
  });
  it('a smooth point mirrors the other handle; straight keeps its length; corner leaves it', () => {
    const segs = parsePath(d);
    const s = setHandle(segs, 1, true, [30, 20]);
    expect(s[2].pts[0]).toEqual([30, 20]);
    expect(s[1].pts[1]).toEqual([30, -20]);
    const st = setHandle(segs, 1, true, [30, 20], 'straight');
    expect(st[1].pts[1][0]).toBeCloseTo(30);
    expect(st[1].pts[1][1]).toBeCloseTo(-Math.hypot(10, 10));
    const c = setHandle(segs, 1, false, [25, 5], 'corner');
    expect(writePath(c)).toBe('M0 0 C10 -10 25 5 30 0 C40 10 50 10 60 0');
  });
});

describe('Shape Effects', () => {
  it('shadow presets carry DeckCraft values, options override them', () => {
    expect(shadowOf(el('a'))).toBeNull();
    expect(shadowOf(el('a', { dropShadow: true }))).toMatchObject({ kind: 'outer', blur: 8, dist: 6, dir: 45, transparency: 0.6 });
    expect(shadowOf(el('a', { dropShadow: true, shadowKind: 'bottom', shadowOpts: { color: '#ff0000', dist: 10 } }))).toMatchObject({ dir: 90, dist: 10, color: '#ff0000' });
    expect(effectFilter(el('a', { dropShadow: true, shadowKind: 'bottom' }))).toBe('drop-shadow(0px 6px 8px rgba(0,0,0,0.4))');
    expect(effectFilter(el('a', { glow: '#ffd966', glowSize: 10, glowAlpha: 0 }))).toContain('rgba(255,217,102,1)');
  });
  it('reflection, bevel and 3-D rotation CSS', () => {
    expect(reflectCss(el('a', { reflection: true, reflectionOpts: { size: 0.9, transparency: 0.5, dist: 8 } }))).toBe('below 8px linear-gradient(transparent 10%, rgba(255,255,255,0.5))');
    expect(bevelCss(el('a', { bevel: true, bevelKind: 'angle' }))).toContain('4px 4px 0px');
    expect(transformOf(el('a', { rotate3d: { x: 10, y: 20, z: 5, persp: true }, rotation: 30 }))).toBe('perspective(900px) rotateX(10deg) rotateY(20deg) rotateZ(5deg) rotate(30deg)');
    expect(transformOf(el('a'))).toBeUndefined();
  });
  it('dash presets', () => {
    expect(dashPattern(undefined, 4)).toBeUndefined();
    expect(dashPattern('lgDash', 2)).toBe('16 6');
    expect(dashPattern('sysDot', 3)).toBe('3 3');
  });
});

describe('sizeUnit (Size and Position on an object or a group)', () => {
  it('sizes one object, a group as a whole, and leaves locked ones', () => {
    const a = el('a', { x: 0, y: 0, w: 100, h: 50 }), b = el('b', { x: 100, y: 0, w: 100, h: 50, groupId: 'g' }), c = el('c', { x: 0, y: 50, w: 100, h: 50, groupId: 'g' });
    const one = sizeUnit([a], ['a'], { scaleW: 200, lockAspect: true });
    expect(one[0]).toMatchObject({ w: 200, h: 100, lockAspect: true });
    const grp = sizeUnit([b, c], ['b', 'c'], { scaleW: 200 });
    expect(grp.map((e) => [e.x, e.w])).toEqual([[200, 200], [0, 200]]);
    const lk = [{ ...a, locked: true }];
    expect(sizeUnit(lk, ['a'], { w: 10 })).toBe(lk);
  });
});
