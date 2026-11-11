import { describe, expect, it } from 'vitest';
import type { Slide, SlideElement } from '../src/domain/types';
import { centreOf, dedupePoints, drawnMotionPath, motionPathOverlays, pathArrow, presetMotionPoints, startAtCentre, withCustomPath } from '../src/domain/motionPath';
import { animSpec, motionPathPoints } from '../src/domain/animations';
import { prepareTimeline, sampleTimeline } from '../src/engine';

const box: SlideElement = { id: 'b', kind: 'shape', x: 100, y: 200, w: 200, h: 100 };
const slide = (more: Partial<Slide> = {}): Slide => ({ id: 's', group: 'G', text: '', elements: [box, { id: 'o', kind: 'shape', x: 0, y: 0, w: 10, h: 10 }], ...more });

describe('Custom Path drawing', () => {
  it('starts at the object centre, putting it in front of a first click elsewhere', () => {
    expect(centreOf(box)).toEqual([200, 250]);
    expect(startAtCentre([[600, 250]], [200, 250])).toEqual([[200, 250], [600, 250]]);
    // A first click on the centre is the centre (no doubled point).
    expect(startAtCentre([[202, 251], [600, 250]], [200, 250])).toEqual([[200, 250], [600, 250]]);
  });

  it('drops the repeated points a double-click or a slow drag leaves', () => {
    expect(dedupePoints([[0, 0], [0, 0.5], [10, 0], [10, 0], [10.5, 0.5], [20, 0]])).toEqual([[0, 0], [10, 0], [20, 0]]);
  });

  it('turns the drawing into the engine path (slide fractions from the centre), closed or open', () => {
    expect(drawnMotionPath([[560, 250], [560, 520], [560, 520]], [200, 250], false)).toBe('M 0 0 L 0.25 0 L 0.25 0.25 E');
    expect(drawnMotionPath([[560, 250], [560, 520]], [200, 250], true)).toBe('M 0 0 L 0.25 0 L 0.25 0.25 Z E');
    // A click on the centre alone (or a double-click there) draws nothing.
    expect(drawnMotionPath([[200, 250], [201, 250]], [200, 250], false)).toBeNull();
    // The overlay gets the same points back.
    expect(motionPathPoints('M 0 0 L 0.25 0 L 0.25 0.25 E', 200, 250)).toEqual([[200, 250], [560, 250], [560, 520]]);
  });

  it('sets (replacing what the object did) or adds a 2 s on-click Custom Path', () => {
    const fade = { id: 'a1', elementId: 'b', effect: 'fade', class: 'entrance' as const, start: 'click' as const, durationMs: 500, delayMs: 0 };
    const other = { ...fade, id: 'a2', elementId: 'o' };
    const s = slide({ animations: [fade, other] });
    const set = withCustomPath(s, 'b', 'M 0 0 L 0.1 0 E', false);
    expect(set.map((a) => a.id)).toEqual(['a2', set[1].id]);
    expect(set[1]).toMatchObject({ elementId: 'b', effect: 'customPath', class: 'path', start: 'click', durationMs: 2000, delayMs: 0, path: 'M 0 0 L 0.1 0 E' });
    const added = withCustomPath(s, 'b', 'M 0 0 L 0.1 0 E', true);
    expect(added.map((a) => a.effect)).toEqual(['fade', 'fade', 'customPath']);
    expect(added[2]).toMatchObject({ elementId: 'b', start: 'click', durationMs: 2000, path: 'M 0 0 L 0.1 0 E' });
  });

  it('plays: the slide timeline moves the object along the drawn path', () => {
    const path = drawnMotionPath([[560, 250], [560, 520]], [200, 250], false)!;
    const s = slide({ animations: withCustomPath(slide(), 'b', path, false) });
    const spec = animSpec(s)!;
    expect(spec.anims[0].path).toBe(path);
    const tl = prepareTimeline(spec)!;
    expect(tl.steps).toBe(1);
    expect(tl.durations[0]).toBeCloseTo(2, 1);
    const end = sampleTimeline(spec, 0, 2)!.b;
    expect(end.dx).toBeCloseTo(360, 0);
    expect(end.dy).toBeCloseTo(270, 0);
    // Half-way along the path (by length 630 px): past the corner, going down.
    const mid = sampleTimeline(spec, 0, 1.4)!.b;
    expect(mid.dx).toBeCloseTo(360, -1);
    expect(mid.dy).toBeGreaterThan(10);
    expect(mid.dy).toBeLessThan(270);
  });
});

describe('Motion path overlay', () => {
  it('draws the selected objects’ custom paths from their centres', () => {
    const s = slide({ animations: withCustomPath(slide(), 'b', 'M 0 0 L 0.25 0 L 0.25 0.25 Z E', false) });
    const ov = motionPathOverlays(s, s.elements!, ['b']);
    expect(ov).toHaveLength(1);
    expect(ov[0]).toMatchObject({ elementId: 'b', closed: true, points: [[200, 250], [560, 250], [560, 520]] });
    expect(motionPathOverlays(s, s.elements!, ['o'])).toEqual([]);
  });

  it('traces a preset path (Lines › Down) with the engine', () => {
    const a = { id: 'p1', elementId: 'b', effect: 'lines', class: 'path' as const, start: 'click' as const, durationMs: 2000, delayMs: 0 };
    const pts = presetMotionPoints(a, box);
    expect(pts[0]).toEqual([200, 250]);
    const last = pts[pts.length - 1];
    expect(Math.hypot(last[0] - 200, last[1] - 250)).toBeGreaterThan(20);
    const s = slide({ animations: [a, { ...a, id: 'e1', effect: 'fade', class: 'entrance' }] });
    expect(motionPathOverlays(s, s.elements!, ['b']).map((o) => o.id)).toEqual(['p1']);
  });

  it('points the start and end arrowheads along the path', () => {
    const right = pathArrow([[0, 0], [100, 0]], false, 10);
    expect(right[0][0]).toBeCloseTo(6);
    expect(right[0][1]).toBeCloseTo(0);
    const down = pathArrow([[0, 0], [100, 0], [100, 100], [100, 100]], true, 10);
    expect(down[0][0]).toBeCloseTo(100);
    expect(down[0][1]).toBeCloseTo(106);
  });
});
