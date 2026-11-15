// Master pages in .odp: read as the deck's master and layouts (slides keep their layoutId), or flattened onto the slides.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOdp, writeOdp } from '../src/domain/io/odp';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/real/odp/${n}`, import.meta.url)));
const opts = { storeImage: () => '' };

describe('master pages', () => {
  it('real LibreOffice deck: its master bar becomes the master, every page a layout, slides keep layoutId', async () => {
    const doc = await parseOdp(fixture('libreoffice-rich.odp'), opts);
    expect(doc.master?.elements.map((e) => e.name)).toContain('MasterBar');
    const layouts = doc.master!.layouts!;
    expect(layouts.length).toBeGreaterThan(0);
    for (const s of doc.slides) expect(layouts.some((l) => l.id === s.layoutId)).toBe(true);
    // The bar is a master copy on the slide (not a shape of its own), so editing the master changes every slide.
    const s1 = doc.slides[0];
    expect(s1.elements!.find((e) => e.master)).toMatchObject({ name: 'MasterBar', fill: '#1e1e78' });
    expect(s1.elements!.some((e) => e.name?.startsWith('마스터: '))).toBe(false);
  });

  it('real LibreOffice deck: layouts carry placeholders with their places', async () => {
    const doc = await parseOdp(fixture('libreoffice-transitions.odp'), opts);
    const names = doc.master!.layouts!.map((l) => l.name);
    expect(names).toContain('Title Slide');
    expect(names).toContain('Title and Content');
    const content = doc.master!.layouts!.find((l) => l.name === 'Title and Content')!;
    expect(content.elements.some((e) => e.placeholder === 'title')).toBe(true);
    expect(content.elements.some((e) => e.placeholder === 'body')).toBe(true);
    expect(doc.slides.every((s) => !!s.layoutId)).toBe(true);
  });

  it('flatten mode puts the master objects on the slides as before and returns no master', async () => {
    const doc = await parseOdp(fixture('libreoffice-rich.odp'), { ...opts, masterMode: 'flatten' });
    expect(doc.master).toBeUndefined();
    expect(doc.slides[0].layoutId).toBeUndefined();
    expect(doc.slides[0].elements![0].name).toBe('마스터: MasterBar');
  });

  it('master and layouts survive writing and reading again', async () => {
    const doc = await parseOdp(fixture('libreoffice-rich.odp'), opts);
    const bytes = await writeOdp({ title: 't', properties: {}, slides: doc.slides, master: doc.master } as never, { loadMedia: () => null });
    const back = await parseOdp(bytes, opts);
    expect(back.master?.elements.map((e) => e.name)).toContain('MasterBar');
    expect(back.master!.layouts!.length).toBe(doc.master!.layouts!.length);
    expect(back.slides.every((s) => !!s.layoutId)).toBe(true);
  });
});
