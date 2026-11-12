import { describe, expect, it } from 'vitest';
import { copyFormat, applyFormat } from '../src/domain/formatPainter';
import type { SlideElement } from '../src/domain/types';

describe('Format Painter carries the shapes-branch look', () => {
  it('copies line cap / join / compound, fill transparency and gradient stops between shapes', () => {
    const src = { id: 'a', kind: 'shape', x: 0, y: 0, w: 10, h: 10, stroke: '#fff', cap: 'round', join: 'bevel', compound: 'dbl', fillTransparency: 0.4, gradientStops: [{ pos: 0, color: '#000' }, { pos: 1, color: '#fff' }] } as unknown as SlideElement;
    const dst = { id: 'b', kind: 'shape', x: 0, y: 0, w: 10, h: 10, compound: 'tri' } as unknown as SlideElement;
    const out = applyFormat(dst, copyFormat(src));
    expect(out).toMatchObject({ cap: 'round', join: 'bevel', compound: 'dbl', fillTransparency: 0.4 });
    expect(out.gradientStops).toHaveLength(2);
  });
});
