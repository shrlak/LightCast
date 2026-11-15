import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module shared with the Electron main process
import { tileRects } from '../electron/windowTiles.mjs';
import { absorbOtherWindow, presentationFromHash, windowHash } from '../src/domain/windowSync';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Presentation } from '../src/domain/types';

type R = { x: number; y: number; width: number; height: number };
const area = { x: 100, y: 50, width: 1000, height: 600 };
const covers = (rs: R[]) => rs.reduce((s, r) => s + r.width * r.height, 0) === area.width * area.height;
const overlap = (a: R, b: R) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('Arrange All tiles', () => {
  it('fills the display with no overlap for any count', () => {
    for (let n = 1; n <= 9; n++) {
      const rs: R[] = tileRects(area, n);
      expect(rs).toHaveLength(n);
      expect(covers(rs)).toBe(true);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(rs[i], rs[j])).toBe(false);
    }
    expect(tileRects(area, 0)).toEqual([]);
    expect(tileRects(area, 2).map((r: R) => r.width)).toEqual([500, 500]);
  });
});

const pres = (id: string, title: string): Presentation => ({ id, title, slides: [], updatedAt: 1 } as unknown as Presentation);

describe('two editor windows share the library', () => {
  it('the hash names the presentation', () => {
    expect(presentationFromHash(windowHash('p 1'))).toBe('p 1');
    expect(presentationFromHash('')).toBeNull();
  });
  it('a presentation added in the other window is merged in; own edits stay; a settled pair yields null', () => {
    const base = { ...createSeedLibrary(), presentations: [pres('a', 'A')] };
    const mine = { ...base, presentations: [pres('a', 'A'), pres('mine', 'Mine')] };
    const stored = { ...base, presentations: [pres('a', 'A'), pres('theirs', 'Theirs')] };
    const merged = absorbOtherWindow(base, mine, stored)!;
    expect(merged.presentations.map((p) => p.id).sort()).toEqual(['a', 'mine', 'theirs']);
    expect(absorbOtherWindow(stored, merged, merged)).toBeNull();
    expect(absorbOtherWindow(base, base, base)).toBeNull();
  });
  it('keeps online songs, which are never stored', () => {
    const base = { ...createSeedLibrary(), presentations: [pres('a', 'A')] };
    const mine = { ...base, presentations: [...base.presentations, { ...pres('song', 'Song'), online: true } as Presentation] };
    const stored = { ...base, presentations: [pres('a', 'A'), pres('theirs', 'T')] };
    const merged = absorbOtherWindow(base, mine, stored)!;
    expect(merged.presentations.map((p) => p.id).sort()).toEqual(['a', 'song', 'theirs']);
  });
});
