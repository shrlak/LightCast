// Connectors in .odp: real LibreOffice 24.2 draw:connector (tests/fixtures/real/odp/libreoffice-connectors.odp, from
// build_connectors.py), glued to objects by draw:start-shape / draw:start-glue-point, and the writer's output re-read.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseOdp, writeOdp } from '../src/domain/io/odp';
import type { SlideElement } from '../src/domain/types';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/real/odp/libreoffice-connectors.odp', import.meta.url)));
const opts = { storeImage: () => '' };

describe('connectors', () => {
  it('reads straight, elbow and curved connectors with their glued ends (LibreOffice glue ids are top, right, bottom, left)', async () => {
    const els = (await parseOdp(fixture, opts)).slides[0].elements!;
    const by = (n: string) => els.find((e) => e.name === n)!;
    const a = by('Box A'), b = by('Box B'), c = by('Oval C');
    const straight = by('Straight A-B');
    expect(straight.shape).toBe('straightConnector1');
    expect(straight.connect).toEqual({ from: { id: a.id, site: 3 }, to: { id: b.id, site: 1 } });
    // Bottom of A to the top of B leaves downward: PowerPoint's elbow turned a quarter.
    const elbow = by('Elbow A-B');
    expect(elbow).toMatchObject({ shape: 'bentConnector3', rotation: 90 });
    expect(elbow.connect).toEqual({ from: { id: a.id, site: 2 }, to: { id: b.id, site: 0 } });
    // The oval lists glue points of its own: ids count from 4.
    const curve = by('Curve C-B');
    expect(curve.shape).toBe('curvedConnector3');
    expect(curve.connect).toEqual({ from: { id: c.id, site: 3 }, to: { id: b.id, site: 2 } });
    const free = by('Elbow free');
    expect(free).toMatchObject({ shape: 'bentConnector3' });
    expect(free.rotation).toBeUndefined();
    expect(free.connect).toBeUndefined();
  });

  it('writes connectors and their glue, and reads them back', async () => {
    const rect = (id: string, x: number, y: number): SlideElement => ({ id, kind: 'shape', shape: 'rect', name: id, x, y, w: 300, h: 150, fill: '#cccccc' });
    const els: SlideElement[] = [
      { id: 'k1', kind: 'shape', shape: 'bentConnector3', name: 'k1', x: 400, y: 200, w: 300, h: 400, stroke: '#000000', strokeWidth: 6, arrowEnd: true, connect: { from: { id: 'a', site: 3 }, to: { id: 'b', site: 0 } } },
      { id: 'k2', kind: 'shape', shape: 'bentConnector3', name: 'k2', x: 100, y: 500, w: 300, h: 100, rotation: 90, flipH: true, stroke: '#000000', strokeWidth: 6, connect: { from: { id: 'gone', site: 0 } } },
      { id: 'k3', kind: 'shape', shape: 'curvedConnector3', name: 'k3', x: 800, y: 100, w: 200, h: 200, flipV: true, stroke: '#ff0000', strokeWidth: 6 },
      rect('a', 100, 100), rect('b', 700, 650),
    ];
    const bytes = await writeOdp({ title: 't', properties: {}, slides: [{ id: 's', group: '', text: '', elements: els }] } as never, { loadMedia: () => null });
    const xml = await (await JSZip.loadAsync(bytes)).file('content.xml')!.async('string');
    expect(xml).toContain('draw:start-glue-point="1"'); // site 3 (right) is LibreOffice's glue point 1
    expect(xml).toContain('draw:end-glue-point="0"');
    expect(xml).not.toContain('@@G');
    expect(xml).not.toContain('"gone"');
    const back = (await parseOdp(bytes, opts)).slides[0].elements!;
    const by = (n: string) => back.find((e) => e.name === n)!;
    expect(by('k1')).toMatchObject({ shape: 'bentConnector3', x: 400, y: 200, w: 300, h: 400, arrowEnd: true });
    expect(by('k1').connect).toEqual({ from: { id: by('a').id, site: 3 }, to: { id: by('b').id, site: 0 } });
    expect(by('k2').rotation).toBe(90);
    expect(by('k2').connect).toBeUndefined();
    expect(by('k3')).toMatchObject({ shape: 'curvedConnector3', flipV: true, stroke: '#ff0000' });
  });
});
