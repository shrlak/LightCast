// What the slide show draws goes into a downloaded .pptx too: picture colour changes in the a:blip, a gradient's
// angle (lin@scaled) and focus (fillToRect), and table cells that mix formatting.
import { describe, expect, it } from 'vitest';
import { fillXml, patchPictureXml, pictureColorFromFilter, pictureColorXml } from '../src/domain/io/shapeXml';
import { pictureColorOf } from '../src/domain/pictureColor';
import { OFFICE_THEME } from '../src/domain/io/drawingml';
import { parseMarkup } from '../src/domain/io/markup';
import { readTable } from '../src/domain/io/pptxTable';
import { cellRuns } from '../src/engine';
import type { SlideElement } from '../src/domain/types';

const blipOf = (inner: string) => parseMarkup(`<a:blip xmlns:a="a">${inner}</a:blip>`).children[0];

describe('picture colour in the exported file', () => {
  it('writes the changes as PowerPoint does, and reads them back the same', () => {
    const pc = { grayscale: true, brightness: 0.2, contrast: -0.3, duotone: ['#000000', '#ff8000'] as [string, string], clearColor: '#ffffff', bilevel: 0.4 };
    expect(pictureColorOf(blipOf(pictureColorXml(pc)), OFFICE_THEME)).toEqual(pc);
  });

  it('puts them into the marked picture\'s a:blip and gives the picture its name back', () => {
    const xml = '<p:pic><p:nvPicPr><p:cNvPr id="2" name="lcp-1"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>';
    const out = patchPictureXml(xml, { marker: 'lcp-1', name: '사진', blip: '<a:grayscl/>' });
    expect(out).toContain('<a:blip r:embed="rId2"><a:grayscl/></a:blip>');
    expect(out).toContain('name="사진"');
  });

  it('turns a 1.2.6 CSS filter back into picture colour', () => {
    expect(pictureColorFromFilter('grayscale(1)')).toEqual({ grayscale: true });
    expect(pictureColorFromFilter('grayscale(1) contrast(100)')).toEqual({ bilevel: 0.5 });
    expect(pictureColorFromFilter('brightness(1.2) contrast(0.6)')).toEqual({ brightness: 0.2, contrast: -0.4 });
  });
});

describe('gradients in the exported file', () => {
  const el = (o: Partial<SlideElement>): SlideElement => ({ id: 'g', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, gradient: ['#ff0000', '#0000ff'], gradientAngle: 45, ...o });
  it('keeps lin@scaled as the shape was drawn', () => {
    expect(fillXml(el({ gradientScaled: false }))).toContain('scaled="0"');
    expect(fillXml(el({}))).toContain('scaled="1"');
  });
  it('keeps a path gradient\'s focus', () => {
    expect(fillXml(el({ gradientType: 'radial', gradientCenter: [0.25, 1] }))).toContain('<a:fillToRect l="25000" t="100000" r="75000" b="0"/>');
  });
});

describe('table cells that mix formatting', () => {
  it('keep each run, and drop them once the text is edited in LightCast', () => {
    const tbl = parseMarkup(`<a:tbl xmlns:a="a"><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="370840"><a:tc><a:txBody><a:p>
      <a:r><a:rPr b="1"/><a:t>주일</a:t></a:r><a:r><a:rPr sz="1200"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t> 오전</a:t></a:r>
      </a:p></a:txBody></a:tc></a:tr></a:tbl>`).children[0];
    const { table } = readTable(tbl, 144, 58, OFFICE_THEME, null);
    const cell = table.rows[0][0];
    expect(cell.runs).toEqual([[{ text: '주일', bold: true }, { text: ' 오전', color: '#ff0000', fontSize: 24 }]]);
    expect(cellRuns(cell)).toBe(cell.runs);
    expect(cellRuns({ ...cell, text: '주일 저녁' })).toBeNull();
  });
});
