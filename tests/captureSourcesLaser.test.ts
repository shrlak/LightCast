import { describe, expect, it } from 'vitest';
import { cropFromDrag, cropSizeLabel, cropToShown, filterSources, isWholePicture, keepSelection, normalizeSources } from '../src/domain/captureSources';
import { edgeLaserPosition, laserDue, parseLaserMessage } from '../src/domain/laserPointer';

describe('capture source picker', () => {
  const raw = [
    { id: 'window:9:0', name: ' 메모장 ', thumbnail: 'data:image/png;base64,AA' },
    { id: 'screen:1:0', name: '', thumbnail: 'javascript:x' },
    { id: 'screen:1:0', name: 'dup' },
    { name: 'no id' },
    { id: 'window:7:0', name: '' },
  ];
  it('cleans, names and puts screens first', () => {
    const l = normalizeSources(raw);
    expect(l.map((s) => s.id)).toEqual(['screen:1:0', 'window:9:0', 'window:7:0']);
    expect(l[0]).toMatchObject({ name: '화면 1', kind: 'screen', thumbnail: '' });
    expect(l[1]).toMatchObject({ name: '메모장', kind: 'window', thumbnail: 'data:image/png;base64,AA' });
    expect(l[2].name).toBe('이름 없는 창');
  });
  it('filters and keeps a valid selection', () => {
    const l = normalizeSources(raw);
    expect(filterSources(l, 'window')).toHaveLength(2);
    expect(filterSources(l, 'all')).toHaveLength(3);
    expect(keepSelection(l, 'window:9:0')).toBe('window:9:0');
    expect(keepSelection(l, 'gone')).toBe('screen:1:0');
    expect(keepSelection([], 'x')).toBeNull();
  });
});

describe('crop', () => {
  const shown = { w: 400, h: 300 }, natural = { w: 1600, h: 1200 };
  it('maps a drag in either direction to picture pixels, clamped', () => {
    expect(cropFromDrag({ x: 10, y: 20 }, { x: 110, y: 120 }, shown, natural)).toEqual({ x: 40, y: 80, w: 400, h: 400 });
    expect(cropFromDrag({ x: 110, y: 120 }, { x: 10, y: 20 }, shown, natural)).toEqual({ x: 40, y: 80, w: 400, h: 400 });
    expect(cropFromDrag({ x: -50, y: -50 }, { x: 999, y: 999 }, shown, natural)).toEqual({ x: 0, y: 0, w: 1600, h: 1200 });
  });
  it('ignores stray clicks and bad sizes', () => {
    expect(cropFromDrag({ x: 5, y: 5 }, { x: 6, y: 6 }, shown, natural)).toBeNull();
    expect(cropFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { w: 0, h: 0 }, natural)).toBeNull();
  });
  it('round trips to shown pixels and knows the whole picture', () => {
    expect(cropToShown({ x: 40, y: 80, w: 400, h: 400 }, shown, natural)).toEqual({ x: 10, y: 20, w: 100, h: 100 });
    expect(isWholePicture({ x: 0, y: 0, w: 1600, h: 1200 }, natural)).toBe(true);
    expect(isWholePicture({ x: 1, y: 0, w: 1599, h: 1200 }, natural)).toBe(false);
    expect(cropSizeLabel({ w: 10, h: 20 })).toBe('10 × 20 픽셀');
  });
});

describe('laser over the network', () => {
  it('accepts only well-formed messages and clamps them', () => {
    expect(parseLaserMessage({ type: 'laser', x: 0.25, y: 0.5 })).toEqual({ type: 'laser', x: 0.25, y: 0.5 });
    expect(parseLaserMessage({ type: 'laser', x: 4, y: -2 })).toEqual({ type: 'laser', x: 1, y: 0 });
    expect(parseLaserMessage({ type: 'laser', off: true })).toEqual({ type: 'laser', off: true });
    expect(parseLaserMessage({ type: 'laser', x: 'a', y: 1 })).toBeNull();
    expect(parseLaserMessage({ type: 'laser', x: NaN, y: 1 })).toBeNull();
    expect(parseLaserMessage({ type: 'state' })).toBeNull();
    expect(parseLaserMessage(null)).toBeNull();
  });
  it('limits the send rate but never holds back "off"', () => {
    expect(laserDue(1000, 1010, { x: 0, y: 0 })).toBe(false);
    expect(laserDue(1000, 1040, { x: 0, y: 0 })).toBe(true);
    expect(laserDue(1000, 1001, null)).toBe(true);
  });
});

describe('laser in the two-projector layout', () => {
  // 1440 x 1080 slide, 200 px overlap: each projector shows 820 px of it.
  const edge = (part: 'left' | 'right') => ({ part, overlap: 200 });
  it('puts a point of the left part on the left projector only', () => {
    const l = edgeLaserPosition({ x: 410 / 1440, y: 0.5 }, edge('left'), 1440, 1080, 4 / 3);
    expect(l!.x).toBeCloseTo(0.5, 5);
    expect(l!.y).toBeCloseTo(0.5, 5);
    expect(edgeLaserPosition({ x: 1000 / 1440, y: 0.5 }, edge('left'), 1440, 1080, 4 / 3)).toBeNull();
    expect(edgeLaserPosition({ x: 100 / 1440, y: 0.5 }, edge('right'), 1440, 1080, 4 / 3)).toBeNull();
  });
  it('shows the overlap on both projectors at the same slide point', () => {
    const p = { x: 0.5, y: 0.5 };
    expect(edgeLaserPosition(p, edge('left'), 1440, 1080, 4 / 3)!.x).toBeCloseTo(720 / 820, 5);
    expect(edgeLaserPosition(p, edge('right'), 1440, 1080, 4 / 3)!.x).toBeCloseTo(100 / 820, 5);
  });
  it('uses the slide height on the screen: the slide is drawn 1440/820 screen-widths wide', () => {
    // 1.756 widths * 0.75 / (16/9) = 0.741 screen-heights tall, centred.
    const top = edgeLaserPosition({ x: 0.1, y: 0 }, edge('left'), 1440, 1080, 16 / 9)!;
    expect(top.y).toBeCloseTo(0.5 - 0.741 / 2, 2);
  });
  it('is null with no edge blend', () => {
    expect(edgeLaserPosition({ x: 0.5, y: 0.5 }, { part: 'none', overlap: 0 }, 1440, 1080, 1.5)).toBeNull();
  });
});
