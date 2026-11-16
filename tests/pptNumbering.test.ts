import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importPpt } from '../src/domain/io/pptImport';
import { elementMarkers } from '../src/domain/textFormat';

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/ppt/${name}`, import.meta.url)));
const run = async (name: string) => {
  let n = 0;
  return importPpt(load(name), name, { group: 'g', newId: (p) => `${p}${++n}`, store: async () => 'm1' });
};

describe('.ppt numbering and hanging indents (LibreOffice)', () => {
  it('reads auto-numbered bullets with start numbers and continuing levels', async () => {
    const r = await run('libreoffice-numbering.ppt');
    const el = r.slides[0].elements![0];
    const { markers } = elementMarkers(el);
    expect(markers.slice(0, 5)).toEqual(['1.', '2.', 'a)', 'b)', '3.']);
    expect(markers[5]).toBeNull();
    expect(markers.slice(6, 8)).toEqual(['V.', 'VI.']);
    expect(markers[8]).toBe('•');
  });

  it('reads the left margin and the hanging first line in canvas px', async () => {
    const r = await run('libreoffice-numbering.ppt');
    const ps = r.slides[0].elements![0].paragraphs!;
    expect(ps[0]).toMatchObject({ marginLeft: 72, firstIndent: -54 });
    expect(ps[2].marginLeft).toBe(144);
  });
});
