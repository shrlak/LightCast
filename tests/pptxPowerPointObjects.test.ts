import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import { makeChart, makeTable } from '../src/domain/editOps';
import type { Presentation } from '../src/domain/types';

async function files(p: Presentation) {
  const lib = { ...createSeedLibrary(), presentations: [p] };
  const pptx = await buildPptx(lib, { presentation: p });
  return JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
}

describe('PPTX export of PowerPoint objects made in FreeCast', () => {
  const table = makeTable(2, 3)!;
  table.table!.rows[0][0].text = '시간';
  const deck: Presentation = {
    id: 'd', title: 'objects', themeId: 'theme_classic', slides: [{
      id: 's', group: 'Slide', text: '', elements: [
        { id: 'star', kind: 'shape', shape: 'star5', x: 100, y: 100, w: 300, h: 300, fill: '#2E6FD8', stroke: '#1B4FA8', strokeWidth: 4, flipH: true },
        { id: 'arrow', kind: 'shape', shape: 'rightArrow', x: 500, y: 100, w: 300, h: 150, fill: '#ff0000', text: '다음' },
        { id: 'rich', kind: 'text', x: 100, y: 500, w: 900, h: 120, text: '주 예수', fontSize: 60, runs: [[{ text: '주 ' }, { text: '예수', bold: true, fontSize: 90 }]] },
        { ...table, x: 100, y: 700 },
        { ...makeChart('pie'), id: 'chart' },
        { id: 'gone', kind: 'shape', shape: 'heart', x: 0, y: 0, w: 10, h: 10, hidden: true },
      ],
    }],
  };

  it('writes preset shapes by their OOXML names, with flips, lines and their text', async () => {
    const xml = await (await files(deck)).file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('prst="star5"');
    expect(xml).toContain('prst="rightArrow"');
    expect(xml).toContain('flipH="1"');
    expect(xml).toContain('다음');
    expect(xml).not.toContain('prst="heart"');
  });

  it('keeps characters formatted on their own', async () => {
    const xml = await (await files(deck)).file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/<a:rPr[^>]*sz="4500"[^>]*b="1"[^>]*>|<a:rPr[^>]*b="1"[^>]*sz="4500"[^>]*>/);
  });

  it('writes the table and a native chart', async () => {
    const zip = await files(deck);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('<a:tbl>');
    expect(xml).toContain('시간');
    expect(Object.keys(zip.files).some((f) => f.startsWith('ppt/charts/chart'))).toBe(true);
  });
});
