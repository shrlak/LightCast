// Dashes, inline text styles, table borders and text transforms in .odp, against real LibreOffice 24.2 output
// (tests/fixtures/real/odp/libreoffice-text.odp, made by build_text.py), and the writer's output re-read.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseOdp, writeOdp } from '../src/domain/io/odp';
import type { DashStyle, SlideElement } from '../src/domain/types';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/real/odp/libreoffice-text.odp', import.meta.url)));
const opts = { storeImage: () => '' };
const DASHES: DashStyle[] = ['dash', 'sysDash', 'sysDot', 'dot', 'dashDot', 'lgDash', 'lgDashDot', 'lgDashDotDot', 'sysDashDot', 'sysDashDotDot'];

describe('real LibreOffice text, dashes and table borders', () => {
  it('tells all ten PowerPoint dash presets apart (LibreOffice names them differently: "Long Dash" is dash)', async () => {
    const els = (await parseOdp(fixture, opts)).slides[0].elements!;
    expect(DASHES.map((d) => els.find((e) => e.name === `Dash ${d}`)?.dash)).toEqual(DASHES);
  });

  it('reads runs with their own fonts, sizes, colours, a hyperlink, superscript and subscript', async () => {
    const doc = await parseOdp(fixture, opts);
    const runs = doc.slides[0].elements!.find((e) => e.name === 'Runs')!.paragraphs![0].runs!;
    expect(runs.find((r) => r.text === 'Big red serif ')).toMatchObject({ bold: true, color: '#cc0000', fontFamily: 'Times New Roman', fontSize: 56 });
    expect(runs.filter((r) => r.text === '2').map((r) => r.baseline)).toEqual(['super', 'sub']);
    expect(runs.find((r) => r.text === 'link')).toMatchObject({ link: 'https://example.com/' });
    // Spacing on one run only: LightCast keeps spacing per object, so it is left out and said.
    expect(doc.warnings.join(' ')).toContain('문자 간격');
  });

  it('reads table cell borders (LibreOffice keeps them in the cell paragraph properties)', async () => {
    const table = (await parseOdp(fixture, opts)).slides[0].elements!.find((e) => e.kind === 'table')!.table!;
    expect(table.rows[0][0].borders).toEqual({ t: { color: '#00aa00', width: 3 }, r: { color: '#0000ff', width: 1, dash: 'dash' }, b: { color: '#000000', width: 1 }, l: { color: '#ff0000', width: 2 } });
  });

  it('reads a Fontwork text as the PowerPoint text transform', async () => {
    const warp = (await parseOdp(fixture, opts)).slides[0].elements!.find((e) => e.name === 'Warp')!;
    expect(warp.warp).toBe('textArchUp');
    expect(warp.text).toBe('Curved text');
  });
});

describe('writing dashes, runs, spacing and borders', () => {
  it('round trips them', async () => {
    const els: SlideElement[] = [
      ...DASHES.map((d, i): SlideElement => ({ id: `d${i}`, kind: 'shape', shape: 'line', name: d, x: 50, y: 40 + i * 30, w: 500, h: 1, stroke: '#000000', strokeWidth: 6, dash: d })),
      { id: 't', kind: 'text', name: 'T', x: 600, y: 50, w: 700, h: 200, text: 'a link H2O', letterSpacing: 6, fontSize: 40,
        paragraphs: [{ text: 'a link H2O', runs: [{ text: 'a ' }, { text: 'link', link: 'https://example.org/' }, { text: ' H' }, { text: '2', baseline: 'sub' }, { text: 'O', fontFamily: 'Georgia', color: '#ff0000' }] }] },
      { id: 'tb', kind: 'table', name: 'Tb', x: 600, y: 400, w: 600, h: 200, table: { rows: [[{ text: 'a', borders: { l: { color: '#ff0000', width: 4 }, t: null, r: { color: '#0000ff', width: 2, dash: 'dash' } } }, { text: 'b' }]], cols: [300, 300], heights: [200], style: '', firstRow: false, firstCol: false, lastRow: false, lastCol: false, bandRow: false, bandCol: false } },
    ];
    const bytes = await writeOdp({ title: 't', properties: {}, slides: [{ id: 's', group: '', text: '', elements: els }] } as never, { loadMedia: () => null });
    const xml = await (await JSZip.loadAsync(bytes)).file('content.xml')!.async('string');
    expect(xml).toContain('<text:a xlink:href="https://example.org/" xlink:type="simple">link</text:a>');
    const back = (await parseOdp(bytes, opts)).slides[0].elements!;
    expect(DASHES.map((d) => back.find((e) => e.name === d)?.dash)).toEqual(DASHES);
    const t = back.find((e) => e.name === 'T')!;
    expect(t.letterSpacing).toBe(6);
    const runs = t.paragraphs![0].runs!;
    expect(runs.find((r) => r.text === 'link')?.link).toBe('https://example.org/');
    expect(runs.find((r) => r.text === '2')?.baseline).toBe('sub');
    expect(runs.find((r) => r.text === 'O')).toMatchObject({ fontFamily: 'Georgia', color: '#ff0000' });
    const cell = back.find((e) => e.kind === 'table')!.table!.rows[0][0];
    expect(cell.borders?.l).toEqual({ color: '#ff0000', width: 4 });
    expect(cell.borders?.r).toEqual({ color: '#0000ff', width: 2, dash: 'dash' });
    expect(cell.borders?.t).toBeUndefined();
  });
});
