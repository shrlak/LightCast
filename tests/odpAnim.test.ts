// .odp animations as real LibreOffice 24.2 writes them (tests/fixtures/real/odp/libreoffice-animations2.odp, made by
// build_animations2.py from PowerPoint timing XML), and the writer's output re-read.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseOdp, writeOdp, animationsXml } from '../src/domain/io/odp';
import type { Presentation, SlideAnimation, SlideElement } from '../src/domain/types';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/odp/${n}`, import.meta.url)));
const read = (n: string) => parseOdp(fixture(n), { storeImage: (b, m) => `img:${m}:${b.length}` });

describe('real LibreOffice .odp animations', () => {
  it('reads fly in / out directions, zoom, spin, emphasis, wipe, motion paths, repeat and a trigger', async () => {
    const s = (await read('libreoffice-animations2.odp')).slides[0];
    const name = (id: string) => s.elements!.find((e) => e.id === id)?.name;
    const list = (s.animations ?? []).map((a) => ({ box: name(a.elementId), effect: a.effect, class: a.class, option: a.option, start: a.start, repeat: a.repeat, trigger: a.trigger ? name(a.trigger) : undefined }));
    expect(list).toEqual([
      { box: 'Box 0', effect: 'fly', class: 'entrance', option: 'l', start: 'click' },
      { box: 'Box 1', effect: 'fly', class: 'entrance', option: 't', start: 'click' },
      { box: 'Box 2', effect: 'fly', class: 'entrance', option: 'r', start: 'click' },
      { box: 'Box 3', effect: 'flyOut', class: 'exit', option: 'l', start: 'click' },
      { box: 'Box 4', effect: 'flyOut', class: 'exit', option: 'b', start: 'click' },
      { box: 'Box 5', effect: 'zoom', class: 'entrance', start: 'click' },
      { box: 'Box 6', effect: 'zoomOut', class: 'exit', start: 'click' },
      { box: 'Box 7', effect: 'spin', class: 'emphasis', start: 'click' },
      { box: 'Box 8', effect: 'growShrink', class: 'emphasis', start: 'with' },
      { box: 'Box 9', effect: 'pulse', class: 'emphasis', start: 'click', repeat: 3 },
      { box: 'Box 10', effect: 'objectColor', class: 'emphasis', start: 'click' },
      { box: 'Box 11', effect: 'boldFlash', class: 'emphasis', start: 'click' },
      { box: 'Box 12', effect: 'lines', class: 'path', start: 'click' },
      { box: 'Box 0', effect: 'spin', class: 'emphasis', start: 'click', trigger: 'Box 13' },
    ].map((x) => ({ option: undefined, repeat: undefined, trigger: undefined, ...x })));
    expect(s.animations![12].path).toBe('M 0 0 L 0.25 0.1 E');
    expect(s.animations![7].durationMs).toBe(2000);
  });
});

const box = (id: string, name: string): SlideElement => ({ id, kind: 'shape', shape: 'rect', name, x: 100, y: 100, w: 200, h: 100, fill: '#ff0000' });
const anim = (id: string, el: string, effect: string, cls: SlideAnimation['class'], extra: Partial<SlideAnimation> = {}): SlideAnimation =>
  ({ id, elementId: el, effect, class: cls, start: 'click', durationMs: 600, delayMs: 0, ...extra });

describe('animations written to .odp', () => {
  it('round trips direction, repeat, triggers, motion paths and effects ODF has no preset for', async () => {
    const els = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => box(id, `Obj ${i}`));
    const list: SlideAnimation[] = [
      anim('1', 'a', 'fly', 'entrance', { option: 'lt' }),
      anim('2', 'b', 'wipe', 'entrance', { option: 'r', start: 'with' }),
      anim('3', 'c', 'flyOut', 'exit', { option: 't' }),
      anim('4', 'd', 'zoomOut', 'exit', { start: 'after', delayMs: 250 }),
      anim('5', 'e', 'pulse', 'emphasis', { repeat: 3 }),
      anim('6', 'f', 'spin', 'emphasis', { option: 'counterClockwise', repeat: 4294967295 }),
      anim('7', 'g', 'bounce', 'entrance'),
      anim('8', 'h', 'lines', 'path', { path: 'M 0 0 L 0.2 0.1 E' }),
      anim('9', 'a', 'boldFlash', 'emphasis', { trigger: 'b' }),
    ];
    const pres: Pick<Presentation, 'title' | 'slides' | 'properties' | 'master'> = { title: 't', properties: {}, slides: [{ id: 's', group: '', text: '', elements: els, animations: list }] } as never;
    const bytes = await writeOdp(pres, { loadMedia: () => null });
    const xml = await (await JSZip.loadAsync(bytes)).file('content.xml')!.async('string');
    expect(xml).toContain('presentation:preset-id="ooo-entrance-fly-in" presentation:preset-sub-type="from-top-left"');
    expect(xml).toContain('presentation:node-type="interactive-sequence"');
    expect(xml).toContain('smil:begin="id2.click+0s"');
    expect(xml).toContain('svg:path="M 0 0 L 0.2 0.1"');
    const back = (await parseOdp(bytes, { storeImage: () => '' })).slides[0];
    const n = (id: string) => back.elements!.find((e) => e.id === id)?.name;
    const got = back.animations!.map((a) => [n(a.elementId), a.effect, a.option, a.start, a.repeat, a.trigger && n(a.trigger)]);
    expect(got).toEqual([
      ['Obj 0', 'fly', 'lt', 'click', undefined, undefined],
      ['Obj 1', 'wipe', 'r', 'with', undefined, undefined],
      ['Obj 2', 'flyOut', 't', 'click', undefined, undefined],
      ['Obj 3', 'zoomOut', undefined, 'after', undefined, undefined],
      ['Obj 4', 'pulse', undefined, 'click', 3, undefined],
      ['Obj 5', 'spin', 'counterClockwise', 'click', 4294967295, undefined],
      ['Obj 6', 'bounce', undefined, 'click', undefined, undefined],
      ['Obj 7', 'lines', undefined, 'click', undefined, undefined],
      ['Obj 0', 'boldFlash', undefined, 'click', undefined, 'Obj 1'],
    ]);
    expect(back.animations![3].delayMs).toBe(250);
    expect(back.animations![7].path).toBe('M 0 0 L 0.2 0.1 E');
  });

  it('leaves out an effect with no ODF form and an unknown object, never throws', () => {
    const a = anim('x', 'a', 'wave', 'emphasis');
    expect(animationsXml([a], new Map([['a', 'id1']]))).toBe('');
    expect(animationsXml([anim('y', 'zz', 'fade', 'entrance')], new Map())).toBe('');
    expect(animationsXml(undefined, new Map())).toBe('');
  });
});
