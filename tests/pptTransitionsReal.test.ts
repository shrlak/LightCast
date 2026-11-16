import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importPpt, transitionOf } from '../src/domain/io/pptImport';

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/ppt/${name}`, import.meta.url)));

describe('.ppt transition directions (LibreOffice-written)', () => {
  it('maps cover, uncover, wipe, push and fade through black to the pptx directions they came from', async () => {
    let n = 0;
    const r = await importPpt(load('libreoffice-transitions.ppt'), 't', { group: 'g', newId: (p) => `${p}${++n}`, store: async () => 'm' });
    const got = r.slides.map((s) => [s.transition?.kind, s.transition?.option]);
    expect(got).toEqual([
      ['fx:cover', 'l'], ['fx:cover', 'u'], ['fx:cover', 'rd'], ['fx:uncover', 'd'],
      ['fx:wipe', 'l'], ['fx:push', 'l'], ['fx:push', 'r'], ['fade', 'throughBlack'],
    ]);
  });

  it('reads the remaining numbering from the same conversion', () => {
    const t = (effect: number, direction: number) => transitionOf({ effect, direction, speed: 1, onClick: true, afterMs: 0 }).transition;
    expect(t(13, 0)).toMatchObject({ kind: 'fx:split', option: 'horzOut' });
    expect(t(13, 3)).toMatchObject({ kind: 'fx:split', option: 'vertIn' });
    expect(t(2, 1)).toMatchObject({ kind: 'fx:blinds', option: 'horz' });
    expect(t(3, 1)).toMatchObject({ kind: 'fx:checker', option: 'vert' });
    expect(t(9, 5)).toMatchObject({ kind: 'fx:wipe', option: 'ru' });
    expect(t(7, 6)).toMatchObject({ kind: 'fx:uncover', option: 'ld' });
    expect(t(23, 0)).toMatchObject({ kind: 'fade', option: 'smoothly' });
  });
});
