// .odp transitions (direction, speed) and page size, against real LibreOffice 24.2 output
// (tests/fixtures/real/odp/libreoffice-transitions.odp, a 33.866 x 19.05 cm deck made by build_transitions.py).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseOdp, writeOdp } from '../src/domain/io/odp';
import type { Slide } from '../src/domain/types';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/real/odp/libreoffice-transitions.odp', import.meta.url)));
const opts = { storeImage: () => '' };

describe('real LibreOffice transitions and page size', () => {
  it('reads kind, direction and speed', async () => {
    const doc = await parseOdp(fixture, opts);
    const t = doc.slides.map((s) => s.transition && [s.transition.kind, s.transition.option, s.transition.duration]);
    expect(t).toEqual([
      ['fx:push', 'u', 1000],        // push dir="u", slow
      ['fx:wipe', 'r', 500],         // wipe dir="r", fast
      ['fx:cover', 'ld', 750],       // cover dir="ld": comes in from the top right
      ['fx:uncover', 'r', 750],      // pull dir="r"
      ['fx:split', 'vertIn', 750],
      ['fx:blinds', 'vert', 750],
      ['fade', undefined, 750],
    ]);
  });

  it('reads the real page size, scales onto the 4:3 canvas and says so', async () => {
    const doc = await parseOdp(fixture, opts);
    expect(doc.pageCm.w).toBeCloseTo(33.866, 2);
    expect(doc.pageCm.h).toBeCloseTo(19.05, 2);
    expect(doc.warnings.join('')).toContain('4:3');
    expect(doc.slides[0].importSource?.pageCm?.w).toBeCloseTo(33.866, 2);
  });

  it('writes direction, speed and the original page height, and reads them back', async () => {
    const mk = (kind: string, option?: string, duration = 1000): Slide => ({ id: kind + option, group: '', text: '', elements: [], transition: { kind: kind as never, duration, ...(option ? { option } : {}) } });
    const slides = [mk('fx:push', 'l', 400), mk('fx:wipe', 'u'), mk('fx:cover', 'rd', 800), mk('fx:uncover', 'u'), mk('fx:split', 'horzOut'), mk('fade', 'throughBlack')];
    const bytes = await writeOdp({ title: 't', properties: {}, slides, master: undefined } as never, { loadMedia: () => null, pageCm: { w: 33.866, h: 19.05 } });
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('styles.xml')!.async('string')).toContain('fo:page-width="25.4cm" fo:page-height="19.05cm"');
    const back = await parseOdp(bytes, opts);
    expect(back.slides.map((s) => [s.transition?.kind, s.transition?.option, s.transition?.duration])).toEqual([
      ['fx:push', 'l', 400], ['fx:wipe', 'u', 1000], ['fx:cover', 'rd', 800], ['fx:uncover', 'u', 1000], ['fx:split', 'horzOut', 1000], ['fade', 'throughBlack', 1000],
    ]);
  });
});
