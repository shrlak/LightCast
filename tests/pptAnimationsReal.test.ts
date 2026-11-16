import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePpt } from '../src/domain/io/pptBinary';
import { importPpt } from '../src/domain/io/pptImport';
import { effectOf } from '../src/domain/io/pptAnimations';

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/ppt/${name}`, import.meta.url)));

describe('.ppt animations (PowerPoint 2002 time tree, LibreOffice-written)', () => {
  it('reads click / with / after effects with their preset, direction, duration and target', () => {
    const doc = parsePpt(load('libreoffice-animations.ppt'));
    const a = doc.slides[0].animations!;
    expect(a.map((x) => [x.presetId, x.subtype, x.start, x.durationMs])).toEqual([[1, 0, 'click', 0], [10, 0, 'with', 500], [2, 4, 'after', 750], [22, 8, 'click', 1000]]);
    const spids = doc.slides[0].shapes.map((s) => s.spid);
    for (const x of a) expect(spids).toContain(x.spid);
    expect(new Set(a.map((x) => x.spid)).size).toBe(4);
  });

  it('becomes LightCast entrance animations on the imported boxes', async () => {
    let n = 0;
    const r = await importPpt(load('libreoffice-animations.ppt'), 'a', { group: 'g', newId: (p) => `${p}${++n}`, store: async () => 'm' });
    const s = r.slides[0];
    const anims = s.animations!;
    expect(anims.map((x) => [x.effect, x.option, x.start, x.durationMs, x.delayMs])).toEqual([
      ['appear', undefined, 'click', 0, 0], ['fade', undefined, 'with', 500, 0], ['fly', 'b', 'after', 750, 0], ['wipe', 'l', 'click', 1000, 0],
    ]);
    // In slide order: Box 1 … Box 4.
    const text = (id: string) => s.elements!.find((e) => e.id === id)?.text;
    expect(anims.map((x) => text(x.elementId))).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4']);
    expect(r.warnings).toEqual([]);
  });

  it('maps only entrance effects it knows', () => {
    expect(effectOf({ presetId: 2, subtype: 9, presetClass: 1 })).toEqual({ effect: 'fly', option: 'lt' });
    expect(effectOf({ presetId: 10, subtype: 0, presetClass: 2 })).toBeNull();
    expect(effectOf({ presetId: 999, subtype: 0, presetClass: 1 })).toBeNull();
  });
});
